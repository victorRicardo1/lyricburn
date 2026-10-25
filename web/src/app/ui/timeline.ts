import {
  ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, signal,
  untracked, viewChild,
} from '@angular/core';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, { type Region } from 'wavesurfer.js/plugins/regions';
import { Api } from '../core/api';
import { ConfigStore } from '../core/config.store';
import { ProjectStore } from '../core/project.store';
import { LyricLine, Project } from '../core/types';
import { mmss, mmssShort, parseTime } from './format';

/** Barras por segundo pedidas pra waveform de alta resolução (o upload traz ~3/s). */
const PEAKS_PER_SECOND = 40;
/** Distância máxima, em pixels na tela, pra janela grudar numa linha ou num beat. */
const SNAP_PX = 10;
const MAX_ZOOM = 60;

type Snap = { time: number; kind: 'linha' | 'beat'; label: string };

/**
 * Timeline da música: waveform (wavesurfer.js) com a janela que vira vídeo.
 *
 * Tudo aqui é em **tempo da música** — é o referencial em que `music_start` vive.
 * A janela é uma região do plugin Regions do tamanho do vídeo de saída: arrastar
 * escreve `timing.music_start` no ConfigStore, e o campo "Música começa em" move a
 * janela de volta. O áudio toca num <audio> próprio, separado do vídeo da prévia.
 *
 * Atalhos com a timeline em foco: espaço toca/pausa, Enter começa o vídeo no ponto
 * ouvido, setas movem a janela 0,1 s (com Shift, 1 s).
 */
