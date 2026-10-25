import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Api } from './api';
import { ProjectStore } from './project.store';
import { RenderStore } from './render.store';
import { Job, Project } from './types';

export type PreviewFormat = 'mp4' | 'webm';
/** Qual vídeo está na tela: a entrada crua ou o resultado do último export. */
export type Clip = 'original' | 'render';
type Build = 'idle' | 'building' | 'ready' | 'error';

/** O que o navegador diz que toca — nem sempre é verdade, daí o fallback no erro. */
const PROBES: Record<PreviewFormat, string> = {
  mp4: 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
  webm: 'video/webm; codecs="vp9, opus"',
};

/** Containers que o <video> não abre, por mais que o ffmpeg abra. */
const UNPLAYABLE = /\.(mkv|avi|flv|wmv|ts|mpg|mpeg|m2ts)$/i;
const RISKY_CODECS = /hevc|h265|av1|vp8|mpeg4|prores/i;

/**
 * De onde o `<video>` da prévia carrega.
 *
 * Dois eixos independentes:
 *
 * * **clipe** — o vídeo de entrada ou o renderizado (já com a legenda queimada);
 * * **fonte** — o arquivo direto ou uma cópia transcodificada, quando o navegador
 *   não dá conta do original.
 *
 * A troca pra cópia acontece por dois caminhos, porque nenhum basta sozinho:
 * antes de tentar (`canPlayType` + extensão/codec) e depois de tentar (evento
 * `error` do elemento — tem navegador que promete H.264 e entrega quadro preto).
 */
@Injectable({ providedIn: 'root' })
export class PreviewSource {
  private api = inject(Api);
  private projects = inject(ProjectStore);
  private render = inject(RenderStore);

  readonly clip = signal<Clip>('original');
  readonly build = signal<Build>('idle');
  readonly format = signal<PreviewFormat>('mp4');
  private proxied = signal(false);

  /** Só dá pra ver o resultado depois que um export terminou. */
  readonly hasRender = computed(() => this.render.job()?.status === 'done');

  /** O render na tela foi feito com a config que está nos controles agora? */
  readonly renderStale = computed(() => this.hasRender() && this.render.stale());

  /** URL que o <video> deve usar agora. Null = ainda não dá pra tocar nada. */
  readonly url = computed(() => {
    const project = this.projects.project();
    if (!project) return null;

    if (this.clip() === 'render') {
      const job = this.render.job();
      if (!job || job.status !== 'done') return null;
      if (!this.proxied()) return this.api.jobVideoUrl(job.id, 'mp4');
      return this.build() === 'ready' ? this.api.jobVideoUrl(job.id, this.format()) : null;
    }

    if (!this.proxied()) return this.api.mediaUrl(project.id, 'video');
    return this.build() === 'ready' ? this.api.previewUrl(project.id, this.format()) : null;
  });

  readonly status = computed(() => {
    if (!this.proxied()) return null;
    if (this.build() === 'building') return 'convertendo o vídeo pra prévia…';
    if (this.build() === 'error') return 'não consegui converter o vídeo pra prévia';
    return `prévia convertida (${this.format()})`;
  });

  /** Último render que já foi mostrado sozinho — pra não insistir depois. */
  private autoShown: string | null = null;

  constructor() {
    // `untracked` nos dois: o corpo chama `show`/`useProxy`, que leem `clip`.
    // Sem isso o effect passaria a depender de `clip` e, ao trocar de clipe no
    // botão, ele reagiria à própria mudança e empurraria a escolha de volta.
    effect(() => {
      const project = this.projects.project();
      untracked(() => this.onProjectChanged(project));
    });

    effect(() => {
      const job = this.render.job();
      untracked(() => this.onJobChanged(job));
    });
  }

  private onProjectChanged(project: Project | null): void {
    this.autoShown = null;
    this.clip.set('original');
    this.reset();
    if (!project) return;

    const forced = forcedFormat();
    if (forced) {
      this.format.set(forced);
      void this.useProxy(forced);
    } else if (!this.canPlayOriginal(project.files.video.original, project.meta.video.codec)) {
      void this.useProxy(this.bestFormat());
    }
  }

  /** Export terminou: mostra o resultado uma vez — depois a escolha é de quem usa. */
  private onJobChanged(job: Job | null): void {
    if (job?.status !== 'done' || this.autoShown === job.id) return;
    this.autoShown = job.id;
    // voltou do F5: o "Com legenda" fica disponível, mas quem escolhe é a pessoa
    if (this.render.restoredJobId() === job.id) return;
    this.show('render');
  }

  /** Troca de clipe pelo botão acima do vídeo. */
  show(clip: Clip): void {
    if (clip === this.clip()) return;
    this.clip.set(clip);
    this.reset();

    const forced = forcedFormat();
    if (forced) {
      this.format.set(forced);
      void this.useProxy(forced);
      return;
    }
    if (clip === 'original') {
      const project = this.projects.project();
      if (project && !this.canPlayOriginal(project.files.video.original, project.meta.video.codec)) {
        void this.useProxy(this.bestFormat());
      }
    } else if (!this.canPlay(PROBES.mp4)) {
      // o render sai sempre em H.264; navegador sem ele precisa da cópia
      void this.useProxy('webm');
    }
  }

  /** Chamado pelo (error) do <video>: o palpite estava errado, troca pra cópia. */
  onPlaybackError(): void {
    if (!this.projects.project()) return;
    if (this.proxied()) {
      // já é a cópia convertida e mesmo assim não tocou: não tem plano C, avisa
      this.waitToken++;
      this.build.set('error');
      return;
    }
    void this.useProxy(this.bestFormat());
  }

  private reset(): void {
    this.waitToken++;          // invalida qualquer espera em andamento
    this.proxied.set(false);
    this.build.set('idle');
  }

  private canPlay(mime: string): boolean {
    return document.createElement('video').canPlayType(mime) !== '';
  }

  private canPlayOriginal(filename: string, codec: string | null): boolean {
    if (UNPLAYABLE.test(filename)) return false;
    if (codec && RISKY_CODECS.test(codec)) return false;
    return this.canPlay(PROBES.mp4);
  }

  private bestFormat(): PreviewFormat {
    return this.canPlay(PROBES.mp4) ? 'mp4' : 'webm';
  }

  /**
   * Cada espera recebe um número. Se o clipe ou o projeto mudar no meio, a espera
   * antiga perde a vez e para — senão fica um polling órfão batendo na API pra
   * sempre, e eles se acumulam a cada troca.
   */
  private waitToken = 0;

  private async useProxy(format: PreviewFormat): Promise<void> {
    const project = this.projects.project();
    if (!project) return;
    const token = ++this.waitToken;
    this.format.set(format);
    this.proxied.set(true);
    this.build.set('building');
    try {
      const url = this.clip() === 'render'
        ? this.api.jobVideoUrl(this.render.job()!.id, format)
        : this.api.previewUrl(project.id, format);
      await this.api.waitUntilReady(url, () => token === this.waitToken);
      if (token !== this.waitToken) return;
      this.build.set('ready');
    } catch {
      if (token === this.waitToken) this.build.set('error');
    }
  }
}

/** `?preview=webm` força a cópia — útil pra depurar codec numa máquina específica. */
function forcedFormat(): PreviewFormat | null {
  const value = new URLSearchParams(location.search).get('preview');
  return value === 'mp4' || value === 'webm' ? value : null;
}
