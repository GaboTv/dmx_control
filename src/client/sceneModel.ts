import {
  DMX_CHANNELS,
  FIXTURE_COUNT,
  type DmxPatch,
  type FixtureState,
  clampDmxByte,
} from '../shared/dmx';

export type FixturePatches = DmxPatch[];

export interface SceneCue {
  fixtures: FixturePatches;
  id: string;
  label: string;
  time: number;
}

export interface TrackScene {
  createdAt: string;
  cues: SceneCue[];
  duration: number;
  fixtureCount: number;
  name: string;
  songName?: string;
  version: 1;
}

export interface FolkloricSceneInput {
  duration: number;
  fixtureCount: number;
  sampleRate: number;
  samples: Float32Array;
  songName: string;
}

interface EnergyFrame {
  energy: number;
  time: number;
}

type FullFixturePatch = Required<FixtureState>;
type DimmingKey = 'blue' | 'green' | 'master' | 'red' | 'white';

const DIMMING_KEYS: DimmingKey[] = ['master', 'red', 'green', 'blue', 'white'];

const CHANNEL_KEYS = DMX_CHANNELS.map((channel) => channel.key);

const AUTO_PALETTES: FixturePatches[] = [
  [
    {
      blue: 0,
      functionMode: 0,
      green: 20,
      master: 235,
      red: 255,
      strobe: 0,
      white: 0,
    },
    {
      blue: 255,
      functionMode: 0,
      green: 35,
      master: 230,
      red: 0,
      strobe: 0,
      white: 0,
    },
  ],
  [
    {
      blue: 40,
      functionMode: 0,
      green: 255,
      master: 230,
      red: 0,
      strobe: 0,
      white: 0,
    },
    {
      blue: 0,
      functionMode: 0,
      green: 40,
      master: 225,
      red: 255,
      strobe: 0,
      white: 30,
    },
  ],
  [
    {
      blue: 255,
      functionMode: 0,
      green: 0,
      master: 230,
      red: 170,
      strobe: 0,
      white: 0,
    },
    {
      blue: 0,
      functionMode: 0,
      green: 210,
      master: 220,
      red: 30,
      strobe: 0,
      white: 120,
    },
  ],
  [
    {
      blue: 0,
      functionMode: 0,
      green: 0,
      master: 255,
      red: 0,
      strobe: 0,
      white: 255,
    },
    {
      blue: 130,
      functionMode: 0,
      green: 40,
      master: 220,
      red: 255,
      strobe: 0,
      white: 0,
    },
  ],
];

export function createEmptyScene(
  fixtureCount = FIXTURE_COUNT,
  songName?: string,
  duration = 0,
): TrackScene {
  return {
    createdAt: new Date().toISOString(),
    cues: [],
    duration,
    fixtureCount: clampSceneFixtureCount(fixtureCount),
    name: songName ? `${songName} show` : 'Untitled dance show',
    songName,
    version: 1,
  };
}

export function createAutoCue(
  time: number,
  index: number,
  fixtureCount: number,
): SceneCue {
  const base = AUTO_PALETTES[index % AUTO_PALETTES.length];
  const strongHit = index % 8 === 0;
  const normalizedFixtureCount = clampSceneFixtureCount(fixtureCount);
  const accentFixture = normalizedFixtureCount > 1 ? 1 : 0;
  return {
    fixtures: normalizeFixturePatches(base, normalizedFixtureCount).map(
      (patch, fixtureIndex) => ({
        ...patch,
        functionMode: 0,
        master: strongHit ? 255 : patch.master,
        strobe: strongHit && fixtureIndex === accentFixture ? 80 : 0,
      }),
    ),
    id: createId(),
    label: strongHit ? `Accent ${index + 1}` : `Auto ${index + 1}`,
    time,
  };
}

