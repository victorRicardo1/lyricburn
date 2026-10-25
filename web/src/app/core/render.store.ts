import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Api, apiError } from './api';
import { ConfigStore } from './config.store';
import { Job, LyricConfig } from './types';

const POLL_MS = 700;

/** Dispara o render e fica perguntando o progresso até terminar. */
@Injectable({ providedIn: 'root' })
export class RenderStore {
  private api = inject(Api);

  private cfg = inject(ConfigStore);

  readonly job = signal<Job | null>(null);
  readonly error = signal<string | null>(null);
  readonly starting = signal(false);

  /** Config com que o vídeo atual foi gerado — serve pra saber se ele envelheceu. */
  private renderedWith = signal<string | null>(null);

  /** Mexeram nos controles depois do export? Então o vídeo na tela está velho. */
  readonly stale = computed(() => {
    const fingerprint = this.renderedWith();
    return fingerprint !== null && fingerprint !== JSON.stringify(this.cfg.config());
  });

  readonly busy = computed(() => {
    const status = this.job()?.status;
    return this.starting() || status === 'queued' || status === 'preparing' || status === 'rendering';
  });
  readonly done = computed(() => this.job()?.status === 'done');
  readonly downloadUrl = computed(() => {
    const job = this.job();
    return job?.status === 'done' ? this.api.downloadUrl(job.id) : null;
  });

  /** Job trazido de volta do localStorage (F5) — a prévia não troca sozinha pra ele. */
  readonly restoredJobId = signal<string | null>(null);

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // trocou de projeto (ou F5): esquece o job da tela e tenta recuperar o salvo
    effect(() => {
      const projectId = this.cfg.project();
      untracked(() => void this.restore(projectId));
    });
  }

  private async restore(projectId: string | null): Promise<void> {
    this.stopPolling();
    this.job.set(null);
    this.error.set(null);
    this.renderedWith.set(null);
    this.restoredJobId.set(null);

    const saved = this.cfg.lastRender();
    if (!projectId || !saved) return;
    try {
      const job = await this.api.job(saved.jobId);
      // a API guarda os jobs em memória: se ela reiniciou, o job sumiu
      if (this.cfg.project() !== projectId || job.status !== 'done' || job.project_id !== projectId) {
        throw new Error('job indisponível');
      }
      this.restoredJobId.set(job.id);
      this.renderedWith.set(saved.config);
      this.job.set(job);
    } catch {
      if (this.cfg.project() === projectId) this.cfg.lastRender.set(null);
    }
  }

  async start(projectId: string, config: LyricConfig, fast: boolean): Promise<void> {
    this.stopPolling();
    this.starting.set(true);
    this.error.set(null);
    this.job.set(null);
    this.renderedWith.set(JSON.stringify(config));
    try {
      const job = await this.api.render(projectId, config, fast);
      this.job.set(job);
      this.poll(job.id);
    } catch (err) {
      this.error.set(apiError(err));
    } finally {
      this.starting.set(false);
    }
  }

  private poll(id: string): void {
    this.timer = setTimeout(async () => {
      try {
        const job = await this.api.job(id);
        this.job.set(job);
        if (job.status === 'error') {
          this.error.set(job.message ?? 'o render falhou');
          return;
        }
        if (job.status === 'done') {
          const config = this.renderedWith();
          if (config) this.cfg.lastRender.set({ jobId: job.id, config });
          return;
        }
        this.poll(id);
      } catch (err) {
        this.error.set(apiError(err));
      }
    }, POLL_MS);
  }

  private stopPolling(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  clear(): void {
    this.stopPolling();
    this.job.set(null);
    this.error.set(null);
    this.renderedWith.set(null);
    this.restoredJobId.set(null);
    this.cfg.lastRender.set(null);
  }
}
