// Sound Pong - Game state synchronized over audio using Quiet.js

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// UI Elements
const btnHost = document.getElementById('btnHost');
const btnJoin = document.getElementById('btnJoin');
const btnListen = document.getElementById('btnListen');
const profileSelect = document.getElementById('profileSelect');
const statusEl = document.getElementById('status');
const roleIndicator = document.getElementById('roleIndicator');
const roleText = document.getElementById('roleText');
const score1El = document.getElementById('score1');
const score2El = document.getElementById('score2');
const syncDot = document.getElementById('syncDot');
const syncStatus = document.getElementById('syncStatus');
const debugPanel = document.getElementById('debugPanel');
const debugTx = document.getElementById('debugTx');
const debugRx = document.getElementById('debugRx');
const debugLastSync = document.getElementById('debugLastSync');
const debugLatency = document.getElementById('debugLatency');

// Communication constants
const START = '\u0002';
const END = '\u0003';
const SYNC_INTERVAL = 100; // ms between sync packets (host sends state)
const INPUT_SEND_INTERVAL = 80; // ms between input packets (guest sends input)
const TIMEOUT_MS = 3000; // Connection timeout

// Game constants
const PADDLE_WIDTH = 12;
const PADDLE_HEIGHT = 100;
const BALL_SIZE = 15;
const PADDLE_SPEED = 8;
const BALL_SPEED_INITIAL = 6;
const BALL_SPEED_INCREMENT = 0.3;
const MAX_BALL_SPEED = 15;
const WIN_SCORE = 11;

// Game state
let gameState = {
    ball: { x: 400, y: 250, vx: 0, vy: 0 },
    paddle1: { y: 200 }, // Host (left)
    paddle2: { y: 200 }, // Guest (right)
    score1: 0,
    score2: 0,
    gameStarted: false,
    paused: true,
    winner: null,
    timestamp: 0,
    seq: 0
};

// Local state
let role = null; // 'host' or 'guest'
let isReady = false;
let transmitter = null;
let receiver = null;
let receiverActive = false;
let currentProfile = 'audible-fsk-fast';
let rxBuffer = '';
let lastSyncTime = 0;
let lastInputTime = 0;
let syncTimer = null;
let inputTimer = null;
let connectionTimer = null;
let txCount = 0;
let rxCount = 0;
let lastReceivedTimestamp = 0;
let joinInterval = null;
let joinInterval = null;

// Input state
let keysPressed = {
    up: false,
    down: false
};

// Debug mode (press D to toggle)
let debugMode = false;

// Transmission queue to prevent overlapping sends
let isSending = false;
let sendQueue = [];

// ==================== Quiet.js Integration ====================

function setStatus(text, tone = 'info') {
    statusEl.textContent = text;
    statusEl.classList.remove('ok', 'error', 'warning');
    if (tone === 'ok') statusEl.classList.add('ok');
    if (tone === 'error') statusEl.classList.add('error');
    if (tone === 'warning') statusEl.classList.add('warning');
}

function setSyncStatus(status) {
    syncDot.classList.remove('synced', 'syncing', 'disconnected');
    syncDot.classList.add(status);
    
    const labels = {
        synced: 'Connected',
        syncing: 'Syncing...',
        disconnected: 'Disconnected'
    };
    syncStatus.textContent = labels[status] || 'Unknown';
}

function initQuiet() {
    setStatus('Initializing audio...', 'warning');
    
    Quiet.init({
        profilesPrefix: './',
        memoryInitializerPrefix: './',
        libfecPrefix: './',
        onReady: () => {
            isReady = true;
            createTransmitter();
            setStatus('Ready - Choose Host or Join', 'ok');
            enableButtons(true);
        },
        onError: (reason) => {
            console.error('Quiet init failed:', reason);
            setStatus('Audio init failed: ' + reason, 'error');
        }
    });
}

function waitForQuiet(remaining = 50) {
    if (window.Quiet) {
        initQuiet();
        return;
    }
    if (remaining <= 0) {
        setStatus('Failed to load audio library', 'error');
        return;
    }
    setTimeout(() => waitForQuiet(remaining - 1), 100);
}

function createTransmitter() {
    if (!isReady) return;
    
    if (transmitter && transmitter.destroy) {
        transmitter.destroy();
    }
    
    transmitter = Quiet.transmitter({
        profile: currentProfile,
        onFinish: () => {
            isSending = false;
            processQueue();
        }
    });
}

