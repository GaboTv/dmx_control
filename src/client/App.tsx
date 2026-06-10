import {
  type CSSProperties,
  type ChangeEvent,
  type SyntheticEvent,
  useEffect,
  useRef,
  useState,
} from 'react';

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
  normalizeDmxPatch,
  showStateToDmxFrame,
} from '../shared/dmx';
import {
  type FixturePatches,
  type SceneCue,
  type TrackScene,
  clampSceneFixtureCount,
  createAutoCue,
  createEmptyScene,
  createId,
  findNextCueIndex,
  fixtureToPatch,
  formatTime,
  type EnergyFrame,
  SCENE_GENERATION_METHODS,
  type SceneGenerationMethod,
  generateSignalSceneFromEnergyFrames,
  normalizeFixturePatches,
  normalizeImportedScene,
  normalizePatchLoose,
  roundTime,
  sceneDimmingPatchesAt,
} from './sceneModel';
import { TheaterViewer } from './TheaterViewer';

type ConnectionState = 'connected' | 'connecting' | 'offline';
type ActivePage = 'control' | 'home' | 'music' | 'player';
type StatusSocketPayload =
  | { snapshot: DmxSnapshot; type: 'snapshot' }
  | { error: string; type: 'error' };

const CLIENT_ID_STORAGE_KEY = 'dmx-control-client-id';
const PLAYER_SLOT_COUNT = 20;
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

interface PlayerSlot {
  scene?: TrackScene;
  song?: UploadedSong;
  songFile?: File;
}

interface GeneratedSceneResult {
  scene: TrackScene;
  warning?: string;
}

