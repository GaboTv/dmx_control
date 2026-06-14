# DMX Light Control App

Production-oriented local web app for controlling two 8-channel RGBW DMX fixtures through a uDMX USB-to-DMX adapter, including music-synced scene playback.

## Fixture Profile

The included `control.jpeg` shows each fixture in `DMX 512 Control Mode: 8 Channel Model`:

| Channel | Function        | Range                                                                                                          |
| ------- | --------------- | -------------------------------------------------------------------------------------------------------------- |
| CH1     | Master dimmer   | `0-255`                                                                                                        |
| CH2     | Red dimmer      | `0-255`                                                                                                        |
| CH3     | Green dimmer    | `0-255`                                                                                                        |
| CH4     | Blue dimmer     | `0-255`                                                                                                        |
| CH5     | White dimmer    | `0-255`                                                                                                        |
| CH6     | Strobe          | `0-255`, slow to fast                                                                                          |
| CH7     | Function choice | `0-50` direct DMX, `51-100` colors, `101-150` jump, `151-200` gradate, `201-250` pulse, `251-255` sound-active |
| CH8     | Function speed  | `0-255`, slow to fast                                                                                          |

Set light A to `A001` and light B to `A009`. The uDMX protocol is zero-based, so this app defaults `UDMX_START_ADDRESS=0` and sends a 16-channel frame.

## Scene Workflow

- Upload a song in the browser; audio stays local and is played through an HTML audio element.
- Choose `Lights in this scene` before generating or capturing cues; scenes can target the first 1 or 2 configured fixtures.
- Use `Generate Folkloric Scene` to analyze rhythm/phrase intensity in the browser and create warm RGBW cues for the selected number of lights. The generate button shows staged processing progress.
- If the browser cannot decode an uploaded audio file for analysis, the app falls back to duration-based timed cues so the scene can still be used. Re-exporting the track as a standard MP3/WAV may restore beat-aware analysis.
- Use `Add Manual Cue` while the song is paused or playing to capture the selected Light A/B state at the current audio time.
- Use `Clear Scene` to remove all cues while keeping the uploaded song, fixture count, and scene settings.
- Exported scene JSON contains cue timing and DMX values, not the audio file. Re-upload the song and import the scene JSON to replay the same show.
- The 3D theater preview is browser-only; it visualizes the current DMX fixture state and does not send hardware commands.

## Control Lock

- Click `Take Control` before sending DMX commands. Sliders, presets, blackout, reconnect, and scene playback remain disabled until this browser owns the hardware lock.
- The app keeps control after pause, stop, scene end, and returning to the mode-selection screen.
- Control is released only when the user clicks `Release` / `Release Control`, the browser disconnects, or the backend drops the client connection.

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

## Desktop App For End Users

End users should not need Node.js, npm, or a terminal. Build and publish the Electron installers instead:

- Windows: `DMX Light Control-Setup-<version>.exe`
- macOS: `DMX Light Control-<version>-<arch>.dmg`

User flow:

1. Download the installer from the GitHub release.
2. Install the app.
3. Plug in the uDMX adapter.
4. Open `DMX Light Control` from the desktop/start menu/applications folder.
5. Click `Take Control` before sending DMX commands.

The desktop app bundles the API server and browser UI. It still defaults to `DMX_DRIVER=auto`, so it uses uDMX when available and mock mode when the adapter is missing.

## Desktop Build Commands

```bash
npm run electron:dev       # current dev server + Electron shell
npm run electron:build:dir # unpacked local test build in release/win-unpacked
npm run electron:build     # installer build for the current OS
```

Build Windows installers on Windows and macOS DMGs on macOS. Native USB dependencies are rebuilt for the target Electron runtime during packaging.

Unsigned first releases may trigger Windows SmartScreen or macOS Gatekeeper warnings. For public distribution, add code signing later.

## Hardware Mode

`DMX_DRIVER=auto` tries the uDMX adapter first and falls back to mock mode if hardware is unavailable. While in mock mode, the backend auto-scans for uDMX every `UDMX_AUTO_RECONNECT_MS` milliseconds and switches to hardware as soon as the adapter appears. Use `DMX_DRIVER=udmx` when the app should fail startup unless the adapter is connected.

