// host-simple.js - Complete Screen Streaming Host
const io = require('socket.io-client');
const screenshot = require('screenshot-desktop');

// Configuration
const SIGNALING_SERVER = 'http://localhost:3000';
const ROOM_ID = 'my-desktop';
const TARGET_FPS = 15; // Lower target for stability

let socket;
let connected = false;
let capturing = false;
let viewerSocketId = null;

console.log('╔═══════════════════════════════════════════════════╗');
console.log('║   Screen Screenshot Streaming (View Only)         ║');
console.log('╚═══════════════════════════════════════════════════╝');

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
    startCapture();
  });

  socket.on('disconnect', () => {
    console.log('❌ Disconnected');
    connected = false;
    capturing = false;
  });
}

// Start screen capture
async function startCapture() {
  if (capturing) return;
  capturing = true;
  
  console.log('🎬 Streaming started...');
  
  let frameCount = 0;
  let lastFpsTime = Date.now();
  const frameInterval = 1000 / TARGET_FPS;
  let lastFrameTime = Date.now();

  async function captureLoop() {
    if (!capturing || !connected) {
      console.log('⏸️  Stopped');
      return;
    }

    const now = Date.now();
    const elapsed = now - lastFrameTime;

    if (elapsed < frameInterval) {
      setTimeout(captureLoop, frameInterval - elapsed);
      return;
    }

    try {
      // Capture screenshot with lower quality for speed
      const imgBuffer = await screenshot({ 
        format: 'jpg',
        quality: 50  // Lower quality = faster
      });
      const base64 = imgBuffer.toString('base64');
      
      if (viewerSocketId) {
        socket.emit('frame', {
          to: viewerSocketId,
          data: base64
        });
      }

      frameCount++;
      lastFrameTime = now;

      if (now - lastFpsTime >= 5000) {
        const fps = Math.round(frameCount / ((now - lastFpsTime) / 1000));
        console.log(`📊 Streaming at ${fps} FPS`);
        frameCount = 0;
        lastFpsTime = now;
      }

    } catch (error) {
      console.error('❌ Error:', error.message);
    }

    setImmediate(captureLoop);
  }

  captureLoop();
}

process.on('SIGINT', () => {
  console.log('\n👋 Goodbye!');
  process.exit(0);
});

connectToServer();