@Component({
  selector: 'lb-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    tabindex: '0',
    '(keydown)': 'onKey($event)',
    '[attr.aria-label]': '"timeline da música"',
  },
  template: `
    @if (project(); as p) {
      <header>
        <h2>{{ title() }}</h2>
        <span class="mono sub">{{ subtitle() }}</span>
        <span class="spacer"></span>
        @if (snapNote(); as note) { <span class="mono snap-note">{{ note }}</span> }
        <span class="mono hint">clique ouve · arraste a janela · espaço · Enter · ←/→</span>
      </header>

      <div class="toolbar">
        <button type="button" class="tool play" (click)="playPause()"
                [attr.aria-label]="playing() ? 'pausar música' : 'tocar música'">
          {{ playing() ? '❚❚' : '▶' }}
        </button>
        <span class="mono now">{{ clock() }}</span>
        <span class="now-line">
          @if (currentLine(); as l) { <span [class.back]="l.track === 'back'">{{ l.text }}</span> }
        </span>
        <button type="button" class="tool" (click)="startHere()" title="Enter">começar aqui</button>
        <button type="button" class="tool" (click)="playWindow()">ouvir trecho</button>
        <label class="tool toggle" [class.on]="snapOn()">
          <input type="checkbox" [checked]="snapOn()" (change)="snapOn.set($any($event.target).checked)" />
          snap
        </label>
        <span class="zoom">
          <button type="button" class="tool sq" (click)="setZoom(zoom() / 1.5)" aria-label="menos zoom">−</button>
          <input type="range" min="1" [max]="maxZoom" step="0.1" [value]="zoom()"
                 aria-label="zoom" (input)="setZoom(+$any($event.target).value)" />
          <button type="button" class="tool sq" (click)="setZoom(zoom() * 1.5)" aria-label="mais zoom">+</button>
        </span>
      </div>

      <div class="track">
        <span class="tag">MÚSICA</span>
        <div class="lane-wrap">
          <div class="wave" #wave (mousemove)="hover($event)" (mouseleave)="hoverAt.set(null)"></div>
          @if (hoverInfo(); as h) {
            <div class="tip" [style.left.px]="h.x">
              <b class="mono">{{ h.time }}</b>
              @if (h.line) { <span>{{ h.line }}</span> }
            </div>
          }
        </div>
      </div>

      <div class="track">
        <span class="tag">LETRA</span>
        <div class="lane blocks" (mousemove)="hover($event)" (mouseleave)="hoverAt.set(null)">
          @for (b of visibleBeats(); track b) {
            <span class="beat" [style.left.%]="pos(b)"></span>
          }
          @for (line of visibleLines(); track line.index) {
            <button type="button" class="block"
                    [style.left.%]="pos(line.start)" [style.width.%]="width(line)"
                    [class.on]="inWindow(line.start)" [class.back]="line.track === 'back'"
                    [class.now]="currentLine() === line"
                    [attr.aria-label]="line.text"
                    (click)="listen(line.start)" (dblclick)="startAtLine(line)"></button>
          }
        </div>
      </div>

      <div class="axis">
        @for (t of ticks(); track t) { <span [style.left.%]="pos(t)">{{ short(t) }}</span> }
      </div>

      <audio #music preload="auto"></audio>
    } @else {
      <div class="empty mono">a waveform aparece aqui depois que você subir a música</div>
    }
  `,
  styles: [`
    /* min-width: 0 é o que segura a waveform com zoom: sem ele a timeline (item de
       grid) cresce até a largura do conteúdo, o wavesurfer se redimensiona pra caber
       e o zoom realimenta a si mesmo */
    :host {
      display: block; min-width: 0; padding: 14px 20px 12px; outline: none;
      background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-lg);
    }
    :host(:focus-visible) { border-color: var(--accent); }

    header { display: flex; align-items: baseline; gap: 14px; margin-bottom: 10px; }
    h2 { margin: 0; font-size: 15px; font-weight: 500; white-space: nowrap; }
    .sub { font-size: 12px; color: var(--text-dim); white-space: nowrap; }
    .spacer { flex: 1; }
    .hint { font-size: 11px; color: var(--text-dim); white-space: nowrap; }
    .snap-note { font-size: 11px; color: var(--accent); white-space: nowrap; }

    .toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .tool {
      padding: 6px 11px; background: var(--bg); border: 1px solid var(--line);
      border-radius: var(--r-sm); color: var(--text-muted); font-size: 12px; white-space: nowrap;
    }
    .tool:hover { color: var(--text); border-color: var(--text-dim); }
    .tool.play { width: 34px; padding: 6px 0; color: var(--accent); }
    .tool.sq { width: 28px; padding: 5px 0; }
    .toggle { display: flex; align-items: center; cursor: pointer; }
    .toggle input { display: none; }
    .toggle.on { color: var(--accent); border-color: rgba(200, 240, 106, .4); }
    .now { font-size: 12px; color: var(--text); width: 64px; }
    .now-line {
      flex: 1; min-width: 0; font-size: 13px; color: var(--blue);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .now-line .back { font-style: italic; opacity: .8; }
    .zoom { display: flex; align-items: center; gap: 6px; }
    .zoom input { width: 110px; }

    .track { display: flex; align-items: center; gap: 14px; margin-bottom: 6px; }
    .tag {
      width: 56px; flex: none; font-family: var(--mono); font-size: 10px;
      letter-spacing: .1em; color: var(--text-dim);
    }
    .lane-wrap { position: relative; flex: 1; min-width: 0; }
    .wave { width: 100%; min-width: 0; overflow: hidden; }

    /* por dentro da faixa, no topo da waveform: por cima ela cobria a barra de botões */
    .tip {
      position: absolute; top: 4px; transform: translateX(-50%); z-index: 5;
      max-width: 340px; padding: 5px 9px; pointer-events: none;
      background: #0b0c0e; border: 1px solid var(--line); border-radius: 6px;
      font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .tip b { color: var(--accent); font-weight: 400; margin-right: 8px; }

    .lane { position: relative; flex: 1; min-width: 0; overflow: hidden; }
    .blocks { height: 22px; }
    .block {
      position: absolute; top: 4px; height: 14px; min-width: 3px; padding: 0;
      background: #2c3238; border: none; border-radius: 2px; cursor: pointer;
    }
    .block:hover { background: #47505a; }
    .block.on { background: var(--blue); opacity: .75; }
    .block.back { top: 10px; height: 8px; }
    .block.now { background: var(--accent); opacity: 1; }
    .beat { position: absolute; top: 0; bottom: 0; width: 1px; background: rgba(255, 255, 255, .07); }

    .axis {
      position: relative; height: 14px; margin: 6px 0 0 70px;
      font-family: var(--mono); font-size: 10px; color: var(--text-dim);
    }
    .axis span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
    .empty { padding: 28px; text-align: center; font-size: 12px; color: var(--text-dim); }
  `],
})
export class Timeline {
  private api = inject(Api);
  private cfg = inject(ConfigStore);
  private projects = inject(ProjectStore);

