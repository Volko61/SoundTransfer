// Pong Game with Audio Sync
const START = "\u0002";
const END = "\u0003";

// DOM Elements
const statusEl = document.getElementById("status");
const profileSelect = document.getElementById("profileSelect");
const playerSelect = document.getElementById("playerSelect");
const hostBtn = document.getElementById("hostGame");
const joinBtn = document.getElementById("joinGame");
const stopBtn = document.getElementById("stopGame");
const canvas = document.getElementById("pongCanvas");
const ctx = canvas.getContext("2d");
const gameMessage = document.getElementById("gameMessage");
const score1El = document.getElementById("score1");
const score2El = document.getElementById("score2");
const connectionLog = document.getElementById("connectionLog");

// Game State
const state = {
    isReady: false,
    transmitter: null,
    receiverInstance: null,
    receiverActive: false,
    currentProfile: "ultrasonic-experimental",
    rxBuffer: "",
    isHost: false,
    isPlaying: false,
    myPlayer: 1,
    lastSentTime: 0,
    sendInterval: 50 // ms between sends
};

// Game Objects
const game = {
    width: 800,
    height: 500,
    paddleWidth: 12,
    paddleHeight: 90,
    ballSize: 14,
    paddleSpeed: 8,
    ballSpeedX: 6,
    ballSpeedY: 4,
    maxBallSpeed: 12,
    
    // Positions
    paddle1Y: 205,
    paddle2Y: 205,
    ballX: 400,
    ballY: 250,
    ballVX: 6,
    ballVY: 4,
    
    // Scores
    score1: 0,
    score2: 0,
    
    // Input
    keys: {},
    
    // Sync
    lastSync: 0
};

// Utility Functions
function setStatus(text, tone = "info") {
    statusEl.textContent = text;
    statusEl.classList.remove("ok", "error");
    if (tone === "ok") statusEl.classList.add("ok");
    if (tone === "error") statusEl.classList.add("error");
}

function log(message, type = "info") {
    const entry = document.createElement("div");
    entry.className = `log-entry ${type}`;
    const time = new Date().toLocaleTimeString();
    entry.innerHTML = `<span class="time">[${time}]</span> ${message}`;
    connectionLog.appendChild(entry);
    connectionLog.scrollTop = connectionLog.scrollHeight;
    
    // Keep log manageable
    while (connectionLog.children.length > 50) {
        connectionLog.removeChild(connectionLog.firstChild);
    }
}

function showMessage(text) {
    gameMessage.textContent = text;
    gameMessage.classList.remove("hidden");
}

function hideMessage() {
    gameMessage.classList.add("hidden");
}

// Profile Loading
async function loadProfiles() {
    try {
        const res = await fetch("./quiet-profiles.json");
        const profiles = await res.json();
        
        profileSelect.innerHTML = "";
        for (const name of Object.keys(profiles)) {
            const opt = document.createElement("option");
            opt.value = name;
            opt.textContent = name;
            profileSelect.appendChild(opt);
        }
        
        // Try to select ultrasonic by default for less annoying gameplay
        if (profiles["ultrasonic-experimental"]) {
            profileSelect.value = "ultrasonic-experimental";
            state.currentProfile = "ultrasonic-experimental";
        } else if (profiles["ultrasonic"]) {
            profileSelect.value = "ultrasonic";
            state.currentProfile = "ultrasonic";
        } else {
            state.currentProfile = profileSelect.value;
        }
    } catch (err) {
        console.error("Failed to load profiles:", err);
    }
}

// Quiet.js Integration
function initQuiet() {
    setStatus("Initializing…");

    Quiet.init({
        profilesPrefix: "./",
        memoryInitializerPrefix: "./",
        libfecPrefix: "./",
        onReady: () => {
            state.isReady = true;
            createTransmitter();
            setStatus("Ready", "ok");
            hostBtn.disabled = false;
            joinBtn.disabled = false;
            log("Audio system initialized", "received");
        },
        onError: (reason) => {
            console.error("Quiet init failed:", reason);
            setStatus("Init failed", "error");
            log("Initialization failed: " + reason, "error");
        }
    });
}

function waitForQuiet(remaining = 50) {
    if (window.Quiet) {
        initQuiet();
        return;
    }
    if (remaining <= 0) {
        console.error("Quiet.js did not load.");
        setStatus("Quiet.js failed to load", "error");
        return;
    }
    window.setTimeout(() => waitForQuiet(remaining - 1), 100);
}

