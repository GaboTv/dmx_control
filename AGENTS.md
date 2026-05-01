# AGENTS.md

## Commands

- Use Node `>=20.11`; CI runs Node `22`, which is also preferred on Windows for native `usb` stability.
- `npm run dev` starts API + web: backend `tsx watch src/server/index.ts` on `4174`, Vite on `5173`; split commands are `npm run dev:api` and `npm run dev:web`.
- Vite proxies browser `/api` and `/ws` to the backend; do not point client code directly at `4174`.
- CI order is `npm run typecheck`, `npm test`, `npm run build`; run this sequence after behavior, protocol, or DMX model changes.
- Focused tests: `npm test -- src/shared/dmx.test.ts`, `npm test -- src/server/dmxController.test.ts`, or `npm test -- src/client/sceneModel.test.ts`; lint is `npm run lint`, format is `npm run format`.
- Long-run validation is manual: `npm run test:soak` drives the mock DMX controller for 5 real hours; use `npm run test:soak -- --minutes=30` for shorter checks.
- `npm start` runs `dist/server/server/index.js` and expects `npm run build` to have produced both `dist/server` (tsc) and `dist/client` (Vite).
- `npm run typecheck` runs two configs: `tsconfig.json` (client + shared) and `tsconfig.server.json` (server + shared). Both must pass.
- `npm run build` runs `tsc -p tsconfig.server.json && vite build` — server is compiled by tsc, client by Vite; they are separate build steps.

## Architecture

- Entrypoints: `index.html` → `src/client/main.tsx` → `App`; backend starts from `src/server/index.ts` (top-level await).
- Local hardware-control app: React/Vite UI plus Express/WebSocket backend. Browser code must use backend `/api` or `/ws`, never `usb`/uDMX directly.
- API routes and WebSocket handlers are in `src/server/index.ts`; hardware writes are isolated in `src/server/dmxOutput.ts`.
- `src/server/dmxController.ts` owns write debounce, refresh, blackout, reconnect, serialized writes, and snapshot broadcasts.
- `src/server/controlLock.ts` implements exclusive DMX control: a client must `acquireControl` before sending any `setState`/`blackout`/`reconnect` commands; the lock auto-releases on disconnect.
- Server TS uses `moduleResolution: NodeNext`; relative imports inside `src/server/**/*.ts` (including to `../shared/`) must use `.js` specifiers even though source files are `.ts`.
- `src/client/TheaterViewer.tsx` is a Three.js-only preview of fixture state; it must not send DMX commands or touch backend hardware code.
- `src/shared/dmx.ts` defines the fixture model, channel mapping, types, and normalization — shared between client and server.

## DMX And Scenes

- Fixture mapping comes from `control.jpeg` and `src/shared/dmx.ts`: each fixture is 8 channels, CH1 master, CH2–CH5 RGBW, CH6 strobe, CH7 function mode, CH8 speed.
- Direct RGBW control requires CH7/functionMode in `0–50`; scene presets and auto cues should keep manual RGBW looks at `functionMode: 0`.
- The show model controls exactly two fixtures as a 16-channel frame: Light A starts at `A001`, Light B at `A009`; uDMX uses zero-based `UDMX_START_ADDRESS=0`.
- Hardware env is loaded by `src/server/config.ts` from `.env`: `DMX_DRIVER` accepts `auto` (tries uDMX, falls back to mock), `mock` (always mock), or `udmx` (fails without adapter).
- uDMX should use `.env.example` defaults: `UDMX_WRITE_MODE=multi`, `UDMX_REFRESH_MS=0`, `DMX_WRITE_DEBOUNCE_MS=150`.
- Music Sync prioritizes smooth RGBW interpolation and can send changed frames at about 20 Hz during playback.
- Music scenes are browser-local: uploaded audio is decoded/played in `App.tsx` and never sent to the backend; exported JSON stores cue times, selected fixture count, and per-fixture DMX patches only.

## API

- `GET /api/status` — current DMX state, frame, device status, and control lock.
- `GET /api/config` — fixture configs, channel definitions, and function modes (static).
- `POST /api/state` — partial fixture updates; `?immediate=true` bypasses debounce (for scene playback). Requires control lock.
- `POST /api/blackout` — sets all channels to `0` immediately. Requires control lock.
- `POST /api/device/reconnect` — reopens uDMX adapter. Requires control lock.
- `POST /api/control-lock` — acquire exclusive DMX control, body `{ clientId, label? }`.
- `POST /api/control-lock/release` — release DMX control.
- `WS /ws` — supports `setState`, `blackout`, `reconnect`, `acquireControl`, `releaseControl` message types. Client ID is passed via WebSocket query param `clientId` or header `X-DMX-Client-Id`.

## Style

- Prettier: `singleQuote: true`, `trailingComma: 'all'`. Run `npm run format` before committing.
- ESLint: `@typescript-eslint/no-explicit-any` is explicitly off; `any` is permitted.
- Server `tsconfig.server.json` excludes `**/*.test.ts`; tests share `src/shared/` but are only typechecked by the client config.
