import { describe, expect, it } from 'vitest';

import { ControlLockManager } from './controlLock';

describe('ControlLockManager', () => {
  it('allows the owner to reacquire and update its label', () => {
    const locks = new ControlLockManager();

    const first = locks.acquire('client-a', 'Booth laptop');
    const second = locks.acquire('client-a', 'Main booth');

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(true);
    expect(second.lock?.clientId).toBe('client-a');
    expect(second.lock?.label).toBe('Main booth');
    expect(second.lock?.acquiredAt).toBe(first.lock?.acquiredAt);
  });

  it('blocks another client while a lock is active', () => {
    const locks = new ControlLockManager();
    locks.acquire('client-a', 'Booth laptop');

    expect(() => locks.acquire('client-b', 'Phone')).toThrow(
      'DMX control is locked by Booth laptop.',
    );
    expect(() => locks.assertOwner('client-b')).toThrow(
      'DMX control is locked by Booth laptop.',
    );
  });

  it('requires an active lock for hardware commands', () => {
    const locks = new ControlLockManager();

    expect(() => locks.assertOwner('client-a')).toThrow(
      'Acquire DMX control before sending hardware commands.',
    );
  });

  it('releases only for the lock owner', () => {
    const locks = new ControlLockManager();
    locks.acquire('client-a', 'Booth laptop');

    expect(() => locks.release('client-b')).toThrow(
      'DMX control is locked by Booth laptop.',
    );
    expect(locks.release('client-a').changed).toBe(true);
    expect(locks.current()).toBeUndefined();
  });
});