function createTransmitter() {
    if (!state.isReady) return;
    if (state.transmitter && state.transmitter.destroy) {
        state.transmitter.destroy();
    }
    state.transmitter = Quiet.transmitter({
        profile: state.currentProfile,
        onFinish: () => {}
    });
}

function resetReceiver() {
    if (state.receiverInstance && state.receiverInstance.destroy) {
        state.receiverInstance.destroy();
    }
    state.receiverInstance = null;
    state.receiverActive = false;
}

function ensureReceiver() {
    if (state.receiverInstance) return;

    state.receiverInstance = Quiet.receiver({
        profile: state.currentProfile,
        onReceive: (payload) => {
            if (!state.receiverActive) return;
            handleIncomingPayload(payload);
        },
        onCreate: () => {
            log("Listening for opponent...", "received");
        },
        onCreateFail: (reason) => {
            console.error("Receiver create failed:", reason);
            setStatus("Mic access failed", "error");
            log("Microphone access failed", "error");
        },
        onReceiveFail: (totalFails) => {
            // Silent fail for game - too noisy otherwise
        }
    });
    state.receiverActive = true;
}

function sendMessage(msg) {
    if (!state.isReady || !state.transmitter) return;
    const payload = JSON.stringify(msg);
    const framed = `${START}${payload}${END}`;
    state.transmitter.transmit(Quiet.str2ab(framed));
}

function handleIncomingPayload(payload) {
    const chunk = Quiet.ab2str(payload);
    state.rxBuffer += chunk;

    if (state.rxBuffer.length > 50000) {
        state.rxBuffer = state.rxBuffer.slice(-50000);
    }

    let startIdx = state.rxBuffer.indexOf(START);
    while (startIdx !== -1) {
        const endIdx = state.rxBuffer.indexOf(END, startIdx + 1);
        if (endIdx === -1) {
            state.rxBuffer = state.rxBuffer.slice(startIdx);
            break;
        }

        const jsonStr = state.rxBuffer.slice(startIdx + 1, endIdx);
        state.rxBuffer = state.rxBuffer.slice(endIdx + 1);

        try {
            const msg = JSON.parse(jsonStr);
            handleGameMessage(msg);
        } catch (err) {
            // Ignore parse errors during gameplay
        }

        startIdx = state.rxBuffer.indexOf(START);
    }
}

// Game Message Handlers
function handleGameMessage(msg) {
    switch (msg.type) {
        case "join":
            if (state.isHost) {
                log("Player 2 joined!", "received");
                showMessage("Player 2 connected! Starting...");
                setTimeout(() => {
                    startGame();
                    sendMessage({ type: "start", game: getGameState() });
                }, 1000);
            }
            break;
            
        case "start":
            if (!state.isHost && msg.game) {
                log("Game starting!", "received");
                applyGameState(msg.game);
                state.isPlaying = true;
                hideMessage();
            }
            break;
            
        case "sync":
            // Host sends full game state, client applies it
            if (!state.isHost && msg.game) {
                applyGameState(msg.game);
            }
            break;
            
        case "paddle":
            // Receive opponent's paddle position
            if (msg.player === 1 && state.myPlayer === 2) {
                game.paddle1Y = msg.y;
            } else if (msg.player === 2 && state.myPlayer === 1) {
                game.paddle2Y = msg.y;
            }
            break;
            
        case "score":
            game.score1 = msg.score1;
            game.score2 = msg.score2;
            updateScoreDisplay();
            log(`Score: ${msg.score1} - ${msg.score2}`, "received");
            break;
            
        case "stop":
            stopGame();
            log("Opponent stopped the game", "received");
            break;
    }
}

function getGameState() {
    return {
        paddle1Y: game.paddle1Y,
        paddle2Y: game.paddle2Y,
        ballX: game.ballX,
        ballY: game.ballY,
        ballVX: game.ballVX,
        ballVY: game.ballVY,
        score1: game.score1,
        score2: game.score2
    };
}

function applyGameState(gs) {
    if (gs.paddle1Y !== undefined) game.paddle1Y = gs.paddle1Y;
    if (gs.paddle2Y !== undefined) game.paddle2Y = gs.paddle2Y;
    if (gs.ballX !== undefined) game.ballX = gs.ballX;
    if (gs.ballY !== undefined) game.ballY = gs.ballY;
    if (gs.ballVX !== undefined) game.ballVX = gs.ballVX;
    if (gs.ballVY !== undefined) game.ballVY = gs.ballVY;
    if (gs.score1 !== undefined) game.score1 = gs.score1;
    if (gs.score2 !== undefined) game.score2 = gs.score2;
    updateScoreDisplay();
}