  private waveRef = viewChild<ElementRef<HTMLElement>>('wave');
  private musicRef = viewChild<ElementRef<HTMLAudioElement>>('music');

  protected project = this.projects.project;
  protected short = mmssShort;
  protected maxZoom = MAX_ZOOM;

  protected playing = signal(false);
  protected currentTime = signal(0);
  protected zoom = signal(1);
  protected snapOn = signal(true);
  protected snapNote = signal<string | null>(null);
  protected hoverAt = signal<{ x: number; time: number } | null>(null);
  /** Trecho da música visível na tela (muda com zoom e rolagem). */
  protected visible = signal<[number, number]>([0, 1]);

  private beats = signal<number[]>([]);
  private ws: WaveSurfer | null = null;
  private regions: RegionsPlugin | null = null;
  private region: Region | null = null;
  private dragging = false;
  /** Escala pedida no último zoom (px por segundo); 0 = música inteira na largura. */
  private pxPerSec = 0;
  /** Rolagem a aplicar depois do redesenho — antes dele o wrapper ainda tem a largura velha. */
  private pendingScroll: number | null = null;
  private noteTimer: ReturnType<typeof setTimeout> | null = null;

  private duration = computed(() => this.project()?.peaks.duration || 1);

  /** Linhas principais e de backing, em tempo da música, com índice pra track. */
  private lines = computed<(LyricLine & { index: number })[]>(() =>
    (this.project()?.lines ?? []).map((l, i) => ({ ...l, index: l.index ?? i })));

  /**
   * Onde a janela começa. Com "começar na linha" preenchido quem decide é o
   * servidor (o plan), senão é o próprio campo — e aí a janela anda na hora,
   * sem esperar o plan voltar.
   */
  protected windowStart = computed(() => {
    const t = this.cfg.timing();
    if (t.start_at_lyric.trim()) return this.projects.summary()?.music_start ?? null;
    const v = parseTime(t.music_start);
    return Number.isFinite(v) ? Math.max(0, v) : null;
  });

  /** Quanto de música cabe no vídeo: duração final menos o ponto em que a música entra. */
  protected windowLength = computed(() => {
    const s = this.projects.summary();
    if (s) return Math.max(0.5, s.duration - s.video_offset);
    return this.project()?.meta.video.duration ?? 10;
  });

  protected currentLine = computed(() => this.lineAt(this.currentTime()));

  protected title = computed(() => {
    const name = this.project()?.files.audio.original ?? '';
    return name.replace(/\.[^.]+$/, '').replace(/\s*\(.*?\)\s*$/, '');
  });

  protected subtitle = computed(() => {
    const start = this.windowStart();
    const total = mmssShort(this.duration());
    if (start === null) return total;
    return `${total} · trecho no vídeo ${mmss(start)} → ${mmss(start + this.windowLength())}`;
  });

  protected clock = computed(() => mmss(this.currentTime()));

  protected hoverInfo = computed(() => {
    const h = this.hoverAt();
    if (!h) return null;
    return { x: h.x, time: mmss(h.time), line: this.lineAt(h.time)?.text ?? null };
  });

  protected visibleLines = computed(() => {
    const [a, b] = this.visible();
    return this.lines().filter((l) => l.end >= a && l.start <= b);
  });

  /** Beats só aparecem com zoom suficiente pra não virar uma parede de risquinhos. */
  protected visibleBeats = computed(() => {
    const [a, b] = this.visible();
    if (b - a > 75) return [];
    return this.beats().filter((t) => t >= a && t <= b);
  });

