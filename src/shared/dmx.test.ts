import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DMX_STATE,
  DEFAULT_SHOW_STATE,
  FUNCTION_MODES,
  clampDmxByte,
  fixtureStateToDmxFrame,
  isDirectControlMode,
  normalizeDmxPatch,
  normalizeShowPatch,
  showStateToDmxFrame,
} from './dmx';

describe('DMX model', () => {
  it('maps one fixture state to the eight documented channels', () => {
    expect(
      fixtureStateToDmxFrame({
        ...DEFAULT_DMX_STATE,
        master: 10,
        red: 20,
        green: 30,
        blue: 40,
        white: 50,
        strobe: 60,
        functionMode: 70,
        functionSpeed: 80,
      }),
    ).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
  });

  it('maps two fixtures to a 16-channel show frame', () => {
    expect(
      showStateToDmxFrame({
        fixtures: [
          { ...DEFAULT_DMX_STATE, red: 255 },
          { ...DEFAULT_DMX_STATE, blue: 255 },
        ],
      }),
    ).toEqual([255, 255, 0, 0, 0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0]);
  });

  it('keeps default fixture state objects independent', () => {
    expect(DEFAULT_SHOW_STATE.fixtures[0]).not.toBe(DEFAULT_SHOW_STATE.fixtures[1]);
  });

  it('clamps DMX values to one byte', () => {
    expect(clampDmxByte(-10)).toBe(0);
    expect(clampDmxByte(88.6)).toBe(89);
    expect(clampDmxByte(300)).toBe(255);
  });

  it('rejects unknown channel keys', () => {
    expect(() => normalizeDmxPatch({ pan: 100 })).toThrow('Unknown DMX channel key');
  });

  it('normalizes fixture-specific patches', () => {
    expect(normalizeShowPatch({ fixtures: [{ red: 255 }, { blue: 255 }] })).toEqual({
      fixtures: [{ red: 255 }, { blue: 255 }],
    });
  });

  it('keeps direct RGBW control in the CH7 0-50 range', () => {
    expect(FUNCTION_MODES[0]).toMatchObject({ min: 0, max: 50 });
    expect(isDirectControlMode(0)).toBe(true);
    expect(isDirectControlMode(51)).toBe(false);
  });
});
