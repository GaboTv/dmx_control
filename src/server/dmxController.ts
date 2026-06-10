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
  private autoReconnectTimer?: NodeJS.Timeout;
  private flushTimer?: NodeJS.Timeout;
  private refreshTimer?: NodeJS.Timeout;
  private reconnectInFlight?: Promise<DmxSnapshot>;
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

    if (this.autoReconnectEnabled()) {
      this.autoReconnectTimer = setInterval(() => {
        void this.maintainAutoConnection();
      }, config.udmxAutoReconnectMs);
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

    if (this.autoReconnectTimer) {
      clearInterval(this.autoReconnectTimer);
    }

    if (this.reconnectInFlight) {
      await this.reconnectInFlight.catch(() => undefined);
    }

    await this.output.close();
  }

  onSnapshot(listener: SnapshotListener): () => void {
    this.events.on('snapshot', listener);
    return () => this.events.off('snapshot', listener);
  }

  async reconnect(): Promise<DmxSnapshot> {
    return this.reconnectOutput('manual');
  }

  private async reconnectOutput(
    reason: 'auto' | 'manual',
  ): Promise<DmxSnapshot> {
    if (this.reconnectInFlight) {
      return this.reconnectInFlight;
    }

    this.reconnectInFlight = this.doReconnect(reason).finally(() => {
      this.reconnectInFlight = undefined;
    });

    return this.reconnectInFlight;
  }

  private async doReconnect(reason: 'auto' | 'manual'): Promise<DmxSnapshot> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }

    await this.writeChain.catch(() => undefined);

    const currentStatus = this.output.status();
    if (
      reason === 'auto' &&
      currentStatus.driver !== 'mock' &&
      currentStatus.connected
    ) {
      return this.snapshot();
    }

    if (currentStatus.driver === 'mock') {
      const nextOutput = await createDmxOutput(this.config);
      const nextStatus = nextOutput.status();

      if (reason === 'auto' && nextStatus.driver === 'mock') {
        await nextOutput.close();
        return this.snapshot();
      }

      await this.output.close();
      this.output = nextOutput;
    } else {
      await this.output.close();
      this.output = await createDmxOutput(this.config);
    }

    await this.flushNow();
    this.emitSnapshot();
    return this.snapshot();
  }

  snapshot(): DmxSnapshot {
    return {
      device: this.deviceStatus(),
      frame: showStateToDmxFrame(this.state),
      state: this.state,
      updatedAt: this.updatedAt,
    };
  }

  private autoReconnectEnabled(): boolean {
    return (
      this.config.dmxDriver === 'auto' && this.config.udmxAutoReconnectMs > 0
    );
  }

  private async maintainAutoConnection(): Promise<void> {
    if (!this.autoReconnectEnabled()) {
      return;
    }

    try {
      const healthChanged = (await this.output.checkHealth?.()) ?? false;
      const status = this.output.status();

      if (status.driver === 'mock' || !status.connected) {
        await this.reconnectOutput('auto');
        return;
      }

      if (healthChanged) {
        this.emitSnapshot();
      }
    } catch (error) {
      console.warn(
        '[dmx] Automatic uDMX connection check failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private deviceStatus(): DmxSnapshot['device'] {
    const status = this.output.status();
    const autoReconnectActive =
      this.autoReconnectEnabled() && status.driver === 'mock';

    return {
      ...status,
      autoReconnectActive,
      autoReconnectMs: autoReconnectActive
        ? this.config.udmxAutoReconnectMs
        : undefined,
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
