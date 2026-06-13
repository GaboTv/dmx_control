# AGENTS.md

## Commands

- Use Node `>=20.11`; Node `22` is preferred on Windows because native `usb` is rebuilt for Electron and can be sensitive to runtime versions.
- `npm run dev` starts both processes: API `src/server/index.ts` on `127.0.0.1:4174` and Vite on strict port `5173`; use `npm run dev:api` or `npm run dev:web` to split them.
- Browser/client code should call same-origin `/api` and `/ws`; Vite proxies those to the API server.
- Full local verification after behavior/protocol/DMX/Electron changes: `npm run typecheck`, `npm test`, `npm run build`; add `npm run electron:build` when validating packaged desktop output.
- `npm run typecheck` covers three configs: client/shared/Vite (`tsconfig.json`), server/shared (`tsconfig.server.json`), and Electron (`tsconfig.electron.json`).
- Focused tests: `npm test -- src/shared/dmx.test.ts`, `npm test -- src/server/dmxOutput.test.ts`, `npm test -- src/server/dmxController.test.ts`, `npm test -- src/server/controlLock.test.ts`, `npm test -- src/client/sceneModel.test.ts`.
- Long-running validation is manual: `npm run test:soak` defaults to 5 real hours in mock mode; `npm run test:soak:scene` is the 20 Hz mock scene profile; `npm run test:soak:hardware` runs that profile against real uDMX.
- Desktop shortcuts: `npm run electron:dev`, `npm run electron:build:dir` for unpacked local output, and `npm run electron:build` for installers in `release/`.
- `.github/workflows/macos-build.yml` builds unsigned macOS DMG artifacts on GitHub with Node 22; it runs on manual dispatch and relevant `main` pushes.

## Architecture

- Entrypoints: `index.html` -> `src/client/main.tsx` -> `App`; backend starts from `src/server/index.ts` using top-level await.
- This is a local hardware-control app: React/Vite UI plus Express/WebSocket backend. Browser code must not import `usb` or touch uDMX directly.
- API routes, static serving, Helmet CSP, and WebSocket handlers live in `src/server/index.ts`; hardware writes are isolated in `src/server/dmxOutput.ts`.
- `src/server/dmxController.ts` owns debounce, immediate scene writes, refresh, blackout, reconnect/auto-scan, serialized writes, and snapshot broadcasts.
- `src/server/controlLock.ts` enforces exclusive DMX control; `setState`/`blackout`/`reconnect` require the client lock, and the lock auto-releases when that client disconnects.
- Electron starts at `src/electron/main.ts`; packaged Electron spawns `dist/server/server/index.js` with `STATIC_DIR=dist/client`, while `electron:dev` uses `ELECTRON_RENDERER_URL` to load Vite.
- Server and Electron TS use `moduleResolution: NodeNext`; relative imports in those trees need `.js` specifiers even when importing `.ts` source files.
- `src/client/TheaterViewer.tsx` is a Three.js preview only; it must not send DMX commands or import backend/hardware code.

## DMX And Scenes

- The fixture model lives in `src/shared/dmx.ts`: exactly two 8-channel fixtures, Light A at `A001`, Light B at `A009`, yielding a 16-channel show frame.
- Channel mapping: CH1 master, CH2 red, CH3 green, CH4 blue, CH5 white, CH6 strobe, CH7 function mode, CH8 speed.
- Direct RGBW control requires CH7/functionMode in `0-50`; manual RGBW looks, presets, and generated RGBW scene cues should use `functionMode: 0`.
- uDMX addressing is zero-based; default `UDMX_START_ADDRESS=0` maps fixture A `A001` correctly.
- `.env` is loaded by `src/server/config.ts`; defaults are `DMX_DRIVER=auto`, `UDMX_VENDOR_ID=0x16c0`, `UDMX_PRODUCT_ID=0x05dc`, `UDMX_WRITE_MODE=multi`, `UDMX_AUTO_RECONNECT_MS=5000`, `UDMX_REFRESH_MS=0`, `DMX_WRITE_DEBOUNCE_MS=150`.
- `DMX_DRIVER=auto` tries uDMX first, falls back to mock, then auto-scans for uDMX; `mock` never writes hardware; `udmx` fails startup without the adapter.
- Music scenes are browser-local in `App.tsx`/`sceneModel.ts`: uploaded audio is decoded/played in the browser and exported JSON stores cue timing, fixture count, and per-fixture DMX patches only.
- Scene playback uses `?immediate=true` and interpolates RGBW dimming at about 20 Hz; avoid adding backend audio or hardware logic to scene generation.

## API

- `GET /api/status` returns current state, frame, device status, and control lock.
- `GET /api/config` returns fixture configs, channel definitions, and function modes.
- `POST /api/state` accepts partial fixture updates; `?immediate=true` bypasses debounce for scene playback. Requires control lock.
- `POST /api/blackout` sets all channels to `0` immediately. Requires control lock.
- `POST /api/device/reconnect` reopens the uDMX adapter. Requires control lock.
- `POST /api/control-lock` and `/api/control-lock/release` manage exclusive control with `{ clientId, label? }`.
- `WS /ws` supports `setState`, `blackout`, `reconnect`, `acquireControl`, and `releaseControl`; pass client ID via `?clientId=` or `X-DMX-Client-Id`.

## Style And Repo Notes

- Prettier is `singleQuote: true`, `trailingComma: 'all'`; `npm run format` formats the whole repo.
- `npm run lint` uses the flat ESLint config and ignores `dist`, `node_modules`, and `coverage`.
- ESLint deliberately disables `@typescript-eslint/no-explicit-any`; do not fix useful `any` solely for lint style.
- `tsconfig.server.json` excludes tests; server tests are run by Vitest but are not part of server typecheck.
- `electron-builder.yml` packages only `dist/**/*` plus `package.json`; `node_modules/usb/**/*` is `asarUnpack` so native USB can load in packaged apps.
- `.agents/` is tracked repo-local guidance; `graphify-out/`, `.graphifyignore`, `skills-lock.json`, `release/`, and `dist/` are intentionally ignored.
