import { DmxController } from '../src/server/dmxController.js';
import {
  serverConfig,
  type DmxDriverMode,
  type ServerConfig,
} from '../src/server/config.js';
import {
  FIXTURE_COUNT,
  type DmxDeviceStatus,
  type FixturePatch,
} from '../src/shared/dmx.js';

const DEFAULT_MINUTES = 300;
const DEFAULT_STATS_INTERVAL_MS = 30_000;
const UPDATE_INTERVAL_MS = 250;

interface SoakOptions {
  driver: DmxDriverMode;
  intervalMs: number;
  minutes: number;
  statsIntervalMs: number;
  strobe: boolean;
}

interface PacketStats {
  lastDevicePackets: number;
  totalPackets: number;
}

let fatalError: unknown;

process.on('uncaughtException', (error) => {
  fatalError = error;
});

process.on('unhandledRejection', (reason) => {
  fatalError = reason;
});

const options = parseOptions();
const startedAt = Date.now();
const deadline = Date.now() + options.minutes * 60_000;
const controller = await DmxController.create(soakConfig(options.driver));
const initialSnapshot = controller.snapshot();
const packetStats = createPacketStats(initialSnapshot.device);
let iterations = 0;
let lastDevice = initialSnapshot.device;
let lastFailures = initialSnapshot.device.failures ?? 0;
let nextStatsAt = Date.now() + options.statsIntervalMs;

console.log(
  `[soak] Starting ${options.minutes}-minute ${options.driver} DMX soak test with color changes every ${options.intervalMs}ms. Press Ctrl+C to stop early.`,
);
console.log(
  `[soak] Stats every ${(options.statsIntervalMs / 1000).toFixed(0)}s.`,
);

if (options.driver === 'udmx') {
  console.log(
    '[soak] Hardware mode enabled; connected lights will change color.',
  );
} else if (options.driver === 'auto') {
  console.log(
    '[soak] Auto mode may fall back to mock. Use --driver=udmx for strict USB stability testing.',
  );
}

try {
  lastFailures = assertExpectedDevice(lastDevice, options, lastFailures);

  while (Date.now() < deadline) {
    if (fatalError) {
      throw fatalError;
    }

    const snapshot = await controller.update(
      { fixtures: nextFixturePatches(iterations, options.strobe) },
      { immediate: true },
    );
    lastDevice = snapshot.device;
    updatePacketStats(packetStats, lastDevice);
    lastFailures = assertExpectedDevice(snapshot.device, options, lastFailures);

    if (iterations > 0 && iterations % 240 === 0) {
      const blackoutSnapshot = await controller.blackout();
      lastFailures = assertExpectedDevice(
        blackoutSnapshot.device,
        options,
        lastFailures,
      );
      lastDevice = blackoutSnapshot.device;
      updatePacketStats(packetStats, lastDevice);
    }

    if (iterations > 0 && iterations % 600 === 0) {
      const reconnectSnapshot = await controller.reconnect();
      lastFailures = assertExpectedDevice(
        reconnectSnapshot.device,
        options,
        lastFailures,
      );
      lastDevice = reconnectSnapshot.device;
      updatePacketStats(packetStats, lastDevice);
    }

    iterations += 1;
    if (Date.now() >= nextStatsAt) {
      printStats('stats', {
        deadline,
        device: lastDevice,
        iterations,
        options,
        packetStats,
        startedAt,
      });
      nextStatsAt = Date.now() + options.statsIntervalMs;
    }

    await sleep(options.intervalMs);
  }

  printStats('final', {
    deadline,
    device: lastDevice,
    iterations,
    options,
    packetStats,
    startedAt,
  });
  console.log(
    `[soak] Completed ${iterations} updates without uncaught errors.`,
  );
} finally {
  const finalSnapshot = await controller.blackout();
  updatePacketStats(packetStats, finalSnapshot.device);
  await controller.close();
}

function parseOptions(): SoakOptions {
  const driver = parseDriver();
  const minutes = parseMinutes();
  const intervalMs = parseIntervalMs();
  const statsIntervalMs = parseStatsIntervalMs();
  const strobe = process.argv.includes('--strobe');
  return { driver, intervalMs, minutes, statsIntervalMs, strobe };
}

function parseDriver(): DmxDriverMode {
  if (process.argv.includes('--hardware')) {
    return 'udmx';
  }

  const raw =
    process.argv
      .find((value) => value.startsWith('--driver='))
      ?.split('=')[1]
      ?.toLowerCase() ?? process.env.SOAK_DMX_DRIVER?.toLowerCase();

  if (raw === 'mock' || raw === 'udmx' || raw === 'auto') {
    return raw;
  }

  return 'mock';
}

