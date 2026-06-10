import { monitorEventLoopDelay } from 'node:perf_hooks';

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
const DEFAULT_OPERATION_TIMEOUT_MS = 5000;
const DEFAULT_STATS_INTERVAL_MS = 30_000;
const DEFAULT_MAX_EVENT_LOOP_DELAY_MS = 2000;
const UPDATE_INTERVAL_MS = 250;

interface SoakOptions {
  blackoutIntervalMs: number;
  driver: DmxDriverMode;
  intervalMs: number;
  maxEventLoopDelayMs: number;
  minutes: number;
  operationTimeoutMs: number;
  reconnectIntervalMs: number;
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
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();
const controller = await withTimeout(
  DmxController.create(soakConfig(options.driver)),
  options.operationTimeoutMs,
  'controller startup',
);
const initialSnapshot = controller.snapshot();
const packetStats = createPacketStats(initialSnapshot.device);
let iterations = 0;
let lastDevice = initialSnapshot.device;
let lastFailures = initialSnapshot.device.failures ?? 0;
let nextBlackoutAt = nextScheduledAt(options.blackoutIntervalMs);
let nextReconnectAt = nextScheduledAt(options.reconnectIntervalMs);
let nextStatsAt = Date.now() + options.statsIntervalMs;
let nextUpdateAt = Date.now();

console.log(
  `[soak] Starting ${options.minutes}-minute ${options.driver} DMX soak test with color changes every ${options.intervalMs}ms. Press Ctrl+C to stop early.`,
);
console.log(
  `[soak] Stats every ${(options.statsIntervalMs / 1000).toFixed(0)}s; operation timeout ${options.operationTimeoutMs}ms; max event-loop delay ${options.maxEventLoopDelayMs}ms.`,
);
console.log(
  `[soak] Blackout interval: ${formatInterval(options.blackoutIntervalMs)}; reconnect interval: ${formatInterval(options.reconnectIntervalMs)}.`,
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

    await sleep(Math.max(0, nextUpdateAt - Date.now()));
    nextUpdateAt += options.intervalMs;

    const snapshot = await withTimeout(
      controller.update(
        { fixtures: nextFixturePatches(iterations, options.strobe) },
        { immediate: true },
      ),
      options.operationTimeoutMs,
      'DMX update',
    );
    lastDevice = snapshot.device;
    updatePacketStats(packetStats, lastDevice);
    lastFailures = assertExpectedDevice(snapshot.device, options, lastFailures);

    if (options.blackoutIntervalMs > 0 && Date.now() >= nextBlackoutAt) {
      const blackoutSnapshot = await withTimeout(
        controller.blackout(),
        options.operationTimeoutMs,
        'DMX blackout',
      );
      lastFailures = assertExpectedDevice(
        blackoutSnapshot.device,
        options,
        lastFailures,
      );
      lastDevice = blackoutSnapshot.device;
      updatePacketStats(packetStats, lastDevice);
      nextBlackoutAt = Date.now() + options.blackoutIntervalMs;
    }

    if (options.reconnectIntervalMs > 0 && Date.now() >= nextReconnectAt) {
      const reconnectSnapshot = await withTimeout(
        controller.reconnect(),
        options.operationTimeoutMs,
        'DMX reconnect',
      );
      lastFailures = assertExpectedDevice(
        reconnectSnapshot.device,
        options,
        lastFailures,
      );
      lastDevice = reconnectSnapshot.device;
      updatePacketStats(packetStats, lastDevice);
      nextReconnectAt = Date.now() + options.reconnectIntervalMs;
    }

    iterations += 1;
    if (Date.now() >= nextStatsAt) {
      assertEventLoopHealthy(eventLoopDelay.max, options);
      printStats('stats', {
        deadline,
        device: lastDevice,
        eventLoopMaxMs: nanosecondsToMilliseconds(eventLoopDelay.max),
        eventLoopMeanMs: nanosecondsToMilliseconds(eventLoopDelay.mean),
        iterations,
        options,
        packetStats,
        startedAt,
      });
      eventLoopDelay.reset();
      nextStatsAt = Date.now() + options.statsIntervalMs;
    }

    if (nextUpdateAt < Date.now() - options.intervalMs) {
      nextUpdateAt = Date.now() + options.intervalMs;
    }
  }

  assertEventLoopHealthy(eventLoopDelay.max, options);
  printStats('final', {
    deadline,
    device: lastDevice,
    eventLoopMaxMs: nanosecondsToMilliseconds(eventLoopDelay.max),
    eventLoopMeanMs: nanosecondsToMilliseconds(eventLoopDelay.mean),
    iterations,
    options,
    packetStats,
    startedAt,
  });
  console.log(
    `[soak] Completed ${iterations} updates without uncaught errors.`,
  );
} finally {
  eventLoopDelay.disable();
  const finalSnapshot = await withTimeout(
    controller.blackout(),
    options.operationTimeoutMs,
    'final blackout',
  );
  updatePacketStats(packetStats, finalSnapshot.device);
  await withTimeout(controller.close(), options.operationTimeoutMs, 'close');
}

