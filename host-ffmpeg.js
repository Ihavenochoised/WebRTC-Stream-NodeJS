// host-ffmpeg.js - Screen Recording with FFmpeg
const io = require('socket.io-client');
const { spawn } = require('child_process');
const fs = require('fs');

// Configuration
const SIGNALING_SERVER = 'http://localhost:3000';
const ROOM_ID = 'my-desktop';
const TARGET_FPS = 30;

let socket;
let connected = false;
let viewerSocketId = null;
let ffmpegProcess = null;

console.log('╔════════════════════════════════════════╗');
console.log('║   FFmpeg Screen Recording Host         ║');
console.log('╚════════════════════════════════════════╝');

// Connect to signaling server
function connectToServer() {
    console.log('🔌 Connecting to server...');

    socket = io(SIGNALING_SERVER, {
        reconnection: true,
        reconnectionDelay: 1000
    });

    socket.on('connect', () => {
        console.log('✅ Connected');
        socket.emit('join-room', { roomId: ROOM_ID, role: 'host' });
    });

    socket.on('joined', () => {
        console.log(`✅ Room: ${ROOM_ID}`);
        console.log('⏳ Waiting for viewer...');
        console.log(`📱 Open: http://localhost:3000`);
    });

    socket.on('viewer-joined', ({ viewerId }) => {
        console.log('👀 Viewer connected!');
        viewerSocketId = viewerId;
        connected = true;
        startFFmpegCapture();
    });

    socket.on('disconnect', () => {
        console.log('❌ Disconnected');
        connected = false;
        stopFFmpegCapture();
    });
}

// Start FFmpeg screen capture
function startFFmpegCapture() {
    if (ffmpegProcess) return;

    console.log('🎬 Starting FFmpeg capture...');

    // FFmpeg command for Windows screen capture
    // Captures screen at 30 FPS, outputs JPEG frames
    const ffmpegArgs = [
        '-f', 'gdigrab',           // Windows screen capture
        '-framerate', TARGET_FPS,   // Frame rate
        '-i', 'desktop',            // Capture desktop
        '-vf', 'scale=1280:720',    // Downscale for performance
        '-q:v', '5',                // JPEG quality (2-31, lower = better)
        '-f', 'image2pipe',         // Output as image stream
        '-vcodec', 'mjpeg',         // Motion JPEG codec
        'pipe:1'                    // Output to stdout
    ];

    ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

    let frameBuffer = Buffer.alloc(0);
    let frameCount = 0;
    let lastFpsTime = Date.now();

    // Read JPEG frames from stdout
    ffmpegProcess.stdout.on('data', (data) => {
        frameBuffer = Buffer.concat([frameBuffer, data]);

        // Find JPEG markers (FFD8 = start, FFD9 = end)
        while (true) {
            const startIdx = frameBuffer.indexOf(Buffer.from([0xFF, 0xD8]));
            const endIdx = frameBuffer.indexOf(Buffer.from([0xFF, 0xD9]));

            if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                // Extract complete JPEG frame
                const frame = frameBuffer.slice(startIdx, endIdx + 2);
                frameBuffer = frameBuffer.slice(endIdx + 2);

                // Send frame to viewer
                if (connected && viewerSocketId) {
                    const base64 = frame.toString('base64');
                    socket.emit('frame', {
                        to: viewerSocketId,
                        data: base64
                    });

                    frameCount++;
                    const now = Date.now();
                    if (now - lastFpsTime >= 5000) {
                        const fps = Math.round(frameCount / ((now - lastFpsTime) / 1000));
                        console.log(`📊 Streaming at ${fps} FPS`);
                        frameCount = 0;
                        lastFpsTime = now;
                    }
                }
            } else {
                break;
            }
        }
    });

    ffmpegProcess.stderr.on('data', (data) => {
        // FFmpeg logs go to stderr, ignore unless there's an error
        const msg = data.toString();
        if (msg.includes('Error') || msg.includes('error')) {
            console.error('❌ FFmpeg error:', msg);
        }
    });

    ffmpegProcess.on('close', (code) => {
        console.log(`FFmpeg process exited with code ${code}`);
        ffmpegProcess = null;
    });

    console.log('✅ FFmpeg capture started');
}

function stopFFmpegCapture() {
    if (ffmpegProcess) {
        console.log('⏸️  Stopping FFmpeg...');
        ffmpegProcess.kill('SIGTERM');
        ffmpegProcess = null;
    }
}

process.on('SIGINT', () => {
    console.log('\n👋 Shutting down...');
    stopFFmpegCapture();
    if (socket) socket.disconnect();
    process.exit(0);
});

connectToServer();