export function generateFolkloricSceneFromSamples(
  input: FolkloricSceneInput,
): TrackScene {
  const fixtureCount = clampSceneFixtureCount(input.fixtureCount);
  const duration = roundTime(input.duration);
  const frames = analyzeEnergy(input.samples, input.sampleRate);
  const onsets = detectOnsets(frames);
  const beatInterval = estimateBeatInterval(onsets, duration);
  const phraseDuration = Math.min(10, Math.max(3.5, beatInterval * 8));
  const cues: SceneCue[] = [];

  const minEnergy = frames.reduce(
    (min, frame) => Math.min(min, frame.energy),
    Number.POSITIVE_INFINITY,
  );
  const maxEnergy = frames.reduce(
    (max, frame) => Math.max(max, frame.energy),
    0,
  );

  for (
    let phraseStart = 0, phraseIndex = 0;
    phraseStart < duration;
    phraseStart += phraseDuration, phraseIndex += 1
  ) {
    const phraseEnd = Math.min(duration, phraseStart + phraseDuration);
    const phraseEnergy = averageEnergy(frames, phraseStart, phraseEnd);
    const phrasePeak = maxEnergyInRange(frames, phraseStart, phraseEnd);
    const intensity = Math.max(
      normalizeIntensity(phraseEnergy, minEnergy, maxEnergy),
      normalizeIntensity(phrasePeak, minEnergy, maxEnergy) * 0.85,
    );

    cues.push(
      createFolkloricPhraseCue(
        phraseStart,
        phraseIndex,
        intensity,
        fixtureCount,
      ),
    );

    const accentTime =
      strongestOnsetInRange(
        onsets,
        frames,
        phraseStart + 0.25,
        phraseEnd - 0.2,
      ) ?? strongestFrameInRange(frames, phraseStart + 0.25, phraseEnd - 0.2);
    if (accentTime !== undefined && intensity > 0.58) {
      cues.push(
        createFolkloricAccentCue(
          accentTime,
          phraseIndex,
          intensity,
          fixtureCount,
        ),
      );
    }
  }

  if (!cues.length) {
    fallbackCueTimes(duration).forEach((time, index) => {
      cues.push(createFolkloricPhraseCue(time, index, 0.35, fixtureCount));
    });
  }

  return {
    createdAt: new Date().toISOString(),
    cues: cues
      .sort((left, right) => left.time - right.time)
      .slice(0, 220)
      .map((cue) => ({ ...cue, time: roundTime(cue.time) })),
    duration,
    fixtureCount,
    name: `${input.songName} folkloric scene`,
    songName: input.songName,
    version: 1,
  };
}

export function fallbackCueTimes(duration: number): number[] {
  const times: number[] = [];
  for (let time = 0; time < duration; time += 2) {
    times.push(roundTime(time));
  }
  return times;
}

function analyzeEnergy(
  samples: Float32Array,
  sampleRate: number,
): EnergyFrame[] {
  const windowSize = Math.max(1, Math.floor(sampleRate * 0.22));
  const hopSize = Math.max(1, Math.floor(sampleRate * 0.11));
  const frames: EnergyFrame[] = [];

  for (let start = 0; start < samples.length; start += hopSize) {
    let sum = 0;
    const end = Math.min(samples.length, start + windowSize);
    for (let index = start; index < end; index += 1) {
      sum += samples[index] * samples[index];
    }
    frames.push({
      energy: Math.sqrt(sum / Math.max(1, end - start)),
      time: start / sampleRate,
    });
  }

  return frames.length ? frames : [{ energy: 0, time: 0 }];
}

function detectOnsets(frames: EnergyFrame[]): number[] {
  const average =
    frames.reduce((sum, frame) => sum + frame.energy, 0) /
    Math.max(1, frames.length);
  const peak = frames.reduce((max, frame) => Math.max(max, frame.energy), 0);
  const threshold = average + (peak - average) * 0.34;
  const onsets: number[] = [];
  let lastOnset = -1;

  for (let index = 1; index < frames.length - 1; index += 1) {
    const current = frames[index];
    const isLocalPeak =
      current.energy >= frames[index - 1].energy &&
      current.energy > frames[index + 1].energy;
    if (
      isLocalPeak &&
      current.energy >= threshold &&
      current.time - lastOnset >= 0.28
    ) {
      onsets.push(current.time);
      lastOnset = current.time;
    }
  }

  return onsets;
}

function estimateBeatInterval(onsets: number[], duration: number): number {
  const intervals = onsets
    .slice(1)
    .map((time, index) => time - onsets[index])
    .filter((interval) => interval >= 0.28 && interval <= 1.4)
    .sort((left, right) => left - right);

  if (!intervals.length) {
    return Math.min(0.82, Math.max(0.48, duration / 48 || 0.62));
  }

  let median = intervals[Math.floor(intervals.length / 2)];
  while (median < 0.42) {
    median *= 2;
  }
  while (median > 0.92) {
    median /= 2;
  }
  return Math.min(0.92, Math.max(0.42, median));
}

function averageEnergy(
  frames: EnergyFrame[],
  start: number,
  end: number,
): number {
  const matching = frames.filter(
    (frame) => frame.time >= start && frame.time < end,
  );
  return (
    matching.reduce((sum, frame) => sum + frame.energy, 0) /
    Math.max(1, matching.length)
  );
}

