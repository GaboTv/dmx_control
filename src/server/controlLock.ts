import type { DmxControlLock } from '../shared/dmx.js';

interface LockMutationResult {
  changed: boolean;
  lock?: DmxControlLock;
}

export class ControlLockManager {
  private lock?: DmxControlLock;

  acquire(clientId: unknown, label: unknown): LockMutationResult {
    const normalizedClientId = normalizeClientId(clientId);
    const normalizedLabel = normalizeLabel(label, normalizedClientId);

    if (this.lock && this.lock.clientId !== normalizedClientId) {
      throw new Error(`DMX control is locked by ${this.lock.label}.`);
    }

    const nextLock: DmxControlLock = this.lock
      ? { ...this.lock, label: normalizedLabel }
      : {
          acquiredAt: new Date().toISOString(),
          clientId: normalizedClientId,
          label: normalizedLabel,
        };
    const changed =
      !this.lock ||
      this.lock.clientId !== nextLock.clientId ||
      this.lock.label !== nextLock.label;

    this.lock = nextLock;
    return { changed, lock: this.current() };
  }

  assertOwner(clientId: unknown): DmxControlLock {
    const normalizedClientId = normalizeClientId(clientId);

    if (!this.lock) {
      throw new Error('Acquire DMX control before sending hardware commands.');
    }

    if (this.lock.clientId !== normalizedClientId) {
      throw new Error(`DMX control is locked by ${this.lock.label}.`);
    }

    return this.lock;
  }

  current(): DmxControlLock | undefined {
    return this.lock ? { ...this.lock } : undefined;
  }

  release(clientId: unknown): LockMutationResult {
    const normalizedClientId = normalizeClientId(clientId);

    if (!this.lock) {
      return { changed: false };
    }

    if (this.lock.clientId !== normalizedClientId) {
      throw new Error(`DMX control is locked by ${this.lock.label}.`);
    }

    this.lock = undefined;
    return { changed: true };
  }
}

export function normalizeClientId(clientId: unknown): string {
  if (typeof clientId !== 'string' || !clientId.trim()) {
    throw new Error('A browser client ID is required for DMX control.');
  }

  return clientId.trim().slice(0, 128);
}

function normalizeLabel(label: unknown, clientId: string): string {
  if (typeof label === 'string' && label.trim()) {
    return label.trim().slice(0, 80);
  }

  return `Browser ${clientId.slice(-4).toUpperCase()}`;
}
