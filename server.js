const express = require('express');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const INPUT_RTMP_BASE = process.env.INPUT_RTMP_BASE || 'rtmp://localhost/live';
const OBS_STREAM_KEY_LENGTH = 24;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const state = {
  sessions: new Map()
};

function createSession(name) {
  const sessionId = uuidv4();
  const ingestKey = uuidv4().replace(/-/g, '').slice(0, OBS_STREAM_KEY_LENGTH);
  const session = {
    id: sessionId,
    name: name || `Live Session ${state.sessions.size + 1}`,
    createdAt: new Date().toISOString(),
    ingestUrl: `${INPUT_RTMP_BASE}/${ingestKey}`,
    ingestKey,
    destinations: [],
    status: 'stopped',
    logs: [],
    ffmpegProcess: null,
    peakViewers: 0,
    viewers: 0
  };

  state.sessions.set(sessionId, session);
  return sanitizeSession(session);
}

function sanitizeSession(session) {
  return {
    id: session.id,
    name: session.name,
    createdAt: session.createdAt,
    ingestUrl: session.ingestUrl,
    ingestKey: session.ingestKey,
    destinations: session.destinations,
    status: session.status,
    logs: session.logs.slice(-120),
    peakViewers: session.peakViewers,
    viewers: session.viewers
  };
}

function addLog(session, message, level = 'info') {
  session.logs.push({
    id: uuidv4(),
    at: new Date().toISOString(),
    level,
    message
  });
  if (session.logs.length > 500) {
    session.logs.shift();
  }
  io.emit('session:update', sanitizeSession(session));
}

function ffmpegArgsForSession(session) {
  const outputs = session.destinations
    .filter((d) => d.enabled)
    .map((dest) => `[f=flv:onfail=ignore]${dest.rtmpUrl}`)
    .join('|');

  if (!outputs) {
    return null;
  }

  return [
    '-re',
    '-i',
    session.ingestUrl,
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-f',
    'tee',
    outputs
  ];
}

function startRelay(session) {
  const args = ffmpegArgsForSession(session);
  if (!args) {
    throw new Error('No enabled destinations configured.');
  }

  if (session.ffmpegProcess) {
    throw new Error('Relay already running.');
  }

  addLog(session, `Starting FFmpeg relay for ${session.destinations.filter((d) => d.enabled).length} destinations.`);

  const ffmpeg = spawn('ffmpeg', args);
  session.ffmpegProcess = ffmpeg;
  session.status = 'live';

  ffmpeg.stderr.on('data', (data) => {
    const text = data.toString();
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    lines.forEach((line) => addLog(session, line, /error/i.test(line) ? 'error' : 'info'));
  });

  ffmpeg.on('close', (code) => {
    addLog(session, `FFmpeg exited with code ${code}.`, code === 0 ? 'info' : 'error');
    session.status = 'stopped';
    session.ffmpegProcess = null;
    io.emit('session:update', sanitizeSession(session));
  });

  ffmpeg.on('error', (error) => {
    addLog(session, `Failed to spawn ffmpeg: ${error.message}`, 'error');
    session.status = 'error';
    session.ffmpegProcess = null;
    io.emit('session:update', sanitizeSession(session));
  });

  io.emit('session:update', sanitizeSession(session));
}

function stopRelay(session) {
  if (!session.ffmpegProcess) {
    throw new Error('Relay is not running.');
  }

  addLog(session, 'Stopping FFmpeg relay.');
  session.ffmpegProcess.kill('SIGINT');
  session.status = 'stopping';
  io.emit('session:update', sanitizeSession(session));
}

app.get('/api/sessions', (_req, res) => {
  const sessions = Array.from(state.sessions.values()).map(sanitizeSession);
  res.json({ sessions });
});

app.post('/api/sessions', (req, res) => {
  const { name } = req.body || {};
  const session = createSession(name);
  res.status(201).json({ session });
});

app.post('/api/sessions/:sessionId/destinations', (req, res) => {
  const session = state.sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  const { platform, rtmpUrl } = req.body || {};
  if (!platform || !rtmpUrl) {
    return res.status(400).json({ error: 'platform and rtmpUrl are required.' });
  }

  const destination = {
    id: uuidv4(),
    platform,
    rtmpUrl,
    enabled: true
  };

  session.destinations.push(destination);
  addLog(session, `Added ${platform} destination.`);
  return res.status(201).json({ session: sanitizeSession(session) });
});

app.patch('/api/sessions/:sessionId/destinations/:destinationId', (req, res) => {
  const session = state.sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  const destination = session.destinations.find((d) => d.id === req.params.destinationId);
  if (!destination) {
    return res.status(404).json({ error: 'Destination not found.' });
  }

  const { enabled, platform, rtmpUrl } = req.body || {};
  if (typeof enabled === 'boolean') destination.enabled = enabled;
  if (typeof platform === 'string' && platform.trim()) destination.platform = platform.trim();
  if (typeof rtmpUrl === 'string' && rtmpUrl.trim()) destination.rtmpUrl = rtmpUrl.trim();

  addLog(session, `Updated destination ${destination.platform}.`);
  return res.json({ session: sanitizeSession(session) });
});

app.delete('/api/sessions/:sessionId/destinations/:destinationId', (req, res) => {
  const session = state.sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  const index = session.destinations.findIndex((d) => d.id === req.params.destinationId);
  if (index === -1) {
    return res.status(404).json({ error: 'Destination not found.' });
  }

  const [removed] = session.destinations.splice(index, 1);
  addLog(session, `Removed destination ${removed.platform}.`);
  return res.json({ session: sanitizeSession(session) });
});

app.post('/api/sessions/:sessionId/start', (req, res) => {
  const session = state.sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  try {
    startRelay(session);
    return res.json({ session: sanitizeSession(session) });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post('/api/sessions/:sessionId/stop', (req, res) => {
  const session = state.sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  try {
    stopRelay(session);
    return res.json({ session: sanitizeSession(session) });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

io.on('connection', (socket) => {
  socket.emit('sessions:init', {
    sessions: Array.from(state.sessions.values()).map(sanitizeSession)
  });
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Studio running on http://localhost:${PORT}`);
});
