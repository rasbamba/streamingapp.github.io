const socket = io();
const sessionsById = new Map();

const sessionsNode = document.getElementById('sessions');
const sessionTemplate = document.getElementById('session-template');
const createSessionForm = document.getElementById('create-session-form');

createSessionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const sessionName = new FormData(createSessionForm).get('sessionName');
  await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: sessionName })
  });
  createSessionForm.reset();
});

socket.on('sessions:init', ({ sessions }) => {
  sessions.forEach((session) => sessionsById.set(session.id, session));
  render();
});

socket.on('session:update', (session) => {
  sessionsById.set(session.id, session);
  render();
});

function statusClass(status) {
  return ['live', 'stopped', 'stopping', 'error'].includes(status) ? status : 'stopped';
}

function buildDestinationRow(sessionId, destination) {
  const row = document.createElement('div');
  row.className = 'destination-row';

  const platform = document.createElement('strong');
  platform.textContent = destination.platform;

  const url = document.createElement('small');
  url.textContent = destination.rtmpUrl;

  const state = document.createElement('small');
  state.textContent = destination.enabled ? 'Enabled' : 'Disabled';

  const actions = document.createElement('div');
  actions.className = 'dest-actions';

  const toggleButton = document.createElement('button');
  toggleButton.textContent = destination.enabled ? 'Disable' : 'Enable';
  toggleButton.addEventListener('click', async () => {
    await fetch(`/api/sessions/${sessionId}/destinations/${destination.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !destination.enabled })
    });
  });

  const removeButton = document.createElement('button');
  removeButton.textContent = 'Remove';
  removeButton.addEventListener('click', async () => {
    await fetch(`/api/sessions/${sessionId}/destinations/${destination.id}`, { method: 'DELETE' });
  });

  actions.append(toggleButton, removeButton);
  row.append(platform, url, state, actions);
  return row;
}

function renderSession(session) {
  const fragment = sessionTemplate.content.cloneNode(true);

  fragment.querySelector('.session-name').textContent = session.name;

  const statusEl = fragment.querySelector('.status');
  statusEl.className = `status ${statusClass(session.status)}`;
  statusEl.textContent = session.status;

  fragment.querySelector('.ingest-url').textContent = session.ingestUrl;
  fragment.querySelector('.ingest-key').textContent = session.ingestKey;

  const startButton = fragment.querySelector('.start');
  const stopButton = fragment.querySelector('.stop');

  startButton.disabled = session.status === 'live' || session.status === 'stopping';
  stopButton.disabled = session.status !== 'live' && session.status !== 'stopping';

  startButton.addEventListener('click', async () => {
    await fetch(`/api/sessions/${session.id}/start`, { method: 'POST' });
  });

  stopButton.addEventListener('click', async () => {
    await fetch(`/api/sessions/${session.id}/stop`, { method: 'POST' });
  });

  const destinationForm = fragment.querySelector('.destination-form');
  destinationForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(destinationForm);
    await fetch(`/api/sessions/${session.id}/destinations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: formData.get('platform'),
        rtmpUrl: formData.get('rtmpUrl')
      })
    });
    destinationForm.reset();
  });

  const destinationsNode = fragment.querySelector('.destinations');
  session.destinations.forEach((destination) => {
    destinationsNode.appendChild(buildDestinationRow(session.id, destination));
  });

  const logsText = session.logs
    .map((entry) => `[${new Date(entry.at).toLocaleTimeString()}] ${entry.level.toUpperCase()} ${entry.message}`)
    .join('\n');
  fragment.querySelector('.logs').textContent = logsText || 'No relay logs yet.';

  return fragment;
}

function render() {
  const sessions = Array.from(sessionsById.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  sessionsNode.innerHTML = '';

  if (!sessions.length) {
    sessionsNode.innerHTML = '<p>No sessions yet. Create one to start streaming.</p>';
    return;
  }

  sessions.forEach((session) => {
    sessionsNode.appendChild(renderSession(session));
  });
}