  protected ticks = computed(() => {
    const [a, b] = this.visible();
    const span = b - a;
    const steps = [1, 2, 5, 10, 15, 30, 60, 120];
    const step = steps.find((s) => span / s <= 9) ?? 300;
    const out: number[] = [];
    for (let t = Math.ceil(a / step) * step; t <= b; t += step) out.push(t);
    return out;
  });

  constructor() {
    // projeto novo: monta a waveform de novo (o <div #wave> só existe com projeto)
    effect(() => {
      const project = this.project();
      const host = this.waveRef()?.nativeElement;
      const media = this.musicRef()?.nativeElement;
      untracked(() => {
        this.teardown();
        if (project && host && media) this.mount(project, host, media);
      });
    });

    // o campo "Música começa em" (ou o plan) mudou: a janela acompanha
    effect(() => {
      const start = this.windowStart();
      const length = this.windowLength();
      untracked(() => this.placeRegion(start, length));
    });

    inject(DestroyRef).onDestroy(() => this.teardown());
  }

  // ---------- wavesurfer ----------

  private mount(project: Project, container: HTMLElement, media: HTMLAudioElement): void {
    const regions = RegionsPlugin.create();
    const ws = WaveSurfer.create({
      container,
      media,
      url: this.api.mediaUrl(project.id, 'audio'),
      // com picos + duração o wavesurfer não decodifica o áudio de novo no navegador
      peaks: [project.peaks.values],
      duration: project.peaks.duration,
      height: 64,
      waveColor: '#3a4048',
      progressColor: '#5b636d',
      cursorColor: '#c8f06a',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      normalize: false,
      interact: true,
      autoScroll: true,
      autoCenter: false,
      plugins: [regions],
    });
    this.ws = ws;
    this.regions = regions;
    this.zoom.set(1);
    this.pxPerSec = 0;

    ws.on('ready', () => {
      this.updateVisible();
      this.placeRegion(this.windowStart(), this.windowLength());
    });
    ws.on('redrawcomplete', () => {
      if (this.pendingScroll !== null) {
        ws.setScroll(this.pendingScroll);
        this.pendingScroll = null;
      }
      this.updateVisible();
    });
    ws.on('zoom', () => requestAnimationFrame(() => this.updateVisible()));
    // não uso o payload do evento 'scroll' do wavesurfer: ele vem de um estado em
    // cache que fica velho logo depois do zoom. Leio a rolagem direto do contêiner.
    const scroller = ws.getWrapper().parentElement;
    scroller?.addEventListener('scroll', () => this.updateVisible(), { passive: true });
    ws.on('timeupdate', (t) => this.currentTime.set(t));
    ws.on('play', () => this.playing.set(true));
    ws.on('pause', () => this.playing.set(false));
    ws.on('finish', () => this.playing.set(false));
    // clique na waveform: o wavesurfer já posicionou o cursor, só falta tocar
    ws.on('interaction', () => void ws.play());

    regions.on('region-update', () => {
      this.dragging = true;
    });
    regions.on('region-updated', (region) => {
      this.dragging = false;
      this.commitStart(this.snapIfClose(region.start));
    });
    regions.on('region-clicked', (_region, e) => {
      e.stopPropagation();
      this.listen(this.timeAtClientX(e.clientX));
    });

    // picos de alta resolução e beats chegam depois, sem travar a abertura
    const id = project.id;
    const buckets = Math.min(20000, Math.round(project.peaks.duration * PEAKS_PER_SECOND));
    this.api.peaks(id, buckets).then((hi) => {
      if (this.ws === ws) ws.setOptions({ peaks: [hi.values], duration: hi.duration });
    }).catch(() => undefined);
    this.beats.set([]);
    this.api.beats(id).then((b) => {
      if (this.project()?.id === id) this.beats.set(b.beats);
    }).catch(() => undefined);
  }