function maxEnergyInRange(
  frames: EnergyFrame[],
  start: number,
  end: number,
): number {
  return frames.reduce((max, frame) => {
    if (frame.time < start || frame.time >= end) {
      return max;
    }
    return Math.max(max, frame.energy);
  }, 0);
}

function normalizeIntensity(value: number, min: number, max: number): number {
  if (!Number.isFinite(min) || max <= min) {
    return 0.35;
  }

  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

function strongestOnsetInRange(
  onsets: number[],
  frames: EnergyFrame[],
  start: number,
  end: number,
): number | undefined {
  const candidates = onsets.filter((time) => time >= start && time <= end);
  if (!candidates.length) {
    return undefined;
  }

  return candidates.reduce((best, time) =>
    energyNear(frames, time) > energyNear(frames, best) ? time : best,
  );
}

function strongestFrameInRange(
  frames: EnergyFrame[],
  start: number,
  end: number,
): number | undefined {
  const candidates = frames.filter(
    (frame) => frame.time >= start && frame.time <= end,
  );
  if (!candidates.length) {
    return undefined;
  }

  return candidates.reduce((best, frame) =>
    frame.energy > best.energy ? frame : best,
  ).time;
}

function energyNear(frames: EnergyFrame[], time: number): number {
  return frames.reduce((best, frame) => {
    const distance = Math.abs(frame.time - time);
    if (distance > 0.12) {
      return best;
    }
    return Math.max(best, frame.energy);
  }, 0);
}

function createFolkloricPhraseCue(
  time: number,
  phraseIndex: number,
  intensity: number,
  fixtureCount: number,
): SceneCue {
  return {
    fixtures: createFolkloricFixturePatches(
      phraseIndex,
      intensity,
      fixtureCount,
      false,
    ),
    id: createId(),
    label: folkloricLabel(intensity, phraseIndex),
    time,
  };
}

function createFolkloricAccentCue(
  time: number,
  phraseIndex: number,
  intensity: number,
  fixtureCount: number,
): SceneCue {
  return {
    fixtures: createFolkloricFixturePatches(
      phraseIndex,
      intensity,
      fixtureCount,
      true,
    ),
    id: createId(),
    label: `Percussion Accent ${phraseIndex + 1}`,
    time,
  };
}

function createFolkloricFixturePatches(
  phraseIndex: number,
  intensity: number,
  fixtureCount: number,
  accent: boolean,
): FixturePatches {
  const normalizedFixtureCount = clampSceneFixtureCount(fixtureCount);
  const base = folkloricPalette(intensity, phraseIndex);
  const accentFixture = normalizedFixtureCount > 1 ? phraseIndex % 2 : 0;

  return Array.from(
    { length: normalizedFixtureCount },
    (_unused, fixtureIndex) => {
      const mirrored =
        normalizedFixtureCount > 1 && fixtureIndex !== phraseIndex % 2;
      const patch = mirrored
        ? mirrorFolkloricPatch(base, intensity)
        : { ...base };

      if (accent && fixtureIndex === accentFixture) {
        return {
          ...patch,
          green: clampDmxByte(patch.green + 18),
          master: clampDmxByte(patch.master + 18),
          red: clampDmxByte(patch.red + 12),
          strobe: intensity > 0.78 ? 28 : 0,
          white: clampDmxByte(patch.white + 24),
        };
      }

      return { ...patch, strobe: 0 };
    },
  );
}

function folkloricPalette(
  intensity: number,
  phraseIndex: number,
): FullFixturePatch {
  const family = phraseIndex % 6;

  if (intensity < 0.24 && phraseIndex % 4 === 2) {
    return directPatch({
      blue: 155,
      green: 42,
      master: 145,
      red: 42,
      white: 6,
    });
  }

  if (intensity < 0.34) {
    const low = [
      { blue: 0, green: 78, red: 205 },
      { blue: 88, green: 20, red: 150 },
      { blue: 118, green: 58, red: 45 },
      { blue: 0, green: 110, red: 170 },
      { blue: 90, green: 92, red: 0 },
      { blue: 22, green: 36, red: 215 },
    ][family];
    return directPatch({ ...low, master: 150, white: 4 });
  }

  if (intensity < 0.68) {
    const medium = [
      { blue: 0, green: 118, red: 255 },
      { blue: 145, green: 30, red: 240 },
      { blue: 190, green: 90, red: 30 },
      { blue: 0, green: 185, red: 200 },
      { blue: 135, green: 170, red: 20 },
      { blue: 35, green: 54, red: 255 },
    ][family];
    return directPatch({ ...medium, master: 205, white: 8 });
  }

  if (intensity < 0.86) {
    const bright = [
      { blue: 0, green: 150, red: 255 },
      { blue: 188, green: 40, red: 255 },
      { blue: 230, green: 110, red: 40 },
      { blue: 0, green: 230, red: 225 },
      { blue: 170, green: 215, red: 35 },
      { blue: 58, green: 80, red: 255 },
    ][family];
    return directPatch({ ...bright, master: 235, white: 14 });
  }

  const celebration = [
    { blue: 0, green: 178, red: 255 },
    { blue: 210, green: 56, red: 255 },
    { blue: 255, green: 132, red: 55 },
    { blue: 0, green: 255, red: 235 },
    { blue: 190, green: 245, red: 45 },
    { blue: 75, green: 100, red: 255 },
  ][family];
  return directPatch({ ...celebration, master: 255, white: 24 });
}

function mirrorFolkloricPatch(
  base: FullFixturePatch,
  intensity: number,
): FullFixturePatch {
  return directPatch({
    blue: clampDmxByte(base.blue + (intensity > 0.6 ? 28 : 12)),
    green: clampDmxByte(base.green - 18),
    master: clampDmxByte(base.master - 18),
    red: clampDmxByte(base.red - 22),
    white: clampDmxByte(base.white + 4),
  });
}

function directPatch(
  input: Pick<FixtureState, 'blue' | 'green' | 'master' | 'red' | 'white'>,
): FullFixturePatch {
  return {
    blue: clampDmxByte(input.blue),
    functionMode: 0,
    functionSpeed: 0,
    green: clampDmxByte(input.green),
    master: clampDmxByte(input.master),
    red: clampDmxByte(input.red),
    strobe: 0,
    white: clampDmxByte(input.white),
  };
}

function folkloricLabel(intensity: number, phraseIndex: number): string {
  if (intensity > 0.86) {
    return `Celebration Phrase ${phraseIndex + 1}`;
  }

  if (intensity > 0.68) {
    return `Bright Dance Phrase ${phraseIndex + 1}`;
  }

  if (intensity < 0.24 && phraseIndex % 4 === 2) {
    return `Cool Break Phrase ${phraseIndex + 1}`;
  }

  return `Warm Dance Phrase ${phraseIndex + 1}`;
}

export function normalizeImportedScene(input: unknown): TrackScene {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Scene file must contain a JSON object.');
  }

  const source = input as Partial<TrackScene>;
  const fixtureCount = clampSceneFixtureCount(
    source.fixtureCount,
    inferFixtureCount(Array.isArray(source.cues) ? source.cues : []),
  );
  const cues = Array.isArray(source.cues)
    ? source.cues.map((cueInput, index) =>
        normalizeImportedCue(cueInput, index, fixtureCount),
      )
    : [];

  if (!cues.length) {
    throw new Error('Scene file does not contain any cues.');
  }

  return {
    createdAt:
      typeof source.createdAt === 'string'
        ? source.createdAt
        : new Date().toISOString(),
    cues: cues.sort((left, right) => left.time - right.time),
    duration:
      typeof source.duration === 'number' ? roundTime(source.duration) : 0,
    fixtureCount,
    name: typeof source.name === 'string' ? source.name : 'Imported dance show',
    songName: typeof source.songName === 'string' ? source.songName : undefined,
    version: 1,
  };
}

