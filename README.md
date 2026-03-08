# LiveBridge Studio

LiveBridge Studio is a simple StreamYard-like control room that lets you:

- create a live session,
- connect OBS by using a generated RTMP ingest URL + key,
- add multiple destination RTMP endpoints (YouTube, Facebook, Twitch, custom),
- go live and relay one source to all enabled destinations.

## Features

- **OBS ingest setup** per session.
- **Multi-destination output** with enable/disable controls.
- **Go Live / Stop** controls.
- **Live relay logs** streamed to browser via Socket.IO.
- **Single-page dashboard UI**.

## Requirements

- Node.js 18+
- FFmpeg installed and available in your PATH
- An RTMP ingest service reachable by your OBS instance and this app.

> By default the app assumes ingest is available at `rtmp://localhost/live/<streamKey>`.

## Run locally

```bash
npm install
npm start
```

Then open <http://localhost:3000>.

## How to use with OBS and social platforms

1. Create a session in the dashboard.
2. Copy the **OBS RTMP URL** and **Stream Key** into OBS (`Settings -> Stream -> Custom`).
3. Add destination RTMP URLs from each platform:
   - YouTube (RTMP server + stream key)
   - Facebook Live (stream URL + key)
   - Twitch (RTMP ingest URL + key)
4. Press **Go Live**. The backend starts FFmpeg with tee muxing to restream to all enabled destinations.

## Important note

This is a practical starter implementation intended for self-hosting and extension.
For production, add authentication, persistent storage, platform OAuth integrations, chat moderation, recordings, analytics, and hardened error handling.
