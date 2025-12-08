// host.js - Windows Remote Desktop Host
// Run with: node host.js
// Requires admin privileges for full screen capture and input control

const io = require('socket.io-client');
const wrtc = require('wrtc');
const screenshot = require('screenshot-desktop');
const robot = require('robotjs');
const { createCanvas, loadImage } = require('canvas');

const SIGNALING_SERVER = 'http://localhost:3000'; // Change to your Replit URL
const ROOM_ID = 'desktop-session-1';
const TARGET_FPS = 30;
const FRAME_INTERVAL = 1000 / TARGET_FPS;

let socket;
let peerConnection;
let dataChannel;
let isStreaming = false;
let lastFrameTime = 0;
let frameCount = 0;

// Get screen size
const screenSize = robot.getScreenSize();
console.log(`📺 Screen size: ${screenSize.width}x${screenSize.height}`);

// WebRTC configuration
const config = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
};

// Connect to signaling server
function connectToServer() {
  console.log('🔌 Connecting to signaling server...');
  
  socket = io(SIGNALING_SERVER, {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 10
  });

  socket.on('connect', () => {
    console.log('✅ Connected to signaling server');
    console.log(`🏠 Joining room: ${ROOM_ID}`);
    socket.emit('join-room', { roomId: ROOM_ID, role: 'host' });
  });

  socket.on('joined', ({ role }) => {
    console.log(`✅ Joined room as ${role}`);
    console.log('⏳ Waiting for viewers...');
  });

  socket.on('viewer-joined', ({ viewerId }) => {
    console.log('👀 Viewer joined! Creating connection...');
    createPeerConnection(viewerId);
  });

  socket.on('signal', async ({ from, signal }) => {
    await handleSignal(signal, from);
  });

  socket.on('disconnect', () => {
    console.log('❌ Disconnected from server');
    isStreaming = false;
  });

  socket.on('connect_error', (error) => {
    console.error('❌ Connection error:', error.message);
  });
}

// Create WebRTC peer connection
async function createPeerConnection(viewerId) {
  console.log('🎬 Creating peer connection...');
  
  peerConnection = new wrtc.RTCPeerConnection(config);

  // ICE candidate handling
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.log(`🧊 ICE candidate: ${event.candidate.type}`);
      socket.emit('signal', {
        roomId: ROOM_ID,
        to: viewerId,
        signal: { type: 'ice-candidate', candidate: event.candidate }
      });
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log(`❄️ ICE connection state: ${peerConnection.iceConnectionState}`);
  };

  peerConnection.onconnectionstatechange = () => {
    console.log(`🔗 Connection state: ${peerConnection.connectionState}`);
    
    if (peerConnection.connectionState === 'connected') {
      console.log('✅ WebRTC connected! Starting screen capture...');
      isStreaming = true;
      startScreenCapture();
    } else if (peerConnection.connectionState === 'failed' || 
               peerConnection.connectionState === 'disconnected') {
      console.log('❌ Connection failed/disconnected');
      isStreaming = false;
    }
  };

  // Create data channel for input events
  dataChannel = peerConnection.createDataChannel('input');
  
  dataChannel.onopen = () => {
    console.log('📡 Data channel opened - ready for input events');
  };

  dataChannel.onmessage = (event) => {
    handleInputEvent(JSON.parse(event.data));
  };

  dataChannel.onclose = () => {
    console.log('📡 Data channel closed');
  };

  // Create canvas for streaming
  const canvas = createCanvas(1280, 720);
  const ctx = canvas.getContext('2d');
  
  // Use node-canvas to create a MediaStream (we'll manually push frames)
  const stream = canvas.captureStream(TARGET_FPS);
  
  stream.getTracks().forEach(track => {
    console.log(`➕ Adding track: ${track.kind}`);
    peerConnection.addTrack(track, stream);
  });

  // Store canvas for later use
  peerConnection._canvas = canvas;
  peerConnection._ctx = ctx;

  // Create and send offer
  console.log('📝 Creating offer...');
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  
  socket.emit('signal', {
    roomId: ROOM_ID,
    to: viewerId,
    signal: { type: 'offer', sdp: offer.sdp }
  });
  
  console.log('📤 Offer sent to viewer');
}

// Handle signaling messages
async function handleSignal(signal, from) {
  console.log(`📨 Received signal: ${signal.type}`);
  
  if (signal.type === 'answer') {
    await peerConnection.setRemoteDescription(
      new wrtc.RTCSessionDescription({
        type: 'answer',
        sdp: signal.sdp
      })
    );
    console.log('✅ Answer processed');
  } else if (signal.type === 'ice-candidate') {
    if (peerConnection.remoteDescription) {
      await peerConnection.addIceCandidate(
        new wrtc.RTCIceCandidate(signal.candidate)
      );
    }
  }
}

// Screen capture loop
async function startScreenCapture() {
  console.log('📸 Starting screen capture...');
  
  async function captureFrame() {
    if (!isStreaming || !peerConnection) return;

    const now = Date.now();
    if (now - lastFrameTime < FRAME_INTERVAL) {
      setTimeout(captureFrame, FRAME_INTERVAL - (now - lastFrameTime));
      return;
    }

    try {
      // Capture screenshot
      const imgBuffer = await screenshot({ format: 'png' });
      const img = await loadImage(imgBuffer);
      
      const canvas = peerConnection._canvas;
      const ctx = peerConnection._ctx;
      
      // Draw to canvas (downscaled for performance)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      // Calculate FPS
      frameCount++;
      if (now - lastFrameTime >= 1000) {
        const fps = Math.round(frameCount / ((now - lastFrameTime) / 1000));
        console.log(`📊 FPS: ${fps}`);
        frameCount = 0;
      }
      
      lastFrameTime = now;
      
    } catch (error) {
      console.error('❌ Screen capture error:', error.message);
    }

    // Schedule next frame
    setTimeout(captureFrame, 5);
  }

  captureFrame();
}

// Handle input events from viewer
function handleInputEvent(event) {
  try {
    if (event.type === 'mousemove') {
      const x = Math.round((event.x / 100) * screenSize.width);
      const y = Math.round((event.y / 100) * screenSize.height);
      robot.moveMouse(x, y);
      
    } else if (event.type === 'mousedown') {
      const button = event.button === 0 ? 'left' : event.button === 2 ? 'right' : 'middle';
      robot.mouseToggle('down', button);
      
    } else if (event.type === 'mouseup') {
      const button = event.button === 0 ? 'left' : event.button === 2 ? 'right' : 'middle';
      robot.mouseToggle('up', button);
      
    } else if (event.type === 'wheel') {
      robot.scrollMouse(0, event.deltaY > 0 ? -3 : 3);
      
    } else if (event.type === 'keydown') {
      robot.keyToggle(event.key, 'down', event.modifiers || []);
      
    } else if (event.type === 'keyup') {
      robot.keyToggle(event.key, 'up', event.modifiers || []);
    }
  } catch (error) {
    console.error('❌ Input handling error:', error.message);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  isStreaming = false;
  
  if (dataChannel) dataChannel.close();
  if (peerConnection) peerConnection.close();
  if (socket) socket.disconnect();
  
  process.exit(0);
});

// Start
console.log('🚀 Windows Remote Desktop Host Starting...');
console.log('⚠️  Make sure to run as Administrator for full functionality');
connectToServer();

/*
Installation notes:
1. Install Node.js (16.x or higher recommended)
2. Run: npm install
3. You may need windows-build-tools for native modules:
   npm install --global windows-build-tools
4. Run as Administrator: node host.js
*/