function normalizeImportedCue(
  input: unknown,
  index: number,
  fixtureCount: number,
): SceneCue {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`Cue ${index + 1} must be an object.`);
  }

  const source = input as Partial<SceneCue>;
  if (typeof source.time !== 'number') {
    throw new Error(`Cue ${index + 1} is missing a numeric time.`);
  }

  const fixtureInputs = Array.isArray(source.fixtures) ? source.fixtures : [];
  return {
    fixtures: normalizeFixturePatches(fixtureInputs, fixtureCount),
    id: typeof source.id === 'string' ? source.id : createId(),
    label: typeof source.label === 'string' ? source.label : `Cue ${index + 1}`,
    time: roundTime(source.time),
  };
}

export function normalizeFixturePatches(
  inputs: unknown[],
  fixtureCount: number,
): FixturePatches {
  const normalizedFixtureCount = clampSceneFixtureCount(fixtureCount);
  return Array.from({ length: normalizedFixtureCount }, (_unused, index) =>
    normalizePatchLoose(inputs[index]),
  );
}

function inferFixtureCount(cues: unknown[]): number {
  const maxCueFixtures = cues.reduce<number>((max, cueInput) => {
    if (!cueInput || typeof cueInput !== 'object' || Array.isArray(cueInput)) {
      return max;
    }
    const fixtures = (cueInput as Partial<SceneCue>).fixtures;
    return Array.isArray(fixtures) ? Math.max(max, fixtures.length) : max;
  }, 1);

  return clampSceneFixtureCount(maxCueFixtures);
}

