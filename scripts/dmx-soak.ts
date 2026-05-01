import { DmxController } from '../src/server/dmxController.js';
import type { ServerConfig } from '../src/server/config.js';
import { FIXTURE_COUNT, type FixturePatch } from '../src/shared/dmx.js';

const DEFAULT_MINUTES = 300;
const UPDATE_INTERVAL_MS = 250;

let fatalError: unknown;

process.on('uncaughtException', (error) => {
  fatalError = error;
});

process.on('unhandledRejection', (reason) => {
  fatalError = reason;
});

const minutes = parseMinutes();
const deadline = Date.now() + minutes * 60_000;
const controller = await DmxController.create(mockConfig());
let iterations = 0;

console.log(
  `[soak] Starting ${minutes}-minute mock DMX soak test. Press Ctrl+C to stop early.`,
);

try {
  while (Date.now() < deadline) {
    if (fatalError) {
      throw fatalError;
    }

    await controller.update(
      { fixtures: nextFixturePatches(iterations) },
      { immediate: iterations % 10 === 0 },
    );

    if (iterations > 0 && iterations % 240 === 0) {
      await controller.blackout();
    }

    if (iterations > 0 && iterations % 600 === 0) {
      await controller.reconnect();
    }

    iterations += 1;
    if (iterations % 1200 === 0) {
      const elapsedMinutes = (
        (Date.now() - (deadline - minutes * 60_000)) /
        60_000
      ).toFixed(1);
      console.log(
        `[soak] ${iterations} updates completed after ${elapsedMinutes} minutes.`,
      );
    }

    await sleep(UPDATE_INTERVAL_MS);
  }

  console.log(
    `[soak] Completed ${iterations} updates without uncaught errors.`,
  );
} finally {
  await controller.blackout();
  await controller.close();
}

function parseMinutes(): number {
  const arg = process.argv.find((value) => value.startsWith('--minutes='));
  const raw = arg?.split('=')[1] ?? process.env.SOAK_MINUTES;
  const parsed = raw ? Number(raw) : DEFAULT_MINUTES;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MINUTES;
}

function nextFixturePatches(
  iteration: number,
): Array<FixturePatch | undefined> {
  return Array.from({ length: FIXTURE_COUNT }, (_unused, fixtureIndex) => ({
    blue: (iteration * 23 + fixtureIndex * 53) % 256,
    functionMode: 0,
    green: (iteration * 17 + fixtureIndex * 47) % 256,
    master: 180 + ((iteration + fixtureIndex * 11) % 76),
    red: (iteration * 13 + fixtureIndex * 31) % 256,
    strobe: iteration % 32 === 0 ? 60 : 0,
    white: iteration % 24 === 0 ? 120 : 0,
  }));
}

function mockConfig(): ServerConfig {
  return {
    corsOrigin: undefined,
    dmxDriver: 'mock',
    dmxWriteDebounceMs: 150,
    host: '127.0.0.1',
    port: 4174,
    staticDir: 'dist/client',
    udmxProductId: 0x05dc,
    udmxRefreshMs: 0,
    udmxStartAddress: 0,
    udmxVendorId: 0x16c0,
    udmxWriteMode: 'multi',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
