// host-ffmpeg.js - Screen Recording with FFmpeg + Input Control
const io = require('socket.io-client');
const { spawn } = require('child_process');
const robot = require('robotjs');

// Configuration
const SIGNALING_SERVER = 'http://localhost:3000';
const ROOM_ID = 'my-desktop';
const TARGET_FPS = 60;

let socket;
let connected = false;
let viewerSocketId = null;
let ffmpegProcess = null;
let screenSize = null;

console.log('╔════════════════════════════════════════╗');
console.log('║   FFmpeg Screen + Input Control        ║');
console.log('╚════════════════════════════════════════╝');

// Get screen size for input mapping
try {
  screenSize = robot.getScreenSize();
  console.log(`📺 Screen: ${screenSize.width}x${screenSize.height}`);
} catch (err) {
  console.log('⚠️  Warning: Could not get screen size');
  screenSize = { width: 1920, height: 1080 };
}

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

  socket.on('input-event', (event) => {
    handleInputEvent(event);
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
  '-f', 'gdigrab',          // Windows screen capture
  '-framerate', TARGET_FPS,
  '-i', 'desktop',
  '-c:v', 'libx264',        // Use H.264
  '-preset', 'ultrafast',   // Prioritize speed
  '-tune', 'zerolatency',   // Prioritize low latency
  '-crf', '25',             // Quality (18-28 is good, higher=lower quality/smaller size)
  '-vf', 'scale=1024:576',  // Lower resolution
  '-f', 'mpegts',           // Transport stream format (easy to pipe)
  'pipe:1'
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
          socket.emit('frame', {
            to: viewerSocketId,
            data: frame // Socket.IO handles the Buffer natively
          }, true); // Add a callback for an ACK if desired
          
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

function handleInputEvent(event) {
    if (!screenSize) {
        console.log('Cannot handle input: screen size unknown.');
        return;
    }

    // Input events should be simple objects like:
    // { type: 'mouse', action: 'move', x: 0.5, y: 0.5 } (normalized coordinates)
    // { type: 'key', action: 'down', key: 'a' }
    
    switch (event.type) {
        case 'mouse':
            handleMouseEvent(event);
            break;
        case 'key':
            handleKeyEvent(event);
            break;
        // Add support for scroll, etc.
    }
}

function handleMouseEvent(event) {
    const { action, x, y, button } = event; // x, y are normalized (0.0 to 1.0)
    
    // Map normalized client coordinates (0.0 to 1.0) to host screen pixels
    const targetX = Math.round(x * screenSize.width);
    const targetY = Math.round(y * screenSize.height);

    switch (action) {
        case 'move':
            robot.moveMouse(targetX, targetY);
            break;
        case 'down':
            // Check for right or left click
            const clickButton = button === 'right' ? 'right' : 'left';
            robot.mouseToggle('down', clickButton);
            break;
        case 'up':
            const releaseButton = button === 'right' ? 'right' : 'left';
            robot.mouseToggle('up', releaseButton);
            break;
        case 'click':
            const singleClickButton = button === 'right' ? 'right' : 'left';
            robot.mouseClick(singleClickButton);
            break;
    }
}

function handleKeyEvent(event) {
    const { action, key, modifiers } = event; // 'key' is the robotjs key name
    
    // The viewer client is responsible for sending robotjs-compatible keys.
    if (action === 'down') {
        robot.keyToggle(key, 'down', modifiers);
    } else if (action === 'up') {
        robot.keyToggle(key, 'up', modifiers);
    } else if (action === 'tap') {
        robot.keyTap(key, modifiers);
    }
}

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  stopFFmpegCapture();
  if (socket) socket.disconnect();
  process.exit(0);
});

connectToServer();