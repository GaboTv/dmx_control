import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ServerConfig } from './config.js';

describe('uDMX output', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('usb');
  });

  it('falls back to single-channel writes when auto mode multi transfer fails', async () => {
    const transfers: Array<{ index: number; request: number; value: number }> =
      [];
    const device = {
      close: vi.fn(),
      controlTransfer: vi.fn(
        (
          _requestType: number,
          request: number,
          value: number,
          index: number,
          _data: Buffer,
          callback: (error?: Error) => void,
        ) => {
          transfers.push({ index, request, value });
          callback(
            request === 2 ? new Error('multi transfer failed') : undefined,
          );
        },
      ),
      open: vi.fn(),
    };

    const usbMock = {
      findByIds: () => device,
    };

    vi.doMock('usb', () => ({
      ...usbMock,
      default: usbMock,
    }));

    const { createDmxOutput } = await import('./dmxOutput.js');
    const output = await createDmxOutput(
      testConfig({ dmxDriver: 'udmx', udmxWriteMode: 'auto' }),
    );

    await output.sendFrame([10, 20, 30]);

    expect(output.status()).toMatchObject({
      connected: true,
      failures: 1,
      writeMode: 'single',
      writes: 1,
    });
    expect(device.close).toHaveBeenCalledTimes(1);
    expect(device.open).toHaveBeenCalledTimes(2);
    expect(transfers).toEqual([
      { index: 0, request: 2, value: 3 },
      { index: 0, request: 1, value: 10 },
      { index: 1, request: 1, value: 20 },
      { index: 2, request: 1, value: 30 },
    ]);
  });

  it('marks uDMX disconnected when the adapter disappears during health check', async () => {
    let attached = true;
    const device = {
      close: vi.fn(),
      controlTransfer: vi.fn(
        (
          _requestType: number,
          _request: number,
          _value: number,
          _index: number,
          _data: Buffer,
          callback: (error?: Error) => void,
        ) => callback(),
      ),
      open: vi.fn(),
    };
    const usbMock = {
      findByIds: () => (attached ? device : undefined),
    };

    vi.doMock('usb', () => ({
      ...usbMock,
      default: usbMock,
    }));

    const { createDmxOutput } = await import('./dmxOutput.js');
    const output = await createDmxOutput(testConfig({ dmxDriver: 'udmx' }));
    attached = false;

    await expect(output.checkHealth?.()).resolves.toBe(true);

    const status = output.status();

    expect(status).toMatchObject({
      connected: false,
      driver: 'udmx',
    });
    expect(status.lastError).toContain(
      'uDMX adapter disconnected from 0x16c0:0x05dc.',
    );
    expect(status.lastError).toContain('Runtime:');
    expect(device.close).toHaveBeenCalledTimes(1);
  });

  it('reports visible USB devices when the configured uDMX adapter is missing', async () => {
    const usbMock = {
      findByIds: () => undefined,
      getDeviceList: () => [
        {
          busNumber: 3,
          deviceAddress: 8,
          deviceDescriptor: {
            idProduct: 0x05dc,
            idVendor: 0x16c0,
            iManufacturer: 1,
            iProduct: 2,
          },
          portNumbers: [2],
        },
      ],
    };

    vi.doMock('usb', () => ({
      ...usbMock,
      default: usbMock,
    }));

    const { createDmxOutput } = await import('./dmxOutput.js');
    const output = await createDmxOutput(testConfig({ dmxDriver: 'auto' }));
    const status = output.status();

    expect(status).toMatchObject({
      driver: 'mock',
      productId: '0x05dc',
      vendorId: '0x16c0',
    });
    expect(status.detail).toContain('uDMX adapter not found at 0x16c0:0x05dc');
    expect(status.detail).toContain('Visible USB devices: 0x16c0:0x05dc');
    expect(status.usbDevices).toEqual([
      '0x16c0:0x05dc (bus=3, address=8, ports=2, manufacturerIndex=1, productIndex=2)',
    ]);
    expect(status.runtime).toContain('platform=');
  });
});

function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    corsOrigin: undefined,
    dmxDriver: 'mock',
    dmxWriteDebounceMs: 150,
    host: '127.0.0.1',
    port: 4174,
    staticDir: 'dist/client',
    udmxProductId: 0x05dc,
    udmxAutoReconnectMs: 5000,
    udmxRefreshMs: 0,
    udmxStartAddress: 0,
    udmxVendorId: 0x16c0,
    udmxWriteMode: 'auto',
    ...overrides,
  };
}
