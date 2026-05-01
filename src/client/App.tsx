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
  clampDmxByte,
  isDirectControlMode,
  modeForValue,
  showStateToDmxFrame,
} from '../shared/dmx';
import { TheaterViewer } from './TheaterViewer';

type ConnectionState = 'connected' | 'connecting' | 'offline';
type FixturePatches = DmxPatch[];

interface SceneCue {
  fixtures: FixturePatches;
  id: string;
  label: string;
  time: number;
}

interface TrackScene {
  createdAt: string;
  cues: SceneCue[];
  duration: number;
  fixtureCount: number;
  name: string;
  songName?: string;
  version: 1;
}

interface UploadedSong {
  duration?: number;
  name: string;
  url: string;
}

const CHANNEL_KEYS = DMX_CHANNELS.map((channel) => channel.key);

const PRESETS: Array<{ fixtures: FixturePatches; label: string }> = [
  {
    label: 'Mirror Red/Blue',
    fixtures: [
      { blue: 0, functionMode: 0, green: 0, master: 255, red: 255, strobe: 0, white: 0 },
      { blue: 255, functionMode: 0, green: 20, master: 255, red: 0, strobe: 0, white: 0 },
    ],
  },
  {
    label: 'Warm Front',
    fixtures: [
      { blue: 35, functionMode: 0, green: 130, master: 230, red: 255, strobe: 0, white: 180 },
      { blue: 120, functionMode: 0, green: 40, master: 160, red: 40, strobe: 0, white: 0 },
    ],
  },
  {
    label: 'Cool Wash',
    fixtures: [
      { blue: 255, functionMode: 0, green: 110, master: 230, red: 20, strobe: 0, white: 80 },
      { blue: 180, functionMode: 0, green: 255, master: 210, red: 0, strobe: 0, white: 40 },
    ],
  },
  {
    label: 'White Hit',
    fixtures: [
      { blue: 0, functionMode: 0, green: 0, master: 255, red: 0, strobe: 0, white: 255 },
      { blue: 0, functionMode: 0, green: 0, master: 255, red: 0, strobe: 0, white: 255 },
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
      { blue: 0, functionMode: 0, green: 0, master: 0, red: 0, strobe: 0, white: 0 },
      { blue: 0, functionMode: 0, green: 0, master: 0, red: 0, strobe: 0, white: 0 },
    ],
  },
];

const AUTO_PALETTES: FixturePatches[] = [
  [
    { blue: 0, functionMode: 0, green: 20, master: 235, red: 255, strobe: 0, white: 0 },
    { blue: 255, functionMode: 0, green: 35, master: 230, red: 0, strobe: 0, white: 0 },
  ],
  [
    { blue: 40, functionMode: 0, green: 255, master: 230, red: 0, strobe: 0, white: 0 },
    { blue: 0, functionMode: 0, green: 40, master: 225, red: 255, strobe: 0, white: 30 },
  ],
  [
    { blue: 255, functionMode: 0, green: 0, master: 230, red: 170, strobe: 0, white: 0 },
    { blue: 0, functionMode: 0, green: 210, master: 220, red: 30, strobe: 0, white: 120 },
  ],
  [
    { blue: 0, functionMode: 0, green: 0, master: 255, red: 0, strobe: 0, white: 255 },
    { blue: 130, functionMode: 0, green: 40, master: 220, red: 255, strobe: 0, white: 0 },
  ],
];

function createInitialShowState(): ShowState {
  return {
    fixtures: DEFAULT_SHOW_STATE.fixtures.map((fixture) => ({ ...fixture })),
  };
}

