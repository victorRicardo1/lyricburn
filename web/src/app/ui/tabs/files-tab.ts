import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ProjectStore } from '../../core/project.store';
import { fileSize, mmss } from '../format';

type Slot = 'video' | 'audio' | 'lyrics';

const SLOTS: { key: Slot; label: string; accept: string; hint: string }[] = [
  { key: 'video', label: 'Vídeo', accept: 'video/*,.mp4,.mov,.mkv,.webm', hint: 'gameplay, clipe, o que for' },
  { key: 'audio', label: 'Música', accept: 'audio/*,.mp3,.m4a,.wav,.flac,.ogg', hint: 'a faixa que entra por cima' },
  { key: 'lyrics', label: 'Letra', accept: '.lrc,.srt,.vtt,text/plain', hint: '.lrc, .srt ou .vtt' },
];

/** Entrada do projeto: sobe os três arquivos e mostra o que a API detectou. */
@Component({
  selector: 'lb-files-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (slot of slots; track slot.key) {
      <label class="slot" [class.filled]="picked()[slot.key]" [class.loaded]="!picked()[slot.key] && stored(slot.key)">
        <input type="file" [accept]="slot.accept" (change)="pick(slot.key, $event)" />
        <span class="name">{{ slot.label }}</span>
        <span class="file">{{ picked()[slot.key]?.name || stored(slot.key) || slot.hint }}</span>
        @if (picked()[slot.key]; as f) {
          <span class="size">{{ size(f) }}</span>
        } @else if (storedSize(slot.key); as b) {
          <span class="size">{{ b }}</span>
        }
      </label>
    }

    <button type="button" class="send" [disabled]="!complete() || store.uploading()"
            (click)="send()">
      {{ store.uploading() ? 'analisando…' : store.ready() ? 'Trocar arquivos' : 'Analisar arquivos' }}
    </button>

    @if (store.uploadError(); as err) { <p class="err">{{ err }}</p> }

    @if (store.project(); as p) {
      <div class="sep">detectado</div>
      <dl>
        <div><dt>vídeo</dt><dd>{{ p.meta.video.width }}×{{ p.meta.video.height }}
          · {{ mmss(p.meta.video.duration) }}
          @if (p.meta.video.fps) { · {{ p.meta.video.fps }} fps }</dd></div>
        <div><dt>som no vídeo</dt><dd>{{ p.meta.video.has_audio ? 'sim' : 'não' }}</dd></div>
        <div><dt>música</dt><dd>{{ mmss(p.meta.audio.duration) }}
          · acaba em {{ mmss(p.meta.audio.music_end) }}</dd></div>
        <div><dt>letra</dt><dd>{{ p.lines.length }} linhas
          @if (backing(); as b) { · {{ b }} de backing }</dd></div>
      </dl>

      @for (w of p.warnings; track w) { <p class="warn">{{ w }}</p> }

      <div class="sep">letra</div>
      <ul class="lines">
        @for (line of p.lines; track $index) {
          <li [class.back]="line.track === 'back'">
            <span class="t">{{ mmss(line.start) }}</span>
            <span class="x">{{ line.text }}</span>
          </li>
        }
      </ul>
    }
  `,
  styles: [`
    .slot {
      display: grid; grid-template-columns: 70px 1fr auto; align-items: center; gap: 12px;
      padding: 13px 14px; margin-bottom: 10px; cursor: pointer;
      background: var(--bg); border: 1px dashed var(--line); border-radius: var(--r-md);
      transition: border-color .12s;
    }
    .slot:hover { border-color: var(--text-dim); }
    .slot.filled { border-style: solid; border-color: var(--accent); }
    .slot.loaded { border-style: solid; border-color: var(--line); }
    .slot input { display: none; }
    .name { color: var(--text-muted); font-size: 13px; }
    .file {
      font-family: var(--mono); font-size: 12px; color: var(--text);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .slot:not(.filled) .file { color: var(--text-dim); }
    .size { font-family: var(--mono); font-size: 11px; color: var(--text-dim); }

    .send {
      width: 100%; margin-top: 14px; padding: 12px;
      background: var(--panel-2); border: 1px solid var(--line); border-radius: var(--r-md);
      color: var(--text); font-size: 14px;
    }
    .send:disabled { opacity: .4; cursor: not-allowed; }
    .send:not(:disabled):hover { border-color: var(--accent); color: var(--accent); }

    .err { color: var(--danger); font-size: 13px; margin: 12px 0 0; }
    .warn { color: #e3b341; font-size: 12px; line-height: 1.5; margin: 8px 0 0; }

    .sep {
      font-family: var(--mono); font-size: 11px; letter-spacing: .08em; text-transform: uppercase;
      color: var(--text-dim); margin: 26px 0 14px; padding-top: 16px;
      border-top: 1px solid var(--line-soft);
    }
    dl { margin: 0; font-size: 13px; }
    dl > div { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; }
    dt { color: var(--text-muted); }
    dd { margin: 0; font-family: var(--mono); font-size: 12px; text-align: right; }

    .lines { list-style: none; margin: 0; padding: 0; max-height: 280px; overflow-y: auto; }
    .lines li { display: flex; gap: 10px; padding: 4px 0; font-size: 13px; }
    .lines .t { font-family: var(--mono); font-size: 11px; color: var(--text-dim); flex: none; }
    .lines .back .x { color: var(--text-muted); font-style: italic; }
  `],
})
export class FilesTab {
  protected store = inject(ProjectStore);
  protected slots = SLOTS;
  protected mmss = mmss;

  protected picked = signal<Partial<Record<Slot, File>>>({});
  protected complete = computed(() => {
    const p = this.picked();
    return !!(p.video && p.audio && p.lyrics);
  });
  protected backing = computed(
    () => (this.store.project()?.lines ?? []).filter((l) => l.track === 'back').length,
  );

  /** Nome do arquivo que já está no projeto (depois de um F5, por exemplo). */
  protected stored(slot: Slot): string | null {
    return this.store.project()?.files[slot].original ?? null;
  }

  protected storedSize(slot: Slot): string | null {
    const bytes = this.store.project()?.files[slot].bytes;
    return bytes ? fileSize(bytes) : null;
  }

  protected pick(slot: Slot, event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) this.picked.update((p) => ({ ...p, [slot]: file }));
  }

  protected size(file: File): string {
    return fileSize(file.size);
  }

  protected async send(): Promise<void> {
    const p = this.picked();
    if (!p.video || !p.audio || !p.lyrics) return;
    await this.store.upload({ video: p.video, audio: p.audio, lyrics: p.lyrics });
  }
}