function createReceiver() {
    if (!isReady) return;
    
    if (receiver && receiver.destroy) {
        receiver.destroy();
    }
    
    receiver = Quiet.receiver({
        profile: currentProfile,
        onReceive: (payload) => {
            if (!receiverActive) return;
            handleIncomingPayload(payload);
        },
        onCreate: () => {
            receiverActive = true;
            btnListen.classList.add('listening');
            btnListen.textContent = '🎤 Listening...';
            setStatus('Listening for game data...', 'ok');
        },
        onCreateFail: (reason) => {
            console.error('Mic access failed:', reason);
            setStatus('Microphone access denied', 'error');
        },
        onReceiveFail: (fails) => {
            console.warn('Receive errors:', fails);
        }
    });
}

function stopReceiver() {
    if (receiver && receiver.destroy) {
        receiver.destroy();
    }
    receiver = null;
    receiverActive = false;
    btnListen.classList.remove('listening');
    btnListen.textContent = '🎤 Listen';
}

function sendPacket(data, priority = false) {
    if (!isReady || !transmitter) return;
    
    const payload = JSON.stringify(data);
    const framed = `${START}${payload}${END}`;
    
    if (priority) {
        // High priority: add to front of queue
        sendQueue.unshift(framed);
    } else {
        // Normal: add to back, but limit queue size to avoid buildup
        if (sendQueue.length < 3) {
            sendQueue.push(framed);
        }
    }
    
    processQueue();
}

function processQueue() {
    if (isSending || sendQueue.length === 0 || !transmitter) return;
    
    isSending = true;
    const framed = sendQueue.shift();
    
    try {
        transmitter.transmit(Quiet.str2ab(framed));
        txCount++;
        if (debugMode) {
            debugTx.textContent = txCount;
        }
    } catch (e) {
        console.warn('Transmit error:', e);
        isSending = false;
    }
}

function handleIncomingPayload(payload) {
    const chunk = Quiet.ab2str(payload);
    rxBuffer += chunk;
    
    // Prevent buffer overflow
    if (rxBuffer.length > 50000) {
        rxBuffer = rxBuffer.slice(-50000);
    }
    
    let startIdx = rxBuffer.indexOf(START);
    while (startIdx !== -1) {
        const endIdx = rxBuffer.indexOf(END, startIdx + 1);
        if (endIdx === -1) {
            rxBuffer = rxBuffer.slice(startIdx);
            break;
        }
        
        const jsonStr = rxBuffer.slice(startIdx + 1, endIdx);
        rxBuffer = rxBuffer.slice(endIdx + 1);
        
        try {
            const packet = JSON.parse(jsonStr);
            handlePacket(packet);
            
            rxCount++;
            if (debugMode) {
                debugRx.textContent = rxCount;
                debugLastSync.textContent = new Date().toLocaleTimeString();
            }
        } catch (err) {
            console.warn('Parse error:', err);
        }
        
        startIdx = rxBuffer.indexOf(START);
    }
}

// ==================== Game Networking ====================

function handlePacket(packet) {
    // Reset connection timeout
    resetConnectionTimeout();
    setSyncStatus('synced');
    
    switch (packet.type) {
        case 'state':
            // Full game state from host
            if (role === 'guest') {
                // Only accept newer state
                if (packet.seq > gameState.seq) {
                    const localPaddle2Y = gameState.paddle2.y; // Preserve our paddle
                    Object.assign(gameState, packet.state);
                    gameState.seq = packet.seq;
                    
                    // Keep our local paddle position for smooth feel
                    // but blend towards server state
                    gameState.paddle2.y = localPaddle2Y * 0.3 + packet.state.paddle2.y * 0.7;
                    
                    updateScoreDisplay();
                    
                    // Calculate latency
                    if (debugMode && packet.ts) {
                        debugLatency.textContent = Date.now() - packet.ts;
                    }
                }
            }
            break;
            
        case 'input':
            // Input from guest to host
            if (role === 'host') {
                if (packet.up) {
                    gameState.paddle2.y = Math.max(0, gameState.paddle2.y - PADDLE_SPEED);
                }
                if (packet.down) {
                    gameState.paddle2.y = Math.min(canvas.height - PADDLE_HEIGHT, gameState.paddle2.y + PADDLE_SPEED);
                }
            }
            break;
            
        case 'join':
            // Guest joining
            if (role === 'host') {
                setStatus('Player 2 joined!', 'ok');
                // Send acknowledgment
                sendPacket({ type: 'welcome', profile: currentProfile });
                
                // Start the game after a short delay
                if (!gameState.gameStarted) {
                    setTimeout(() => {
                        startGame();
                    }, 1000);
                }
            }
            break;
            
        case 'welcome':
            // Host acknowledged our join
            if (role === 'guest') {
                setStatus('Connected to host!', 'ok');
                gameState.gameStarted = true;
            }
            break;
            
        case 'pause':
            gameState.paused = packet.paused;
            break;
            
        case 'restart':
            resetGame();
            startGame();
            break;
    }
}

