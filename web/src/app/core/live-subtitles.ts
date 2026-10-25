import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import JASSUB from 'jassub';
import { ProjectStore } from './project.store';

/** Track vazio pra criar o renderer antes do primeiro /plan chegar. */
const EMPTY_TRACK = '[Script Info]\nScriptType: v4.00+\n\n[Events]\nFormat: Layer, Start, End, Style, Text\n';

type State = 'off' | 'loading' | 'on' | 'error';

/**
 * A legenda desenhada ao vivo por cima do vídeo original, enquanto se edita.
 *
 * É o libass compilado pra WebAssembly (JASSUB) lendo **o mesmo `.ass`** que o
 * `/plan` devolve e que o ffmpeg queima no export — então o que aparece aqui é o
 * resultado final, não uma imitação em CSS. Toda vez que a config muda, o plan
 * novo chega e o track é trocado; com o vídeo pausado, o quadro é redesenhado na
 * hora pra dar pra mexer em fonte, cor, tamanho e posição sem dar play.
 *
 * O tempo do `.ass` é o tempo do vídeo de saída, que começa no segundo 0 do vídeo
 * de entrada — por isso não precisa de deslocamento nenhum.
 *
 * O worker e o .wasm vêm de /jassub/ (gerados por scripts/prepare-jassub.mjs).
 */
@Injectable({ providedIn: 'root' })
export class LiveSubtitles {
  private projects = inject(ProjectStore);

  /** Liga/desliga pela UI — dá pra comparar com e sem legenda sem exportar. */
  readonly enabled = signal(true);
  readonly state = signal<State>('off');
  readonly error = signal<string | null>(null);

  readonly active = computed(() => this.enabled() && this.state() === 'on');

  private instance: JASSUB | null = null;
  private video: HTMLVideoElement | null = null;

  constructor() {
    // a cada plan novo, troca o track; untracked porque push lê outros estados
    effect(() => {
      const ass = this.projects.plan()?.ass ?? null;
      untracked(() => void this.push(ass));
    });

    effect(() => {
      const on = this.enabled();
      untracked(() => {
        if (!this.instance) return;
        this.canvas()?.style.setProperty('visibility', on ? 'visible' : 'hidden');
      });
    });
  }

  /**
   * Liga o renderer a um <video>. O JASSUB cria o próprio <canvas> como irmão do
   * vídeo, fora do controle do Angular — por isso quem chama tem que soltar
   * (`detach`) sempre que o elemento sumir ou trocar.
   */
  attach(video: HTMLVideoElement): void {
    if (this.video === video && this.instance) return;
    this.detach();
    this.video = video;
    this.state.set('loading');
    this.error.set(null);

    const origin = location.origin;
    const fonts = (this.projects.fonts()?.fonts ?? []).map((f) => origin + f.url);

    try {
      const instance = new JASSUB({
        video,
        subContent: this.projects.plan()?.ass ?? EMPTY_TRACK,
        workerUrl: origin + '/jassub/worker.js',
        wasmUrl: origin + '/jassub/jassub-worker.wasm',
        modernWasmUrl: origin + '/jassub/jassub-worker-modern.wasm',
        // as mesmas fontes que o libass do ffmpeg usa, servidas por GET /fonts/{nome}
        fonts,
        availableFonts: { 'liberation sans': origin + '/jassub/default.woff2' },
        // não sai procurando fonte no sistema nem no Google: o vídeo final também não acharia
        queryFonts: false,
      });
      this.instance = instance;
      this.canvas()?.style.setProperty('visibility', this.enabled() ? 'visible' : 'hidden');

      instance.ready
        .then(() => {
          if (this.instance !== instance) return;
          this.state.set('on');
          void this.repaint();
        })
        .catch((err) => this.fail(err));
    } catch (err) {
      this.fail(err);
    }
  }

  detach(): void {
    const instance = this.instance;
    this.instance = null;
    this.video = null;
    this.state.set('off');
    if (instance) void instance.destroy().catch(() => undefined);
  }

  /** Redesenha o quadro atual — o JASSUB sozinho só desenha quando chega quadro novo. */
  async repaint(): Promise<void> {
    const instance = this.instance;
    const video = this.video;
    if (!instance || !video || this.state() !== 'on' || !video.videoWidth) return;
    await instance.resize(true);
    await instance.manualRender({
      expectedDisplayTime: performance.now(),
      width: video.videoWidth,
      height: video.videoHeight,
      mediaTime: video.currentTime,
    }, true);
  }

  private async push(ass: string | null): Promise<void> {
    const instance = this.instance;
    if (!instance || !ass) return;
    try {
      await instance.ready;
      if (this.instance !== instance) return;
      await instance.renderer.setTrack(ass);
      await this.repaint();
    } catch (err) {
      this.fail(err);
    }
  }

  private canvas(): HTMLCanvasElement | null {
    return this.instance?._canvas ?? null;
  }

  private fail(err: unknown): void {
    this.state.set('error');
    this.error.set(err instanceof Error ? err.message : String(err));
    console.error('[lyricburn] legenda ao vivo falhou:', err);
  }
}