  private teardown(): void {
    this.region = null;
    this.regions = null;
    this.ws?.destroy();
    this.ws = null;
    this.playing.set(false);
    this.currentTime.set(0);
  }

  private placeRegion(start: number | null, length: number): void {
    if (!this.regions || !this.ws || this.dragging || start === null) return;
    if (!this.ws.getDuration()) return;   // ainda carregando: o 'ready' chama de novo
    const end = Math.min(start + length, this.duration());
    if (this.region) {
      if (Math.abs(this.region.start - start) > 0.005 || Math.abs(this.region.end - end) > 0.005) {
        this.region.setOptions({ start, end });
      }
      return;
    }
    this.region = this.regions.addRegion({
      start, end,
      drag: true,
      resize: false,
      color: 'rgba(200, 240, 106, 0.10)',
      content: this.regionLabel(),
    });
    const el = this.region.element;
    if (el) {
      el.style.border = '1px solid #c8f06a';
      el.style.borderRadius = '4px';
      el.style.cursor = 'grab';
    }
  }

  private regionLabel(): HTMLElement {
    const label = document.createElement('span');
    label.textContent = 'vídeo';
    label.style.cssText = 'font: 10px "IBM Plex Mono", monospace; color: #c8f06a; padding: 2px 5px; display: inline-block;';
    return label;
  }

  /** Largura total da waveform. Calculada como o wavesurfer calcula, em vez de
   *  medida: logo depois de um zoom o elemento ainda está com a largura antiga. */
  private totalWidth(): number {
    const width = this.ws?.getWidth() ?? 1;
    return Math.max(width, this.duration() * this.pxPerSec);
  }

  /** Trecho visível, lido da geometria real do contêiner de rolagem. */
  private updateVisible(): void {
    const ws = this.ws;
    const scroller = ws?.getWrapper().parentElement;
    if (!ws || !scroller || !ws.getDuration()) return;
    const total = scroller.scrollWidth || 1;
    const d = this.duration();
    const a = (scroller.scrollLeft / total) * d;
    const b = Math.min(d, ((scroller.scrollLeft + scroller.clientWidth) / total) * d);
    const [pa, pb] = this.visible();
    if (Math.abs(pa - a) > 1e-3 || Math.abs(pb - b) > 1e-3) this.visible.set([a, b]);
  }

  // ---------- janela ----------

  /** Grava o novo início: é o que o plan e o export vão usar. */
  private commitStart(start: number): void {
    const max = Math.max(0, this.duration() - 0.5);
    const clamped = Math.round(Math.min(Math.max(0, start), max) * 100) / 100;
    // arrastar é escolher na mão: "começar na linha" deixaria a janela sem efeito
    this.cfg.merge({ timing: { music_start: mmss(clamped), start_at_lyric: '' } });
    this.placeRegion(clamped, this.windowLength());
  }

  /**
   * Gruda no início de linha ou no beat mais próximo, se estiver a poucos pixels.
   * Linha tem prioridade: sem zoom o alcance passa de 1 s e sempre haveria um beat
   * por perto (eles vêm a cada ~0,6 s), então a linha nunca ganharia no empate.
   */
  private snapIfClose(start: number): number {
    if (!this.snapOn() || !this.ws) return start;
    const reach = SNAP_PX / (this.totalWidth() / this.duration());
    const nearest = (cands: Snap[]) => cands
      .filter((c) => Math.abs(c.time - start) <= reach)
      .sort((a, b) => Math.abs(a.time - start) - Math.abs(b.time - start))[0];
    const line = nearest(this.lines().filter((l) => l.track === 'main')
      .map((l) => ({ time: l.start, kind: 'linha' as const, label: l.text })));
    const best = line ?? nearest(this.beats().map((t) => ({ time: t, kind: 'beat' as const, label: '' })));
    if (!best) return start;
    this.flash(best.kind === 'linha' ? `encaixou em “${best.label}”` : `encaixou no beat ${mmss(best.time)}`);
    return best.time;
  }

