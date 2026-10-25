import {
  ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, signal,
  untracked, viewChild,
} from '@angular/core';
import { LiveSubtitles } from '../core/live-subtitles';
import { PreviewSource } from '../core/preview.store';
import { ProjectStore } from '../core/project.store';
import { mmss } from './format';

/**
 * Área de prévia: o vídeo original com a legenda desenhada ao vivo por cima
 * (JASSUB lendo o mesmo .ass do export), ou o resultado do último export.
 */
@Component({
  selector: 'lb-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="switch" role="tablist" aria-label="qual vídeo mostrar">
      <button type="button" role="tab" [class.on]="preview.clip() === 'original'"
              [attr.aria-selected]="preview.clip() === 'original'"
              [disabled]="!projects.ready()"
              (click)="preview.show('original')">Original</button>
      <button type="button" role="tab" [class.on]="preview.clip() === 'render'"
              [attr.aria-selected]="preview.clip() === 'render'"
              [disabled]="!preview.hasRender()"
              [title]="preview.hasRender() ? '' : 'exporte uma vez pra ver o resultado aqui'"
              (click)="preview.show('render')">Com legenda</button>
      @if (preview.renderStale()) {
        <span class="stale">a config mudou depois deste export</span>
      }
      @if (preview.clip() === 'original' && projects.ready()) {
        <label class="live" [class.on]="live.enabled()">
          <input type="checkbox" [checked]="live.enabled()"
                 (change)="live.enabled.set($any($event.target).checked)" />
          <i></i>legenda ao vivo
        </label>
      }
    </div>

    <div class="stage">
      <div class="overlay">
        <span class="tag">[ {{ tag() }} ]</span>
        @if (preview.status(); as status) {
          <span class="tag proxy" [class.bad]="preview.build() === 'error'">{{ status }}</span>
        }
        @if (preview.clip() === 'original' && live.enabled()) {
          @switch (live.state()) {
            @case ('loading') { <span class="tag">carregando legenda…</span> }
            @case ('error') { <span class="tag bad">legenda ao vivo indisponível</span> }
          }
        }
      </div>

      @if (src(); as url) {
        <video #video [src]="url" preload="metadata" playsinline
               (loadedmetadata)="onLoaded()"
               (seeked)="live.repaint()"
               (timeupdate)="onTime()"
               (error)="preview.onPlaybackError()"
               (play)="playing.set(true)"
               (pause)="playing.set(false)"
               (ended)="playing.set(false)"></video>
      } @else {
        <div class="empty">
          @if (preview.build() === 'building') {
            <span class="ghost small">convertendo…</span>
            <p class="hint">o navegador não toca esse arquivo, estou gerando uma cópia leve</p>
          } @else {
            <span class="ghost">gameplay.mp4</span>
            <div class="dots"><i></i><i class="hi"></i><i></i></div>
            <p class="hint">suba os arquivos na aba Arquivos</p>
          }
        </div>
      }

      <!-- o <canvas> da legenda ao vivo é inserido aqui pelo JASSUB, irmão do <video> -->
    </div>

    <div class="transport">
      <button type="button" class="play" [disabled]="!src()" (click)="toggle()"
              [attr.aria-label]="playing() ? 'pausar' : 'tocar'">
        @if (playing()) {
          <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor">
            <rect x="1" y="1" width="4" height="14" rx="1" /><rect x="9" y="1" width="4" height="14" rx="1" />
          </svg>
        } @else {
          <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor">
            <path d="M2 1.8v12.4a1 1 0 0 0 1.5.87l10-6.2a1 1 0 0 0 0-1.74l-10-6.2A1 1 0 0 0 2 1.8z" />
          </svg>
        }
      </button>

      <span class="time"><b>{{ clock() }}</b> / {{ total() }}</span>

      <input type="range" class="scrub" min="0" [max]="duration()" step="0.01" [value]="current()"
             aria-label="posição no vídeo" [disabled]="!src()" (input)="seek($event)" />

      <span class="note">{{ musicNote() }}</span>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 12px; min-height: 0; }

    .switch { display: flex; align-items: center; gap: 4px; flex: none; }
    .switch button {
      padding: 7px 14px; background: none; border: 1px solid transparent;
      border-radius: var(--r-sm); color: var(--text-dim); font-size: 13px;
      transition: color .12s, background .12s, border-color .12s;
    }
    .switch button:hover:not(:disabled) { color: var(--text); }
    .switch button.on {
      background: var(--panel); border-color: var(--line); color: var(--text); font-weight: 500;
    }
    .switch button:disabled { opacity: .35; cursor: not-allowed; }
    .stale {
      margin-left: 6px; font-family: var(--mono); font-size: 11px; color: #e3b341;
    }
    .live {
      margin-left: auto; display: flex; align-items: center; gap: 8px; cursor: pointer;
      font-size: 13px; color: var(--text-dim); user-select: none;
    }
    .live input { position: absolute; opacity: 0; pointer-events: none; }
    .live i {
      width: 28px; height: 16px; border-radius: 999px; background: var(--line);
      position: relative; transition: background .15s;
    }
    .live i::after {
      content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px;
      border-radius: 50%; background: var(--text-dim); transition: transform .15s, background .15s;
    }
    .live.on { color: var(--text); }
    .live.on i { background: rgba(200, 240, 106, .3); }
    .live.on i::after { transform: translateX(12px); background: var(--accent); }
    .live input:focus-visible + i { outline: 2px solid var(--accent); outline-offset: 2px; }

    .stage {
      position: relative; flex: 1; min-height: 0;
      display: grid; place-items: center; overflow: hidden;
      background: #0a0b0c; border: 1px solid var(--line); border-radius: var(--r-lg);
      background-image: radial-gradient(var(--line-soft) 1px, transparent 1px);
      background-size: 22px 22px;
    }
    /* absoluto em vez de item do grid: com height:100% o vídeo transbordava
       a .stage em janela larga, porque o grid dá ao item a altura do conteúdo */
    video {
      position: absolute; inset: 0;
      width: 100%; height: 100%; object-fit: contain; display: block;
    }

    /* os rótulos ficam numa faixa própria, com fundo: antes encostavam na borda
       arredondada do painel e apareciam cortados por cima do vídeo */
    .overlay {
      position: absolute; top: 0; left: 0; right: 0; z-index: 2;
      display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
      padding: 12px 14px;
      background: linear-gradient(to bottom, rgba(10, 11, 12, .85), transparent);
      pointer-events: none;
    }
    .tag {
      font-family: var(--mono); font-size: 11px; letter-spacing: .06em;
      color: var(--text-muted); white-space: nowrap;
      background: rgba(10, 11, 12, .6); border-radius: 5px; padding: 3px 7px;
    }
    .tag.proxy { color: var(--accent); }
    .tag.bad { color: var(--danger); }

    .empty { text-align: center; padding: 20px; }
    .ghost.small { font-size: clamp(22px, 3vw, 34px); color: #262a2f; }
    .ghost {
      font-size: clamp(32px, 6vw, 64px); font-weight: 700; letter-spacing: -.02em;
      color: #1d2024;
    }
    .dots { display: flex; gap: 14px; justify-content: center; margin-top: 18px; }
    .dots i { width: 8px; height: 8px; border-radius: 50%; background: #2a2e34; }
    .dots .hi { background: #4a515a; transform: translateY(-7px); }
    .empty .hint { margin-top: 24px; }

    .transport { display: flex; align-items: center; gap: 16px; flex: none; }
    .play {
      width: 46px; height: 46px; flex: none; border: none; border-radius: 50%;
      background: var(--accent); color: var(--accent-ink);
      display: grid; place-items: center; padding-left: 2px;
    }
    .play:disabled { opacity: .3; cursor: not-allowed; }
    .time { font-family: var(--mono); font-size: 13px; color: var(--text-dim); flex: none; }
    .time b { color: var(--text); font-weight: 400; }
    .scrub { flex: 1; }
    .note { font-family: var(--mono); font-size: 12px; color: var(--text-dim); flex: none; }
  `],
})
export class Preview {
  protected projects = inject(ProjectStore);
  protected live = inject(LiveSubtitles);

  private videoRef = viewChild<ElementRef<HTMLVideoElement>>('video');

  protected preview = inject(PreviewSource);
  protected src = this.preview.url;
  protected playing = signal(false);
  protected current = signal(0);

  /** Duração da SAÍDA (o que o plan calculou), não a do arquivo de origem. */
  protected duration = computed(
    () => this.projects.summary()?.duration ?? this.projects.project()?.meta.video.duration ?? 0,
  );

  protected clock = computed(() => mmss(this.current()));
  protected total = computed(() => mmss(this.duration()));

  protected tag = computed(() => {
    const s = this.projects.summary();
    const p = this.projects.project();
    const what = this.preview.clip() === 'render' ? 'COM LEGENDA' : 'GAMEPLAY';
    if (s) return `${what} · ${s.width}×${s.height}`;
    if (p) return `${what} · ${p.meta.video.width}×${p.meta.video.height}`;
    return 'SEM VÍDEO';
  });

  protected musicNote = computed(() => {
    const s = this.projects.summary();
    return s ? `música em ${mmss(s.music_start)}` : '';
  });

  /**
   * Onde retomar quando o <video> troca de fonte. Trocar Original/Com legenda
   * mantém o ponto e o play — os dois clipes têm a mesma linha do tempo, porque o
   * vídeo de saída começa no segundo 0 do de entrada. Projeto novo zera.
   */
  private resume = { time: 0, play: false };
  private lastProject: string | null = null;
  private lastSrc: string | null = null;

  constructor() {
    effect(() => {
      const src = this.src();
      untracked(() => {
        const project = this.projects.project()?.id ?? null;
        if (project !== this.lastProject) {
          this.resume = { time: 0, play: false };
        } else if (this.lastSrc) {
          this.resume = { time: this.current(), play: this.playing() };
        }
        // lastSrc nulo = a troca passou por "convertendo…" e não havia vídeo na
        // tela: mantém o ponto guardado antes, senão o play se perdia no caminho
        this.lastProject = project;
        this.lastSrc = src;
        this.playing.set(false);
      });
    });

    // a legenda ao vivo só faz sentido sobre o original: o render já tem a legenda queimada
    effect(() => {
      const el = this.videoRef()?.nativeElement;
      const showLive = this.preview.clip() === 'original' && !!this.src();
      untracked(() => (el && showLive ? this.live.attach(el) : this.live.detach()));
    });

    inject(DestroyRef).onDestroy(() => this.live.detach());
  }

  protected toggle(): void {
    const el = this.videoRef()?.nativeElement;
    if (!el) return;
    // o signal `playing` acompanha os eventos play/pause do elemento, então segue
    // certo também com tecla de mídia, fim do vídeo ou play disparado por código
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  }

  protected onLoaded(): void {
    const el = this.videoRef()?.nativeElement;
    if (!el) return;
    const { time, play } = this.resume;
    this.resume = { time: 0, play: false };
    // limita à duração do clipe novo (o original costuma ser mais longo que o render).
    // e o seek não é só pra posicionar: com preload="metadata" o elemento não
    // decodifica quadro nenhum até alguém pedir um tempo diferente do atual — sem
    // ele a área da prévia fica preta até apertar play
    const end = Number.isFinite(el.duration) ? el.duration - 0.05 : time;
    el.currentTime = Math.max(0.04, Math.min(time, end));
    this.current.set(el.currentTime);
    if (play) void el.play().catch(() => undefined);
  }

  protected onTime(): void {
    const el = this.videoRef()?.nativeElement;
    if (!el) return;
    this.current.set(el.currentTime);
    // o vídeo final para onde o plan mandou parar
    if (this.duration() && el.currentTime >= this.duration()) {
      el.pause();
      this.playing.set(false);
    }
  }

  protected seek(event: Event): void {
    const value = +(event.target as HTMLInputElement).value;
    const el = this.videoRef()?.nativeElement;
    this.current.set(value);
    if (el) el.currentTime = value;
  }
}
