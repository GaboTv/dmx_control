# AGENTS.md

## Commands

- Use Node `>=20.11`; CI runs Node `22`, which is also preferred on Windows for native `usb` stability.
- `npm run dev` starts API + web: backend `tsx watch src/server/index.ts` on `4174`, Vite on `5173`; split commands are `npm run dev:api` and `npm run dev:web`.
- Vite proxies browser `/api` and `/ws` to the backend; do not point client code directly at `4174`.
- CI order is `npm run typecheck`, `npm test`, `npm run build`; run this sequence after behavior, protocol, or DMX model changes.
- Focused model tests: `npm test -- src/shared/dmx.test.ts`; lint is `npm run lint`, format is `npm run format`.
- `npm start` runs `dist/server/server/index.js` and expects `npm run build` to have produced both `dist/server` and `dist/client`.

## Architecture

- Entrypoints: `index.html` -> `src/client/main.tsx` -> `App`; backend starts from `src/server/index.ts`.
- Local hardware-control app: React/Vite UI plus Express/WebSocket backend. Browser code must use backend `/api` or `/ws`, never `usb`/uDMX directly.
- API/WebSocket routes are in `src/server/index.ts`; hardware writes are isolated in `src/server/dmxOutput.ts`.
- `src/server/dmxController.ts` owns write debounce, refresh, blackout, reconnect, serialized writes, and snapshot broadcasts.
- Server TS uses `moduleResolution: NodeNext`; relative imports inside `src/server/**/*.ts` must use `.js` specifiers even though source files are `.ts`.
- `src/client/TheaterViewer.tsx` is a Three.js-only preview of fixture state; it must not send DMX commands or touch backend hardware code.

## DMX And Scenes

- Fixture mapping comes from `control.jpeg` and `src/shared/dmx.ts`: each fixture is 8 channels, CH1 master, CH2-CH5 RGBW, CH6 strobe, CH7 function mode, CH8 speed.
- Direct RGBW control requires CH7/functionMode in `0-50`; scene presets and auto cues should keep manual RGBW looks at `functionMode: 0`.
- The show model controls exactly two fixtures as a 16-channel frame: Light A starts at `A001`, Light B at `A009`; uDMX uses zero-based `UDMX_START_ADDRESS=0`.
- Hardware env is loaded by `src/server/config.ts` from `.env`: `DMX_DRIVER=auto` falls back to mock, `DMX_DRIVER=udmx` fails without the adapter.
- Windows 11 + libusbK should use `.env.example` defaults: `UDMX_WRITE_MODE=single`, `UDMX_REFRESH_MS=0`, `DMX_WRITE_DEBOUNCE_MS=150`.
- Music scenes are browser-local: uploaded audio is decoded/played in `App.tsx` and never sent to the backend; exported JSON stores cue times, selected fixture count, and per-fixture DMX patches only.
