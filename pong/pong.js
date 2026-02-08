/**
 * Pong Game - Core Game Logic with Multiplayer
 * Uses BroadcastChannel for same-browser sync + Audio for cross-device
 */

// ===================== GAME CONSTANTS =====================

const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 400;
const PADDLE_WIDTH = 10;
const PADDLE_HEIGHT = 80;
const PADDLE_MARGIN = 20;
const BALL_SIZE = 12;
const BALL_SPEED = 5;
const PADDLE_SPEED = 8;
const WIN_SCORE = 11;

// ===================== GAME STATE =====================

const GameState = {
    WAITING: 'waiting',
    PLAYING: 'playing',
    PAUSED: 'paused',
    GAME_OVER: 'gameOver'
};

// ===================== PONG GAME CLASS =====================

class PongGame {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');

        // Game state
        this.state = GameState.WAITING;
        this.isHost = false;
        this.playerId = 0;

        // Scores
        this.score1 = 0;
        this.score2 = 0;

        // Paddles
        this.paddle1 = {
            x: PADDLE_MARGIN,
            y: CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2,
            width: PADDLE_WIDTH,
            height: PADDLE_HEIGHT
        };

        this.paddle2 = {
            x: CANVAS_WIDTH - PADDLE_MARGIN - PADDLE_WIDTH,
            y: CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2,
            width: PADDLE_WIDTH,
            height: PADDLE_HEIGHT
        };

        // Ball
        this.ball = {
            x: CANVAS_WIDTH / 2,
            y: CANVAS_HEIGHT / 2,
            size: BALL_SIZE,
            vx: BALL_SPEED,
            vy: BALL_SPEED * 0.5
        };

        // Input state
        this.keys = {};
        this.mouseY = CANVAS_HEIGHT / 2;

        // Sync channel (BroadcastChannel for local, Audio for cross-device)
        this.localChannel = null;
        this.audioTransmitter = null;
        this.audioReceiver = null;
        this.visualizer = null;

        // Sync timing
        this.lastTransmitTime = 0;
        this.transmitInterval = 33; // ~30 updates/sec

        // Animation
        this.animationId = null;
        this.lastTime = 0;

        // Bind methods
        this.gameLoop = this.gameLoop.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleKeyUp = this.handleKeyUp.bind(this);
        this.handleMouseMove = this.handleMouseMove.bind(this);

