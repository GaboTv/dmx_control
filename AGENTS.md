# AGENTS.md

## Commands

- Use Node `>=20.11`; CI and release use Node `22`, which is preferred on Windows for native `usb` stability.
- `npm run dev` starts API + web: `tsx watch src/server/index.ts` on `4174` and Vite on strict port `5173`; split commands are `npm run dev:api` and `npm run dev:web`.
- Browser code should call same-origin `/api` and `/ws`; Vite proxies them to `127.0.0.1:4174`.
- CI order is `npm run typecheck`, `npm test`, `npm run build`; run it after behavior, protocol, Electron, or DMX model changes.
- `npm run typecheck` checks `tsconfig.json` (client/shared/Vite), `tsconfig.server.json` (server/shared), and `tsconfig.electron.json` (Electron main/preload).
- `npm run build` runs `tsc -p tsconfig.server.json && vite build`; `npm start` expects `dist/server/server/index.js` and `dist/client` from that build.
- Release validation adds `npm run electron:build`, which runs the web/server build, `tsconfig.electron.json`, and `electron-builder`.
- Focused tests: `npm test -- src/shared/dmx.test.ts`, `npm test -- src/server/dmxController.test.ts`, `npm test -- src/server/controlLock.test.ts`, or `npm test -- src/client/sceneModel.test.ts`.
- Long-run validation is manual: `npm run test:soak` defaults to 5 real hours in mock mode; `npm run test:soak:scene` is the 20 Hz mock scene profile; `npm run test:soak:hardware` runs the same 20 Hz profile against real uDMX.
- Desktop shortcuts: `npm run electron:dev`, `npm run electron:build:dir` for unpacked local output, and `npm run electron:build` for installers in `release/`.

## Architecture

- Entrypoints: `index.html` -> `src/client/main.tsx` -> `App`; backend starts from `src/server/index.ts` (top-level await).
- Local hardware-control app: React/Vite UI plus Express/WebSocket backend. Browser code must use backend `/api` or `/ws`, never `usb`/uDMX directly.
- API routes, static serving, and WebSocket handlers are in `src/server/index.ts`; hardware writes are isolated in `src/server/dmxOutput.ts`.
- `src/server/dmxController.ts` owns write debounce, refresh, blackout, reconnect, serialized writes, and snapshot broadcasts.
- `src/server/controlLock.ts` implements exclusive DMX control: a client must acquire the lock before `setState`/`blackout`/`reconnect`; the lock auto-releases on disconnect.
- Electron starts from `src/electron/main.ts`; packaged Electron spawns `dist/server/server/index.js` with `STATIC_DIR=dist/client`, while `electron:dev` uses `ELECTRON_RENDERER_URL` to load Vite.
- Server and Electron TS use `moduleResolution: NodeNext`; relative imports in those trees must use `.js` specifiers even though source files are `.ts`.
- `src/client/TheaterViewer.tsx` is a Three.js-only preview of fixture state; it must not send DMX commands or touch backend hardware code.
- `src/shared/dmx.ts` defines the fixture model, channel mapping, types, and normalization shared by client, server, and tests.

## DMX And Scenes

- Fixture mapping comes from `control.jpeg` and `src/shared/dmx.ts`: each fixture is 8 channels, CH1 master, CH2-CH5 RGBW, CH6 strobe, CH7 function mode, CH8 speed.
- Direct RGBW control requires CH7/functionMode in `0-50`; scene presets and auto cues should keep manual RGBW looks at `functionMode: 0`.
- The show model controls exactly two fixtures as a 16-channel frame: Light A starts at `A001`, Light B at `A009`; uDMX uses zero-based `UDMX_START_ADDRESS=0`.
- Hardware env is loaded by `src/server/config.ts` from `.env`: `DMX_DRIVER=auto` tries uDMX then mock and keeps auto-scanning; `mock` disables hardware writes; `udmx` fails without the adapter.
- uDMX defaults are `UDMX_VENDOR_ID=0x16c0`, `UDMX_PRODUCT_ID=0x05dc`, `UDMX_WRITE_MODE=multi`, `UDMX_AUTO_RECONNECT_MS=5000`, `UDMX_REFRESH_MS=0`, `DMX_WRITE_DEBOUNCE_MS=150`.
- Music Sync prioritizes smooth RGBW interpolation and can send changed frames at about 20 Hz during playback.
- Music scenes are browser-local: uploaded audio is decoded/played in `App.tsx` and never sent to the backend; exported JSON stores cue times, selected fixture count, and per-fixture DMX patches only.

## API

- `GET /api/status` returns current DMX state, frame, device status, and control lock.
- `GET /api/config` returns fixture configs, channel definitions, and function modes.
- `POST /api/state` accepts partial fixture updates; `?immediate=true` bypasses debounce for scene playback. Requires control lock.
- `POST /api/blackout` sets all channels to `0` immediately. Requires control lock.
- `POST /api/device/reconnect` reopens the uDMX adapter. Requires control lock.
- `POST /api/control-lock` acquires exclusive DMX control with `{ clientId, label? }`.
- `POST /api/control-lock/release` releases DMX control.
- `WS /ws` supports `setState`, `blackout`, `reconnect`, `acquireControl`, and `releaseControl`; pass client ID via `?clientId=` or `X-DMX-Client-Id`.

## Style

- Prettier: `singleQuote: true`, `trailingComma: 'all'`. Run `npm run format` before committing.
- ESLint deliberately disables `@typescript-eslint/no-explicit-any`; `any` is allowed when useful.
- `tsconfig.server.json` excludes `**/*.test.ts`; server tests are run by Vitest but not server-typechecked.
