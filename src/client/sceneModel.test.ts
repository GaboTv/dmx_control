import { describe, expect, it } from 'vitest';

import {
  SCENE_GENERATION_METHODS,
  clampSceneFixtureCount,
  createAutoCue,
  fallbackCueTimes,
  findNextCueIndex,
  formatTime,
  generateFolkloricSceneFromSamples,
  generateSignalSceneFromEnergyFrames,
  normalizeImportedScene,
  normalizePatchLoose,
  roundTime,
  sceneDimmingPatchesAt,
} from './sceneModel';

describe('scene model', () => {
  it('normalizes imported scenes into sorted, clamped fixture cues', () => {
    const scene = normalizeImportedScene({
      cues: [
        {
          fixtures: [{ blue: -10 }, { green: 260, pan: 128 }],
          label: 'late',
          time: 4.236,
        },
        {
          fixtures: [{ red: 512, white: 'bright' }, { strobe: 12.4 }],
          label: 'early',
          time: 1.004,
        },
      ],
      duration: 9.999,
      fixtureCount: 99,
      name: 'Imported show',
      songName: 'track.wav',
    });

    expect(scene).toMatchObject({
      duration: 10,
      fixtureCount: 2,
      name: 'Imported show',
      songName: 'track.wav',
      version: 1,
    });
    expect(scene.cues.map((cue) => cue.label)).toEqual(['early', 'late']);
    expect(scene.cues[0].time).toBe(1);
    expect(scene.cues[0].fixtures).toEqual([{ red: 255 }, { strobe: 12 }]);
    expect(scene.cues[1].fixtures).toEqual([{ blue: 0 }, { green: 255 }]);
  });

  it('rejects scene files with no usable cues', () => {
    expect(() => normalizeImportedScene({ cues: [] })).toThrow(
      'Scene file does not contain any cues',
    );
    expect(() => normalizeImportedScene(null)).toThrow(
      'Scene file must contain a JSON object',
    );
  });

  it('keeps auto-generated RGBW cues in direct DMX mode', () => {
    const oneLightCue = createAutoCue(1.5, 0, 1);
    const twoLightCue = createAutoCue(2.5, 8, 2);

    expect(oneLightCue.fixtures).toHaveLength(1);
    expect(oneLightCue.fixtures[0]).toMatchObject({
      functionMode: 0,
      master: 255,
      strobe: 80,
    });
    expect(twoLightCue.fixtures).toHaveLength(2);
    expect(
      twoLightCue.fixtures.every((fixture) => fixture.functionMode === 0),
    ).toBe(true);
    expect(twoLightCue.fixtures.map((fixture) => fixture.strobe)).toEqual([
      0, 80,
    ]);
  });

  it('generates folkloric phrase cues with individual RGBW dimming', () => {
    const sampleRate = 1000;
    const duration = 24;
    const samples = syntheticFolkloricSamples(sampleRate, duration);
    const scene = generateFolkloricSceneFromSamples({
      duration,
      fixtureCount: 2,
      sampleRate,
      samples,
      songName: 'cueca.wav',
    });

    expect(scene.name).toBe('cueca.wav folkloric scene');
    expect(scene.fixtureCount).toBe(2);
    expect(scene.cues.length).toBeGreaterThan(3);
    expect(scene.cues[0].time).toBe(0);
    expect(scene.cues.some((cue) => cue.label.includes('Dance Phrase'))).toBe(
      true,
    );
    expect(
      scene.cues.some((cue) => cue.label.includes('Percussion Accent')),
    ).toBe(true);

    const allFixtures = scene.cues.flatMap((cue) => cue.fixtures);
    expect(allFixtures.every((fixture) => fixture.functionMode === 0)).toBe(
      true,
    );
    expect(allFixtures.every((fixture) => fixture.functionSpeed === 0)).toBe(
      true,
    );
    expect(new Set(allFixtures.map((fixture) => fixture.red))).not.toEqual(
      new Set([0]),
    );
    expect(
      new Set(allFixtures.map((fixture) => fixture.green)).size,
    ).toBeGreaterThan(1);
    expect(
      new Set(
        allFixtures.map(
          (fixture) => `${fixture.red}-${fixture.green}-${fixture.blue}`,
        ),
      ).size,
    ).toBeGreaterThan(3);
    expect(
      new Set(allFixtures.map((fixture) => fixture.white)).size,
    ).toBeGreaterThan(1);
    expect(
      Math.max(...allFixtures.map((fixture) => fixture.white ?? 0)),
    ).toBeLessThanOrEqual(48);
    expect(
      allFixtures.some((fixture) => (fixture.white ?? 0) < (fixture.red ?? 0)),
    ).toBe(true);
    expect(
      Math.max(...allFixtures.map((fixture) => fixture.strobe ?? 0)),
    ).toBeLessThanOrEqual(28);
  });

  it('respects one-light folkloric scenes', () => {
    const scene = generateFolkloricSceneFromSamples({
      duration: 8,
      fixtureCount: 1,
      sampleRate: 100,
      samples: syntheticFolkloricSamples(100, 8),
      songName: 'tonada.wav',
    });

    expect(scene.fixtureCount).toBe(1);
    expect(scene.cues.every((cue) => cue.fixtures.length === 1)).toBe(true);
    expect(scene.cues.every((cue) => cue.fixtures[0].functionMode === 0)).toBe(
      true,
    );
  });

  it('generates cues for every music processing method', () => {
    const frames = Array.from({ length: 96 }, (_unused, index) => {
      const time = index * 0.25;
      const pulse = index % 8 === 0 ? 0.95 : 0.2 + (index % 5) * 0.08;
      return {
        energy: pulse,
        flux: index % 8 === 0 ? 0.7 : 0.05,
        high: index % 3 === 0 ? 0.62 : 0.18,
        low: index % 4 === 0 ? 0.72 : 0.22,
        mid: index % 5 === 0 ? 0.58 : 0.26,
        peak: Math.min(1, pulse + 0.08),
        rms: pulse * 0.82,
        time,
      };
    });

    for (const method of SCENE_GENERATION_METHODS) {
      const scene = generateSignalSceneFromEnergyFrames({
        duration: 24,
        fixtureCount: 2,
        frames,
        method: method.id,
        songName: 'analysis.wav',
      });

      expect(scene.cues.length, method.id).toBeGreaterThan(0);
      expect(scene.cues.length, method.id).toBeLessThanOrEqual(220);
      expect(scene.cues.every((cue) => cue.fixtures.length === 2)).toBe(true);
      expect(
        scene.cues
          .flatMap((cue) => cue.fixtures)
          .every((fixture) => {
            return fixture.functionMode === 0;
          }),
      ).toBe(true);
    }
  });

  it('interpolates RGBW dimming between scene cues during playback', () => {
    const patches = sceneDimmingPatchesAt(
      [
        {
          fixtures: [
            {
              blue: 0,
              functionMode: 0,
              functionSpeed: 0,
              green: 40,
              master: 100,
              red: 200,
              white: 20,
            },
          ],
          id: 'warm',
          label: 'Warm phrase',
          time: 0,
        },
        {
          fixtures: [
            {
              blue: 80,
              functionMode: 0,
              functionSpeed: 0,
              green: 160,
              master: 220,
              red: 250,
              white: 100,
            },
          ],
          id: 'bright',
          label: 'Bright phrase',
          time: 10,
        },
      ],
      5,
      1,
    );

    expect(patches).toEqual([
      {
        blue: 40,
        functionMode: 0,
        functionSpeed: 0,
        green: 100,
        master: 160,
        red: 225,
        strobe: 0,
        white: 60,
      },
    ]);
  });

  it('keeps accent strobe momentary while dimming continues', () => {
    const cues = [
      {
        fixtures: [
          {
            functionMode: 0,
            green: 100,
            master: 180,
            red: 220,
            strobe: 28,
            white: 90,
          },
        ],
        id: 'accent',
        label: 'Percussion Accent',
        time: 2,
      },
      {
        fixtures: [
          {
            blue: 20,
            functionMode: 0,
            green: 120,
            master: 200,
            red: 240,
            strobe: 0,
            white: 110,
          },
        ],
        id: 'phrase',
        label: 'Phrase',
        time: 6,
      },
    ];

    expect(sceneDimmingPatchesAt(cues, 2.05, 1)[0].strobe).toBe(28);
    expect(sceneDimmingPatchesAt(cues, 2.3, 1)[0].strobe).toBe(0);
    expect(sceneDimmingPatchesAt(cues, 4, 1)[0].white).toBe(100);
  });

  it('clamps loose patches without allowing unknown or non-numeric channels', () => {
    expect(
      normalizePatchLoose({ dimmer: 99, red: 300, strobe: 12.6, white: '255' }),
    ).toEqual({
      red: 255,
      strobe: 13,
    });
  });

  it('handles cue timing helpers used by playback', () => {
    const cues = [
      { fixtures: [], id: 'a', label: 'A', time: 1 },
      { fixtures: [], id: 'b', label: 'B', time: 2 },
      { fixtures: [], id: 'c', label: 'C', time: 3 },
    ];

    expect(findNextCueIndex(1.02, cues)).toBe(0);
    expect(findNextCueIndex(1.04, cues)).toBe(1);
    expect(findNextCueIndex(4, cues)).toBe(3);
    expect(fallbackCueTimes(5.2)).toEqual([0, 2, 4]);
    expect(formatTime(65.25)).toBe('1:05.3');
    expect(roundTime(-3.14)).toBe(0);
    expect(clampSceneFixtureCount('not a number', 9)).toBe(2);
  });
});

function syntheticFolkloricSamples(
  sampleRate: number,
  duration: number,
): Float32Array {
  const samples = new Float32Array(Math.floor(sampleRate * duration));
  const beatInterval = 0.55;

  for (let beatTime = 0; beatTime < duration; beatTime += beatInterval) {
    const phrase = Math.floor(beatTime / 4.4);
    const amplitude = phrase % 3 === 0 ? 0.35 : phrase % 3 === 1 ? 0.72 : 0.95;
    const start = Math.floor(beatTime * sampleRate);
    const width = Math.max(2, Math.floor(sampleRate * 0.03));
    for (
      let index = start;
      index < Math.min(samples.length, start + width);
      index += 1
    ) {
      samples[index] = amplitude * (1 - (index - start) / width);
    }
  }

  return samples;
}
