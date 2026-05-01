import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DmxDeviceStatus } from '../shared/dmx';
import type { ServerConfig } from './config.js';
import type { DmxOutput } from './dmxOutput.js';

const mockState = vi.hoisted(() => ({
  outputs: [] as DmxOutput[],
}));

vi.mock('./dmxOutput.js', () => ({
  createDmxOutput: vi.fn(async () => {
    const output = mockState.outputs.shift();
    if (!output) {
      throw new Error('No test DMX output was queued.');
    }
    return output;
  }),
}));

import { DmxController } from './dmxController';

class TestDmxOutput implements DmxOutput {
  closeCalls = 0;
  failNext = false;
  frames: number[][] = [];
  inFlight = 0;
  maxInFlight = 0;

  async close(): Promise<void> {
    this.closeCalls += 1;
  }

  async sendFrame(frame: number[]): Promise<void> {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);

    try {
      await Promise.resolve();
      if (this.failNext) {
        this.failNext = false;
        throw new Error('simulated DMX write failure');
      }
      this.frames.push([...frame]);
    } finally {
      this.inFlight -= 1;
    }
  }

  status(): DmxDeviceStatus {
    return {
      connected: true,
      detail: 'test output',
      driver: 'mock',
      writes: this.frames.length,
    };
  }
}

afterEach(() => {
  mockState.outputs.length = 0;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('DmxController reliability', () => {
  it('debounces rapid updates and writes only the latest frame', async () => {
    vi.useFakeTimers();
    const output = new TestDmxOutput();
    const controller = await createController(output);
    output.frames = [];

    await controller.update({ fixtures: [{ red: 10 }] });
    await controller.update({ fixtures: [{ red: 20 }] });

    expect(output.frames).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(149);
    expect(output.frames).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(output.frames).toHaveLength(1);
    expect(output.frames[0][1]).toBe(20);
    await controller.close();
  });

  it('immediate updates clear pending debounced writes', async () => {
    vi.useFakeTimers();
    const output = new TestDmxOutput();
    const controller = await createController(output);
    output.frames = [];

    await controller.update({ fixtures: [{ red: 15 }] });
    await controller.update({ fixtures: [{ blue: 35 }] }, { immediate: true });
    await vi.advanceTimersByTimeAsync(150);

    expect(output.frames).toHaveLength(1);
    expect(output.frames[0][1]).toBe(15);
    expect(output.frames[0][3]).toBe(35);
    await controller.close();
  });

  it('contains write failures so the controller can keep accepting updates', async () => {
    const output = new TestDmxOutput();
    const controller = await createController(output);
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    output.frames = [];
    output.failNext = true;

    const failedWriteSnapshot = await controller.update(
      { fixtures: [{ red: 50 }] },
      { immediate: true },
    );
    await controller.update({ fixtures: [{ green: 60 }] }, { immediate: true });

    expect(consoleError).toHaveBeenCalledWith(
      '[dmx] DMX frame write failed; backend remains online:',
      'simulated DMX write failure',
    );
    expect(failedWriteSnapshot.state.fixtures[0].red).toBe(50);
    expect(output.frames).toHaveLength(1);
    expect(output.frames[0][1]).toBe(50);
    expect(output.frames[0][2]).toBe(60);
    await controller.close();
  });

  it('serializes concurrent immediate writes', async () => {
    const output = new TestDmxOutput();
    const controller = await createController(output);
    output.frames = [];

    await Promise.all(
      Array.from({ length: 20 }, (_unused, index) =>
        controller.update({ fixtures: [{ red: index }] }, { immediate: true }),
      ),
    );

    expect(output.maxInFlight).toBe(1);
    expect(output.frames).toHaveLength(20);
    expect(output.frames.at(-1)?.[1]).toBe(19);
    await controller.close();
  });

  it('simulates five hours of refresh ticks without errors or overlapping writes', async () => {
    vi.useFakeTimers();
    const output = new TestDmxOutput();
    const controller = await createController(output, {
      udmxRefreshMs: 60_000,
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1000);

    expect(output.frames).toHaveLength(301);
    expect(output.maxInFlight).toBe(1);
    await controller.close();

    const writesAfterClose = output.frames.length;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(output.frames).toHaveLength(writesAfterClose);
  });
});

async function createController(
  output: TestDmxOutput,
  overrides: Partial<ServerConfig> = {},
): Promise<DmxController> {
  mockState.outputs.push(output);
  return DmxController.create(testConfig(overrides));
}

function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
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
    ...overrides,
  };
}
