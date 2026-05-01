export const FIXTURE_COUNT = 2;
export const FIXTURE_CHANNEL_COUNT = 8;
export const DMX_CHANNEL_COUNT = FIXTURE_COUNT * FIXTURE_CHANNEL_COUNT;

export const FIXTURE_CONFIGS = [
  {
    id: 'light-a',
    label: 'Light A',
    shortLabel: 'A',
    startAddress: 1,
  },
  {
    id: 'light-b',
    label: 'Light B',
    shortLabel: 'B',
    startAddress: 9,
  },
] as const;

export const DMX_CHANNELS = [
  {
    key: 'master',
    channel: 1,
    label: 'Master Dimmer',
    shortLabel: 'Master',
    description: 'RGBW master intensity from dark to bright.',
  },
  {
    key: 'red',
    channel: 2,
    label: 'Red Dimmer',
    shortLabel: 'Red',
    description: 'Red LED intensity from dark to bright.',
  },
  {
    key: 'green',
    channel: 3,
    label: 'Green Dimmer',
    shortLabel: 'Green',
    description: 'Green LED intensity from dark to bright.',
  },
  {
    key: 'blue',
    channel: 4,
    label: 'Blue Dimmer',
    shortLabel: 'Blue',
    description: 'Blue LED intensity from dark to bright.',
  },
  {
    key: 'white',
    channel: 5,
    label: 'White Dimmer',
    shortLabel: 'White',
    description: 'White LED intensity from dark to bright.',
  },
  {
    key: 'strobe',
    channel: 6,
    label: 'Strobe',
    shortLabel: 'Strobe',
    description: 'RGBW strobe speed from slow to fast; 0 disables strobe.',
  },
  {
    key: 'functionMode',
    channel: 7,
    label: 'Function Choice',
    shortLabel: 'Mode',
    description: 'Selects direct DMX control, color macros, chases, or sound-active mode.',
  },
  {
    key: 'functionSpeed',
    channel: 8,
    label: 'Function Speed',
    shortLabel: 'Speed',
    description: 'Function speed from slow to fast for CH7 effects.',
  },
] as const;

export type FixtureId = (typeof FIXTURE_CONFIGS)[number]['id'];
export type DmxStateKey = (typeof DMX_CHANNELS)[number]['key'];

export type FixtureState = Record<DmxStateKey, number>;
export type DmxState = FixtureState;
export type FixturePatch = Partial<FixtureState>;
export type DmxPatch = FixturePatch;

export interface ShowState {
  fixtures: FixtureState[];
}

export interface ShowPatch {
  fixtures: Array<FixturePatch | undefined>;
}

export const DEFAULT_DMX_STATE: FixtureState = {
  master: 255,
  red: 0,
  green: 0,
  blue: 0,
  white: 0,
  strobe: 0,
  functionMode: 0,
  functionSpeed: 0,
};

export const BLACKOUT_DMX_STATE: FixtureState = {
  master: 0,
  red: 0,
  green: 0,
  blue: 0,
  white: 0,
  strobe: 0,
  functionMode: 0,
  functionSpeed: 0,
};

export const DEFAULT_SHOW_STATE: ShowState = createShowState(DEFAULT_DMX_STATE);
export const BLACKOUT_SHOW_STATE: ShowState = createShowState(BLACKOUT_DMX_STATE);

export const FUNCTION_MODES = [
  {
    id: 'dmx8ch',
    label: 'DMX 8CH Control',
    min: 0,
    max: 50,
    value: 0,
  },
  {
    id: 'colorOutput',
    label: 'Different Colors Output',
    min: 51,
    max: 100,
    value: 75,
  },
  {
    id: 'jumpChange',
    label: 'Colors Jump Change',
    min: 101,
    max: 150,
    value: 125,
  },
  {
    id: 'gradate',
    label: 'Colors Gradate',
    min: 151,
    max: 200,
    value: 175,
  },
  {
    id: 'pulseChange',
    label: 'Colors Pulse Change',
    min: 201,
    max: 250,
    value: 225,
  },
  {
    id: 'soundActive',
    label: 'Sound-Active',
    min: 251,
    max: 255,
    value: 253,
  },
] as const;

export type FunctionModeId = (typeof FUNCTION_MODES)[number]['id'];

export interface DmxDeviceStatus {
  connected: boolean;
  driver: 'mock' | 'udmx';
  detail: string;
  failures?: number;
  lastError?: string;
  lastErrorAt?: string;
  lastFrameAt?: string;
  productId?: string;
  vendorId?: string;
  writeMode?: string;
  writes: number;
}