// Game Logic
function resetBall(direction = 1) {
    game.ballX = game.width / 2;
    game.ballY = game.height / 2;
    game.ballVX = game.ballSpeedX * direction;
    game.ballVY = (Math.random() - 0.5) * game.ballSpeedY * 2;
}

function updateScoreDisplay() {
    score1El.textContent = game.score1;
    score2El.textContent = game.score2;
}

function updateGame() {
    if (!state.isPlaying) return;
    
    // Handle input for my paddle
    const myPaddle = state.myPlayer === 1 ? "paddle1Y" : "paddle2Y";
    
    if (game.keys["w"] || game.keys["W"] || game.keys["ArrowUp"]) {
        game[myPaddle] = Math.max(0, game[myPaddle] - game.paddleSpeed);
    }
    if (game.keys["s"] || game.keys["S"] || game.keys["ArrowDown"]) {
        game[myPaddle] = Math.min(game.height - game.paddleHeight, game[myPaddle] + game.paddleSpeed);
    }
    
    // Send paddle position
    const now = Date.now();
    if (now - state.lastSentTime > state.sendInterval) {
        sendMessage({
            type: "paddle",
            player: state.myPlayer,
            y: game[myPaddle]
        });
        state.lastSentTime = now;
    }
    
    // Only host updates ball physics
    if (state.isHost) {
        // Ball movement
        game.ballX += game.ballVX;
        game.ballY += game.ballVY;
        
        // Top/bottom walls
        if (game.ballY <= game.ballSize / 2) {
            game.ballY = game.ballSize / 2;
            game.ballVY = -game.ballVY;
        }
        if (game.ballY >= game.height - game.ballSize / 2) {
            game.ballY = game.height - game.ballSize / 2;
            game.ballVY = -game.ballVY;
        }
        
        // Paddle 1 collision (left)
        if (game.ballX - game.ballSize / 2 <= game.paddleWidth + 15 &&
            game.ballY >= game.paddle1Y &&
            game.ballY <= game.paddle1Y + game.paddleHeight &&
            game.ballVX < 0) {
            game.ballVX = -game.ballVX * 1.05;
            game.ballVX = Math.min(game.ballVX, game.maxBallSpeed);
            
            // Add spin based on where ball hits paddle
            const hitPos = (game.ballY - game.paddle1Y) / game.paddleHeight;
            game.ballVY = (hitPos - 0.5) * 10;
            game.ballX = game.paddleWidth + 15 + game.ballSize / 2;
        }
        
        // Paddle 2 collision (right)
        if (game.ballX + game.ballSize / 2 >= game.width - game.paddleWidth - 15 &&
            game.ballY >= game.paddle2Y &&
            game.ballY <= game.paddle2Y + game.paddleHeight &&
            game.ballVX > 0) {
            game.ballVX = -game.ballVX * 1.05;
            game.ballVX = Math.max(game.ballVX, -game.maxBallSpeed);
            
            const hitPos = (game.ballY - game.paddle2Y) / game.paddleHeight;
            game.ballVY = (hitPos - 0.5) * 10;
            game.ballX = game.width - game.paddleWidth - 15 - game.ballSize / 2;
        }
        
        // Scoring
        if (game.ballX < 0) {
            game.score2++;
            updateScoreDisplay();
            resetBall(1);
            sendMessage({ type: "score", score1: game.score1, score2: game.score2 });
            log(`Player 2 scores! (${game.score1} - ${game.score2})`, "sent");
        }
        if (game.ballX > game.width) {
            game.score1++;
            updateScoreDisplay();
            resetBall(-1);
            sendMessage({ type: "score", score1: game.score1, score2: game.score2 });
            log(`Player 1 scores! (${game.score1} - ${game.score2})`, "sent");
        }
        
        // Sync game state periodically
        if (now - game.lastSync > 200) {
            sendMessage({ type: "sync", game: getGameState() });
            game.lastSync = now;
        }
    }
}