function sendGameState() {
    if (role !== 'host' || !gameState.gameStarted) return;
    
    gameState.seq++;
    gameState.timestamp = Date.now();
    
    sendPacket({
        type: 'state',
        state: gameState,
        seq: gameState.seq,
        ts: Date.now()
    });
}

function sendInput() {
    if (role !== 'guest') return;
    
    sendPacket({
        type: 'input',
        up: keysPressed.up,
        down: keysPressed.down,
        ts: Date.now()
    });
}

function resetConnectionTimeout() {
    if (connectionTimer) {
        clearTimeout(connectionTimer);
    }
    
    connectionTimer = setTimeout(() => {
        setSyncStatus('disconnected');
        if (role === 'guest') {
            setStatus('Lost connection to host', 'error');
        }
    }, TIMEOUT_MS);
}

// ==================== Game Logic ====================

function enableButtons(enabled) {
    btnHost.disabled = !enabled;
    btnJoin.disabled = !enabled;
    btnListen.disabled = !enabled;
    profileSelect.disabled = !enabled;
}

function hostGame() {
    role = 'host';
    roleIndicator.style.display = 'block';
    roleIndicator.className = 'role-indicator host';
    roleText.textContent = '🎮 HOST - Player 1 (Left Paddle)';
    
    btnHost.classList.add('active');
    btnJoin.disabled = true;
    
    setStatus('Hosting... Waiting for player 2', 'warning');
    setSyncStatus('syncing');
    
    // Start sync timer
    syncTimer = setInterval(() => {
        sendGameState();
    }, SYNC_INTERVAL);
    
    resetGame();
}

function joinGame() {
    // Prevent multiple clicks
    if (role === 'guest') return;
    
    role = 'guest';
    roleIndicator.style.display = 'block';
    roleIndicator.className = 'role-indicator guest';
    roleText.textContent = '🎮 GUEST - Player 2 (Right Paddle)';
    
    btnJoin.classList.add('active');
    btnJoin.disabled = true;
    btnHost.disabled = true;
    
    setStatus('Joining... Looking for host', 'warning');
    setSyncStatus('syncing');
    
    // Send first join request immediately
    sendPacket({ type: 'join', ts: Date.now() });
    
    // Send join request periodically until acknowledged
    joinInterval = setInterval(() => {
        if (gameState.gameStarted) {
            clearInterval(joinInterval);
            joinInterval = null;
            // Only start input timer once connected
            if (!inputTimer) {
                inputTimer = setInterval(() => {
                    sendInput();
                }, INPUT_SEND_INTERVAL);
            }
            return;
        }
        sendPacket({ type: 'join', ts: Date.now() });
    }, 1000); // Slower join requests to avoid overwhelming transmitter
}

function toggleListen() {
    if (receiverActive) {
        stopReceiver();
        setStatus('Stopped listening', 'warning');
    } else {
        createReceiver();
    }
}

function startGame() {
    if (gameState.gameStarted && !gameState.winner) return;
    
    gameState.gameStarted = true;
    gameState.paused = false;
    gameState.winner = null;
    
    // Launch ball
    resetBall();
    
    setStatus('Game started!', 'ok');
}

function resetGame() {
    gameState.score1 = 0;
    gameState.score2 = 0;
    gameState.paddle1.y = (canvas.height - PADDLE_HEIGHT) / 2;
    gameState.paddle2.y = (canvas.height - PADDLE_HEIGHT) / 2;
    gameState.winner = null;
    gameState.paused = true;
    gameState.seq = 0;
    
    resetBall();
    updateScoreDisplay();
}