Default uDMX USB IDs are `UDMX_VENDOR_ID=0x16c0` and `UDMX_PRODUCT_ID=0x05dc`.

For the uDMX adapter, use the `.env.example` defaults:

```env
UDMX_WRITE_MODE=multi
UDMX_AUTO_RECONNECT_MS=5000
UDMX_REFRESH_MS=0
DMX_WRITE_DEBOUNCE_MS=150
```

`UDMX_WRITE_MODE=multi` sends the full 16-channel show frame as one control transfer. `UDMX_WRITE_MODE=single` sends changed channels one at a time. `UDMX_WRITE_MODE=auto` tries multi and falls back to single after a transfer failure.

Set `UDMX_AUTO_RECONNECT_MS=0` to disable automatic uDMX scanning while in mock mode.

Music Sync prioritizes smooth automatic RGBW dimming: scene interpolation sends changed frames at up to about 20 updates/second while playback runs.

## Commands

```bash
npm run dev        # API + web UI
npm run dev:api    # backend only
npm run dev:web    # frontend only
npm run typecheck
npm test
npm run test:soak # mock DMX long-run soak, defaults to 5 hours
npm run test:soak:scene # 20 Hz scene-playback soak, mock by default
npm run test:soak:hardware # 20 Hz scene-playback soak against real uDMX
npm run build
npm start          # serves dist/client from the API server
npm run electron:build
```

## Reliability Tests

`npm test` includes fast checks for the DMX model, scene import/generation helpers, controller debounce, serialized writes, write-failure recovery, and a fake-timer simulation of 5 hours of refresh ticks.

Run `npm run test:soak` before unattended use to exercise the controller in mock mode for 5 real hours. Use `npm run test:soak -- --minutes=30` for a shorter local soak. The default soak workload sends changing RGBW frames every `250ms`.

For production readiness, run the scene-playback profile for the full 5 hours. It sends changed frames at `50ms` intervals, disables artificial blackout/reconnect actions, fails if an operation takes longer than `5000ms`, and reports event-loop delay plus memory use:

```bash
npm run test:soak:scene
```

For real USB stability, plug in uDMX and run the same 20 Hz profile against hardware:

```bash
npm run test:soak:hardware
```

Soak stats print every `30s` by default:

```text
[soak:stats] elapsed=0m30s remaining=299m30s updates=600 packets=601 packets/s=20.03 updates/s=20.00 driver=udmx mode=multi connected=true failures=0 eventLoopMaxMs=22.4 eventLoopMeanMs=20.1 heapMb=18.7 rssMb=82.3
```

`updates` is controller update cycles. `packets` is actual output packets: mock and uDMX `multi` mode count one packet per frame, while uDMX `single` mode counts each successful USB control transfer. The soak fails on disconnects, increased uDMX write failures, event-loop stalls above `--max-event-loop-delay-ms` (default `2000`), or operations that exceed `--operation-timeout-ms` (default `5000`).

To test the real USB-to-DMX path, run hardware mode explicitly:

```bash
npm run test:soak -- --driver=udmx --minutes=30 --stats-interval-ms=5000
```

Hardware soak mode changes connected light colors and fails if uDMX disconnects or write failures increase. Add `--strobe` only if visible strobe flashes are acceptable. Use time-based options only when you intentionally want to test those controls during a soak:

```bash
npm run test:soak -- --driver=udmx --minutes=30 --blackout-interval-minutes=10 --reconnect-interval-minutes=30
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

## Troubleshooting uDMX On macOS

- In System Information -> USB, confirm the uDMX device shows Product ID `0x05dc` and Vendor ID `0x16c0`; those are the app defaults.
- If the desktop app stays in mock mode, open the device card's `USB devices seen by app` section. It lists what the packaged native `usb` module can enumerate, which may differ from System Information if native USB loading failed.
- To force a hard failure instead of mock fallback, launch from Terminal:

```bash
DMX_DRIVER=udmx "/Applications/DMX Light Control.app/Contents/MacOS/DMX Light Control"
```

- If the Terminal error says the native `usb` module failed to load, rebuild the macOS release from GitHub Actions or on the target Mac so `node_modules/usb` is rebuilt for the Electron/macOS architecture.
- If the app sees `0x16c0:0x05dc` but still cannot open it, close other DMX/USB tools and reconnect the adapter directly rather than through a hub.