        // Setup
        this.setupEventListeners();
        this.render();
    }

    setupEventListeners() {
        document.addEventListener('keydown', this.handleKeyDown);
        document.addEventListener('keyup', this.handleKeyUp);
        this.canvas.addEventListener('mousemove', this.handleMouseMove);

        document.getElementById('hostBtn')?.addEventListener('click', () => this.hostGame());
        document.getElementById('joinBtn')?.addEventListener('click', () => this.joinGame());
        document.getElementById('stopBtn')?.addEventListener('click', () => this.stopGame());
    }

    handleKeyDown(e) {
        this.keys[e.key] = true;
        if (['ArrowUp', 'ArrowDown'].includes(e.key)) e.preventDefault();
    }

    handleKeyUp(e) {
        this.keys[e.key] = false;
    }

    handleMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        this.mouseY = (e.clientY - rect.top) * (CANVAS_HEIGHT / rect.height);
    }

    // ===================== GAME CONTROLS =====================

    async hostGame() {
        this.isHost = true;
        this.playerId = 0;

        // Use BroadcastChannel for instant same-browser sync
        this.localChannel = new window.AudioSync.LocalChannel((state) => {
            this.handleReceivedState(state);
        });

        // Also start audio for cross-device (optional)
        this.audioTransmitter = new window.AudioSync.AudioTransmitter();
        await this.audioTransmitter.start();

        // Update UI
        this.updateConnectionStatus('Hosting (Local + Audio)');
        this.updateRoleStatus('Host (Player 1)');
        this.enableStopButton(true);
        this.disableStartButtons(true);

        // Start game
        this.resetBall();
        this.state = GameState.PLAYING;
        this.startGameLoop();

        console.log('Host started - using BroadcastChannel + Audio');
    }

    async joinGame() {
        this.isHost = false;
        this.playerId = 1;

        // Use BroadcastChannel for instant same-browser sync
        this.localChannel = new window.AudioSync.LocalChannel((state) => {
            this.handleReceivedState(state);
        });

        // Also start audio transmitter for cross-device
        this.audioTransmitter = new window.AudioSync.AudioTransmitter();
        await this.audioTransmitter.start();

        // Update UI
        this.updateConnectionStatus('Joined (Local + Audio)');
        this.updateRoleStatus('Guest (Player 2)');
        this.enableStopButton(true);
        this.disableStartButtons(true);

        // Start game
        this.state = GameState.PLAYING;
        this.startGameLoop();

        console.log('Guest joined - using BroadcastChannel + Audio');
    }

    stopGame() {
        this.state = GameState.WAITING;

        // Stop channels
        if (this.localChannel) {
            this.localChannel.close();
            this.localChannel = null;
        }
        if (this.audioTransmitter) {
            this.audioTransmitter.stop();
            this.audioTransmitter = null;
        }
        if (this.audioReceiver) {
            this.audioReceiver.stop();
            this.audioReceiver = null;
        }
        if (this.visualizer) {
            this.visualizer.stop();
            this.visualizer = null;
        }

        // Stop game loop
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        // Reset
        this.score1 = 0;
        this.score2 = 0;
        this.updateScoreDisplay();
        this.updateConnectionStatus('Not connected');
        this.updateRoleStatus('-');
        this.enableStopButton(false);
        this.disableStartButtons(false);
        this.render();
    }

    // ===================== GAME LOOP =====================

    startGameLoop() {
        this.lastTime = performance.now();
        this.animationId = requestAnimationFrame(this.gameLoop);
    }

    gameLoop(currentTime) {
        const deltaTime = (currentTime - this.lastTime) / 1000;
        this.lastTime = currentTime;

        if (this.state === GameState.PLAYING) {
            this.update(deltaTime);
            this.transmitState();
        }

        this.render();
        this.updatePacketStatus();

        this.animationId = requestAnimationFrame(this.gameLoop);
    }

    update(dt) {
        const myPaddle = this.isHost ? this.paddle1 : this.paddle2;

        // Keyboard input
        if (this.keys['ArrowUp'] || this.keys['w'] || this.keys['W']) {
            myPaddle.y -= PADDLE_SPEED;
        }
        if (this.keys['ArrowDown'] || this.keys['s'] || this.keys['S']) {
            myPaddle.y += PADDLE_SPEED;
        }

        // Mouse input
        const targetY = this.mouseY - myPaddle.height / 2;
        myPaddle.y += (targetY - myPaddle.y) * 0.15;
        myPaddle.y = Math.max(0, Math.min(CANVAS_HEIGHT - myPaddle.height, myPaddle.y));

        // Ball physics (host only)
        if (this.isHost) {
            this.updateBall();
        }
    }

    updateBall() {
        this.ball.x += this.ball.vx;
        this.ball.y += this.ball.vy;

        // Wall collision
        if (this.ball.y <= 0 || this.ball.y >= CANVAS_HEIGHT - this.ball.size) {
            this.ball.vy *= -1;
            this.ball.y = Math.max(0, Math.min(CANVAS_HEIGHT - this.ball.size, this.ball.y));
        }

        // Paddle collision
        if (this.checkPaddleCollision(this.paddle1)) {
            this.ball.vx = Math.abs(this.ball.vx);
            this.addSpinFromPaddle(this.paddle1);
        }
        if (this.checkPaddleCollision(this.paddle2)) {
            this.ball.vx = -Math.abs(this.ball.vx);
            this.addSpinFromPaddle(this.paddle2);
        }

        // Scoring
        if (this.ball.x < 0) {
            this.score2++;
            this.updateScoreDisplay();
            this.checkWin() || this.resetBall();
        } else if (this.ball.x > CANVAS_WIDTH) {
            this.score1++;
            this.updateScoreDisplay();
            this.checkWin() || this.resetBall();
        }
    }

    checkPaddleCollision(paddle) {
        return this.ball.x < paddle.x + paddle.width &&
            this.ball.x + this.ball.size > paddle.x &&
            this.ball.y < paddle.y + paddle.height &&
            this.ball.y + this.ball.size > paddle.y;
    }

    addSpinFromPaddle(paddle) {
        const offset = ((this.ball.y + this.ball.size / 2) - (paddle.y + paddle.height / 2)) / (paddle.height / 2);
        this.ball.vy = offset * BALL_SPEED;
        this.ball.vx *= 1.05;
        this.ball.vx = Math.sign(this.ball.vx) * Math.min(Math.abs(this.ball.vx), BALL_SPEED * 2);
    }

    resetBall() {
        this.ball.x = CANVAS_WIDTH / 2;
        this.ball.y = CANVAS_HEIGHT / 2;
        this.ball.vx = (Math.random() > 0.5 ? 1 : -1) * BALL_SPEED;
        this.ball.vy = (Math.random() - 0.5) * BALL_SPEED;
    }

    checkWin() {
        if (this.score1 >= WIN_SCORE || this.score2 >= WIN_SCORE) {
            this.state = GameState.GAME_OVER;
            return true;
        }
        return false;
    }

    // ===================== STATE SYNC =====================

    transmitState() {
        const now = performance.now();
        if (now - this.lastTransmitTime < this.transmitInterval) return;
        this.lastTransmitTime = now;

        const myPaddle = this.isHost ? this.paddle1 : this.paddle2;

        const state = {
            playerId: this.playerId,
            paddleY: Math.floor((myPaddle.y / CANVAS_HEIGHT) * 255),
            ballX: this.isHost ? Math.floor((this.ball.x / CANVAS_WIDTH) * 255) : 0,
            ballY: this.isHost ? Math.floor((this.ball.y / CANVAS_HEIGHT) * 255) : 0,
            ballVX: this.isHost ? this.ball.vx : 0,
            ballVY: this.isHost ? this.ball.vy : 0,
            score1: this.score1,
            score2: this.score2
        };

        // Send via BroadcastChannel (instant for same browser)
        if (this.localChannel) {
            this.localChannel.send(state);
        }

        // Also send via audio (for cross-device)
        if (this.audioTransmitter) {
            this.audioTransmitter.transmitGameState(state);
        }
    }

    handleReceivedState(state) {
        // Ignore our own packets
        if (state.playerId === this.playerId) return;

        // Update opponent paddle
        const opponentPaddle = this.isHost ? this.paddle2 : this.paddle1;
        const targetY = (state.paddleY / 255) * CANVAS_HEIGHT;
        opponentPaddle.y += (targetY - opponentPaddle.y) * 0.5; // Faster interpolation for local

        // Guest syncs ball from host
        if (!this.isHost && state.ballX > 0) {
            const targetBallX = (state.ballX / 255) * CANVAS_WIDTH;
            const targetBallY = (state.ballY / 255) * CANVAS_HEIGHT;

            this.ball.x += (targetBallX - this.ball.x) * 0.5;
            this.ball.y += (targetBallY - this.ball.y) * 0.5;

            this.ball.vx = state.ballVX >= 0 ? Math.abs(this.ball.vx || BALL_SPEED) : -Math.abs(this.ball.vx || BALL_SPEED);
            this.ball.vy = state.ballVY >= 0 ? Math.abs(this.ball.vy || BALL_SPEED * 0.5) : -Math.abs(this.ball.vy || BALL_SPEED * 0.5);

            // Sync scores
            this.score1 = state.score1;
            this.score2 = state.score2;
            this.updateScoreDisplay();
        }
    }

    // ===================== RENDERING =====================

    render() {
        const ctx = this.ctx;

        // Simple black background
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // Center line (dashed)
        ctx.setLineDash([10, 10]);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(CANVAS_WIDTH / 2, 0);
        ctx.lineTo(CANVAS_WIDTH / 2, CANVAS_HEIGHT);
        ctx.stroke();
        ctx.setLineDash([]);

        // Paddles (white)
        this.drawPaddle(this.paddle1);
        this.drawPaddle(this.paddle2);

        // Ball (white)
        this.drawBall();

        // Overlays
        if (this.state === GameState.WAITING) {
            this.drawOverlay('Press Host or Join to start');
        } else if (this.state === GameState.GAME_OVER) {
            const winner = this.score1 >= WIN_SCORE ? 'Player 1' : 'Player 2';
            this.drawOverlay(`${winner} Wins!`);
        }
    }

    drawPaddle(paddle) {
        const ctx = this.ctx;
        ctx.fillStyle = '#fff';
        ctx.fillRect(paddle.x, paddle.y, paddle.width, paddle.height);
    }

    drawBall() {
        const ctx = this.ctx;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(
            this.ball.x + this.ball.size / 2,
            this.ball.y + this.ball.size / 2,
            this.ball.size / 2,
            0, Math.PI * 2
        );
        ctx.fill();
    }

    drawOverlay(text) {
        const ctx = this.ctx;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 20px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
    }

    // ===================== UI =====================

    updateScoreDisplay() {
        const s1 = document.getElementById('score1');
        const s2 = document.getElementById('score2');
        if (s1) s1.textContent = this.score1;
        if (s2) s2.textContent = this.score2;
    }

    updateConnectionStatus(status) {
        const el = document.getElementById('connectionStatus');
        if (el) el.textContent = status;
    }

    updateRoleStatus(role) {
        const el = document.getElementById('roleStatus');
        if (el) el.textContent = role;
    }

    updatePacketStatus() {
        const tx = (this.localChannel?.getTxCount() || 0) + (this.audioTransmitter?.getTxCount() || 0);
        const rx = this.localChannel?.getRxCount() || 0;
        const el = document.getElementById('packetStatus');
        if (el) el.textContent = `TX: ${tx} / RX: ${rx}`;
    }

    enableStopButton(enabled) {
        const btn = document.getElementById('stopBtn');
        if (btn) btn.disabled = !enabled;
    }

    disableStartButtons(disabled) {
        const hostBtn = document.getElementById('hostBtn');
        const joinBtn = document.getElementById('joinBtn');
        if (hostBtn) hostBtn.disabled = disabled;
        if (joinBtn) joinBtn.disabled = disabled;
    }
}

// ===================== INIT =====================

document.addEventListener('DOMContentLoaded', () => {
    window.game = new PongGame('gameCanvas');
});