function resetBall() {
    gameState.ball.x = canvas.width / 2;
    gameState.ball.y = canvas.height / 2;
    
    // Random direction
    const angle = (Math.random() - 0.5) * Math.PI / 2; // -45 to +45 degrees
    const direction = Math.random() < 0.5 ? 1 : -1;
    
    gameState.ball.vx = direction * BALL_SPEED_INITIAL * Math.cos(angle);
    gameState.ball.vy = BALL_SPEED_INITIAL * Math.sin(angle);
}

function updateScoreDisplay() {
    score1El.textContent = gameState.score1;
    score2El.textContent = gameState.score2;
}

function togglePause() {
    gameState.paused = !gameState.paused;
    
    if (role === 'host') {
        sendPacket({ type: 'pause', paused: gameState.paused });
    }
}

// ==================== Game Loop ====================

function update() {
    if (!gameState.gameStarted || gameState.paused || gameState.winner) return;
    
    // Host handles all physics
    if (role === 'host') {
        // Move host paddle (Player 1)
        if (keysPressed.up) {
            gameState.paddle1.y = Math.max(0, gameState.paddle1.y - PADDLE_SPEED);
        }
        if (keysPressed.down) {
            gameState.paddle1.y = Math.min(canvas.height - PADDLE_HEIGHT, gameState.paddle1.y + PADDLE_SPEED);
        }
        
        // Update ball position
        gameState.ball.x += gameState.ball.vx;
        gameState.ball.y += gameState.ball.vy;
        
        // Ball collision with top/bottom walls
        if (gameState.ball.y <= BALL_SIZE / 2 || gameState.ball.y >= canvas.height - BALL_SIZE / 2) {
            gameState.ball.vy = -gameState.ball.vy;
            gameState.ball.y = Math.max(BALL_SIZE / 2, Math.min(canvas.height - BALL_SIZE / 2, gameState.ball.y));
        }
        
        // Ball collision with paddles
        // Left paddle (Player 1)
        if (gameState.ball.x - BALL_SIZE / 2 <= PADDLE_WIDTH + 20 &&
            gameState.ball.y >= gameState.paddle1.y &&
            gameState.ball.y <= gameState.paddle1.y + PADDLE_HEIGHT &&
            gameState.ball.vx < 0) {
            
            gameState.ball.vx = -gameState.ball.vx;
            
            // Add spin based on where ball hit paddle
            const hitPos = (gameState.ball.y - gameState.paddle1.y) / PADDLE_HEIGHT;
            gameState.ball.vy += (hitPos - 0.5) * 4;
            
            // Speed up
            const speed = Math.sqrt(gameState.ball.vx ** 2 + gameState.ball.vy ** 2);
            if (speed < MAX_BALL_SPEED) {
                const factor = (speed + BALL_SPEED_INCREMENT) / speed;
                gameState.ball.vx *= factor;
                gameState.ball.vy *= factor;
            }
        }
        
        // Right paddle (Player 2)
        if (gameState.ball.x + BALL_SIZE / 2 >= canvas.width - PADDLE_WIDTH - 20 &&
            gameState.ball.y >= gameState.paddle2.y &&
            gameState.ball.y <= gameState.paddle2.y + PADDLE_HEIGHT &&
            gameState.ball.vx > 0) {
            
            gameState.ball.vx = -gameState.ball.vx;
            
            const hitPos = (gameState.ball.y - gameState.paddle2.y) / PADDLE_HEIGHT;
            gameState.ball.vy += (hitPos - 0.5) * 4;
            
            const speed = Math.sqrt(gameState.ball.vx ** 2 + gameState.ball.vy ** 2);
            if (speed < MAX_BALL_SPEED) {
                const factor = (speed + BALL_SPEED_INCREMENT) / speed;
                gameState.ball.vx *= factor;
                gameState.ball.vy *= factor;
            }
        }
        
        // Scoring
        if (gameState.ball.x < 0) {
            // Player 2 scores
            gameState.score2++;
            updateScoreDisplay();
            
            if (gameState.score2 >= WIN_SCORE) {
                gameState.winner = 2;
            } else {
                resetBall();
            }
        } else if (gameState.ball.x > canvas.width) {
            // Player 1 scores
            gameState.score1++;
            updateScoreDisplay();
            
            if (gameState.score1 >= WIN_SCORE) {
                gameState.winner = 1;
            } else {
                resetBall();
            }
        }
    } else if (role === 'guest') {
        // Guest moves local paddle for responsive feel
        if (keysPressed.up) {
            gameState.paddle2.y = Math.max(0, gameState.paddle2.y - PADDLE_SPEED);
        }
        if (keysPressed.down) {
            gameState.paddle2.y = Math.min(canvas.height - PADDLE_HEIGHT, gameState.paddle2.y + PADDLE_SPEED);
        }
    }
}