  private flash(note: string): void {
    this.snapNote.set(note);
    if (this.noteTimer) clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => this.snapNote.set(null), 2200);
  }

  protected startHere(): void {
    this.commitStart(this.currentTime());
    this.flash(`vídeo começa em ${mmss(this.currentTime())}`);
  }

  protected startAtLine(line: LyricLine): void {
    const lead = Number(this.cfg.timing().lead_in) || 0;
    this.commitStart(line.start - lead);
    this.flash(`vídeo começa ${lead}s antes de “${line.text}”`);
  }

  private nudge(delta: number): void {
    const start = this.windowStart();
    if (start !== null) this.commitStart(start + delta);
  }

  // ---------- áudio ----------

  protected listen(time: number): void {
    if (!this.ws) return;
    this.ws.setTime(Math.max(0, time));
    void this.ws.play();
  }

  protected playPause(): void {
    void this.ws?.playPause();
  }

  /** Toca da entrada até o fim da janela — o trecho de música que vai estar no vídeo. */
  protected playWindow(): void {
    const start = this.windowStart();
    if (!this.ws || start === null) return;
    void this.ws.play(start, Math.min(start + this.windowLength(), this.duration()));
  }

  // ---------- zoom, hover, teclado ----------

  protected setZoom(value: number): void {
    const z = Math.min(MAX_ZOOM, Math.max(1, value));
    this.zoom.set(z);
    const ws = this.ws;
    const host = this.waveRef()?.nativeElement;
    if (!ws || !host) return;
    // zoom 1 = música inteira na largura da faixa
    this.pxPerSec = z <= 1 ? 0 : (ws.getWidth() / this.duration()) * z;
    // mantém à vista o que se está ouvindo, ou o começo da janela do vídeo
    const focus = this.playing() ? this.currentTime() : this.windowStart() ?? this.currentTime();
    this.pendingScroll = Math.max(0, focus * this.pxPerSec - ws.getWidth() * 0.1);
    ws.zoom(this.pxPerSec);
    this.updateVisible();
  }

  protected hover(event: MouseEvent): void {
    const lane = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const time = this.timeAtClientX(event.clientX);
    this.hoverAt.set({ x: event.clientX - lane.left, time });
  }

  private timeAtClientX(clientX: number): number {
    const host = this.waveRef()?.nativeElement;
    if (!host) return 0;
    const rect = host.getBoundingClientRect();
    const [a, b] = this.visible();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / (rect.width || 1)));
    return a + ratio * (b - a);
  }

  protected onKey(e: KeyboardEvent): void {
    // não rouba teclado de campo de texto (o host recebe o evento dos filhos)
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range') return;
    // botões da barra mantêm o comportamento nativo (Enter/espaço acionam o botão)
    if (target.closest('.toolbar') && (e.key === ' ' || e.key === 'Enter')) return;
    if (e.key === ' ') {
      e.preventDefault();
      this.playPause();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.startHere();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (target.tagName === 'INPUT') return;   // deixa o slider de zoom usar as setas
      e.preventDefault();
      const step = e.shiftKey ? 1 : 0.1;
      this.nudge(e.key === 'ArrowLeft' ? -step : step);
    }
  }

  // ---------- geometria da faixa da letra ----------

  protected pos(seconds: number): number {
    const [a, b] = this.visible();
    return ((seconds - a) / (b - a || 1)) * 100;
  }

  protected width(line: { start: number; end: number }): number {
    const [a, b] = this.visible();
    return Math.max(0.25, ((line.end - line.start) / (b - a || 1)) * 100);
  }

  protected inWindow(time: number): boolean {
    const start = this.windowStart();
    return start !== null && time >= start && time <= start + this.windowLength();
  }

  /** Linha cantada naquele instante; a principal ganha da de backing. */
  private lineAt(time: number): (LyricLine & { index: number }) | null {
    let found: (LyricLine & { index: number }) | null = null;
    for (const l of this.lines()) {
      if (time >= l.start && time < l.end && (!found || l.track === 'main')) found = l;
    }
    return found;
  }
}
