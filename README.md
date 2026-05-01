# DMX Light Control App

Production-oriented local web app for controlling two 8-channel RGBW DMX fixtures through a uDMX USB-to-DMX adapter, including music-synced scene playback.

## Fixture Profile

The included `control.jpeg` shows each fixture in `DMX 512 Control Mode: 8 Channel Model`:

| Channel | Function | Range |
| --- | --- | --- |
| CH1 | Master dimmer | `0-255` |
| CH2 | Red dimmer | `0-255` |
| CH3 | Green dimmer | `0-255` |
| CH4 | Blue dimmer | `0-255` |
| CH5 | White dimmer | `0-255` |
| CH6 | Strobe | `0-255`, slow to fast |
| CH7 | Function choice | `0-50` direct DMX, `51-100` colors, `101-150` jump, `151-200` gradate, `201-250` pulse, `251-255` sound-active |
| CH8 | Function speed | `0-255`, slow to fast |

Set light A to `A001` and light B to `A009`. The uDMX protocol is zero-based, so this app defaults `UDMX_START_ADDRESS=0` and sends a 16-channel frame.

## Scene Workflow

- Upload a song in the browser; audio stays local and is played through an HTML audio element.
- Choose `Lights in this scene` before generating or capturing cues; scenes can target the first 1 or 2 configured fixtures.
- Use `Auto-Generate Scene` to analyze audio energy in the browser and create a cue timeline for the selected number of lights.
- Use `Add Manual Cue` while the song is paused or playing to capture the selected Light A/B state at the current audio time.
- Exported scene JSON contains cue timing and DMX values, not the audio file. Re-upload the song and import the scene JSON to replay the same show.
- The 3D theater preview is browser-only; it visualizes the current DMX fixture state and does not send hardware commands.

## Requirements

- Node.js `20.11+`; Node.js `22 LTS` is recommended on Windows because the native USB stack may be less stable on current Node releases.
- uDMX adapter with a libusb-compatible driver installed.
- On Windows 11, install `libusbK` on the uDMX device with Zadig and confirm the device VID/PID is `16c0:05dc`.

## Setup

```bash
npm install
copy .env.example .env
npm run dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/api` and `/ws` to the backend on `http://127.0.0.1:4174`.

## Hardware Mode

`DMX_DRIVER=auto` tries the uDMX adapter first and falls back to mock mode if hardware is unavailable. Use `DMX_DRIVER=udmx` when the app should fail startup unless the adapter is connected.

Default uDMX USB IDs are `UDMX_VENDOR_ID=0x16c0` and `UDMX_PRODUCT_ID=0x05dc`.

For Windows 11 + `libusbK`, use the safer defaults from `.env.example`:

```env
UDMX_WRITE_MODE=single
UDMX_REFRESH_MS=0
DMX_WRITE_DEBOUNCE_MS=150
```

`UDMX_WRITE_MODE=single` sends only changed channels with the uDMX single-channel command. `UDMX_WRITE_MODE=multi` sends the full show frame as one control transfer. `UDMX_WRITE_MODE=auto` tries multi and falls back to single after a transfer failure.

## Commands

```bash
npm run dev        # API + web UI
npm run dev:api    # backend only
npm run dev:web    # frontend only
npm run typecheck
npm test
npm run build
npm start          # serves dist/client from the API server
```

## API

- `GET /api/status` returns the current DMX state, frame, and device status.
- `POST /api/state` accepts partial fixture updates, for example `{ "fixtures": [{ "red": 255 }, { "blue": 255 }] }`. Use `?immediate=true` for scene playback cues.
- `POST /api/blackout` sets all channels to `0` and sends the frame immediately.
- `POST /api/device/reconnect` closes and reopens the uDMX adapter.
- `WS /ws` accepts `{ "type": "setState", "state": { "fixtures": [...] }, "immediate": true }`, `{ "type": "blackout" }`, and `{ "type": "reconnect" }`.

## Production

```bash
npm run build
DMX_DRIVER=udmx npm start
```

Keep this app on a trusted local network. It controls physical lighting hardware and intentionally exposes no public authentication layer by default.

## Troubleshooting uDMX Disconnects

- If Vite logs `ws proxy error: read ECONNRESET`, check the `[api]` terminal first; it usually means the backend lost or restarted its WebSocket connection after a USB error.
- Test `DMX_DRIVER=mock`; if the adapter still disappears from Windows, the issue is outside this app.
- Plug uDMX directly into the PC, avoid hubs, and disable USB selective suspend plus USB hub power saving in Device Manager.
- Close QLC+, DMXControl, OLA, or any other program that may also open the uDMX adapter.
