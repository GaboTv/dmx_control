import { type ChangeEvent, useEffect, useRef, useState } from 'react';

import {
  DEFAULT_SHOW_STATE,
  DMX_CHANNELS,
  FIXTURE_CONFIGS,
  FIXTURE_COUNT,
  FUNCTION_MODES,
  type DmxPatch,
  type DmxSnapshot,
  type FixtureState,
  type ShowState,
  isDirectControlMode,
  modeForValue,
  showStateToDmxFrame,
} from '../shared/dmx';
import {
  type FixturePatches,
  type SceneCue,
  type TrackScene,
  clampSceneFixtureCount,
  createEmptyScene,
  createId,
  findNextCueIndex,
  fixtureToPatch,
  formatTime,
  generateFolkloricSceneFromSamples,
  normalizeFixturePatches,
  normalizeImportedScene,
  normalizePatchLoose,
  roundTime,
  sceneDimmingPatchesAt,
} from './sceneModel';
import { TheaterViewer } from './TheaterViewer';

type ConnectionState = 'connected' | 'connecting' | 'offline';
type ActivePage = 'control' | 'home' | 'music';

const CLIENT_ID_STORAGE_KEY = 'dmx-control-client-id';
const SCENE_DIMMING_INTERVAL_SECONDS = 0.05;
const SCENE_DIMMING_KEYS: Array<keyof FixtureState> = [
  'master',
  'red',
  'green',
  'blue',
  'white',
];

interface UploadedSong {
  duration?: number;
  name: string;
  url: string;
}

const PRESETS: Array<{ fixtures: FixturePatches; label: string }> = [
  {
    label: 'Mirror Red/Blue',
    fixtures: [
      {
        blue: 0,
        functionMode: 0,
        green: 0,
        master: 255,
        red: 255,
        strobe: 0,
        white: 0,
      },
      {
        blue: 255,
        functionMode: 0,
        green: 20,
        master: 255,
        red: 0,
        strobe: 0,
        white: 0,
      },
    ],
  },
  {
    label: 'Warm Front',
    fixtures: [
      {
        blue: 35,
        functionMode: 0,
        green: 130,
        master: 230,
        red: 255,
        strobe: 0,
        white: 180,
      },
      {
        blue: 120,
        functionMode: 0,
        green: 40,
        master: 160,
        red: 40,
        strobe: 0,
        white: 0,
      },
    ],
  },
  {
    label: 'Cool Wash',
    fixtures: [
      {
        blue: 255,
        functionMode: 0,
        green: 110,
        master: 230,
        red: 20,
        strobe: 0,
        white: 80,
      },
      {
        blue: 180,
        functionMode: 0,
        green: 255,
        master: 210,
        red: 0,
        strobe: 0,
        white: 40,
      },
    ],
  },
  {
    label: 'White Hit',
    fixtures: [
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
        blue: 0,
        functionMode: 0,
        green: 0,
        master: 255,
        red: 0,
        strobe: 0,
        white: 255,
      },
    ],
  },
  {
    label: 'Chase Pulse',
    fixtures: [
      { functionMode: 225, functionSpeed: 180, master: 230, strobe: 0 },
      { functionMode: 175, functionSpeed: 120, master: 230, strobe: 0 },
    ],
  },
  {
    label: 'Blackout',
    fixtures: [
      {
        blue: 0,
        functionMode: 0,
        green: 0,
        master: 0,
        red: 0,
        strobe: 0,
        white: 0,
      },
      {
        blue: 0,
        functionMode: 0,
        green: 0,
        master: 0,
        red: 0,
        strobe: 0,
        white: 0,
      },
    ],
  },
];

function createInitialShowState(): ShowState {
  return {
    fixtures: DEFAULT_SHOW_STATE.fixtures.map((fixture) => ({ ...fixture })),
  };
}

function createClientLabel(clientId: string): string {
  return `Browser ${clientId.slice(-4).toUpperCase()}`;
}

function getOrCreateClientId(): string {
  const existing = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const nextId =
    typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, nextId);
  return nextId;
}