export interface DmxSnapshot {
  device: DmxDeviceStatus;
  frame: number[];
  state: ShowState;
  updatedAt: string;
}

const STATE_KEYS = DMX_CHANNELS.map((channel) => channel.key);

export function clampDmxByte(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(255, Math.max(0, Math.round(value)));
}

export function cloneFixtureState(state: FixtureState): FixtureState {
  return { ...state };
}

export function createShowState(seed: FixtureState = DEFAULT_DMX_STATE): ShowState {
  return {
    fixtures: Array.from({ length: FIXTURE_COUNT }, () => cloneFixtureState(seed)),
  };
}

export function isDmxStateKey(value: string): value is DmxStateKey {
  return STATE_KEYS.includes(value as DmxStateKey);
}

export function normalizeDmxPatch(input: unknown): FixturePatch {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('DMX update must be an object.');
  }

  const patch: FixturePatch = {};

  for (const [key, value] of Object.entries(input)) {
    if (!isDmxStateKey(key)) {
      throw new Error(`Unknown DMX channel key: ${key}`);
    }

    if (typeof value !== 'number') {
      throw new Error(`DMX value for ${key} must be a number.`);
    }

    patch[key] = clampDmxByte(value);
  }

  if (Object.keys(patch).length === 0) {
    throw new Error('DMX update must contain at least one channel.');
  }

  return patch;
}

export function normalizeShowPatch(input: unknown): ShowPatch {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('DMX update must be an object.');
  }

  const inputObject = input as Record<string, unknown>;
  const fixtures: Array<FixturePatch | undefined> = Array.from({ length: FIXTURE_COUNT });

  if (Array.isArray(inputObject.fixtures)) {
    inputObject.fixtures.slice(0, FIXTURE_COUNT).forEach((fixtureInput, index) => {
      if (fixtureInput !== undefined && fixtureInput !== null) {
        fixtures[index] = normalizeDmxPatch(fixtureInput);
      }
    });
  } else if ('fixtureIndex' in inputObject && 'patch' in inputObject) {
    const fixtureIndex = Number(inputObject.fixtureIndex);
    if (!Number.isInteger(fixtureIndex) || fixtureIndex < 0 || fixtureIndex >= FIXTURE_COUNT) {
      throw new Error(`fixtureIndex must be between 0 and ${FIXTURE_COUNT - 1}.`);
    }
    fixtures[fixtureIndex] = normalizeDmxPatch(inputObject.patch);
  } else if ('all' in inputObject) {
    const allPatch = normalizeDmxPatch(inputObject.all);
    for (let index = 0; index < FIXTURE_COUNT; index += 1) {
      fixtures[index] = allPatch;
    }
  } else {
    const allPatch = normalizeDmxPatch(inputObject);
    for (let index = 0; index < FIXTURE_COUNT; index += 1) {
      fixtures[index] = allPatch;
    }
  }

  if (!fixtures.some(Boolean)) {
    throw new Error('DMX update must contain at least one fixture patch.');
  }

  return { fixtures };
}

export function mergeDmxState(current: FixtureState, patch: FixturePatch): FixtureState {
  return {
    ...current,
    ...Object.fromEntries(
      Object.entries(patch).map(([key, value]) => [key, clampDmxByte(value ?? 0)]),
    ),
  } as FixtureState;
}

export function mergeShowState(current: ShowState, patch: ShowPatch): ShowState {
  return {
    fixtures: current.fixtures.map((fixture, index) => {
      const fixturePatch = patch.fixtures[index];
      return fixturePatch ? mergeDmxState(fixture, fixturePatch) : cloneFixtureState(fixture);
    }),
  };
}

export function fixtureStateToDmxFrame(state: FixtureState): number[] {
  return DMX_CHANNELS.map((channel) => clampDmxByte(state[channel.key]));
}

export function stateToDmxFrame(state: FixtureState): number[] {
  return fixtureStateToDmxFrame(state);
}

export function showStateToDmxFrame(state: ShowState): number[] {
  return state.fixtures.slice(0, FIXTURE_COUNT).flatMap(fixtureStateToDmxFrame);
}

export function modeForValue(value: number) {
  const byte = clampDmxByte(value);
  return FUNCTION_MODES.find((mode) => byte >= mode.min && byte <= mode.max) ?? FUNCTION_MODES[0];
}

export function isDirectControlMode(value: number): boolean {
  const mode = modeForValue(value);
  return mode.id === 'dmx8ch';
}
