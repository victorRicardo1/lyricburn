import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ConfigStore, PRESETS } from '../core/config.store';
import { ProjectStore } from '../core/project.store';

/** Cabeçalho: nome do projeto, estado do plan e os presets. */
@Component({
  selector: 'lb-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="brand">
      <span class="name">lyricburn</span>
      <span class="ver">v0.1</span>
      @if (projectName(); as n) {
        <span class="sep">/</span>
        <span class="project">{{ n }}</span>
      }
    </div>

    <div class="right">
      <span class="status" [class.live]="live()" [class.working]="projects.planning()">
        <i></i>{{ statusText() }}
      </span>
      <label class="preset">
        <span>Preset</span>
        <select [value]="cfg.presetId()" (change)="cfg.applyPreset($any($event.target).value)">
          @for (p of presets; track p.id) { <option [value]="p.id">{{ p.name }}</option> }
        </select>
      </label>
    </div>
  `,
  styles: [`
    :host {
      display: flex; align-items: center; justify-content: space-between; gap: 20px;
      padding: 16px 22px; border-bottom: 1px solid var(--line-soft);
    }
    .brand { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
    .name { font-size: 19px; font-weight: 700; letter-spacing: -.01em; }
    .ver { font-family: var(--mono); font-size: 12px; color: var(--text-dim); }
    .sep { color: var(--text-dim); margin-left: 4px; }
    .project {
      font-size: 15px; color: var(--text-muted);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }

    .right { display: flex; align-items: center; gap: 18px; flex: none; }
    .status { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-dim); }
    .status i {
      width: 7px; height: 7px; border-radius: 50%; background: var(--text-dim);
      transition: background .2s;
    }
    .status.live i { background: var(--accent); }
    .status.working i { background: #e3b341; animation: pulse 1s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: .3; } }

    .preset { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text-muted); }
    .preset select {
      width: auto; min-width: 170px; padding: 10px 12px;
      background: var(--panel); font-family: var(--sans); font-size: 14px;
      border-radius: var(--r-md);
    }
  `],
})
export class Header {
  protected cfg = inject(ConfigStore);
  protected projects = inject(ProjectStore);
  protected presets = PRESETS;

  /** Nome do projeto = nome do vídeo + da música, como o mockup. */
  protected projectName = computed(() => {
    const files = this.projects.project()?.files;
    if (!files) return null;
    const stem = (name: string) => name.replace(/\.[^.]+$/, '');
    return stem(files.audio.original) + ' · ' + stem(files.video.original);
  });

  /** Verde = tem .ass em dia (é o que a fase 3a vai desenhar). */
  protected live = computed(() => this.projects.plan() !== null && !this.projects.planning());

  protected statusText = computed(() => {
    if (this.projects.planning()) return 'calculando…';
    if (this.projects.planError()) return 'config inválida';
    return this.projects.plan() ? 'legenda em dia' : 'sem projeto';
  });
}