function drawGame() {
    // Clear
    ctx.fillStyle = "#0a0e16";
    ctx.fillRect(0, 0, game.width, game.height);
    
    // Center line
    ctx.strokeStyle = "rgba(106, 165, 255, 0.3)";
    ctx.lineWidth = 2;
    ctx.setLineDash([15, 15]);
    ctx.beginPath();
    ctx.moveTo(game.width / 2, 0);
    ctx.lineTo(game.width / 2, game.height);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Paddles
    ctx.fillStyle = "#5bd9a4"; // Player 1 - green
    ctx.shadowColor = "#5bd9a4";
    ctx.shadowBlur = 15;
    roundRect(ctx, 15, game.paddle1Y, game.paddleWidth, game.paddleHeight, 6);
    ctx.fill();
    
    ctx.fillStyle = "#6aa5ff"; // Player 2 - blue
    ctx.shadowColor = "#6aa5ff";
    roundRect(ctx, game.width - game.paddleWidth - 15, game.paddle2Y, game.paddleWidth, game.paddleHeight, 6);
    ctx.fill();
    
    ctx.shadowBlur = 0;
    
    // Ball
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "#fff";
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(game.ballX, game.ballY, game.ballSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    
    // Player indicator
    ctx.font = "12px 'Segoe UI', sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    if (state.myPlayer === 1) {
        ctx.fillText("YOU", 15, game.height - 10);
    } else {
        ctx.fillText("YOU", game.width - 40, game.height - 10);
    }
}

function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

function gameLoop() {
    updateGame();
    drawGame();
    requestAnimationFrame(gameLoop);
}

// Game Control Functions
function startGame() {
    state.isPlaying = true;
    game.score1 = 0;
    game.score2 = 0;
    game.paddle1Y = (game.height - game.paddleHeight) / 2;
    game.paddle2Y = (game.height - game.paddleHeight) / 2;
    resetBall(1);
    updateScoreDisplay();
    hideMessage();
    setStatus("Playing", "ok");
}

function hostGame() {
    state.isHost = true;
    state.myPlayer = 1;
    playerSelect.value = "1";
    
    ensureReceiver();
    showMessage("Waiting for Player 2 to join...");
    setStatus("Hosting - waiting for player", "info");
    log("Hosting game, waiting for Player 2...", "sent");
    
    hostBtn.disabled = true;
    joinBtn.disabled = true;
    stopBtn.disabled = false;
    
    // Send periodic beacon so player 2 can find us
    state.beaconInterval = setInterval(() => {
        if (!state.isPlaying) {
            sendMessage({ type: "beacon", host: true });
        }
    }, 2000);
}

function joinGame() {
    state.isHost = false;
    state.myPlayer = 2;
    playerSelect.value = "2";
    
    ensureReceiver();
    showMessage("Connecting to host...");
    setStatus("Joining game", "info");
    log("Attempting to join game...", "sent");
    
    hostBtn.disabled = true;
    joinBtn.disabled = true;
    stopBtn.disabled = false;
    
    // Send join message
    sendMessage({ type: "join", player: 2 });
    
    // Keep sending join attempts
    state.joinInterval = setInterval(() => {
        if (!state.isPlaying) {
            sendMessage({ type: "join", player: 2 });
        } else {
            clearInterval(state.joinInterval);
        }
    }, 1500);
}

function stopGame() {
    state.isPlaying = false;
    state.isHost = false;
    
    if (state.beaconInterval) {
        clearInterval(state.beaconInterval);
        state.beaconInterval = null;
    }
    if (state.joinInterval) {
        clearInterval(state.joinInterval);
        state.joinInterval = null;
    }
    
    resetReceiver();
    
    sendMessage({ type: "stop" });
    
    showMessage("Game stopped. Press Host or Join to play again.");
    setStatus("Ready", "ok");
    log("Game stopped", "info");
    
    hostBtn.disabled = false;
    joinBtn.disabled = false;
    stopBtn.disabled = true;
}

// Input Handling
document.addEventListener("keydown", (e) => {
    game.keys[e.key] = true;
    
    // Prevent scrolling with arrow keys
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
    }
});

document.addEventListener("keyup", (e) => {
    game.keys[e.key] = false;
});

// Event Listeners
profileSelect.addEventListener("change", () => {
    state.currentProfile = profileSelect.value;
    createTransmitter();
    if (state.receiverActive) {
        resetReceiver();
        ensureReceiver();
    }
    log(`Profile changed to ${state.currentProfile}`, "info");
});

playerSelect.addEventListener("change", () => {
    state.myPlayer = parseInt(playerSelect.value);
});

hostBtn.addEventListener("click", hostGame);
joinBtn.addEventListener("click", joinGame);
stopBtn.addEventListener("click", stopGame);

// Initialize
hostBtn.disabled = true;
joinBtn.disabled = true;

loadProfiles();
waitForQuiet();
gameLoop();
drawGame();