function parseMinutes(): number {
  const arg = process.argv.find((value) => value.startsWith('--minutes='));
  const raw = arg?.split('=')[1] ?? process.env.SOAK_MINUTES;
  const parsed = raw ? Number(raw) : DEFAULT_MINUTES;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MINUTES;
}

function parseIntervalMs(): number {
  const arg = process.argv.find((value) => value.startsWith('--interval-ms='));
  const raw = arg?.split('=')[1] ?? process.env.SOAK_INTERVAL_MS;
  const parsed = raw ? Number(raw) : UPDATE_INTERVAL_MS;
  return Number.isFinite(parsed) && parsed >= 20 ? parsed : UPDATE_INTERVAL_MS;
}

function parseStatsIntervalMs(): number {
  const arg = process.argv.find((value) =>
    value.startsWith('--stats-interval-ms='),
  );
  const raw = arg?.split('=')[1] ?? process.env.SOAK_STATS_INTERVAL_MS;
  const parsed = raw ? Number(raw) : DEFAULT_STATS_INTERVAL_MS;
  return Number.isFinite(parsed) && parsed >= 1000
    ? parsed
    : DEFAULT_STATS_INTERVAL_MS;
}

function nextFixturePatches(
  iteration: number,
  strobe: boolean,
): Array<FixturePatch | undefined> {
  return Array.from({ length: FIXTURE_COUNT }, (_unused, fixtureIndex) => ({
    blue: (iteration * 23 + fixtureIndex * 53) % 256,
    functionMode: 0,
    functionSpeed: (iteration * 19 + fixtureIndex * 41) % 256,
    green: (iteration * 17 + fixtureIndex * 47) % 256,
    master: 180 + ((iteration + fixtureIndex * 11) % 76),
    red: (iteration * 13 + fixtureIndex * 31) % 256,
    strobe: strobe && iteration % 32 === 0 ? 60 : 0,
    white: iteration % 24 === 0 ? 120 : 0,
  }));
}

function soakConfig(driver: DmxDriverMode): ServerConfig {
  return {
    ...serverConfig,
    dmxDriver: driver,
  };
}

function createPacketStats(device: DmxDeviceStatus): PacketStats {
  const currentPackets = devicePacketCount(device);
  return {
    lastDevicePackets: currentPackets,
    totalPackets: currentPackets,
  };
}

function updatePacketStats(
  packetStats: PacketStats,
  device: DmxDeviceStatus,
): void {
  const currentPackets = devicePacketCount(device);

  if (currentPackets >= packetStats.lastDevicePackets) {
    packetStats.totalPackets += currentPackets - packetStats.lastDevicePackets;
  } else {
    packetStats.totalPackets += currentPackets;
  }

  packetStats.lastDevicePackets = currentPackets;
}

function devicePacketCount(device: DmxDeviceStatus): number {
  return device.packets ?? device.writes;
}

function printStats(
  label: 'final' | 'stats',
  input: {
    deadline: number;
    device: DmxDeviceStatus;
    iterations: number;
    options: SoakOptions;
    packetStats: PacketStats;
    startedAt: number;
  },
): void {
  const now = Date.now();
  const elapsedSeconds = Math.max(0.001, (now - input.startedAt) / 1000);
  const remainingSeconds = Math.max(0, (input.deadline - now) / 1000);
  const failures = input.device.failures ?? 0;
  const packetRate = input.packetStats.totalPackets / elapsedSeconds;
  const updateRate = input.iterations / elapsedSeconds;
  const writeMode = input.device.writeMode
    ? ` mode=${input.device.writeMode}`
    : '';

  console.log(
    `[soak:${label}] elapsed=${formatDuration(elapsedSeconds)} remaining=${formatDuration(remainingSeconds)} updates=${input.iterations} packets=${input.packetStats.totalPackets} packets/s=${packetRate.toFixed(2)} updates/s=${updateRate.toFixed(2)} driver=${input.device.driver}${writeMode} connected=${input.device.connected} failures=${failures}`,
  );
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m${remainder.toString().padStart(2, '0')}s`;
}

function assertExpectedDevice(
  device: DmxDeviceStatus,
  options: SoakOptions,
  previousFailures: number,
): number {
  const failures = device.failures ?? 0;

  if (options.driver === 'udmx') {
    if (device.driver !== 'udmx') {
      throw new Error(`Expected uDMX driver, got ${device.driver}.`);
    }
    if (!device.connected) {
      throw new Error('uDMX device disconnected during soak test.');
    }
    if (failures > previousFailures) {
      throw new Error(
        `uDMX write failures increased from ${previousFailures} to ${failures}.`,
      );
    }
  }

  return failures;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
