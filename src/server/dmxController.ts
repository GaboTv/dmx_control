import { EventEmitter } from 'node:events';

import {
  BLACKOUT_SHOW_STATE,
  DEFAULT_SHOW_STATE,
  type DmxSnapshot,
  type ShowPatch,
  type ShowState,
  mergeShowState,
  normalizeShowPatch,
  showStateToDmxFrame,
} from '../shared/dmx.js';
import { type ServerConfig } from './config.js';
import { type DmxOutput, createDmxOutput } from './dmxOutput.js';

type SnapshotListener = (snapshot: DmxSnapshot) => void;

export class DmxController {
  private readonly events = new EventEmitter();
  private flushTimer?: NodeJS.Timeout;
  private refreshTimer?: NodeJS.Timeout;
  private state: ShowState = DEFAULT_SHOW_STATE;
  private updatedAt = new Date().toISOString();
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(
    private output: DmxOutput,
    private readonly config: ServerConfig,
  ) {
    if (config.udmxRefreshMs > 0) {
      this.refreshTimer = setInterval(() => {
        void this.flushNow().finally(() => this.emitSnapshot());
      }, config.udmxRefreshMs);
    }
  }

  static async create(config: ServerConfig): Promise<DmxController> {
    const output = await createDmxOutput(config);
    const controller = new DmxController(output, config);
    await controller.flushNow();
    return controller;
  }

  async blackout(): Promise<DmxSnapshot> {
    this.state = BLACKOUT_SHOW_STATE;
    this.touch();
    await this.flushNow();
    this.emitSnapshot();
    return this.snapshot();
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }

    await this.output.close();
  }

  onSnapshot(listener: SnapshotListener): () => void {
    this.events.on('snapshot', listener);
    return () => this.events.off('snapshot', listener);
  }

  async reconnect(): Promise<DmxSnapshot> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    await this.output.close();
    this.output = await createDmxOutput(this.config);
    await this.flushNow();
    this.emitSnapshot();
    return this.snapshot();
  }

  snapshot(): DmxSnapshot {
    return {
      device: this.output.status(),
      frame: showStateToDmxFrame(this.state),
      state: this.state,
      updatedAt: this.updatedAt,
    };
  }

  async update(
    input: unknown,
    options: { immediate?: boolean } = {},
  ): Promise<DmxSnapshot> {
    const patch = normalizeShowPatch(input);
    this.applyPatch(patch);

    if (options.immediate) {
      await this.flushNow();
    } else {
      this.queueFlush();
    }

    this.emitSnapshot();
    return this.snapshot();
  }

  private applyPatch(patch: ShowPatch): void {
    this.state = mergeShowState(this.state, patch);
    this.touch();
  }

  private emitSnapshot(): void {
    this.events.emit('snapshot', this.snapshot());
  }

  private async flushNow(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }

    const frame = showStateToDmxFrame(this.state);
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        try {
          await this.output.sendFrame(frame);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error(
            '[dmx] DMX frame write failed; backend remains online:',
            message,
          );
        }
      });

    await this.writeChain;
  }

  private queueFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    this.flushTimer = setTimeout(() => {
      void this.flushNow().finally(() => this.emitSnapshot());
    }, this.config.dmxWriteDebounceMs);
  }

  private touch(): void {
    this.updatedAt = new Date().toISOString();
  }
}