export function App() {
  const [clientId] = useState(getOrCreateClientId);
  const [activeCueId, setActiveCueId] = useState<string>();
  const [activePage, setActivePage] = useState<ActivePage>('home');
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [error, setError] = useState<string>();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [scene, setScene] = useState<TrackScene>(() => createEmptyScene());
  const [sceneMessage, setSceneMessage] = useState<string>();
  const [snapshot, setSnapshot] = useState<DmxSnapshot>(() => {
    const state = createInitialShowState();
    return {
      device: {
        connected: false,
        detail: 'Loading backend status.',
        driver: 'mock',
        writes: 0,
      },
      frame: showStateToDmxFrame(state),
      state,
      updatedAt: new Date().toISOString(),
    };
  });
  const [song, setSong] = useState<UploadedSong>();
  const [songFile, setSongFile] = useState<File>();

  const audioRef = useRef<HTMLAudioElement>(null);
  const flushTimer = useRef<number>();
  const lastSceneDimmingAt = useRef<number>();
  const lastSceneDimmingPatches = useRef<FixturePatches>();
  const nextCueIndexRef = useRef(0);
  const pendingPatch = useRef<Array<DmxPatch | undefined>>([]);
  const sceneRef = useRef(scene);
  const sceneTimer = useRef<number>();
  const socketRef = useRef<WebSocket>();
  const songUrlRef = useRef<string>();

  const clientLabel = createClientLabel(clientId);

  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  useEffect(() => {
    let disposed = false;

    async function loadInitialStatus() {
      try {
        const response = await fetch('/api/status');
        if (!response.ok) {
          throw new Error(await response.text());
        }
        const nextSnapshot = (await response.json()) as DmxSnapshot;
        if (!disposed) {
          setSnapshot(nextSnapshot);
          setError(undefined);
        }
      } catch (loadError) {
        if (!disposed) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Could not load DMX status.',
          );
        }
      }
    }

    loadInitialStatus();
    const socket = openStatusSocket(
      clientId,
      (nextSnapshot) => {
        if (!disposed) {
          setSnapshot(nextSnapshot);
          setConnection('connected');
          setError(undefined);
        }
      },
      setConnection,
      setError,
    );
    socketRef.current = socket;

    return () => {
      disposed = true;
      socket.close();
      if (flushTimer.current) {
        window.clearTimeout(flushTimer.current);
      }
      if (sceneTimer.current) {
        window.cancelAnimationFrame(sceneTimer.current);
      }
      if (songUrlRef.current) {
        URL.revokeObjectURL(songUrlRef.current);
      }
    };
  }, [clientId]);

  const activeFixtures = snapshot.state.fixtures.slice(0, scene.fixtureCount);
  const directControl = activeFixtures.every((fixture) =>
    isDirectControlMode(fixture.functionMode),
  );
  const visibleFrame = snapshot.frame.slice(0, scene.fixtureCount * 8);
  const cueCount = scene.cues.length;
  const currentCue = scene.cues.find((cue) => cue.id === activeCueId);
  const controlLock = snapshot.controlLock;
  const ownsControlLock = controlLock?.clientId === clientId;
  const canSendHardwareCommands = !controlLock || ownsControlLock;

  function queueFixturePatch(fixtureIndex: number, patch: DmxPatch) {
    const fixtures: Array<DmxPatch | undefined> = Array.from({
      length: FIXTURE_COUNT,
    });
    fixtures[fixtureIndex] = patch;
    void queueFixturePatches(fixtures);
  }

  async function queueFixturePatches(
    fixtures: Array<DmxPatch | undefined>,
    immediate = false,
  ) {
    if (!(await ensureControlLock())) {
      return;
    }

    const normalizedFixtures = fixtures.map((patch) =>
      patch ? normalizePatchLoose(patch) : undefined,
    );

    setSnapshot((current) => {
      const nextState: ShowState = {
        fixtures: current.state.fixtures.map((fixture, index) => {
          const patch = normalizedFixtures[index];
          return patch
            ? ({ ...fixture, ...patch } as FixtureState)
            : { ...fixture };
        }),
      };

      return {
        ...current,
        frame: showStateToDmxFrame(nextState),
        state: nextState,
        updatedAt: new Date().toISOString(),
      };
    });

    normalizedFixtures.forEach((patch, index) => {
      if (!patch || Object.keys(patch).length === 0) {
        return;
      }
      pendingPatch.current[index] = {
        ...pendingPatch.current[index],
        ...patch,
      };
    });

    if (flushTimer.current) {
      window.clearTimeout(flushTimer.current);
    }

    if (immediate) {
      void flushPatch(true);
      return;
    }

    flushTimer.current = window.setTimeout(() => {
      void flushPatch(false);
    }, 35);
  }

  function applyPreset(preset: { fixtures: FixturePatches; label: string }) {
    void queueFixturePatches(
      normalizeFixturePatches(preset.fixtures, scene.fixtureCount),
    );
  }

  function blackoutActiveLights() {
    const blackout = PRESETS.find((preset) => preset.label === 'Blackout');
    if (blackout) {
      void queueFixturePatches(
        normalizeFixturePatches(blackout.fixtures, scene.fixtureCount),
        true,
      );
    }
  }

  async function flushPatch(immediate: boolean) {
    const fixtures = pendingPatch.current;
    pendingPatch.current = [];

    if (!fixtures.some(Boolean)) {
      return;
    }

    const payload = { fixtures };
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          clientId,
          immediate,
          state: payload,
          type: 'setState',
        }),
      );
      return;
    }

    await postJson(`/api/state${immediate ? '?immediate=true' : ''}`, payload);
  }

  async function postJson(
    path: string,
    body?: unknown,
  ): Promise<DmxSnapshot | undefined> {
    try {
      const response = await fetch(path, {
        body: body ? JSON.stringify(body) : undefined,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          'X-DMX-Client-Id': clientId,
        },
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const nextSnapshot = (await response.json()) as DmxSnapshot;
      setSnapshot(nextSnapshot);
      setError(undefined);
      return nextSnapshot;
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'DMX request failed.',
      );
      return undefined;
    }
  }

  async function acquireControlLock(): Promise<boolean> {
    if (ownsControlLock) {
      return true;
    }

    if (controlLock) {
      const message = `Read-only: DMX control is locked by ${controlLock.label}.`;
      setError(message);
      setSceneMessage(message);
      return false;
    }

    const nextSnapshot = await postJson('/api/control-lock', {
      clientId,
      label: clientLabel,
    });
    return nextSnapshot?.controlLock?.clientId === clientId;
  }

  async function ensureControlLock(): Promise<boolean> {
    if (ownsControlLock) {
      return true;
    }

    return acquireControlLock();
  }

  async function releaseControlLock(): Promise<void> {
    if (!ownsControlLock) {
      return;
    }

    await postJson('/api/control-lock/release', { clientId });
  }

  async function sendSocketAction(type: 'blackout' | 'reconnect') {
    if (!(await ensureControlLock())) {
      return;
    }

    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ clientId, type }));
      return;
    }

    const path =
      type === 'blackout' ? '/api/blackout' : '/api/device/reconnect';
    void postJson(path);
  }

  function handleSongUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (songUrlRef.current) {
      URL.revokeObjectURL(songUrlRef.current);
    }

    const url = URL.createObjectURL(file);
    songUrlRef.current = url;
    setSong({ name: file.name, url });
    setSongFile(file);
    setScene((current) => ({
      ...current,
      duration: 0,
      name: current.cues.length ? current.name : `${file.name} show`,
      songName: file.name,
    }));
    setSceneMessage(
      `Loaded ${file.name}. Choose the scene light count, then import or generate cues.`,
    );
  }

  function handleSceneFixtureCountChange(
    event: ChangeEvent<HTMLSelectElement>,
  ) {
    const fixtureCount = clampSceneFixtureCount(Number(event.target.value));
    setScene((current) => ({
      ...current,
      cues: current.cues.map((cue) => ({
        ...cue,
        fixtures: normalizeFixturePatches(cue.fixtures, fixtureCount),
      })),
      fixtureCount,
    }));
    setSceneMessage(
      `Show now targets ${fixtureCount} ${fixtureCount === 1 ? 'light' : 'lights'}. Existing cues were adjusted.`,
    );
  }

  function createNewScene() {
    setScene(
      createEmptyScene(scene.fixtureCount, song?.name, song?.duration ?? 0),
    );
    setActiveCueId(undefined);
    setSceneMessage(`Started a new ${scene.fixtureCount}-light scene.`);
  }

  async function processSong() {
    if (!songFile) {
      setSceneMessage('Upload a song before processing a scene.');
      return;
    }

    setIsProcessing(true);
    setSceneMessage(
      `Analyzing folkloric rhythm and building ${scene.fixtureCount}-light cues...`,
    );
    try {
      const generated = await generateSceneFromAudio(
        songFile,
        scene.fixtureCount,
      );
      setScene(generated);
      setActiveCueId(undefined);
      setSceneMessage(
        `Generated ${generated.cues.length} cues for ${generated.fixtureCount} ${generated.fixtureCount === 1 ? 'light' : 'lights'}.`,
      );
    } catch (processError) {
      setSceneMessage(
        processError instanceof Error
          ? processError.message
          : 'Could not process the uploaded song.',
      );
    } finally {
      setIsProcessing(false);
    }
  }

  async function importScene(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const imported = normalizeImportedScene(JSON.parse(await file.text()));
      setScene(imported);
      setActiveCueId(undefined);
      setSceneMessage(
        `Imported ${imported.cues.length} cues for ${imported.fixtureCount} ${imported.fixtureCount === 1 ? 'light' : 'lights'} from ${file.name}.`,
      );
    } catch (importError) {
      setSceneMessage(
        importError instanceof Error
          ? importError.message
          : 'Could not import scene JSON.',
      );
    } finally {
      event.target.value = '';
    }
  }

  function exportScene() {
    const blob = new Blob([JSON.stringify(scene, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${scene.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-scene.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function addManualCue() {
    const time = roundTime(audioRef.current?.currentTime ?? 0);
    const cue: SceneCue = {
      fixtures: snapshot.state.fixtures
        .slice(0, scene.fixtureCount)
        .map(fixtureToPatch),
      id: createId(),
      label: `Manual ${formatTime(time)}`,
      time,
    };

    setScene((current) => ({
      ...current,
      cues: [...current.cues, cue].sort(
        (left, right) => left.time - right.time,
      ),
    }));
    setActiveCueId(cue.id);
    setSceneMessage(
      `Captured ${scene.fixtureCount} ${scene.fixtureCount === 1 ? 'light' : 'lights'} at ${formatTime(time)}.`,
    );
  }

  function deleteCue(cueId: string) {
    setScene((current) => ({
      ...current,
      cues: current.cues.filter((cue) => cue.id !== cueId),
    }));
    setActiveCueId((current) => (current === cueId ? undefined : current));
  }

  function applyCue(cue: SceneCue, seekAudio = false) {
    if (seekAudio && audioRef.current) {
      audioRef.current.currentTime = cue.time;
      nextCueIndexRef.current = findNextCueIndex(
        cue.time,
        sceneRef.current.cues,
      );
    }

    setActiveCueId(cue.id);
    void queueFixturePatches(cue.fixtures, true);
  }

  async function playScene() {
    if (!audioRef.current || !song) {
      setSceneMessage('Upload a song before playback.');
      return;
    }

    if (!(await ensureControlLock())) {
      return;
    }

    nextCueIndexRef.current = findNextCueIndex(
      audioRef.current.currentTime,
      sceneRef.current.cues,
    );
    await audioRef.current.play();
  }

  async function handleAudioPlay() {
    if (!(await ensureControlLock())) {
      audioRef.current?.pause();
      return;
    }

    startSceneClock();
  }

  function pauseScene() {
    audioRef.current?.pause();
    stopSceneClock();
  }

  function stopScene() {
    pauseScene();
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
    nextCueIndexRef.current = 0;
    setActiveCueId(undefined);
  }

  function startSceneClock() {
    stopSceneClock(false);
    setIsPlaying(true);

    const tick = () => {
      const audio = audioRef.current;
      if (!audio || audio.paused || audio.ended) {
        stopSceneClock();
        return;
      }

      const cues = sceneRef.current.cues;
      while (
        nextCueIndexRef.current < cues.length &&
        cues[nextCueIndexRef.current].time <= audio.currentTime + 0.045
      ) {
        setActiveCueId(cues[nextCueIndexRef.current].id);
        nextCueIndexRef.current += 1;
      }

      if (
        cues.length &&
        (lastSceneDimmingAt.current === undefined ||
          audio.currentTime - lastSceneDimmingAt.current >=
            SCENE_DIMMING_INTERVAL_SECONDS)
      ) {
        const dimmingPatches = sceneDimmingPatchesAt(
          cues,
          audio.currentTime,
          sceneRef.current.fixtureCount,
        );
        if (
          shouldSendSceneDimming(
            dimmingPatches,
            lastSceneDimmingPatches.current,
          )
        ) {
          void queueFixturePatches(dimmingPatches, true);
          lastSceneDimmingPatches.current = dimmingPatches;
        }
        lastSceneDimmingAt.current = audio.currentTime;
      }

      sceneTimer.current = window.requestAnimationFrame(tick);
    };

    sceneTimer.current = window.requestAnimationFrame(tick);
  }

  function stopSceneClock(updateState = true) {
    if (sceneTimer.current) {
      window.cancelAnimationFrame(sceneTimer.current);
      sceneTimer.current = undefined;
    }
    if (updateState) {
      setIsPlaying(false);
      if (activePage === 'music') {
        void releaseControlLock();
      }
    }
    lastSceneDimmingAt.current = undefined;
    lastSceneDimmingPatches.current = undefined;
  }

  function shouldSendSceneDimming(
    next: FixturePatches,
    previous?: FixturePatches,
  ) {
    if (!next.length || !previous) {
      return next.length > 0;
    }

    return next.some((patch, fixtureIndex) => {
      const previousPatch = previous[fixtureIndex] ?? {};

      for (const key of SCENE_DIMMING_KEYS) {
        if ((patch[key] ?? 0) !== (previousPatch[key] ?? 0)) {
          return true;
        }
      }

      return (
        patch.functionMode !== previousPatch.functionMode ||
        patch.functionSpeed !== previousPatch.functionSpeed ||
        patch.strobe !== previousPatch.strobe
      );
    });
  }

  function openPage(page: Exclude<ActivePage, 'home'>) {
    setActivePage(page);
    setSceneMessage(undefined);
  }

  function returnHome() {
    if (isPlaying) {
      setSceneMessage('Pause Music Sync before leaving this page.');
      return;
    }

    void releaseControlLock();
    setActivePage('home');
  }

  return (
    <main className="appShell">
      <section className="heroPanel">
        <div>
          <p className="eyebrow">uDMX dance show controller</p>
          <h1>Two-Light Scene Studio</h1>
          <p className="heroCopy">
            Control two 8-channel fixtures, upload a track, generate or
            hand-build cues, then play the song and lighting scene together.
          </p>
        </div>
        <DeviceCard
          connection={connection}
          disabled={!canSendHardwareCommands}
          onReconnect={() => void sendSocketAction('reconnect')}
          snapshot={snapshot}
        />
      </section>

      {error ? <div className="errorBanner">{error}</div> : null}
      <ControlLockBanner
        canSendHardwareCommands={canSendHardwareCommands}
        clientLabel={clientLabel}
        disabled={isPlaying}
        lock={controlLock}
        onAcquire={() => void acquireControlLock()}
        onRelease={() => void releaseControlLock()}
        ownsLock={ownsControlLock}
      />
      {activePage !== 'home' && !directControl ? (
        <div className="modeBanner">
          One or more selected lights are using a CH7 macro mode. RGBW sliders
          only have full manual control when CH7 is in{' '}
          <strong>DMX 8CH Control</strong>.
        </div>
      ) : null}

      {activePage === 'home' ? (
        <section className="homeChoice">
          <div className="homeIntro">
            <p className="eyebrow">Choose control mode</p>
            <h2>What do you want to run?</h2>
            <p>
              Pick one workflow before touching fixtures. Music Sync stays
              isolated while playback is running, so manual light controls
              cannot be opened by accident.
            </p>
          </div>
          <div className="homeCards">
            <button
              className="homeCard"
              onClick={() => openPage('control')}
              type="button"
            >
              <span>Control Light</span>
              <strong>Manual Light Control</strong>
              <small>
                Control Light A/B, 3D scene, fast looks, and DMX output.
              </small>
            </button>
            <button
              className="homeCard"
              onClick={() => openPage('music')}
              type="button"
            >
              <span>Music Sync</span>
              <strong>Music-Synced Show</strong>
              <small>
                Upload a track, build the timeline, and monitor the 3D theater
                viewer.
              </small>
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="pageHeader">
            <button
              className="secondaryButton"
              disabled={isPlaying}
              onClick={returnHome}
              type="button"
            >
              Back to mode selection
            </button>
            <div>
              <p className="eyebrow">
                {activePage === 'control' ? 'Manual control' : 'Music sync'}
              </p>
              <h2>
                {activePage === 'control'
                  ? 'Control Light A/B'
                  : 'Music Sync Page'}
              </h2>
              {isPlaying ? (
                <small>Pause Music Sync before leaving this page.</small>
              ) : null}
            </div>
          </section>

          <section className="scopePanel">
            <div className="lightScope">
              <label>
                <span>Lights enabled</span>
                <select
                  onChange={handleSceneFixtureCountChange}
                  value={scene.fixtureCount}
                >
                  {FIXTURE_CONFIGS.map((fixture, index) => (
                    <option key={fixture.id} value={index + 1}>
                      {index + 1} {index === 0 ? 'light' : 'lights'}
                    </option>
                  ))}
                </select>
                <small>
                  All controls, presets, cues, and previews target A001, then
                  A009.
                </small>
              </label>
              {activePage === 'music' ? (
                <button
                  className="blackoutButton scopeBlackout"
                  disabled={!canSendHardwareCommands}
                  onClick={blackoutActiveLights}
                  type="button"
                >
                  Turn Off Lights
                </button>
              ) : null}
            </div>
          </section>

          {activePage === 'control' ? (
            <>
              <section
                className="fixtureGrid"
                aria-label="Control selected lights"
              >
                {activeFixtures.map((fixture, index) => (
                  <FixtureControl
                    fixture={fixture}
                    fixtureIndex={index}
                    key={FIXTURE_CONFIGS[index]?.id ?? index}
                    onPatch={(patch) => queueFixturePatch(index, patch)}
                    disabled={!canSendHardwareCommands}
                  />
                ))}
              </section>

              <section className="viewerSection">
                <div className="panel viewerPanel">
                  <TheaterViewer fixtures={activeFixtures} />
                </div>
              </section>

              <section className="dashboardGrid">
                <div className="panel actionsPanel">
                  <PanelHeader
                    kicker="Fast looks"
                    title={
                      scene.fixtureCount === 1
                        ? 'One-Light Presets'
                        : 'Two-Light Presets'
                    }
                  />
                  <div className="presetGrid">
                    {PRESETS.map((preset) => (
                      <button
                        disabled={!canSendHardwareCommands}
                        key={preset.label}
                        onClick={() => applyPreset(preset)}
                        type="button"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="dangerZone">
                    <button
                      className="blackoutButton"
                      disabled={!canSendHardwareCommands}
                      onClick={blackoutActiveLights}
                      type="button"
                    >
                      Blackout Selected
                    </button>
                  </div>
                </div>

                <div className="panel framePanel">
                  <PanelHeader
                    kicker="DMX output"
                    title={`${visibleFrame.length}-Channel Frame`}
                  />
                  <div className="frameReadout">
                    {visibleFrame.map((value, index) => (
                      <div key={index}>
                        <span>CH{index + 1}</span>
                        <strong>{value}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </>
          ) : (
            <>
              <section className="showGrid">
                <div className="panel timelinePanel">
                  <PanelHeader kicker="Music sync" title="Track + Scene" />
                  <div className="uploadGrid">
                    <label className="fileDrop">
                      <span>Upload song</span>
                      <input
                        accept="audio/*"
                        onChange={handleSongUpload}
                        type="file"
                      />
                    </label>
                    <label className="fileDrop">
                      <span>Import scene JSON</span>
                      <input
                        accept="application/json,.json"
                        onChange={importScene}
                        type="file"
                      />
                    </label>
                  </div>

                  <div className="sceneSetup">
                    <div>
                      <span>Scene target</span>
                      <small>
                        Cues target {scene.fixtureCount}{' '}
                        {scene.fixtureCount === 1 ? 'light' : 'lights'}: A001
                        {scene.fixtureCount > 1 ? ', then A009' : ''}.
                      </small>
                    </div>
                    <button onClick={createNewScene} type="button">
                      New Empty Scene
                    </button>
                  </div>

                  {song ? (
                    <audio
                      className="audioPlayer"
                      controls
                      onEnded={() => stopSceneClock()}
                      onLoadedMetadata={(event) => {
                        const duration = roundTime(
                          event.currentTarget.duration,
                        );
                        setSong((current) =>
                          current ? { ...current, duration } : current,
                        );
                        setScene((current) => ({ ...current, duration }));
                      }}
                      onPause={() => stopSceneClock()}
                      onPlay={() => void handleAudioPlay()}
                      onSeeked={() => {
                        const time = audioRef.current?.currentTime ?? 0;
                        nextCueIndexRef.current = findNextCueIndex(
                          time,
                          sceneRef.current.cues,
                        );
                      }}
                      ref={audioRef}
                      src={song.url}
                    />
                  ) : (
                    <div className="emptyAudio">
                      Upload an audio file to enable synchronized playback.
                    </div>
                  )}

                  <div className="sceneActions">
                    <button
                      disabled={!songFile || isProcessing}
                      onClick={() => void processSong()}
                      type="button"
                    >
                      {isProcessing
                        ? 'Processing...'
                        : 'Generate Folkloric Scene'}
                    </button>
                    <button
                      disabled={!cueCount || !canSendHardwareCommands}
                      onClick={() => applyCue(scene.cues[0])}
                      type="button"
                    >
                      Preview Scene Start
                    </button>
                    <button
                      disabled={!song || !canSendHardwareCommands}
                      onClick={() => void playScene()}
                      type="button"
                    >
                      {isPlaying ? 'Playing Scene' : 'Play Scene'}
                    </button>
                    <button disabled={!song} onClick={pauseScene} type="button">
                      Pause
                    </button>
                    <button disabled={!song} onClick={stopScene} type="button">
                      Stop
                    </button>
                    <button onClick={addManualCue} type="button">
                      Add Manual Cue
                    </button>
                    <button
                      disabled={!cueCount}
                      onClick={exportScene}
                      type="button"
                    >
                      Export Scene
                    </button>
                  </div>

                  <div className="sceneStats">
                    <div>
                      <span>Scene</span>
                      <strong>{scene.name}</strong>
                    </div>
                    <div>
                      <span>Cues</span>
                      <strong>{cueCount}</strong>
                    </div>
                    <div>
                      <span>Lights</span>
                      <strong>{scene.fixtureCount}</strong>
                    </div>
                    <div>
                      <span>Track</span>
                      <strong>
                        {song?.duration
                          ? formatTime(song.duration)
                          : formatTime(scene.duration)}
                      </strong>
                    </div>
                    <div>
                      <span>Active</span>
                      <strong>{currentCue ? currentCue.label : 'None'}</strong>
                    </div>
                  </div>
                  {sceneMessage ? (
                    <p className="sceneMessage">{sceneMessage}</p>
                  ) : null}
                </div>

                <div className="panel cuePanel">
                  <PanelHeader kicker="Timeline" title="Scene Cues" />
                  <div className="cueList">
                    {scene.cues.length ? (
                      scene.cues.map((cue) => (
                        <div
                          className={
                            cue.id === activeCueId ? 'cueRow active' : 'cueRow'
                          }
                          key={cue.id}
                        >
                          <button
                            disabled={!canSendHardwareCommands}
                            onClick={() => applyCue(cue, true)}
                            type="button"
                          >
                            <strong>{formatTime(cue.time)}</strong>
                            <span>
                              {cue.label} · {cue.fixtures.length}{' '}
                              {cue.fixtures.length === 1 ? 'light' : 'lights'}
                            </span>
                          </button>
                          <button
                            className="deleteCue"
                            onClick={() => deleteCue(cue.id)}
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="emptyAudio">
                        No cues yet. Generate from the song or capture manual
                        cues.
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <section className="viewerSection">
                <div className="panel viewerPanel">
                  <TheaterViewer fixtures={activeFixtures} />
                </div>
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}

function FixtureControl({
  disabled,
  fixture,
  fixtureIndex,
  onPatch,
}: {
  disabled: boolean;
  fixture: FixtureState;
  fixtureIndex: number;
  onPatch: (patch: DmxPatch) => void;
}) {
  const config = FIXTURE_CONFIGS[fixtureIndex];
  const activeMode = modeForValue(fixture.functionMode);
  const colorPreview = `rgb(${fixture.red}, ${fixture.green}, ${fixture.blue})`;
  const whiteAmount = Math.round((fixture.white / 255) * 100);

  return (
    <div className="panel fixturePanel">
      <div className="fixtureHeader">
        <PanelHeader
          kicker={`Address A${String(config.startAddress).padStart(3, '0')}`}
          title={config.label}
        />
        <div
          className="miniPreview"
          style={{
            background: `linear-gradient(135deg, ${colorPreview}, rgba(255,255,255,${fixture.white / 255}))`,
            opacity: Math.max(0.25, fixture.master / 255),
          }}
        >
          {whiteAmount}% W
        </div>
      </div>

      <div className="fixtureSliders">
        <Slider
          disabled={disabled}
          channelKey="master"
          fixtureIndex={fixtureIndex}
          onChange={onPatch}
          state={fixture}
        />
        <Slider
          disabled={disabled}
          channelKey="red"
          fixtureIndex={fixtureIndex}
          onChange={onPatch}
          state={fixture}
          tone="red"
        />
        <Slider
          disabled={disabled}
          channelKey="green"
          fixtureIndex={fixtureIndex}
          onChange={onPatch}
          state={fixture}
          tone="green"
        />
        <Slider
          disabled={disabled}
          channelKey="blue"
          fixtureIndex={fixtureIndex}
          onChange={onPatch}
          state={fixture}
          tone="blue"
        />
        <Slider
          disabled={disabled}
          channelKey="white"
          fixtureIndex={fixtureIndex}
          onChange={onPatch}
          state={fixture}
          tone="white"
        />
        <Slider
          disabled={disabled}
          channelKey="strobe"
          fixtureIndex={fixtureIndex}
          onChange={onPatch}
          state={fixture}
          tone="amber"
        />
      </div>

      <div className="modeList compact">
        {FUNCTION_MODES.map((mode) => (
          <button
            className={
              activeMode.id === mode.id ? 'modeButton active' : 'modeButton'
            }
            disabled={disabled}
            key={mode.id}
            onClick={() => onPatch({ functionMode: mode.value })}
            type="button"
          >
            <span>{mode.label}</span>
            <small>
              CH{config.startAddress + 6} {mode.min}-{mode.max}
            </small>
          </button>
        ))}
      </div>
      <Slider
        channelKey="functionSpeed"
        disabled={disabled}
        fixtureIndex={fixtureIndex}
        onChange={onPatch}
        state={fixture}
        tone="violet"
      />
    </div>
  );
}

function DeviceCard({
  connection,
  disabled,
  onReconnect,
  snapshot,
}: {
  connection: ConnectionState;
  disabled: boolean;
  onReconnect: () => void;
  snapshot: DmxSnapshot;
}) {
  const status = snapshot.device;
  const online = status.connected && connection === 'connected';
  return (
    <aside className="deviceCard">
      <div className={online ? 'statusDot online' : 'statusDot'} />
      <div className="deviceInfo">
        <p className="deviceTitle">
          {status.driver === 'udmx' ? 'uDMX hardware' : 'Mock output'}
        </p>
        <p>{status.detail}</p>
        {status.lastError ? (
          <p className="deviceError">{status.lastError}</p>
        ) : null}
        <small>
          {status.vendorId && status.productId
            ? `${status.vendorId}:${status.productId} · `
            : ''}
          {status.writeMode ? `${status.writeMode} mode · ` : ''}
          {connection} · {status.writes} writes
          {status.failures ? ` · ${status.failures} failures` : ''}
        </small>
        <button
          className="secondaryButton deviceReconnect"
          disabled={disabled}
          onClick={onReconnect}
          type="button"
        >
          Reconnect uDMX
        </button>
      </div>
    </aside>
  );
}

function ControlLockBanner({
  canSendHardwareCommands,
  clientLabel,
  disabled,
  lock,
  onAcquire,
  onRelease,
  ownsLock,
}: {
  canSendHardwareCommands: boolean;
  clientLabel: string;
  disabled: boolean;
  lock: DmxSnapshot['controlLock'];
  onAcquire: () => void;
  onRelease: () => void;
  ownsLock: boolean;
}) {
  const className = ownsLock
    ? 'lockBanner owned'
    : canSendHardwareCommands
      ? 'lockBanner'
      : 'lockBanner blocked';
  const title = ownsLock
    ? 'Hardware control active'
    : lock
      ? 'Read-only browser'
      : 'Hardware control available';
  const detail = ownsLock
    ? `${clientLabel} owns DMX commands from this browser.`
    : lock
      ? `${lock.label} is controlling the lights. This browser can watch but cannot send DMX commands.`
      : 'Take control before running lights from this browser.';

  return (
    <section className={className}>
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      {ownsLock ? (
        <button
          className="secondaryButton"
          disabled={disabled}
          onClick={onRelease}
          type="button"
        >
          Release Control
        </button>
      ) : !lock ? (
        <button className="secondaryButton" onClick={onAcquire} type="button">
          Take Control
        </button>
      ) : null}
    </section>
  );
}

function PanelHeader({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="panelHeader">
      <p>{kicker}</p>
      <h2>{title}</h2>
    </div>
  );
}

function Slider({
  channelKey,
  disabled,
  fixtureIndex,
  onChange,
  state,
  tone = 'neutral',
}: {
  channelKey: keyof FixtureState;
  disabled: boolean;
  fixtureIndex: number;
  onChange: (patch: DmxPatch) => void;
  state: FixtureState;
  tone?: 'amber' | 'blue' | 'green' | 'neutral' | 'red' | 'violet' | 'white';
}) {
  const channel = DMX_CHANNELS.find((item) => item.key === channelKey);
  const value = state[channelKey];
  const fixture = FIXTURE_CONFIGS[fixtureIndex];

  if (!channel || !fixture) {
    return null;
  }

  return (
    <label className={`sliderRow tone-${tone}`}>
      <span>
        <strong>{channel.shortLabel}</strong>
        <small>CH{fixture.startAddress + channel.channel - 1}</small>
      </span>
      <input
        max="255"
        min="0"
        disabled={disabled}
        onChange={(event) =>
          onChange({ [channelKey]: Number(event.target.value) })
        }
        type="range"
        value={value}
      />
      <output>{value}</output>
    </label>
  );
}

function openStatusSocket(
  clientId: string,
  onSnapshot: (snapshot: DmxSnapshot) => void,
  setConnection: (state: ConnectionState) => void,
  setError: (message: string | undefined) => void,
): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(
    `${protocol}//${window.location.host}/ws?clientId=${encodeURIComponent(clientId)}`,
  );

  setConnection('connecting');

  socket.addEventListener('open', () => {
    setConnection('connected');
  });

  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data as string) as
      | { snapshot: DmxSnapshot; type: 'snapshot' }
      | { error: string; type: 'error' };

    if (payload.type === 'snapshot') {
      onSnapshot(payload.snapshot);
      return;
    }

    setError(payload.error);
  });

  socket.addEventListener('close', () => {
    setConnection('offline');
  });

  socket.addEventListener('error', () => {
    setConnection('offline');
    setError(
      'Live connection to the DMX backend failed. REST fallback remains available.',
    );
  });

  return socket;
}

async function generateSceneFromAudio(
  file: File,
  fixtureCount: number,
): Promise<TrackScene> {
  const audioContext = new AudioContext();
  try {
    const buffer = await audioContext.decodeAudioData(await file.arrayBuffer());
    return generateFolkloricSceneFromSamples({
      duration: buffer.duration,
      fixtureCount,
      sampleRate: buffer.sampleRate,
      samples: mixDown(buffer),
      songName: file.name,
    });
  } finally {
    await audioContext.close();
  }
}

function mixDown(buffer: AudioBuffer): Float32Array {
  const output = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      output[index] += data[index] / buffer.numberOfChannels;
    }
  }
  return output;
}
