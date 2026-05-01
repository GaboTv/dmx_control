import { clampDmxByte, type DmxDeviceStatus } from '../shared/dmx.js';
import { type ServerConfig } from './config.js';

export interface DmxOutput {
  close(): Promise<void>;
  sendFrame(frame: number[]): Promise<void>;
  status(): DmxDeviceStatus;
}

type UsbDevice = {
  close: () => void;
  controlTransfer: (
    bmRequestType: number,
    bRequest: number,
    wValue: number,
    wIndex: number,
    data: Buffer,
    callback: (error?: Error, actual?: number) => void,
  ) => void;
  open: () => void;
};

type UsbApi = {
  findByIds?: (vendorId: number, productId: number) => UsbDevice | undefined;
  usb?: {
    findByIds?: (vendorId: number, productId: number) => UsbDevice | undefined;
  };
};

function toHexId(value: number): string {
  return `0x${value.toString(16).padStart(4, '0')}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class MockDmxOutput implements DmxOutput {
  private lastFrame: number[] = [];
  private lastFrameAt?: string;
  private packets = 0;
  private writes = 0;

  constructor(
    private readonly detail = 'Mock DMX output active; no USB writes are being sent.',
  ) {}

  async close(): Promise<void> {
    return Promise.resolve();
  }

  async sendFrame(frame: number[]): Promise<void> {
    this.lastFrame = frame.map(clampDmxByte);
    this.packets += 1;
    this.writes += 1;
    this.lastFrameAt = new Date().toISOString();
  }

  status(): DmxDeviceStatus {
    return {
      connected: true,
      detail: this.detail,
      driver: 'mock',
      lastFrameAt: this.lastFrameAt,
      packets: this.packets,
      writes: this.writes,
    };
  }
}

export class UDmxOutput implements DmxOutput {
  private connected = false;
  private device?: UsbDevice;
  private failures = 0;
  private lastError?: string;
  private lastErrorAt?: string;
  private lastFrame?: number[];
  private lastFrameAt?: string;
  private packets = 0;
  private writes = 0;
  private writeMode: 'multi' | 'single';

  private constructor(private readonly config: ServerConfig) {
    this.writeMode =
      config.udmxWriteMode === 'auto' ? 'multi' : config.udmxWriteMode;
  }

  static async create(config: ServerConfig): Promise<UDmxOutput> {
    const output = new UDmxOutput(config);
    await output.openDevice();
    return output;
  }

  async close(): Promise<void> {
    if (!this.device) {
      this.connected = false;
      return;
    }

    try {
      this.device.close();
    } catch (error) {
      this.lastError = errorMessage(error);
    } finally {
      this.connected = false;
      this.device = undefined;
    }
  }

  async sendFrame(frame: number[]): Promise<void> {
    if (!this.device) {
      await this.openDevice();
    }

    const nextFrame = frame.slice(0, 512).map(clampDmxByte);

    try {
      await this.writeFrame(nextFrame);
      this.markWriteSuccess(nextFrame);
    } catch (error) {
      if (this.config.udmxWriteMode === 'auto' && this.writeMode === 'multi') {
        this.markWriteFailure(error, 'multi');
        console.warn(
          '[dmx] uDMX multi-channel write failed; retrying with single-channel writes.',
        );
        this.writeMode = 'single';
        await this.closeAfterTransferError();
        await this.openDevice();
        await this.writeFrame(nextFrame, true);
        this.markWriteSuccess(nextFrame);
        return;
      }

      this.markWriteFailure(error, this.writeMode);
      await this.closeAfterTransferError();
      throw error;
    }
  }

  status(): DmxDeviceStatus {
    return {
      connected: this.connected,
      detail: this.connected
        ? 'uDMX adapter is open and receiving frames.'
        : 'uDMX adapter is not connected.',
      driver: 'udmx',
      failures: this.failures,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
      lastFrameAt: this.lastFrameAt,
      packets: this.packets,
      productId: toHexId(this.config.udmxProductId),
      vendorId: toHexId(this.config.udmxVendorId),
      writeMode: this.writeMode,
      writes: this.writes,
    };
  }

  private async closeAfterTransferError(): Promise<void> {
    try {
      await this.close();
    } catch (closeError) {
      console.warn(
        '[dmx] uDMX close after transfer error failed:',
        errorMessage(closeError),
      );
    }
  }

  private async controlTransfer(
    request: number,
    value: number,
    index: number,
    payload: Buffer,
  ): Promise<void> {
    const device = this.device;
    if (!device) {
      throw new Error('uDMX device is not available.');
    }

    await new Promise<void>((resolve, reject) => {
      device.controlTransfer(0x40, request, value, index, payload, (error) => {
        if (error) {
          reject(error);
          return;
        }
        this.packets += 1;
        resolve();
      });
    });
  }

  private markWriteFailure(error: unknown, mode: string): void {
    this.connected = false;
    this.failures += 1;
    this.lastError = errorMessage(error);
    this.lastErrorAt = new Date().toISOString();
    console.error('[dmx] uDMX write failed:', {
      error: this.lastError,
      mode,
      productId: toHexId(this.config.udmxProductId),
      startAddress: this.config.udmxStartAddress,
      vendorId: toHexId(this.config.udmxVendorId),
    });
  }

  private markWriteSuccess(frame: number[]): void {
    this.connected = true;
    this.lastError = undefined;
    this.lastFrame = [...frame];
    this.lastFrameAt = new Date().toISOString();
    this.writes += 1;
  }

  private async openDevice(): Promise<void> {
    const usb = await loadUsbApi();
    const findByIds = usb.findByIds ?? usb.usb?.findByIds;

    if (!findByIds) {
      throw new Error('The installed usb package does not expose findByIds().');
    }

    const device = findByIds(
      this.config.udmxVendorId,
      this.config.udmxProductId,
    );
    if (!device) {
      throw new Error(
        `uDMX adapter not found at ${toHexId(this.config.udmxVendorId)}:${toHexId(
          this.config.udmxProductId,
        )}.`,
      );
    }

    device.open();
    this.device = device;
    this.connected = true;
    this.lastError = undefined;
  }

  private async writeFrame(
    frame: number[],
    forceAllChannels = false,
  ): Promise<void> {
    if (this.writeMode === 'single') {
      await this.writeSingleChannelFrame(frame, forceAllChannels);
      return;
    }

    await this.writeMultiChannelFrame(frame);
  }

  private async writeMultiChannelFrame(frame: number[]): Promise<void> {
    const payload = Buffer.from(frame);
    await this.controlTransfer(
      2,
      payload.length,
      this.config.udmxStartAddress,
      payload,
    );
  }

  private async writeSingleChannelFrame(
    frame: number[],
    forceAllChannels: boolean,
  ): Promise<void> {
    for (const [offset, value] of frame.entries()) {
      if (!forceAllChannels && this.lastFrame?.[offset] === value) {
        continue;
      }

      await this.controlTransfer(
        1,
        value,
        this.config.udmxStartAddress + offset,
        Buffer.alloc(1),
      );
    }
  }
}

export async function createDmxOutput(
  config: ServerConfig,
): Promise<DmxOutput> {
  if (config.dmxDriver === 'mock') {
    return new MockDmxOutput('DMX_DRIVER=mock; hardware writes are disabled.');
  }

  try {
    return await UDmxOutput.create(config);
  } catch (error) {
    if (config.dmxDriver === 'udmx') {
      throw error;
    }

    return new MockDmxOutput(
      `uDMX unavailable, running in mock mode: ${errorMessage(error)}`,
    );
  }
}

async function loadUsbApi(): Promise<UsbApi> {
  const moduleName = 'usb';
  const imported = (await import(moduleName)) as UsbApi & { default?: UsbApi };
  return imported.default ?? imported;
}