function draw() {
    // Clear canvas
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw center line
    ctx.setLineDash([10, 10]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Draw paddles
    // Player 1 paddle (left)
    ctx.fillStyle = '#00ff88';
    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur = 15;
    ctx.fillRect(20, gameState.paddle1.y, PADDLE_WIDTH, PADDLE_HEIGHT);
    
    // Player 2 paddle (right)
    ctx.fillStyle = '#ff6b6b';
    ctx.shadowColor = '#ff6b6b';
    ctx.fillRect(canvas.width - 20 - PADDLE_WIDTH, gameState.paddle2.y, PADDLE_WIDTH, PADDLE_HEIGHT);
    
    ctx.shadowBlur = 0;
    
    // Draw ball
    ctx.fillStyle = '#fff';
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(gameState.ball.x, gameState.ball.y, BALL_SIZE / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    
    // Draw game messages
    if (!gameState.gameStarted) {
        drawCenteredText('Press HOST or JOIN to start', 24);
    } else if (gameState.paused && !gameState.winner) {
        drawCenteredText('PAUSED - Press SPACE to continue', 24);
    } else if (gameState.winner) {
        const winnerText = `Player ${gameState.winner} Wins!`;
        drawCenteredText(winnerText, 48);
        drawCenteredText('Press SPACE to restart', 24, 60);
    }
    
    // Draw sync indicator on canvas
    if (role) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`Role: ${role.toUpperCase()}`, 10, 20);
        ctx.fillText(`Seq: ${gameState.seq}`, 10, 35);
    }
}

function drawCenteredText(text, size, yOffset = 0) {
    ctx.fillStyle = '#fff';
    ctx.font = `${size}px 'Segoe UI', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + yOffset);
}

function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

// ==================== Input Handling ====================

document.addEventListener('keydown', (e) => {
    switch (e.key.toLowerCase()) {
        case 'w':
        case 'arrowup':
            keysPressed.up = true;
            e.preventDefault();
            break;
        case 's':
        case 'arrowdown':
            keysPressed.down = true;
            e.preventDefault();
            break;
        case ' ':
            if (gameState.winner && role === 'host') {
                sendPacket({ type: 'restart' });
                resetGame();
                startGame();
            } else if (gameState.gameStarted) {
                togglePause();
            }
            e.preventDefault();
            break;
        case 'd':
            debugMode = !debugMode;
            debugPanel.classList.toggle('visible', debugMode);
            break;
    }
});

document.addEventListener('keyup', (e) => {
    switch (e.key.toLowerCase()) {
        case 'w':
        case 'arrowup':
            keysPressed.up = false;
            break;
        case 's':
        case 'arrowdown':
            keysPressed.down = false;
            break;
    }
});

// ==================== Event Listeners ====================

btnHost.addEventListener('click', hostGame);
btnJoin.addEventListener('click', joinGame);
btnListen.addEventListener('click', toggleListen);

profileSelect.addEventListener('change', (e) => {
    currentProfile = e.target.value;
    if (isReady) {
        createTransmitter();
        if (receiverActive) {
            stopReceiver();
            createReceiver();
        }
    }
});

// ==================== Initialization ====================

enableButtons(false);
gameLoop();
waitForQuiet();

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    if (syncTimer) clearInterval(syncTimer);
    if (inputTimer) clearInterval(inputTimer);
    if (joinInterval) clearInterval(joinInterval);
    if (connectionTimer) clearTimeout(connectionTimer);
    if (transmitter && transmitter.destroy) transmitter.destroy();
    if (receiver && receiver.destroy) receiver.destroy();
});