function parseOptions(): SoakOptions {
  const blackoutIntervalMs = parseIntervalMinutes(
    '--blackout-interval-minutes=',
    'SOAK_BLACKOUT_INTERVAL_MINUTES',
    0,
  );
  const driver = parseDriver();
  const minutes = parseMinutes();
  const intervalMs = parseIntervalMs();
  const maxEventLoopDelayMs = parseMaxEventLoopDelayMs();
  const operationTimeoutMs = parseOperationTimeoutMs();
  const reconnectIntervalMs = parseIntervalMinutes(
    '--reconnect-interval-minutes=',
    'SOAK_RECONNECT_INTERVAL_MINUTES',
    0,
  );
  const statsIntervalMs = parseStatsIntervalMs();
  const strobe = process.argv.includes('--strobe');
  return {
    blackoutIntervalMs,
    driver,
    intervalMs,
    maxEventLoopDelayMs,
    minutes,
    operationTimeoutMs,
    reconnectIntervalMs,
    statsIntervalMs,
    strobe,
  };
}

function parseDriver(): DmxDriverMode {
  if (process.argv.includes('--hardware')) {
    return 'udmx';
  }

  const raw =
    optionValue('--driver=')?.toLowerCase() ??
    process.env.SOAK_DMX_DRIVER?.toLowerCase();

  if (raw === 'mock' || raw === 'udmx' || raw === 'auto') {
    return raw;
  }

  return 'mock';
}

function parseMinutes(): number {
  const raw = optionValue('--minutes=') ?? process.env.SOAK_MINUTES;
  const parsed = raw ? Number(raw) : DEFAULT_MINUTES;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MINUTES;
}

function parseIntervalMs(): number {
  const raw = optionValue('--interval-ms=') ?? process.env.SOAK_INTERVAL_MS;
  const parsed = raw ? Number(raw) : UPDATE_INTERVAL_MS;
  return Number.isFinite(parsed) && parsed >= 20 ? parsed : UPDATE_INTERVAL_MS;
}

function parseIntervalMinutes(
  argName: string,
  envName: string,
  fallback: number,
): number {
  const raw = optionValue(argName) ?? process.env[envName];
  const parsed = raw ? Number(raw) : fallback;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * 60_000 : fallback;
}

function parseMaxEventLoopDelayMs(): number {
  const raw =
    optionValue('--max-event-loop-delay-ms=') ??
    process.env.SOAK_MAX_EVENT_LOOP_DELAY_MS;
  const parsed = raw ? Number(raw) : DEFAULT_MAX_EVENT_LOOP_DELAY_MS;
  return Number.isFinite(parsed) && parsed >= 100
    ? parsed
    : DEFAULT_MAX_EVENT_LOOP_DELAY_MS;
}

function parseOperationTimeoutMs(): number {
  const raw =
    optionValue('--operation-timeout-ms=') ??
    process.env.SOAK_OPERATION_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : DEFAULT_OPERATION_TIMEOUT_MS;
  return Number.isFinite(parsed) && parsed >= 100
    ? parsed
    : DEFAULT_OPERATION_TIMEOUT_MS;
}

function optionValue(prefix: string): string | undefined {
  const value = [...process.argv]
    .reverse()
    .find((argument) => argument.startsWith(prefix));
  return value?.slice(prefix.length);
}

function parseStatsIntervalMs(): number {
  const raw =
    optionValue('--stats-interval-ms=') ?? process.env.SOAK_STATS_INTERVAL_MS;
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
    eventLoopMaxMs: number;
    eventLoopMeanMs: number;
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
  const memory = process.memoryUsage();

  console.log(
    `[soak:${label}] elapsed=${formatDuration(elapsedSeconds)} remaining=${formatDuration(remainingSeconds)} updates=${input.iterations} packets=${input.packetStats.totalPackets} packets/s=${packetRate.toFixed(2)} updates/s=${updateRate.toFixed(2)} driver=${input.device.driver}${writeMode} connected=${input.device.connected} failures=${failures} eventLoopMaxMs=${input.eventLoopMaxMs.toFixed(1)} eventLoopMeanMs=${input.eventLoopMeanMs.toFixed(1)} heapMb=${bytesToMegabytes(memory.heapUsed).toFixed(1)} rssMb=${bytesToMegabytes(memory.rss).toFixed(1)}`,
  );
}

function assertEventLoopHealthy(
  maxEventLoopDelayNs: number,
  options: SoakOptions,
): void {
  const maxEventLoopDelayMs = nanosecondsToMilliseconds(maxEventLoopDelayNs);
  if (maxEventLoopDelayMs > options.maxEventLoopDelayMs) {
    throw new Error(
      `Event loop delay ${maxEventLoopDelayMs.toFixed(1)}ms exceeded ${options.maxEventLoopDelayMs}ms.`,
    );
  }
}

function bytesToMegabytes(bytes: number): number {
  return bytes / 1024 / 1024;
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m${remainder.toString().padStart(2, '0')}s`;
}

function formatInterval(ms: number): string {
  return ms > 0 ? formatDuration(ms / 1000) : 'disabled';
}

function nanosecondsToMilliseconds(value: number): number {
  return value / 1_000_000;
}

function nextScheduledAt(intervalMs: number): number {
  return intervalMs > 0 ? Date.now() + intervalMs : Number.POSITIVE_INFINITY;
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

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${label} did not finish within ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
