import path from 'node:path';

import { config as loadEnv } from 'dotenv';

loadEnv();

export type DmxDriverMode = 'auto' | 'mock' | 'udmx';
export type UDmxWriteMode = 'auto' | 'multi' | 'single';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envUsbId(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = raw.toLowerCase().startsWith('0x')
    ? Number.parseInt(raw, 16)
    : Number.parseInt(raw, 10);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function envDriverMode(): DmxDriverMode {
  const raw = (process.env.DMX_DRIVER ?? 'auto').toLowerCase();
  if (raw === 'mock' || raw === 'udmx' || raw === 'auto') {
    return raw;
  }

  return 'auto';
}

function envWriteMode(): UDmxWriteMode {
  const raw = (process.env.UDMX_WRITE_MODE ?? '').toLowerCase();
  if (raw === 'auto' || raw === 'multi' || raw === 'single') {
    return raw;
  }

  return process.platform === 'win32' ? 'single' : 'multi';
}

export const serverConfig = {
  corsOrigin: process.env.CORS_ORIGIN,
  dmxDriver: envDriverMode(),
  dmxWriteDebounceMs: envInt('DMX_WRITE_DEBOUNCE_MS', 150),
  host: process.env.HOST ?? '127.0.0.1',
  port: envInt('PORT', 4174),
  staticDir: process.env.STATIC_DIR ?? path.join(process.cwd(), 'dist', 'client'),
  udmxProductId: envUsbId('UDMX_PRODUCT_ID', 0x05dc),
  udmxRefreshMs: envInt('UDMX_REFRESH_MS', 0),
  udmxStartAddress: envInt('UDMX_START_ADDRESS', 0),
  udmxVendorId: envUsbId('UDMX_VENDOR_ID', 0x16c0),
  udmxWriteMode: envWriteMode(),
};

export type ServerConfig = typeof serverConfig;
