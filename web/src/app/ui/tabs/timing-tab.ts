import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ConfigStore } from '../../core/config.store';
import { ProjectStore } from '../../core/project.store';
import { Field, Select } from '../controls';

/** Seção [timing] do config.py. */
@Component({
  selector: 'lb-timing-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Field, Select],
  template: `
    <lb-field label="Música começa em" [value]="t().music_start" placeholder="2:26"
              hint="minutagem (2:26), segundos (146) ou 0 pro início"
              (changed)="cfg.patch('timing', 'music_start', $any($event))" />

    <div class="sep">ou comece por uma linha da letra</div>

    <lb-field label="Começar na linha" [value]="t().start_at_lyric" placeholder="they got it"
              [note]="matches()"
              hint="se preenchido, ignora o campo acima"
              (changed)="cfg.patch('timing', 'start_at_lyric', $any($event))" />
    <div class="row">
      <lb-field label="Ocorrência" kind="number" [min]="1" [value]="t().occurrence"
                (changed)="cfg.patch('timing', 'occurrence', +$event)" />
      <lb-field label="Lead-in (s)" kind="number" [step]="0.1" [value]="t().lead_in"
                (changed)="cfg.patch('timing', 'lead_in', +$event)" />
    </div>

    <div class="sep">ajustes</div>

    <lb-field label="Música entra no vídeo em (s)" kind="number" [step]="0.1" [value]="t().video_offset"
              (changed)="cfg.patch('timing', 'video_offset', +$event)" />
    <lb-field label="Sync da letra (s)" kind="number" [step]="0.05" [value]="t().lyrics_offset"
              hint="+ atrasa a letra, − adianta"
              (changed)="cfg.patch('timing', 'lyrics_offset', +$event)" />
    <lb-select label="Termina quando" [value]="t().end" [options]="endOptions"
               hint="auto = o que acabar primeiro, vídeo ou música"
               (changed)="cfg.patch('timing', 'end', $any($event))" />
    <lb-field label="Duração máxima (s)" kind="number" [step]="1" [min]="0" [value]="t().max_duration"
              hint="0 = sem limite"
              (changed)="cfg.patch('timing', 'max_duration', +$event)" />
  `,
  styles: [`
    .sep {
      font-family: var(--mono); font-size: 11px; letter-spacing: .08em; text-transform: uppercase;
      color: var(--text-dim); margin: 26px 0 14px; padding-top: 16px;
      border-top: 1px solid var(--line-soft);
    }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  `],
})
export class TimingTab {
  protected cfg = inject(ConfigStore);
  private projects = inject(ProjectStore);
  protected t = this.cfg.timing;

  protected endOptions = [
    { value: 'auto', label: 'auto' },
    { value: 'video', label: 'no fim do vídeo' },
    { value: 'music', label: 'no fim da música' },
  ];

  /** Quantas vezes a linha buscada aparece — ajuda a escolher a ocorrência. */
  protected matches(): string | null {
    const query = this.t().start_at_lyric.trim().toLowerCase();
    if (!query) return null;
    const lines = this.projects.project()?.lines ?? [];
    const n = lines.filter((l) => l.track === 'main' && l.text.toLowerCase().includes(query)).length;
    return n ? `${n}×` : 'nenhuma';
  }
}