export function clampSceneFixtureCount(
  value: unknown,
  fallback = FIXTURE_COUNT,
): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return Math.min(FIXTURE_COUNT, Math.max(1, Math.round(fallback)));
  }

  return Math.min(FIXTURE_COUNT, Math.max(1, Math.round(parsed)));
}

export function normalizePatchLoose(input: unknown): DmxPatch {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  const patch: DmxPatch = {};
  for (const [key, value] of Object.entries(input)) {
    if (
      !CHANNEL_KEYS.includes(key as keyof FixtureState) ||
      typeof value !== 'number'
    ) {
      continue;
    }
    patch[key as keyof FixtureState] = clampDmxByte(value);
  }
  return patch;
}

export function fixtureToPatch(fixture: FixtureState): DmxPatch {
  return { ...fixture };
}

export function findNextCueIndex(time: number, cues: SceneCue[]): number {
  const index = cues.findIndex((cue) => cue.time >= time - 0.03);
  return index === -1 ? cues.length : index;
}

export function sceneDimmingPatchesAt(
  cues: SceneCue[],
  time: number,
  fixtureCount: number,
): FixturePatches {
  const sortedCues = [...cues].sort((left, right) => left.time - right.time);
  const normalizedFixtureCount = clampSceneFixtureCount(fixtureCount);

  if (!sortedCues.length) {
    return [];
  }

  const nextIndex = sortedCues.findIndex((cue) => cue.time > time);
  const previousCue =
    nextIndex <= 0 ? sortedCues[0] : sortedCues[nextIndex - 1];
  const nextCue = nextIndex === -1 ? previousCue : sortedCues[nextIndex];
  const span = Math.max(0.001, nextCue.time - previousCue.time);
  const progress =
    previousCue === nextCue
      ? 0
      : Math.min(1, Math.max(0, (time - previousCue.time) / span));

  return Array.from(
    { length: normalizedFixtureCount },
    (_unused, fixtureIndex) =>
      interpolateFixturePatch(
        previousCue,
        nextCue,
        sortedCues,
        fixtureIndex,
        time,
        progress,
      ),
  );
}

function interpolateFixturePatch(
  previousCue: SceneCue,
  nextCue: SceneCue,
  allCues: SceneCue[],
  fixtureIndex: number,
  time: number,
  progress: number,
): DmxPatch {
  const previous = previousCue.fixtures[fixtureIndex] ?? {};
  const next = nextCue.fixtures[fixtureIndex] ?? previous;
  const patch: DmxPatch = {};

  for (const key of DIMMING_KEYS) {
    const previousValue = channelValue(previous, key, next[key]);
    const nextValue = channelValue(next, key, previous[key]);
    if (previousValue !== undefined || nextValue !== undefined) {
      patch[key] = clampDmxByte(
        lerp(previousValue ?? 0, nextValue ?? previousValue ?? 0, progress),
      );
    }
  }

  patch.functionMode =
    channelValue(previous, 'functionMode', next.functionMode) ?? 0;
  patch.functionSpeed =
    channelValue(previous, 'functionSpeed', next.functionSpeed) ?? 0;
  patch.strobe = accentStrobeAt(allCues, fixtureIndex, time);

  return patch;
}

function channelValue(
  patch: DmxPatch,
  key: keyof FixtureState,
  fallback?: number,
): number | undefined {
  return typeof patch[key] === 'number' ? patch[key] : fallback;
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function accentStrobeAt(
  cues: SceneCue[],
  fixtureIndex: number,
  time: number,
): number {
  const accent = cues.find((cue) => {
    const strobe = cue.fixtures[fixtureIndex]?.strobe;
    return (
      typeof strobe === 'number' &&
      strobe > 0 &&
      Math.abs(cue.time - time) <= 0.14
    );
  });

  return clampDmxByte(accent?.fixtures[fixtureIndex]?.strobe ?? 0);
}

export function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function formatTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}

export function roundTime(value: number): number {
  return Math.max(0, Math.round(value * 100) / 100);
}
