import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Api, apiError } from './api';
import { ConfigStore } from './config.store';
import { FontsResponse, PlanResult, Project } from './types';

/**
 * O projeto (arquivos já analisados) e o plan derivado dele.
 *
 * O plan é refeito sozinho sempre que a config muda, com um respiro de 350 ms.
 * Do lado do servidor isso é barato: mexer só no estilo acerta o cache e volta
 * em ~0,1 s. É esse plan que a fase 3a vai jogar no JASSUB.
 */
@Injectable({ providedIn: 'root' })
export class ProjectStore {
  private api = inject(Api);
  private cfg = inject(ConfigStore);

  readonly project = signal<Project | null>(null);
  readonly uploading = signal(false);
  readonly uploadError = signal<string | null>(null);

  readonly plan = signal<PlanResult | null>(null);
  readonly planning = signal(false);
  readonly planError = signal<string | null>(null);

  readonly fonts = signal<FontsResponse | null>(null);

  readonly ready = computed(() => this.project() !== null);
  readonly summary = computed(() => this.plan()?.summary ?? null);
  readonly videoUrl = computed(() => {
    const p = this.project();
    return p ? this.api.mediaUrl(p.id, 'video') : null;
  });

  /** Famílias que o libass consegue achar — é o que pode ir em style.font. */
  readonly families = computed(() => this.fonts()?.families ?? []);

  private planToken = 0;

  constructor() {
    void this.loadFonts();
    void this.restoreFromUrl();
    effect((onCleanup) => {
      const project = this.project();
      const config = this.cfg.config();
      if (!project) return;
      const timer = setTimeout(() => void this.runPlan(project.id, config), 350);
      onCleanup(() => clearTimeout(timer));
    });
  }

  private async loadFonts(): Promise<void> {
    try {
      const fonts = await this.api.fonts();
      this.fonts.set(fonts);
      this.registerFaces(fonts);
    } catch {
      this.fonts.set({ fonts: [], families: [] });
    }
  }

  /**
   * Registra no navegador as mesmas fontes que o libass vai usar, baixadas de
   * GET /fonts/{nome}. Serve pro seletor mostrar cada fonte na própria tipografia
   * — e é o mesmo carregamento que o JASSUB vai precisar na fase 3a.
   */
  private registerFaces(fonts: FontsResponse): void {
    if (typeof FontFace === 'undefined') return;
    for (const font of fonts.fonts) {
      const face = new FontFace(font.family, `url("${font.url}")`, {
        weight: String(font.weight ?? 400),
        style: font.italic ? 'italic' : 'normal',
      });
      face.load().then((loaded) => document.fonts.add(loaded)).catch(() => undefined);
    }
  }

  /** O id fica na URL (?project=...), então dar F5 não perde o upload. */
  private async restoreFromUrl(): Promise<void> {
    const id = new URLSearchParams(location.search).get('project');
    if (!id) return;
    try {
      const project = await this.api.getProject(id);
      this.cfg.bindTo(project.id);   // traz de volta a config salva pra ele
      this.project.set(project);
    } catch {
      this.rememberInUrl(null);
    }
  }

  private rememberInUrl(id: string | null): void {
    const url = new URL(location.href);
    if (id) url.searchParams.set('project', id);
    else url.searchParams.delete('project');
    history.replaceState(null, '', url);
  }

  async upload(files: { video: File; audio: File; lyrics: File }): Promise<void> {
    this.uploading.set(true);
    this.uploadError.set(null);
    try {
      const project = await this.api.createProject(files);
      this.plan.set(null);
      this.cfg.bindTo(project.id);
      this.project.set(project);
      this.rememberInUrl(project.id);
    } catch (err) {
      this.uploadError.set(apiError(err));
    } finally {
      this.uploading.set(false);
    }
  }

  private async runPlan(id: string, config: Parameters<Api['plan']>[1]): Promise<void> {
    const token = ++this.planToken;
    this.planning.set(true);
    try {
      const result = await this.api.plan(id, config);
      if (token !== this.planToken) return;   // chegou atrasado: já tem config mais nova
      this.plan.set(result);
      this.planError.set(null);
    } catch (err) {
      if (token !== this.planToken) return;
      this.planError.set(apiError(err));
    } finally {
      if (token === this.planToken) this.planning.set(false);
    }
  }
}