function createEmptyScene(fixtureCount = FIXTURE_COUNT, songName?: string, duration = 0): TrackScene {
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

export function App() {
  const [activeCueId, setActiveCueId] = useState<string>();
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
  const nextCueIndexRef = useRef(0);
  const pendingPatch = useRef<Array<DmxPatch | undefined>>([]);
  const sceneRef = useRef(scene);
  const sceneTimer = useRef<number>();
  const socketRef = useRef<WebSocket>();
  const songUrlRef = useRef<string>();

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
          setError(loadError instanceof Error ? loadError.message : 'Could not load DMX status.');
        }
      }
    }

    loadInitialStatus();
    const socket = openStatusSocket((nextSnapshot) => {
      if (!disposed) {
        setSnapshot(nextSnapshot);
        setConnection('connected');
        setError(undefined);
      }
    }, setConnection, setError);
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
  }, []);

  const directControl = snapshot.state.fixtures.every((fixture) =>
    isDirectControlMode(fixture.functionMode),
  );
  const cueCount = scene.cues.length;
  const currentCue = scene.cues.find((cue) => cue.id === activeCueId);

  function queueFixturePatch(fixtureIndex: number, patch: DmxPatch) {
    const fixtures: Array<DmxPatch | undefined> = Array.from({ length: FIXTURE_COUNT });
    fixtures[fixtureIndex] = patch;
    queueFixturePatches(fixtures);
  }

  function queueFixturePatches(fixtures: Array<DmxPatch | undefined>, immediate = false) {
    const normalizedFixtures = fixtures.map((patch) => (patch ? normalizePatchLoose(patch) : undefined));

    setSnapshot((current) => {
      const nextState: ShowState = {
        fixtures: current.state.fixtures.map((fixture, index) => {
          const patch = normalizedFixtures[index];
          return patch ? ({ ...fixture, ...patch } as FixtureState) : { ...fixture };
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
      pendingPatch.current[index] = { ...pendingPatch.current[index], ...patch };
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

  async function flushPatch(immediate: boolean) {
    const fixtures = pendingPatch.current;
    pendingPatch.current = [];

    if (!fixtures.some(Boolean)) {
      return;
    }

    const payload = { fixtures };
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ immediate, state: payload, type: 'setState' }));
      return;
    }

    await postJson(`/api/state${immediate ? '?immediate=true' : ''}`, payload);
  }

  async function postJson(path: string, body?: unknown) {
    try {
      const response = await fetch(path, {
        body: body ? JSON.stringify(body) : undefined,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      setSnapshot((await response.json()) as DmxSnapshot);
      setError(undefined);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'DMX request failed.');
    }
  }

  function sendSocketAction(type: 'blackout' | 'reconnect') {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type }));
      return;
    }

    const path = type === 'blackout' ? '/api/blackout' : '/api/device/reconnect';
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
    setSceneMessage(`Loaded ${file.name}. Choose the scene light count, then import or generate cues.`);
  }

  function handleSceneFixtureCountChange(event: ChangeEvent<HTMLSelectElement>) {
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
      `Scene now targets ${fixtureCount} ${fixtureCount === 1 ? 'light' : 'lights'}. Existing cues were adjusted.`,
    );
  }

  function createNewScene() {
    setScene(createEmptyScene(scene.fixtureCount, song?.name, song?.duration ?? 0));
    setActiveCueId(undefined);
    setSceneMessage(`Started a new ${scene.fixtureCount}-light scene.`);
  }

  async function processSong() {
    if (!songFile) {
      setSceneMessage('Upload a song before processing a scene.');
      return;
    }

    setIsProcessing(true);
    setSceneMessage(`Analyzing audio energy and building ${scene.fixtureCount}-light cues...`);
    try {
      const generated = await generateSceneFromAudio(songFile, scene.fixtureCount);
      setScene(generated);
      setActiveCueId(undefined);
      setSceneMessage(
        `Generated ${generated.cues.length} cues for ${generated.fixtureCount} ${generated.fixtureCount === 1 ? 'light' : 'lights'}.`,
      );
    } catch (processError) {
      setSceneMessage(
        processError instanceof Error ? processError.message : 'Could not process the uploaded song.',
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
      setSceneMessage(importError instanceof Error ? importError.message : 'Could not import scene JSON.');
    } finally {
      event.target.value = '';
    }
  }

  function exportScene() {
    const blob = new Blob([JSON.stringify(scene, null, 2)], { type: 'application/json' });
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
      fixtures: snapshot.state.fixtures.slice(0, scene.fixtureCount).map(fixtureToPatch),
      id: createId(),
      label: `Manual ${formatTime(time)}`,
      time,
    };

    setScene((current) => ({
      ...current,
      cues: [...current.cues, cue].sort((left, right) => left.time - right.time),
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
      nextCueIndexRef.current = findNextCueIndex(cue.time, sceneRef.current.cues);
    }

    setActiveCueId(cue.id);
    queueFixturePatches(cue.fixtures, true);
  }

  async function playScene() {
    if (!audioRef.current || !song) {
      setSceneMessage('Upload a song before playback.');
      return;
    }

    nextCueIndexRef.current = findNextCueIndex(audioRef.current.currentTime, sceneRef.current.cues);
    await audioRef.current.play();
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
        applyCue(cues[nextCueIndexRef.current]);
        nextCueIndexRef.current += 1;
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
  }

  return (
    <main className="appShell">
      <section className="heroPanel">
        <div>
          <p className="eyebrow">uDMX dance show controller</p>
          <h1>Two-Light Scene Studio</h1>
          <p className="heroCopy">
            Control two 8-channel fixtures, upload a track, generate or hand-build cues, then play
            the song and lighting scene together.
          </p>
        </div>
        <DeviceCard connection={connection} snapshot={snapshot} />
      </section>

      {error ? <div className="errorBanner">{error}</div> : null}
      {!directControl ? (
        <div className="modeBanner">
          One or both lights are using a CH7 macro mode. RGBW sliders only have full manual control
          when CH7 is in <strong>DMX 8CH Control</strong>.
        </div>
      ) : null}

      <section className="showGrid">
        <div className="panel timelinePanel">
          <PanelHeader kicker="Music sync" title="Track + Scene" />
          <div className="uploadGrid">
            <label className="fileDrop">
              <span>Upload song</span>
              <input accept="audio/*" onChange={handleSongUpload} type="file" />
            </label>
            <label className="fileDrop">
              <span>Import scene JSON</span>
              <input accept="application/json,.json" onChange={importScene} type="file" />
            </label>
          </div>

          <div className="sceneSetup">
            <label>
              <span>Lights in this scene</span>
              <select onChange={handleSceneFixtureCountChange} value={scene.fixtureCount}>
                {FIXTURE_CONFIGS.map((fixture, index) => (
                  <option key={fixture.id} value={index + 1}>
                    {index + 1} {index === 0 ? 'light' : 'lights'}
                  </option>
                ))}
              </select>
              <small>Scene cues target the first selected fixtures: A001, then A009.</small>
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
              onLoadedMetadata={(event) => {
                const duration = roundTime(event.currentTarget.duration);
                setSong((current) => (current ? { ...current, duration } : current));
                setScene((current) => ({ ...current, duration }));
              }}
              onPause={() => stopSceneClock()}
              onPlay={() => startSceneClock()}
              onSeeked={() => {
                const time = audioRef.current?.currentTime ?? 0;
                nextCueIndexRef.current = findNextCueIndex(time, sceneRef.current.cues);
              }}
              ref={audioRef}
              src={song.url}
            />
          ) : (
            <div className="emptyAudio">Upload an audio file to enable synchronized playback.</div>
          )}

          <div className="sceneActions">
            <button disabled={!songFile || isProcessing} onClick={() => void processSong()} type="button">
              {isProcessing ? 'Processing...' : 'Auto-Generate Scene'}
            </button>
            <button disabled={!song} onClick={() => void playScene()} type="button">
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
            <button disabled={!cueCount} onClick={exportScene} type="button">
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
              <strong>{song?.duration ? formatTime(song.duration) : formatTime(scene.duration)}</strong>
            </div>
            <div>
              <span>Active</span>
              <strong>{currentCue ? currentCue.label : 'None'}</strong>
            </div>
          </div>
          {sceneMessage ? <p className="sceneMessage">{sceneMessage}</p> : null}
        </div>

        <div className="panel cuePanel">
          <PanelHeader kicker="Timeline" title="Scene Cues" />
          <div className="cueList">
            {scene.cues.length ? (
              scene.cues.map((cue) => (
                <div className={cue.id === activeCueId ? 'cueRow active' : 'cueRow'} key={cue.id}>
                  <button onClick={() => applyCue(cue, true)} type="button">
                    <strong>{formatTime(cue.time)}</strong>
                    <span>
                      {cue.label} · {cue.fixtures.length} {cue.fixtures.length === 1 ? 'light' : 'lights'}
                    </span>
                  </button>
                  <button className="deleteCue" onClick={() => deleteCue(cue.id)} type="button">
                    Delete
                  </button>
                </div>
              ))
            ) : (
              <div className="emptyAudio">No cues yet. Generate from the song or capture manual cues.</div>
            )}
          </div>
        </div>
      </section>

      <section className="viewerSection">
        <div className="panel viewerPanel">
          <TheaterViewer fixtures={snapshot.state.fixtures} />
        </div>
      </section>

      <section className="fixtureGrid">
        {snapshot.state.fixtures.map((fixture, index) => (
          <FixtureControl
            fixture={fixture}
            fixtureIndex={index}
            key={FIXTURE_CONFIGS[index]?.id ?? index}
            onPatch={(patch) => queueFixturePatch(index, patch)}
          />
        ))}
      </section>

      <section className="dashboardGrid">
        <div className="panel actionsPanel">
          <PanelHeader kicker="Fast looks" title="Two-Light Presets" />
          <div className="presetGrid">
            {PRESETS.map((preset) => (
              <button key={preset.label} onClick={() => queueFixturePatches(preset.fixtures)} type="button">
                {preset.label}
              </button>
            ))}
          </div>
          <div className="dangerZone">
            <button className="blackoutButton" onClick={() => sendSocketAction('blackout')} type="button">
              Blackout
            </button>
            <button className="secondaryButton" onClick={() => sendSocketAction('reconnect')} type="button">
              Reconnect uDMX
            </button>
          </div>
        </div>

        <div className="panel framePanel">
          <PanelHeader kicker="DMX output" title="16-Channel Frame" />
          <div className="frameReadout">
            {snapshot.frame.map((value, index) => (
              <div key={index}>
                <span>CH{index + 1}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function FixtureControl({
  fixture,
  fixtureIndex,
  onPatch,
}: {
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
        <Slider channelKey="master" fixtureIndex={fixtureIndex} onChange={onPatch} state={fixture} />
        <Slider channelKey="red" fixtureIndex={fixtureIndex} onChange={onPatch} state={fixture} tone="red" />
        <Slider channelKey="green" fixtureIndex={fixtureIndex} onChange={onPatch} state={fixture} tone="green" />
        <Slider channelKey="blue" fixtureIndex={fixtureIndex} onChange={onPatch} state={fixture} tone="blue" />
        <Slider channelKey="white" fixtureIndex={fixtureIndex} onChange={onPatch} state={fixture} tone="white" />
        <Slider channelKey="strobe" fixtureIndex={fixtureIndex} onChange={onPatch} state={fixture} tone="amber" />
      </div>

      <div className="modeList compact">
        {FUNCTION_MODES.map((mode) => (
          <button
            className={activeMode.id === mode.id ? 'modeButton active' : 'modeButton'}
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
        fixtureIndex={fixtureIndex}
        onChange={onPatch}
        state={fixture}
        tone="violet"
      />
    </div>
  );
}

function DeviceCard({ connection, snapshot }: { connection: ConnectionState; snapshot: DmxSnapshot }) {
  const status = snapshot.device;
  const online = status.connected && connection === 'connected';
  return (
    <aside className="deviceCard">
      <div className={online ? 'statusDot online' : 'statusDot'} />
      <div>
        <p className="deviceTitle">{status.driver === 'udmx' ? 'uDMX hardware' : 'Mock output'}</p>
        <p>{status.detail}</p>
        {status.lastError ? <p className="deviceError">{status.lastError}</p> : null}
        <small>
          {status.vendorId && status.productId ? `${status.vendorId}:${status.productId} · ` : ''}
          {status.writeMode ? `${status.writeMode} mode · ` : ''}
          {connection} · {status.writes} writes
          {status.failures ? ` · ${status.failures} failures` : ''}
        </small>
      </div>
    </aside>
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
  fixtureIndex,
  onChange,
  state,
  tone = 'neutral',
}: {
  channelKey: keyof FixtureState;
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
        onChange={(event) => onChange({ [channelKey]: Number(event.target.value) })}
        type="range"
        value={value}
      />
      <output>{value}</output>
    </label>
  );
}

function openStatusSocket(
  onSnapshot: (snapshot: DmxSnapshot) => void,
  setConnection: (state: ConnectionState) => void,
  setError: (message: string | undefined) => void,
): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

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
    setError('Live connection to the DMX backend failed. REST fallback remains available.');
  });

  return socket;
}

async function generateSceneFromAudio(file: File, fixtureCount: number): Promise<TrackScene> {
  const normalizedFixtureCount = clampSceneFixtureCount(fixtureCount);
  const audioContext = new AudioContext();
  try {
    const buffer = await audioContext.decodeAudioData(await file.arrayBuffer());
    const samples = mixDown(buffer);
    const sampleRate = buffer.sampleRate;
    const windowSize = Math.max(1, Math.floor(sampleRate * 0.28));
    const hopSize = Math.max(1, Math.floor(sampleRate * 0.14));
    const energies: Array<{ energy: number; time: number }> = [];

    for (let start = 0; start < samples.length; start += hopSize) {
      let sum = 0;
      const end = Math.min(samples.length, start + windowSize);
      for (let index = start; index < end; index += 1) {
        sum += samples[index] * samples[index];
      }
      energies.push({ energy: Math.sqrt(sum / Math.max(1, end - start)), time: start / sampleRate });
    }

    const average = energies.reduce((sum, item) => sum + item.energy, 0) / Math.max(1, energies.length);
    const peak = energies.reduce((max, item) => Math.max(max, item.energy), 0);
    const threshold = average + (peak - average) * 0.38;
    const cueTimes: number[] = [];
    let lastCueTime = -1;

    for (let index = 1; index < energies.length - 1; index += 1) {
      const current = energies[index];
      const isLocalPeak = current.energy >= energies[index - 1].energy && current.energy > energies[index + 1].energy;
      if (isLocalPeak && current.energy >= threshold && current.time - lastCueTime >= 0.45) {
        cueTimes.push(roundTime(current.time));
        lastCueTime = current.time;
      }
    }

    if (cueTimes.length < 8) {
      cueTimes.splice(0, cueTimes.length, ...fallbackCueTimes(buffer.duration));
    }

    const cues = cueTimes
      .slice(0, 220)
      .map((time, index) => createAutoCue(time, index, normalizedFixtureCount));
    return {
      createdAt: new Date().toISOString(),
      cues,
      duration: roundTime(buffer.duration),
      fixtureCount: normalizedFixtureCount,
      name: `${file.name} auto scene`,
      songName: file.name,
      version: 1,
    };
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

function createAutoCue(time: number, index: number, fixtureCount: number): SceneCue {
  const base = AUTO_PALETTES[index % AUTO_PALETTES.length];
  const strongHit = index % 8 === 0;
  const normalizedFixtureCount = clampSceneFixtureCount(fixtureCount);
  const accentFixture = normalizedFixtureCount > 1 ? 1 : 0;
  return {
    fixtures: normalizeFixturePatches(base, normalizedFixtureCount).map((patch, fixtureIndex) => ({
      ...patch,
      functionMode: 0,
      master: strongHit ? 255 : patch.master,
      strobe: strongHit && fixtureIndex === accentFixture ? 80 : 0,
    })),
    id: createId(),
    label: strongHit ? `Accent ${index + 1}` : `Auto ${index + 1}`,
    time,
  };
}

function fallbackCueTimes(duration: number): number[] {
  const times: number[] = [];
  for (let time = 0; time < duration; time += 2) {
    times.push(roundTime(time));
  }
  return times;
}

function normalizeImportedScene(input: unknown): TrackScene {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Scene file must contain a JSON object.');
  }

  const source = input as Partial<TrackScene>;
  const fixtureCount = clampSceneFixtureCount(
    source.fixtureCount,
    inferFixtureCount(Array.isArray(source.cues) ? source.cues : []),
  );
  const cues = Array.isArray(source.cues)
    ? source.cues.map((cueInput, index) => normalizeImportedCue(cueInput, index, fixtureCount))
    : [];

  if (!cues.length) {
    throw new Error('Scene file does not contain any cues.');
  }

  return {
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : new Date().toISOString(),
    cues: cues.sort((left, right) => left.time - right.time),
    duration: typeof source.duration === 'number' ? roundTime(source.duration) : 0,
    fixtureCount,
    name: typeof source.name === 'string' ? source.name : 'Imported dance show',
    songName: typeof source.songName === 'string' ? source.songName : undefined,
    version: 1,
  };
}

function normalizeImportedCue(input: unknown, index: number, fixtureCount: number): SceneCue {
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

function normalizeFixturePatches(inputs: unknown[], fixtureCount: number): FixturePatches {
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

function clampSceneFixtureCount(value: unknown, fallback = FIXTURE_COUNT): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return Math.min(FIXTURE_COUNT, Math.max(1, Math.round(fallback)));
  }

  return Math.min(FIXTURE_COUNT, Math.max(1, Math.round(parsed)));
}

function normalizePatchLoose(input: unknown): DmxPatch {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  const patch: DmxPatch = {};
  for (const [key, value] of Object.entries(input)) {
    if (!CHANNEL_KEYS.includes(key as keyof FixtureState) || typeof value !== 'number') {
      continue;
    }
    patch[key as keyof FixtureState] = clampDmxByte(value);
  }
  return patch;
}

function fixtureToPatch(fixture: FixtureState): DmxPatch {
  return { ...fixture };
}

function findNextCueIndex(time: number, cues: SceneCue[]): number {
  const index = cues.findIndex((cue) => cue.time >= time - 0.03);
  return index === -1 ? cues.length : index;
}

function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}

function roundTime(value: number): number {
  return Math.max(0, Math.round(value * 100) / 100);
}
