import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ConfigStore } from '../core/config.store';
import { ProjectStore } from '../core/project.store';
import { RenderStore } from '../core/render.store';
import { fileSize } from './format';

/** Botão de exportar + progresso do job + link do download. */
@Component({
  selector: 'lb-export-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      @if (render.job(); as job) {
        @if (job.status === 'done') {
          @if (render.stale()) {
            <!-- mexeu na prévia depois do export: o natural agora é regerar, não baixar -->
            <button type="button" class="btn go" (click)="start()">Regerar com as mudanças</button>
            <a class="sub-link" [href]="render.downloadUrl()" [download]="job.filename">
              ou baixar a versão anterior
            </a>
          } @else {
            <a class="btn done" [href]="render.downloadUrl()" [download]="job.filename">
              Baixar {{ job.filename }}
            </a>
          }
          <div class="meta">
            <span>{{ size(job.size_bytes) }}</span>
            <span>{{ job.elapsed.toFixed(0) }}s</span>
            @if (!render.stale()) {
              <button type="button" class="again" (click)="start()">regerar</button>
            }
          </div>
          <label class="fast">
            <input type="checkbox" [checked]="fast()" (change)="fast.set($any($event.target).checked)" />
            render rápido (teste)
          </label>
        } @else if (job.status === 'error') {
          <p class="err">{{ render.error() || job.message }}</p>
          <button type="button" class="btn ghost" (click)="render.clear()">tentar de novo</button>
        } @else {
          <div class="bar"><span [style.width.%]="job.progress * 100"></span></div>
          <div class="meta">
            <span>{{ phase(job.status) }} · {{ (job.progress * 100).toFixed(0) }}%</span>
            @if (job.speed) { <span>{{ job.speed }}×</span> }
            @if (job.eta !== null) { <span>faltam {{ job.eta.toFixed(0) }}s</span> }
          </div>
        }
      } @else {
        @if (render.error(); as err) { <p class="err">{{ err }}</p> }
        <button type="button" class="btn go" [disabled]="!canExport()" (click)="start()">
          {{ render.starting() ? 'enviando…' : 'Exportar vídeo' }}
        </button>
        <label class="fast">
          <input type="checkbox" [checked]="fast()" (change)="fast.set($any($event.target).checked)" />
          render rápido (teste)
        </label>
      }
    </div>
  `,
  styles: [`
    .wrap { padding: 16px 18px 18px; border-top: 1px solid var(--line-soft); }
    .btn {
      display: block; width: 100%; padding: 15px; text-align: center; text-decoration: none;
      border: none; border-radius: var(--r-md); font-size: 15px; font-weight: 500;
    }
    .go { background: var(--accent); color: var(--accent-ink); }
    .go:disabled { opacity: .35; cursor: not-allowed; }
    .done { background: var(--accent); color: var(--accent-ink); }
    .ghost { background: var(--panel-2); color: var(--text); border: 1px solid var(--line); }

    .bar { height: 8px; background: var(--line); border-radius: 999px; overflow: hidden; }
    .bar span {
      display: block; height: 100%; background: var(--accent); border-radius: 999px;
      transition: width .3s linear;
    }
    .meta {
      display: flex; gap: 14px; justify-content: center; margin-top: 10px;
      font-family: var(--mono); font-size: 11px; color: var(--text-dim);
    }
    .again { background: none; border: none; color: var(--text-muted); text-decoration: underline; padding: 0; }
    .sub-link {
      display: block; margin-top: 8px; text-align: center;
      font-size: 12px; color: var(--text-muted);
    }
    .err { color: var(--danger); font-size: 12px; margin: 0 0 10px; line-height: 1.5; }
    .fast {
      display: flex; align-items: center; justify-content: center; gap: 7px;
      margin-top: 12px; font-size: 12px; color: var(--text-dim); cursor: pointer;
    }
    .fast input { accent-color: var(--accent); }
  `],
})
export class ExportBar {
  private projects = inject(ProjectStore);
  private cfg = inject(ConfigStore);
  protected render = inject(RenderStore);

  protected fast = signal(false);
  protected canExport = computed(() => this.projects.ready() && !this.render.busy());

  protected size = fileSize;

  protected phase(status: string): string {
    return { queued: 'na fila', preparing: 'preparando', rendering: 'renderizando' }[status] ?? status;
  }

  protected async start(): Promise<void> {
    const project = this.projects.project();
    if (!project) return;
    await this.render.start(project.id, this.cfg.config(), this.fast());
  }
}
