import { Injectable, computed, effect, signal } from '@angular/core';
import { DEFAULT_CONFIG, LyricConfig } from './types';

/** Um preset é só um punhado de campos por cima dos defaults. */
export interface Preset {
  id: string;
  name: string;
  patch: DeepPartial<LyricConfig>;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };

export const PRESETS: Preset[] = [
  {
    id: 'clean-centro',
    name: 'Clean centro',
    patch: {
      style: { font: 'Space Grotesk Medium', size: 48, position: 'center', color: '#F5F5F5', outline: 1.4 },
      dots: { enabled: true, reactive: true },
    },
  },
  {
    id: 'legenda-base',
    name: 'Legenda embaixo',
    patch: {
      style: { font: 'Inter Medium', size: 40, position: 'bottom', color: '#FFFFFF', outline: 2 },
      dots: { enabled: false },
    },
  },
  {
    id: 'reels',
    name: 'Reels vertical',
    patch: {
      video: { resolution: 1080 },
      style: { font: 'Space Grotesk Medium', size: 54, position: 0.62, color: '#C8F06A', outline: 1.8 },
      dots: { enabled: true, reactive: true, spacing: 30 },
    },
  },
  {
    id: 'karaoke',
    name: 'Karaokê suave',
    patch: {
      style: { font: 'Space Grotesk', size: 44, position: 0.78, color: '#A7D8FF', line_fade_ms: 400, back_opacity: 0.9 },
      audio: { game_volume: 0.15, duck: true },
    },
  },
];

function clone(cfg: LyricConfig): LyricConfig {
  return structuredClone(cfg);
}

const STORAGE_PREFIX = 'lyricburn.config.';

/** localStorage some em janela anônima e em iframe sandboxed; nada aqui pode quebrar por isso. */
/** O último export concluído do projeto: o job e a config com que foi feito. */
export interface LastRender {
  jobId: string;
  config: string;   // JSON da config enviada — é a impressão digital pro "desatualizado"
}

interface Stored {
  config: LyricConfig;
  presetId: string;
  lastRender?: LastRender | null;
}

function readStored(key: string): Stored | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sem espaço ou sem permissão: a config só não sobrevive ao F5 */
  }
}

/**
 * O estado da config inteira num signal só. Quem edita chama `patch`;
 * quem lê usa as fatias (`timing`, `style`, ...) e só recalcula o que mudou.
 *
 * A config fica salva no localStorage por projeto, então o F5 — que já traz o
 * projeto de volta pela URL — traz os ajustes junto.
 */
@Injectable({ providedIn: 'root' })
export class ConfigStore {
  private state = signal<LyricConfig>(clone(DEFAULT_CONFIG));

  readonly config = this.state.asReadonly();
  readonly timing = computed(() => this.state().timing);
  readonly audio = computed(() => this.state().audio);
  readonly video = computed(() => this.state().video);
  readonly style = computed(() => this.state().style);
  readonly dots = computed(() => this.state().dots);

  readonly presetId = signal<string>(PRESETS[0].id);

  /** A qual projeto a config atual pertence — é a chave no localStorage. */
  private boundTo = signal<string | null>(null);
  readonly project = this.boundTo.asReadonly();

  /**
   * Último export concluído, guardado junto com a config pra sobreviver ao F5.
   * Quem escreve é o RenderStore; aqui só mora porque é o mesmo registro salvo.
   */
  readonly lastRender = signal<LastRender | null>(null);

  constructor() {
    effect(() => {
      const id = this.boundTo();
      const stored: Stored = {
        config: this.state(),
        presetId: this.presetId(),
        lastRender: this.lastRender(),
      };
      if (id) writeStored(STORAGE_PREFIX + id, stored);
    });
  }

  /**
   * Liga a config a um projeto: restaura o que estava salvo pra ele, ou começa
   * dos defaults. Chamado quando o projeto carrega (inclusive no F5, que traz o
   * id de volta pela URL).
   */
  bindTo(projectId: string | null): void {
    if (this.boundTo() === projectId) return;
    if (!projectId) {
      this.boundTo.set(null);
      return;
    }
    const stored = readStored(STORAGE_PREFIX + projectId);
    if (stored?.config) {
      // mescla por cima dos defaults: config salva por uma versão antiga do app
      // pode não ter todos os campos de hoje
      const restored = clone(DEFAULT_CONFIG);
      for (const section of Object.keys(restored) as (keyof LyricConfig)[]) {
        Object.assign(restored[section], stored.config[section] ?? {});
      }
      this.state.set(restored);
      this.presetId.set(stored.presetId ?? PRESETS[0].id);
      this.lastRender.set(stored.lastRender ?? null);
    } else {
      this.state.set(clone(DEFAULT_CONFIG));
      this.presetId.set(PRESETS[0].id);
      this.lastRender.set(null);
    }
    this.boundTo.set(projectId);
  }

  /** Altera um campo de uma seção, sem mutar o objeto anterior. */
  patch<S extends keyof LyricConfig, K extends keyof LyricConfig[S]>(
    section: S, key: K, value: LyricConfig[S][K],
  ): void {
    this.state.update((cfg) => ({ ...cfg, [section]: { ...cfg[section], [key]: value } }));
  }

  /** Mescla várias seções de uma vez (usado pelos presets). */
  merge(patch: DeepPartial<LyricConfig>): void {
    this.state.update((cfg) => {
      const next = clone(cfg);
      for (const [section, values] of Object.entries(patch)) {
        Object.assign(next[section as keyof LyricConfig], values);
      }
      return next;
    });
  }

  applyPreset(id: string): void {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    this.presetId.set(id);
    this.state.set(clone(DEFAULT_CONFIG));
    this.merge(preset.patch);
  }

  reset(): void {
    this.state.set(clone(DEFAULT_CONFIG));
  }
}
