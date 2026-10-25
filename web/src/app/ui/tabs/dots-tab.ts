import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ConfigStore } from '../../core/config.store';
import { ProjectStore } from '../../core/project.store';
import { Slider, Toggle } from '../controls';
import { mmss } from '../format';

/** Seção [dots] do config.py — os pontinhos que dançam no instrumental. */
@Component({
  selector: 'lb-dots-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Slider, Toggle],
  template: `
    <lb-toggle label="Mostrar pontinhos nas pausas" [value]="d().enabled"
               (changed)="cfg.patch('dots', 'enabled', $event)" />

    @if (d().enabled) {
      <lb-toggle label="Reagir às notas" [value]="d().reactive"
                 hint="detecta as notas do instrumental com o librosa; sem isso os pontos ficam parados"
                 (changed)="cfg.patch('dots', 'reactive', $event)" />
      <lb-slider label="Pausa mínima" [value]="d().min_gap" [min]="0.4" [max]="6" [step]="0.1" suffix="s"
                 (changed)="cfg.patch('dots', 'min_gap', $event)" />
      <lb-slider label="Raio" [value]="d().radius" [min]="2" [max]="14" [step]="0.5" suffix="px"
                 (changed)="cfg.patch('dots', 'radius', $event)" />
      <lb-slider label="Espaçamento" [value]="d().spacing" [min]="10" [max]="70" [step]="1" suffix="px"
                 (changed)="cfg.patch('dots', 'spacing', $event)" />

      @if (summary(); as s) {
        <div class="detected">
          <div class="row"><span>pausas detectadas</span><b>{{ s.gaps.length }}</b></div>
          <div class="row"><span>notas detectadas</span><b>{{ s.note_count }}</b></div>
          @for (g of s.gaps; track g.start) {
            <div class="gap">
              <span>{{ time(g.start) }} – {{ time(g.end) }}</span>
              <span>{{ g.notes.length }} notas</span>
            </div>
          }
          @if (d().reactive && !s.reactive_dots) {
            <p class="hint">sem análise de notas: os pontos ficam estáticos</p>
          }
        </div>
      }
    }
  `,
  styles: [`
    .detected {
      margin-top: 26px; padding-top: 16px; border-top: 1px solid var(--line-soft);
      font-family: var(--mono); font-size: 12px;
    }
    .row { display: flex; justify-content: space-between; color: var(--text-muted); margin-bottom: 6px; }
    .row b { color: var(--accent); font-weight: 500; }
    .gap {
      display: flex; justify-content: space-between; color: var(--text-dim);
      padding: 5px 0; border-top: 1px solid var(--line-soft); margin-top: 6px;
    }
  `],
})
export class DotsTab {
  protected cfg = inject(ConfigStore);
  private projects = inject(ProjectStore);
  protected d = this.cfg.dots;
  protected summary = this.projects.summary;
  protected time = mmss;
}