interface DirectColorOption {
  label: string;
  patch: Required<
    Pick<FixtureState, 'blue' | 'green' | 'master' | 'red' | 'white'>
  >;
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

const DIRECT_COLORS: DirectColorOption[] = [
  {
    label: 'Red',
    patch: { blue: 0, green: 0, master: 255, red: 255, white: 0 },
  },
  {
    label: 'Orange',
    patch: { blue: 0, green: 90, master: 255, red: 255, white: 0 },
  },
  {
    label: 'Amber',
    patch: { blue: 0, green: 145, master: 255, red: 255, white: 18 },
  },
  {
    label: 'Green',
    patch: { blue: 0, green: 255, master: 255, red: 0, white: 0 },
  },
  {
    label: 'Lime',
    patch: { blue: 0, green: 255, master: 255, red: 115, white: 0 },
  },
  {
    label: 'Blue',
    patch: { blue: 255, green: 0, master: 255, red: 0, white: 0 },
  },
  {
    label: 'Deep Blue',
    patch: { blue: 255, green: 0, master: 230, red: 20, white: 0 },
  },
  {
    label: 'Sky',
    patch: { blue: 255, green: 130, master: 245, red: 0, white: 12 },
  },
  {
    label: 'Yellow',
    patch: { blue: 0, green: 210, master: 255, red: 255, white: 0 },
  },
  {
    label: 'Cyan',
    patch: { blue: 255, green: 210, master: 255, red: 0, white: 0 },
  },
  {
    label: 'Turquoise',
    patch: { blue: 190, green: 255, master: 245, red: 0, white: 20 },
  },
  {
    label: 'Magenta',
    patch: { blue: 230, green: 0, master: 255, red: 255, white: 0 },
  },
  {
    label: 'Purple',
    patch: { blue: 255, green: 0, master: 245, red: 120, white: 0 },
  },
  {
    label: 'Pink',
    patch: { blue: 120, green: 20, master: 255, red: 255, white: 35 },
  },
  {
    label: 'White',
    patch: { blue: 0, green: 0, master: 255, red: 0, white: 255 },
  },
  {
    label: 'Soft White',
    patch: { blue: 30, green: 60, master: 220, red: 80, white: 190 },
  },
  {
    label: 'Warm',
    patch: { blue: 25, green: 120, master: 230, red: 255, white: 120 },
  },
  {
    label: 'Candle',
    patch: { blue: 0, green: 75, master: 190, red: 255, white: 80 },
  },
  {
    label: 'Rose Gold',
    patch: { blue: 60, green: 85, master: 220, red: 255, white: 95 },
  },
  {
    label: 'Ice',
    patch: { blue: 255, green: 155, master: 230, red: 30, white: 140 },
  },
  {
    label: 'Blackout',
    patch: { blue: 0, green: 0, master: 0, red: 0, white: 0 },
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

function createPlayerSlots(): PlayerSlot[] {
  return Array.from({ length: PLAYER_SLOT_COUNT }, () => ({}));
}

function getOrCreateClientId(): string {
  try {
    const existing = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (existing) {
      return existing;
    }
  } catch {
    // Storage can be unavailable in private modes or locked-down browsers.
  }

  const nextId =
    typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  try {
    window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, nextId);
  } catch {
    // Keep ephemeral ID for this page session if persistence fails.
  }
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
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [playerSlots, setPlayerSlots] =
    useState<PlayerSlot[]>(createPlayerSlots);
  const [processingProgress, setProcessingProgress] = useState<number>();
  const [sceneGenerationMethod, setSceneGenerationMethod] =
    useState<SceneGenerationMethod>('section-phrases');
  const [scene, setScene] = useState<TrackScene>(() => createEmptyScene());
  const [sceneMessage, setSceneMessage] = useState<string>();
  const [selectedPlayerSlot, setSelectedPlayerSlot] = useState(0);
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
  const playerSongUrls = useRef<Array<string | undefined>>([]);
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
      for (const url of playerSongUrls.current) {
        if (url) {
          URL.revokeObjectURL(url);
        }
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
  const currentPlayerSlot = playerSlots[selectedPlayerSlot];
  const cueDebugJson = currentCue ? JSON.stringify(currentCue, null, 2) : '';
  const ownsControlLock = controlLock?.clientId === clientId;
  const canSendHardwareCommands = !controlLock || ownsControlLock;
  const hardwareControlReady = ownsControlLock;
  const canReconnectHardware = !controlLock || ownsControlLock;

  function queueFixturePatch(fixtureIndex: number, patch: DmxPatch) {
    const fixtures: Array<DmxPatch | undefined> = Array.from({
      length: FIXTURE_COUNT,
    });
    fixtures[fixtureIndex] = patch;
    void queueFixturePatches(fixtures);
  }

  function queueActiveFixturePatch(patch: DmxPatch) {
    void queueFixturePatches(
      Array.from({ length: scene.fixtureCount }, () => patch),
    );
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
        throw new Error(await responseErrorMessage(response));
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

  async function responseErrorMessage(response: Response): Promise<string> {
    try {
      const payload = (await response.json()) as { error?: unknown };
      if (typeof payload.error === 'string') {
        return payload.error;
      }
    } catch {
      // Fall back to status text below if the backend did not return JSON.
    }

    return response.statusText || `Request failed with ${response.status}.`;
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

    const message = controlLock
      ? `Read-only: DMX control is locked by ${controlLock.label}.`
      : 'Take Control before sending DMX commands from this browser.';
    setError(message);
    setSceneMessage(message);
    return false;
  }

  async function releaseControlLock(): Promise<void> {
    if (!ownsControlLock) {
      return;
    }

    await postJson('/api/control-lock/release', { clientId });
  }

  async function reconnectDmxDevice(): Promise<void> {
    if (isReconnecting) {
      return;
    }

    if (!ownsControlLock && !(await acquireControlLock())) {
      return;
    }

    setIsReconnecting(true);
    setSceneMessage('Scanning for uDMX adapter...');

    try {
      const nextSnapshot = await postJson('/api/device/reconnect');
      if (!nextSnapshot) {
        return;
      }

      const message =
        nextSnapshot.device.driver === 'udmx' && nextSnapshot.device.connected
          ? 'uDMX connected and receiving frames.'
          : 'uDMX not found yet. Running in mock mode and continuing to auto-scan.';
      setSceneMessage(message);
    } finally {
      setIsReconnecting(false);
    }
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

  function clearScene() {
    setScene((current) => ({
      ...current,
      cues: [],
    }));
    setActiveCueId(undefined);
    nextCueIndexRef.current = 0;
    setSceneMessage('Cleared all cues from the current scene.');
  }

  async function processSong() {
    if (!songFile) {
      setSceneMessage('Upload a song before processing a scene.');
      return;
    }

    setIsProcessing(true);
    setProcessingProgress(0);
    const methodLabel =
      SCENE_GENERATION_METHODS.find(
        (method) => method.id === sceneGenerationMethod,
      )?.label ?? 'selected method';
    setSceneMessage(
      `Analyzing ${methodLabel.toLowerCase()} and building ${scene.fixtureCount}-light cues...`,
    );
    try {
      const generated = await generateSceneFromAudio(
        songFile,
        scene.fixtureCount,
        sceneGenerationMethod,
        setProcessingProgress,
        song?.duration ?? scene.duration,
      );
      setProcessingProgress(100);
      setScene(generated.scene);
      setActiveCueId(undefined);
      setSceneMessage(
        generated.warning ??
          `Generated ${generated.scene.cues.length} ${methodLabel.toLowerCase()} cues for ${generated.scene.fixtureCount} ${generated.scene.fixtureCount === 1 ? 'light' : 'lights'}.`,
      );
    } catch (processError) {
      setSceneMessage(
        processError instanceof Error
          ? processError.message
          : 'Could not process the uploaded song.',
      );
    } finally {
      setIsProcessing(false);
      window.setTimeout(() => setProcessingProgress(undefined), 350);
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

  function handlePlayerSongUpload(
    slotIndex: number,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (playerSongUrls.current[slotIndex]) {
      URL.revokeObjectURL(playerSongUrls.current[slotIndex]);
    }

    const url = URL.createObjectURL(file);
    const nextSong = { name: file.name, url };
    const slotScene = playerSlots[slotIndex]?.scene;
    playerSongUrls.current[slotIndex] = url;
    setPlayerSlots((current) =>
      current.map((slot, index) =>
        index === slotIndex
          ? { ...slot, song: nextSong, songFile: file }
          : slot,
      ),
    );
    setSelectedPlayerSlot(slotIndex);
    setSong(nextSong);
    setSongFile(file);
    setScene(slotScene ?? createEmptyScene(scene.fixtureCount, file.name, 0));
    setActiveCueId(undefined);
    nextCueIndexRef.current = 0;
    setSceneMessage(`Loaded ${file.name} into player row ${slotIndex + 1}.`);
    event.target.value = '';
  }

  async function handlePlayerSceneUpload(
    slotIndex: number,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const imported = normalizeImportedScene(JSON.parse(await file.text()));
      setPlayerSlots((current) =>
        current.map((slot, index) =>
          index === slotIndex ? { ...slot, scene: imported } : slot,
        ),
      );
      setSelectedPlayerSlot(slotIndex);
      setScene(imported);
      if (playerSlots[slotIndex]?.song) {
        setSong(playerSlots[slotIndex].song);
        setSongFile(playerSlots[slotIndex].songFile);
      }
      setActiveCueId(undefined);
      nextCueIndexRef.current = 0;
      setSceneMessage(
        `Loaded ${imported.name} into player row ${slotIndex + 1}.`,
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

  function loadPlayerSlot(slotIndex: number) {
    const slot = playerSlots[slotIndex];
    if (!slot.song && !slot.scene) {
      setSceneMessage(`Player row ${slotIndex + 1} is empty.`);
      return;
    }

    setSelectedPlayerSlot(slotIndex);
    if (slot.song) {
      setSong(slot.song);
      setSongFile(slot.songFile);
    }
    if (slot.scene) {
      setScene(slot.scene);
    }
    setActiveCueId(undefined);
    nextCueIndexRef.current = 0;
    setSceneMessage(`Loaded player row ${slotIndex + 1}.`);
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

  function handleAudioLoadedMetadata(event: SyntheticEvent<HTMLAudioElement>) {
    const duration = roundTime(event.currentTarget.duration);
    setSong((current) => (current ? { ...current, duration } : current));
    setScene((current) => ({ ...current, duration }));

    if (activePage === 'player') {
      setPlayerSlots((current) =>
        current.map((slot, index) => {
          if (index !== selectedPlayerSlot) {
            return slot;
          }

          return {
            ...slot,
            scene: slot.scene ? { ...slot.scene, duration } : slot.scene,
            song: slot.song ? { ...slot.song, duration } : slot.song,
          };
        }),
      );
    }
  }

  function handleAudioSeeked() {
    const time = audioRef.current?.currentTime ?? 0;
    nextCueIndexRef.current = findNextCueIndex(time, sceneRef.current.cues);
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
          disabled={!canReconnectHardware}
          isReconnecting={isReconnecting}
          onReconnect={() => void reconnectDmxDevice()}
          snapshot={snapshot}
        />
      </section>

      <CommandBar
        activePage={activePage}
        connection={connection}
        disabled={isPlaying}
        fixtureCount={scene.fixtureCount}
        lock={controlLock}
        onAcquire={() => void acquireControlLock()}
        onBlackout={blackoutActiveLights}
        onRelease={() => void releaseControlLock()}
        ownsLock={ownsControlLock}
        snapshot={snapshot}
      />

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
            <button
              className="homeCard"
              onClick={() => openPage('player')}
              type="button"
            >
              <span>Player</span>
              <strong>Show Player</strong>
              <small>
                Build a 20-row show list, load each song with its scene JSON,
                and run playback beside the 3D stage.
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
                {activePage === 'control'
                  ? 'Manual control'
                  : activePage === 'music'
                    ? 'Music sync'
                    : 'Show player'}
              </p>
              <h2>
                {activePage === 'control'
                  ? 'Control Light A/B'
                  : activePage === 'music'
                    ? 'Music Sync Page'
                    : '20-Row Show Player'}
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
              {activePage === 'music' || activePage === 'player' ? (
                <button
                  className="blackoutButton scopeBlackout"
                  disabled={!hardwareControlReady}
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
                {scene.fixtureCount > 1 ? (
                  <FixtureControl
                    fixture={activeFixtures[0]}
                    fixtureIndex={0}
                    headerKicker="Addresses A001 + A009"
                    headerTitle="Both Lights"
                    key="both-lights"
                    onPatch={queueActiveFixturePatch}
                    disabled={!hardwareControlReady}
                  />
                ) : null}
                {activeFixtures.map((fixture, index) => (
                  <FixtureControl
                    fixture={fixture}
                    fixtureIndex={index}
                    key={FIXTURE_CONFIGS[index]?.id ?? index}
                    onPatch={(patch) => queueFixturePatch(index, patch)}
                    disabled={!hardwareControlReady}
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
                        className="presetButton"
                        disabled={!hardwareControlReady}
                        key={preset.label}
                        onClick={() => applyPreset(preset)}
                        style={presetStyle(preset.fixtures, scene.fixtureCount)}
                        type="button"
                      >
                        <span className="presetSwatches" aria-hidden="true">
                          {normalizeFixturePatches(
                            preset.fixtures,
                            scene.fixtureCount,
                          ).map((fixture, index) => (
                            <i
                              key={`${preset.label}-${index}`}
                              style={{
                                background: fixturePatchToCssColor(fixture),
                              }}
                            />
                          ))}
                        </span>
                        <strong>{preset.label}</strong>
                        <small>
                          {presetSummary(preset.fixtures, scene.fixtureCount)}
                        </small>
                      </button>
                    ))}
                  </div>
                  <div className="dangerZone">
                    <button
                      className="blackoutButton"
                      disabled={!hardwareControlReady}
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
          ) : activePage === 'music' ? (
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
                    <label>
                      <span>Processing method</span>
                      <select
                        onChange={(event) =>
                          setSceneGenerationMethod(
                            event.target.value as SceneGenerationMethod,
                          )
                        }
                        value={sceneGenerationMethod}
                      >
                        {SCENE_GENERATION_METHODS.map((method) => (
                          <option key={method.id} value={method.id}>
                            {method.label}
                          </option>
                        ))}
                      </select>
                      <small>
                        {
                          SCENE_GENERATION_METHODS.find(
                            (method) => method.id === sceneGenerationMethod,
                          )?.description
                        }
                      </small>
                    </label>
                    <button onClick={createNewScene} type="button">
                      New Empty Scene
                    </button>
                  </div>

                  {song ? (
                    <audio
                      className="audioPlayer"
                      controls
                      onEnded={() => stopSceneClock()}
                      onLoadedMetadata={handleAudioLoadedMetadata}
                      onError={() => {
                        setSceneMessage(
                          'Could not load the uploaded audio file. Try a standard MP3 or WAV export.',
                        );
                      }}
                      onPause={() => stopSceneClock()}
                      onPlay={() => void handleAudioPlay()}
                      onSeeked={handleAudioSeeked}
                      ref={audioRef}
                      src={song.url}
                    />
                  ) : (
                    <div className="emptyAudio">
                      Upload an audio file to enable synchronized playback.
                    </div>
                  )}

                  <SceneTimeline
                    activeCueId={activeCueId}
                    disabled={!hardwareControlReady}
                    onSelectCue={(cue) => applyCue(cue, true)}
                    scene={scene}
                    songDuration={song?.duration ?? scene.duration}
                  />

                  <div className="sceneActions">
                    <button
                      className={
                        isProcessing
                          ? 'primaryButton progressButton'
                          : 'primaryButton'
                      }
                      disabled={!songFile || isProcessing}
                      onClick={() => void processSong()}
                      style={
                        isProcessing
                          ? ({
                              '--progress': `${processingProgress ?? 0}%`,
                            } as CSSProperties)
                          : undefined
                      }
                      type="button"
                    >
                      {isProcessing
                        ? `Processing ${processingProgress ?? 0}%`
                        : 'Generate Folkloric Scene'}
                    </button>
                    <button
                      className="secondaryButton"
                      disabled={!cueCount || !hardwareControlReady}
                      onClick={() => applyCue(scene.cues[0])}
                      type="button"
                    >
                      Preview Scene Start
                    </button>
                    <button
                      className="primaryButton"
                      disabled={!song || !hardwareControlReady}
                      onClick={() => void playScene()}
                      type="button"
                    >
                      {isPlaying ? 'Playing Scene' : 'Play Scene'}
                    </button>
                    <button
                      className="transportButton"
                      disabled={!song}
                      onClick={pauseScene}
                      type="button"
                    >
                      Pause
                    </button>
                    <button
                      className="transportButton"
                      disabled={!song}
                      onClick={stopScene}
                      type="button"
                    >
                      Stop
                    </button>
                    <button
                      className="captureButton"
                      onClick={addManualCue}
                      type="button"
                    >
                      Add Manual Cue
                    </button>
                    <button
                      className="clearSceneButton"
                      disabled={!cueCount || isPlaying}
                      onClick={clearScene}
                      type="button"
                    >
                      Clear Scene
                    </button>
                    <button
                      className="secondaryButton"
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
                  <details className="fixtureDebug sceneDebug">
                    <summary>Cue JSON Debug</summary>
                    <pre>
                      {cueDebugJson || 'Select a cue to inspect its JSON.'}
                    </pre>
                    <button
                      className="secondaryButton"
                      disabled={!currentCue}
                      onClick={() =>
                        void navigator.clipboard?.writeText(cueDebugJson)
                      }
                      type="button"
                    >
                      Copy Cue JSON
                    </button>
                  </details>
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
                            disabled={!hardwareControlReady}
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
          ) : (
            <>
              <section className="playerGrid">
                <div className="panel playerDeckPanel">
                  <PanelHeader
                    kicker="Show player"
                    title="Loaded Row Transport"
                  />
                  <div className="playerNowCard">
                    <div>
                      <span>Row {selectedPlayerSlot + 1}</span>
                      <strong>
                        {currentPlayerSlot.scene?.name ?? 'No scene loaded'}
                      </strong>
                      <small>
                        {currentPlayerSlot.song?.name ?? 'No song loaded'}
                      </small>
                    </div>
                    <div className="playerNowStats">
                      <span>
                        {currentPlayerSlot.scene?.cues.length ?? 0} cues
                      </span>
                      <span>{scene.fixtureCount} lights</span>
                      <span>
                        {formatTime(song?.duration ?? scene.duration)}
                      </span>
                    </div>
                  </div>

                  {song ? (
                    <audio
                      className="audioPlayer compactAudioPlayer"
                      controls
                      onEnded={() => stopSceneClock()}
                      onError={() => {
                        setSceneMessage(
                          'Could not load the uploaded audio file. Try a standard MP3 or WAV export.',
                        );
                      }}
                      onLoadedMetadata={handleAudioLoadedMetadata}
                      onPause={() => stopSceneClock()}
                      onPlay={() => void handleAudioPlay()}
                      onSeeked={handleAudioSeeked}
                      ref={audioRef}
                      src={song.url}
                    />
                  ) : (
                    <div className="emptyAudio">
                      Load a row with a song before playback.
                    </div>
                  )}

                  <div className="sceneActions playerActions">
                    <button
                      className="primaryButton"
                      disabled={!song || !hardwareControlReady}
                      onClick={() => void playScene()}
                      type="button"
                    >
                      {isPlaying ? 'Playing Row' : 'Play Row'}
                    </button>
                    <button
                      className="transportButton"
                      disabled={!song}
                      onClick={pauseScene}
                      type="button"
                    >
                      Pause
                    </button>
                    <button
                      className="transportButton"
                      disabled={!song}
                      onClick={stopScene}
                      type="button"
                    >
                      Stop
                    </button>
                    <button
                      className="secondaryButton"
                      disabled={!cueCount || !hardwareControlReady}
                      onClick={() => applyCue(scene.cues[0])}
                      type="button"
                    >
                      Preview Start
                    </button>
                  </div>

                  <SceneTimeline
                    activeCueId={activeCueId}
                    disabled={!hardwareControlReady}
                    onSelectCue={(cue) => applyCue(cue, true)}
                    scene={scene}
                    songDuration={song?.duration ?? scene.duration}
                  />
                  {sceneMessage ? (
                    <p className="sceneMessage">{sceneMessage}</p>
                  ) : null}
                </div>

                <div className="panel playerStagePanel">
                  <TheaterViewer fixtures={activeFixtures} />
                </div>
              </section>

              <section className="panel playerListPanel">
                <PanelHeader
                  kicker="20 row show list"
                  title="Music + Scene Assignments"
                />
                <div className="playerRows" aria-label="Show player rows">
                  {playerSlots.map((slot, index) => {
                    const loaded = Boolean(slot.song || slot.scene);
                    const active = index === selectedPlayerSlot;
                    return (
                      <div
                        className={active ? 'playerRow active' : 'playerRow'}
                        key={index}
                      >
                        <button
                          className="playerRowSelect"
                          disabled={!loaded || isPlaying}
                          onClick={() => loadPlayerSlot(index)}
                          type="button"
                        >
                          <strong>{String(index + 1).padStart(2, '0')}</strong>
                          <span>{slot.song?.name ?? 'Add music'}</span>
                          <small>{slot.scene?.name ?? 'Add scene JSON'}</small>
                        </button>
                        <div className="playerRowFiles">
                          <label>
                            Music
                            <input
                              accept="audio/*"
                              onChange={(event) =>
                                handlePlayerSongUpload(index, event)
                              }
                              type="file"
                            />
                          </label>
                          <label>
                            Scene
                            <input
                              accept="application/json,.json"
                              onChange={(event) =>
                                void handlePlayerSceneUpload(index, event)
                              }
                              type="file"
                            />
                          </label>
                        </div>
                        <div className="playerRowMeta">
                          <span>{slot.scene?.cues.length ?? 0} cues</span>
                          <span>
                            {slot.scene
                              ? `${slot.scene.fixtureCount} ${slot.scene.fixtureCount === 1 ? 'light' : 'lights'}`
                              : 'No scene'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}

function CommandBar({
  activePage,
  connection,
  disabled,
  fixtureCount,
  lock,
  onAcquire,
  onBlackout,
  onRelease,
  ownsLock,
  snapshot,
}: {
  activePage: ActivePage;
  connection: ConnectionState;
  disabled: boolean;
  fixtureCount: number;
  lock: DmxSnapshot['controlLock'];
  onAcquire: () => void;
  onBlackout: () => void;
  onRelease: () => void;
  ownsLock: boolean;
  snapshot: DmxSnapshot;
}) {
  const online = snapshot.device.connected && connection === 'connected';
  const pageLabel =
    activePage === 'home'
      ? 'Mode Select'
      : activePage === 'control'
        ? 'Manual Desk'
        : activePage === 'music'
          ? 'Music Sync'
          : 'Show Player';
  const lockLabel = ownsLock ? 'Armed' : lock ? 'Read-only' : 'Standby';
  const updatedAt = new Date(snapshot.updatedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <section className="commandBar" aria-label="Live DMX command center">
      <div className="commandIdentity">
        <span>Live Desk</span>
        <strong>{pageLabel}</strong>
      </div>
      <div className="commandPills">
        <div className={online ? 'commandPill good' : 'commandPill danger'}>
          <span>Backend</span>
          <strong>{connection}</strong>
        </div>
        <div className={ownsLock ? 'commandPill armed' : 'commandPill'}>
          <span>Control</span>
          <strong>{lockLabel}</strong>
        </div>
        <div className="commandPill">
          <span>Fixtures</span>
          <strong>{fixtureCount} live</strong>
        </div>
        <div className="commandPill">
          <span>Updated</span>
          <strong>{updatedAt}</strong>
        </div>
      </div>
      <div className="commandActions">
        {ownsLock ? (
          <button
            className="secondaryButton"
            disabled={disabled}
            onClick={onRelease}
            type="button"
          >
            Release
          </button>
        ) : !lock ? (
          <button className="primaryButton" onClick={onAcquire} type="button">
            Take Control
          </button>
        ) : (
          <span className="commandLocked">Locked by {lock.label}</span>
        )}
        <button
          className="blackoutButton commandBlackout"
          disabled={!ownsLock}
          onClick={onBlackout}
          type="button"
        >
          Blackout
        </button>
      </div>
    </section>
  );
}

function SceneTimeline({
  activeCueId,
  disabled,
  onSelectCue,
  scene,
  songDuration,
}: {
  activeCueId?: string;
  disabled: boolean;
  onSelectCue: (cue: SceneCue) => void;
  scene: TrackScene;
  songDuration: number;
}) {
  const lastCueTime = scene.cues.at(-1)?.time ?? 0;
  const duration = Math.max(songDuration, scene.duration, lastCueTime, 1);
  const activeCue = scene.cues.find((cue) => cue.id === activeCueId);
  const playhead = activeCue
    ? Math.min(100, (activeCue.time / duration) * 100)
    : 0;
  const bars = Array.from({ length: 52 }, (_, index) => {
    const time = (index / 51) * duration;
    const nearbyCue = scene.cues.find(
      (cue) => Math.abs(cue.time - time) < duration / 26,
    );
    const energy = nearbyCue
      ? 72 + ((nearbyCue.fixtures.length + index) % 4) * 7
      : 18 + ((index * 17) % 36);
    return Math.min(96, energy);
  });

  return (
    <div className="sceneTimeline" aria-label="Scene cue timeline">
      <div className="timelineMeta">
        <div>
          <span>Timeline</span>
          <strong>
            {scene.cues.length
              ? `${scene.cues.length} cues placed`
              : 'No cues yet'}
          </strong>
        </div>
        <small>
          {activeCue
            ? `${activeCue.label} at ${formatTime(activeCue.time)}`
            : `Track length ${formatTime(duration)}`}
        </small>
      </div>
      <div className="timelineTrack">
        <div className="timelineBars" aria-hidden="true">
          {bars.map((height, index) => (
            <i
              key={index}
              style={{ height: `${height}%`, opacity: 0.35 + height / 180 }}
            />
          ))}
        </div>
        <div className="timelinePlayhead" style={{ left: `${playhead}%` }} />
        {scene.cues.map((cue) => {
          const left = Math.min(100, Math.max(0, (cue.time / duration) * 100));
          const style = {
            '--cue-color': fixturePatchToCssColor(cue.fixtures[0]),
            left: `${left}%`,
          } as CSSProperties;
          return (
            <button
              aria-label={`Preview cue ${cue.label} at ${formatTime(cue.time)}`}
              className={
                cue.id === activeCueId ? 'timelineCue active' : 'timelineCue'
              }
              disabled={disabled}
              key={cue.id}
              onClick={() => onSelectCue(cue)}
              style={style}
              title={`${cue.label} · ${formatTime(cue.time)}`}
              type="button"
            />
          );
        })}
      </div>
      <div className="timelineScale" aria-hidden="true">
        <span>0:00</span>
        <span>{formatTime(duration / 2)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}

function presetStyle(fixtures: FixturePatches, fixtureCount: number) {
  const normalized = normalizeFixturePatches(fixtures, fixtureCount);
  return {
    '--preset-a': fixturePatchToCssColor(normalized[0]),
    '--preset-b': fixturePatchToCssColor(normalized[1] ?? normalized[0]),
  } as CSSProperties;
}

function presetSummary(fixtures: FixturePatches, fixtureCount: number): string {
  const normalized = normalizeFixturePatches(fixtures, fixtureCount);
  if (normalized.every((fixture) => (fixture.master ?? 255) === 0)) {
    return 'Immediate dark look';
  }

  const modeLabels = Array.from(
    new Set(
      normalized.map((fixture) =>
        modeForValue(fixture.functionMode ?? 0).label.replace('Colors ', ''),
      ),
    ),
  );
  return `${fixtureCount}-fixture look · ${modeLabels.slice(0, 2).join(' / ')}`;
}

function fixturePatchToCssColor(patch: DmxPatch = {}): string {
  const master = (patch.master ?? 255) / 255;
  if (master <= 0) {
    return 'rgb(18, 12, 16)';
  }

  const mode = modeForValue(patch.functionMode ?? 0);
  if (mode.id !== 'dmx8ch') {
    const macroColors: Record<string, string> = {
      colorOutput: 'rgb(255, 176, 74)',
      gradate: 'rgb(81, 177, 255)',
      jumpChange: 'rgb(255, 68, 96)',
      pulseChange: 'rgb(174, 105, 255)',
      soundActive: 'rgb(108, 255, 186)',
    };
    return macroColors[mode.id] ?? 'rgb(255, 168, 97)';
  }

  const white = patch.white ?? 0;
  const red = Math.min(255, (patch.red ?? 0) + white * 0.78) * master;
  const green = Math.min(255, (patch.green ?? 0) + white * 0.78) * master;
  const blue = Math.min(255, (patch.blue ?? 0) + white * 0.78) * master;
  const floor = white > 0 ? 32 : 10;
  return `rgb(${Math.max(floor, Math.round(red))}, ${Math.max(
    floor,
    Math.round(green),
  )}, ${Math.max(floor, Math.round(blue))})`;
}

function FixtureControl({
  disabled,
  fixture,
  fixtureIndex,
  headerKicker,
  headerTitle,
  onPatch,
}: {
  disabled: boolean;
  fixture: FixtureState;
  fixtureIndex: number;
  headerKicker?: string;
  headerTitle?: string;
  onPatch: (patch: DmxPatch) => void;
}) {
  const config = FIXTURE_CONFIGS[fixtureIndex];
  const title = headerTitle ?? config.label;
  const kicker =
    headerKicker ?? `Address A${String(config.startAddress).padStart(3, '0')}`;
  const activeMode = modeForValue(fixture.functionMode);
  const colorPreview = `rgb(${fixture.red}, ${fixture.green}, ${fixture.blue})`;
  const debugJson = JSON.stringify(fixture, null, 2);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const [debugText, setDebugText] = useState(debugJson);
  const [debugDirty, setDebugDirty] = useState(false);
  const [debugError, setDebugError] = useState<string>();
  const pendingDebugText = useRef<string | undefined>(undefined);
  const whiteAmount = Math.round((fixture.white / 255) * 100);

  useEffect(() => {
    if (debugDirty) {
      return;
    }

    if (pendingDebugText.current) {
      if (debugJson === pendingDebugText.current) {
        pendingDebugText.current = undefined;
      }
      return;
    }

    setDebugText(debugJson);
  }, [debugDirty, debugJson]);

  function applyFixtureColor(color: DirectColorOption) {
    onPatch({
      ...color.patch,
      functionMode: 0,
      functionSpeed: 0,
      strobe: 0,
    });
    setColorMenuOpen(false);
  }

  function resetDebugJson() {
    pendingDebugText.current = undefined;
    setDebugText(debugJson);
    setDebugDirty(false);
    setDebugError(undefined);
  }

  function applyDebugJson() {
    try {
      const patch = normalizeDmxPatch(JSON.parse(debugText));
      const nextFixture = { ...fixture, ...patch };
      const nextDebugText = JSON.stringify(nextFixture, null, 2);
      pendingDebugText.current = nextDebugText;
      setDebugText(nextDebugText);
      setDebugDirty(false);
      setDebugError(undefined);
      onPatch(patch);
    } catch (error) {
      setDebugError(error instanceof Error ? error.message : 'Invalid JSON.');
    }
  }

  return (
    <div
      aria-disabled={disabled}
      className={
        disabled ? 'panel fixturePanel disabledPanel' : 'panel fixturePanel'
      }
    >
      <div className="fixtureHeader">
        <PanelHeader kicker={kicker} title={title} />
        <div className="colorMenuWrap">
          <button
            aria-expanded={colorMenuOpen}
            aria-haspopup="menu"
            className="miniPreview"
            disabled={disabled}
            onClick={() => setColorMenuOpen((open) => !open)}
            style={{
              background: `linear-gradient(135deg, ${colorPreview}, rgba(255,255,255,${fixture.white / 255}))`,
              opacity: Math.max(0.25, fixture.master / 255),
            }}
            type="button"
          >
            <span>{whiteAmount}% W</span>
            <small>Color</small>
          </button>
          {colorMenuOpen ? (
            <div className="fixtureColorMenu" role="menu">
              <div className="fixtureColorMenuHeader">
                <strong>{headerTitle ?? config.shortLabel} color</strong>
                <small>RGBW mix</small>
              </div>
              <div className="fixtureColorGrid">
                {DIRECT_COLORS.map((color, index) => (
                  <button
                    aria-label={`${color.label}, ${Math.round((color.patch.white / 255) * 100)} percent white`}
                    key={color.label}
                    onClick={() => applyFixtureColor(color)}
                    role="menuitem"
                    style={
                      {
                        '--color-angle': `${(index / DIRECT_COLORS.length) * 360}deg`,
                        '--color-preview': fixturePatchToCssColor(color.patch),
                      } as CSSProperties
                    }
                    title={`${color.label} · ${Math.round((color.patch.white / 255) * 100)}% W`}
                    type="button"
                  >
                    <span aria-hidden="true" />
                    <strong>{color.label}</strong>
                    <small>
                      {Math.round((color.patch.white / 255) * 100)}% W
                    </small>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
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
        variant="row"
        state={fixture}
        tone="violet"
      />
      <details className="fixtureDebug">
        <summary>Debug JSON</summary>
        <textarea
          aria-label={`${title} editable debug JSON`}
          disabled={disabled}
          onChange={(event) => {
            pendingDebugText.current = undefined;
            setDebugText(event.target.value);
            setDebugDirty(true);
            setDebugError(undefined);
          }}
          spellCheck={false}
          value={debugText}
        />
        {debugError ? <p className="debugError">{debugError}</p> : null}
        <div className="debugActions">
          <button
            className="secondaryButton"
            onClick={() => void navigator.clipboard?.writeText(debugText)}
            type="button"
          >
            Copy JSON
          </button>
          <button
            className="secondaryButton"
            disabled={!debugDirty}
            onClick={resetDebugJson}
            type="button"
          >
            Reset
          </button>
          <button
            className="primaryButton"
            disabled={disabled || !debugDirty}
            onClick={applyDebugJson}
            type="button"
          >
            Apply JSON
          </button>
        </div>
      </details>
    </div>
  );
}

function DeviceCard({
  connection,
  disabled,
  isReconnecting,
  onReconnect,
  snapshot,
}: {
  connection: ConnectionState;
  disabled: boolean;
  isReconnecting: boolean;
  onReconnect: () => void;
  snapshot: DmxSnapshot;
}) {
  const status = snapshot.device;
  const online = status.connected && connection === 'connected';
  const autoScanSeconds = status.autoReconnectMs
    ? Math.round(status.autoReconnectMs / 1000)
    : undefined;
  const reconnectLabel = isReconnecting
    ? 'Scanning...'
    : status.driver === 'mock'
      ? 'Connect uDMX'
      : 'Reconnect uDMX';
  return (
    <aside className="deviceCard">
      <div className={online ? 'statusDot online' : 'statusDot'} />
      <div className="deviceInfo">
        <p className="deviceTitle">
          {status.driver === 'udmx' ? 'uDMX hardware' : 'Mock output'}
        </p>
        <p>{status.detail}</p>
        {status.autoReconnectActive ? (
          <p>
            Auto-scanning for uDMX every {autoScanSeconds ?? '?'}s. Plug in the
            adapter and the app will switch from mock mode automatically.
          </p>
        ) : null}
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
          disabled={disabled || isReconnecting}
          onClick={onReconnect}
          type="button"
        >
          {reconnectLabel}
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
  variant = 'fader',
}: {
  channelKey: keyof FixtureState;
  disabled: boolean;
  fixtureIndex: number;
  onChange: (patch: DmxPatch) => void;
  state: FixtureState;
  tone?: 'amber' | 'blue' | 'green' | 'neutral' | 'red' | 'violet' | 'white';
  variant?: 'fader' | 'row';
}) {
  const channel = DMX_CHANNELS.find((item) => item.key === channelKey);
  const value = state[channelKey];
  const fixture = FIXTURE_CONFIGS[fixtureIndex];

  if (!channel || !fixture) {
    return null;
  }

  return (
    <label
      className={`${variant === 'fader' ? 'faderControl' : 'sliderRow'} tone-${tone}`}
    >
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
        title={
          disabled ? 'Take Control before changing DMX values.' : channel.label
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
    let payload: StatusSocketPayload;
    try {
      payload = parseStatusSocketPayload(event.data);
    } catch {
      setError('Invalid live update from the DMX backend.');
      return;
    }

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

function parseStatusSocketPayload(data: unknown): StatusSocketPayload {
  if (typeof data !== 'string') {
    throw new Error('WebSocket message must be text.');
  }

  const parsed = JSON.parse(data) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('WebSocket message must be an object.');
  }

  const payload = parsed as Record<string, unknown>;
  if (payload.type === 'snapshot' && payload.snapshot) {
    return payload as { snapshot: DmxSnapshot; type: 'snapshot' };
  }

  if (payload.type === 'error' && typeof payload.error === 'string') {
    return { error: payload.error, type: 'error' };
  }

  throw new Error('Unknown WebSocket message type.');
}

async function generateSceneFromAudio(
  file: File,
  fixtureCount: number,
  method: SceneGenerationMethod,
  onProgress: (progress: number) => void,
  fallbackDuration: number,
): Promise<GeneratedSceneResult> {
  const audioContext = new AudioContext();
  try {
    onProgress(8);
    await waitForPaint();
    let audioData: ArrayBuffer | undefined = await file.arrayBuffer();
    onProgress(28);
    await waitForPaint();
    const buffer = await audioContext.decodeAudioData(audioData);
    audioData = undefined;
    onProgress(58);
    await waitForPaint();
    const frames = await analyzeAudioBufferEnergy(buffer, (progress) => {
      onProgress(58 + Math.round(progress * 0.3));
    });
    onProgress(90);
    await waitForPaint();
    const generated = generateSignalSceneFromEnergyFrames({
      duration: buffer.duration,
      frames,
      fixtureCount,
      method,
      songName: file.name,
    });
    onProgress(100);
    return { scene: generated };
  } catch (error) {
    const duration =
      Number.isFinite(fallbackDuration) && fallbackDuration > 0
        ? fallbackDuration
        : await readAudioDuration(file);
    const fallback = generateTimedFallbackScene(
      file.name,
      fixtureCount,
      duration ?? 0,
    );
    if (fallback) {
      onProgress(100);
      return {
        scene: fallback,
        warning: `Audio analysis failed, so generated ${fallback.cues.length} timed fallback cues for ${fallback.fixtureCount} ${fallback.fixtureCount === 1 ? 'light' : 'lights'}. Try re-exporting the MP3 if you need beat-aware cues.`,
      };
    }

    throw createAudioProcessingError(error, file);
  } finally {
    await audioContext.close();
  }
}

function generateTimedFallbackScene(
  songName: string,
  fixtureCount: number,
  duration: number,
): TrackScene | undefined {
  if (!Number.isFinite(duration) || duration <= 0) {
    return undefined;
  }

  const roundedDuration = roundTime(duration);
  const interval = Math.max(4, roundedDuration / 180);
  const cues: SceneCue[] = [];

  for (
    let time = 0, index = 0;
    time < roundedDuration && cues.length < 220;
    time += interval, index += 1
  ) {
    cues.push(createAutoCue(roundTime(time), index, fixtureCount));
  }

  return {
    createdAt: new Date().toISOString(),
    cues,
    duration: roundedDuration,
    fixtureCount: clampSceneFixtureCount(fixtureCount),
    name: `${songName} timed fallback scene`,
    songName,
    version: 1,
  };
}

function readAudioDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve(undefined);
    }, 6_000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute('src');
      URL.revokeObjectURL(url);
    };

    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      cleanup();
      resolve(Number.isFinite(duration) && duration > 0 ? duration : undefined);
    };
    audio.onerror = () => {
      cleanup();
      resolve(undefined);
    };
    audio.src = url;
  });
}

async function analyzeAudioBufferEnergy(
  buffer: AudioBuffer,
  onProgress: (progress: number) => void,
): Promise<EnergyFrame[]> {
  const sampleRate = buffer.sampleRate;
  const windowSize = Math.max(1, Math.floor(sampleRate * 0.22));
  const hopSize = Math.max(1, Math.floor(sampleRate * 0.11));
  const sampleStep = Math.max(1, Math.floor(sampleRate / 6000));
  const channels = Array.from(
    { length: buffer.numberOfChannels },
    (_item, index) => buffer.getChannelData(index),
  );
  const frameCount = Math.max(1, Math.ceil(buffer.length / hopSize));
  const frames: EnergyFrame[] = [];
  let previousEnergy = 0;

  for (
    let start = 0, frameIndex = 0;
    start < buffer.length;
    start += hopSize, frameIndex += 1
  ) {
    let highSum = 0;
    let lowSum = 0;
    let midSum = 0;
    let peak = 0;
    let previousSample = 0;
    let smoothed = 0;
    let sum = 0;
    let count = 0;
    const end = Math.min(buffer.length, start + windowSize);

    for (
      let sampleIndex = start;
      sampleIndex < end;
      sampleIndex += sampleStep
    ) {
      let mixedSample = 0;
      for (const channel of channels) {
        mixedSample += channel[sampleIndex] ?? 0;
      }
      mixedSample /= Math.max(1, channels.length);
      const absolute = Math.abs(mixedSample);
      const highComponent = mixedSample - previousSample;
      smoothed = smoothed * 0.92 + mixedSample * 0.08;
      lowSum += smoothed * smoothed;
      highSum += highComponent * highComponent;
      midSum += Math.max(0, absolute - Math.abs(smoothed)) ** 2;
      peak = Math.max(peak, absolute);
      previousSample = mixedSample;
      sum += mixedSample * mixedSample;
      count += 1;
    }

    const energy = Math.sqrt(sum / Math.max(1, count));

    frames.push({
      energy,
      flux: Math.max(0, energy - previousEnergy),
      high: Math.sqrt(highSum / Math.max(1, count)),
      low: Math.sqrt(lowSum / Math.max(1, count)),
      mid: Math.sqrt(midSum / Math.max(1, count)),
      peak,
      rms: energy,
      time: start / sampleRate,
    });
    previousEnergy = energy;

    if (frameIndex % 90 === 0) {
      onProgress(Math.min(100, Math.round((frameIndex / frameCount) * 100)));
      await waitForPaint();
    }
  }

  onProgress(100);
  return frames.length ? frames : [{ energy: 0, time: 0 }];
}

function createAudioProcessingError(error: unknown, file: File): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(
    `Could not analyze ${file.name}. The browser could not decode or process the full audio file. Try a shorter track, a lower-bitrate audio file, or close other memory-heavy browser tabs. ${detail}`,
  );
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}
