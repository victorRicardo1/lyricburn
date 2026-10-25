import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ConfigStore } from '../../core/config.store';
import { ProjectStore } from '../../core/project.store';
import { Position } from '../../core/types';
import { Field, Select, Slider, Toggle } from '../controls';
import { positionLabel, positionToNumber } from '../format';

const SWATCHES = ['#F5F5F5', '#FFD9A0', '#A7D8FF', '#C8F06A'];

/** Seção [style] do config.py. */
@Component({
  selector: 'lb-style-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Field, Select, Slider, Toggle],
  template: `
    <div class="field">
      <div class="label"><span>Fonte</span></div>
      <div class="fonts">
        @for (family of families(); track family) {
          <button type="button" class="font" [class.on]="s().font === family"
                  [style.font-family]="family + ', var(--sans)'"
                  (click)="cfg.patch('style', 'font', family)">{{ family }}</button>
        }
      </div>
      @if (!families().length) {
        <p class="hint">a API não respondeu /fonts — confira se o servidor está no ar</p>
      }
    </div>

    <lb-slider label="Tamanho" [value]="s().size" [min]="18" [max]="110" [step]="1" suffix="px"
               (changed)="cfg.patch('style', 'size', $event)" />

    <lb-slider label="Posição vertical" [value]="positionNumber()" [min]="0" [max]="1" [step]="0.01"
               [display]="positionText()"
               (changed)="setPosition($event)" />

    <div class="field">
      <div class="label"><span>Cor</span><span class="value">{{ s().color }}</span></div>
      <div class="colors">
        @for (color of swatches; track color) {
          <button type="button" class="dot" [class.on]="same(color)" [style.background]="color"
                  [attr.aria-label]="color" (click)="cfg.patch('style', 'color', color)"></button>
        }
        <label class="custom" [style.background]="s().color">
          <input type="color" [value]="s().color"
                 (input)="cfg.patch('style', 'color', $any($event.target).value.toUpperCase())" />
        </label>
      </div>
    </div>

    <div class="sep">traço</div>
    <lb-slider label="Contorno" [value]="s().outline" [min]="0" [max]="5" [step]="0.1"
               (changed)="cfg.patch('style', 'outline', $event)" />
    <lb-slider label="Sombra" [value]="s().shadow" [min]="0" [max]="6" [step]="0.1"
               (changed)="cfg.patch('style', 'shadow', $event)" />
    <lb-slider label="Espaçamento entre letras" [value]="s().spacing" [min]="-2" [max]="6" [step]="0.1"
               (changed)="cfg.patch('style', 'spacing', $event)" />
    <lb-slider label="Fade de cada linha" [value]="s().line_fade_ms" [min]="0" [max]="900" [step]="10"
               suffix="ms" (changed)="cfg.patch('style', 'line_fade_ms', $event)" />

    <div class="sep">backing vocal</div>
    <div class="field">
      <div class="label"><span>Fonte do backing</span></div>
      <div class="fonts">
        @for (family of families(); track family) {
          <button type="button" class="font" [class.on]="s().back_font === family"
                  [style.font-family]="family + ', var(--sans)'"
                  (click)="cfg.patch('style', 'back_font', family)">{{ family }}</button>
        }
      </div>
    </div>
    <lb-slider label="Tamanho do backing" [value]="s().back_size" [min]="12" [max]="80" [step]="1"
               suffix="px" (changed)="cfg.patch('style', 'back_size', $event)" />
    <lb-slider label="Opacidade do backing" [value]="s().back_opacity" [min]="0" [max]="1" [step]="0.05"
               [display]="pct(s().back_opacity)"
               (changed)="cfg.patch('style', 'back_opacity', $event)" />
    <lb-toggle label="Backing em itálico" [value]="s().back_italic"
               (changed)="cfg.patch('style', 'back_italic', $event)" />

    @if (backingCount() === 0) {
      <p class="hint">esta letra não tem linhas de backing vocal (as que vêm entre parênteses)</p>
    }

    <div class="sep">saída</div>
    <lb-field label="Resolução (lado menor)" kind="number" [step]="90" [min]="240"
              [value]="v().resolution" hint="720 = 720p · vale pra vídeo vertical também"
              (changed)="cfg.patch('video', 'resolution', +$event)" />
    <lb-slider label="Fade de abertura" [value]="v().fade_in" [min]="0" [max]="8" [step]="0.1" suffix="s"
               (changed)="cfg.patch('video', 'fade_in', $event)" />
    <lb-slider label="Fade de fechamento" [value]="v().fade_out" [min]="0" [max]="8" [step]="0.1" suffix="s"
               (changed)="cfg.patch('video', 'fade_out', $event)" />
    <lb-slider label="Qualidade (CRF)" [value]="v().crf" [min]="14" [max]="34" [step]="1"
               [display]="crfLabel()"
               (changed)="cfg.patch('video', 'crf', $event)" />
    <lb-select label="Preset do x264" [value]="v().preset" [options]="presets"
               hint="mais lento = arquivo menor na mesma qualidade"
               (changed)="cfg.patch('video', 'preset', $event)" />
  `,
  styles: [`
    .fonts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .font {
      padding: 13px 14px; text-align: left; background: var(--bg);
      border: 1px solid var(--line); border-radius: var(--r-md);
      font-size: 14px; color: var(--text); transition: border-color .12s, background .12s;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .font:hover { border-color: var(--text-dim); }
    .font.on { border-color: var(--accent); color: var(--accent); }

    .colors { display: flex; gap: 12px; align-items: center; }
    .dot, .custom {
      width: 42px; height: 42px; border-radius: 50%; border: 2px solid transparent;
      box-shadow: 0 0 0 1px var(--line) inset; cursor: pointer; padding: 0;
    }
    .dot.on { border-color: var(--text); }
    .custom {
      position: relative; display: grid; place-items: center; overflow: hidden;
      box-shadow: 0 0 0 1px var(--line) inset, 0 0 0 2px var(--bg);
    }
    .custom::after {
      content: ''; position: absolute; inset: 0; border-radius: 50%;
      background: conic-gradient(#ff5f6d, #ffc371, #c8f06a, #8ab4f8, #b388ff, #ff5f6d);
      -webkit-mask: radial-gradient(circle, transparent 54%, #000 56%);
      mask: radial-gradient(circle, transparent 54%, #000 56%);
    }
    .custom input { position: absolute; inset: -10px; opacity: 0; cursor: pointer; }

    .sep {
      font-family: var(--mono); font-size: 11px; letter-spacing: .08em; text-transform: uppercase;
      color: var(--text-dim); margin: 26px 0 14px; padding-top: 16px;
      border-top: 1px solid var(--line-soft);
    }
  `],
})
export class StyleTab {
  protected cfg = inject(ConfigStore);
  private projects = inject(ProjectStore);
  protected s = this.cfg.style;
  protected v = this.cfg.video;
  protected swatches = SWATCHES;

  /** Só famílias que a API encontrou: o libass precisa achar a fonte pelo nome. */
  protected families = this.projects.families;

  protected backingCount = computed(
    () => (this.projects.project()?.lines ?? []).filter((l) => l.track === 'back').length,
  );

  protected presets = ['ultrafast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow']
    .map((p) => ({ value: p, label: p }));

  /** CRF é ao contrário do intuitivo: número menor = melhor qualidade. */
  protected crfLabel = computed(() => {
    const crf = this.v().crf;
    const quality = crf <= 18 ? 'quase sem perda' : crf <= 23 ? 'bom' : crf <= 28 ? 'leve' : 'bem leve';
    return `${crf} · ${quality}`;
  });

  protected positionNumber = computed(() => positionToNumber(this.s().position));
  protected positionText = computed(() => positionLabel(this.s().position));

  /** Encaixa nos nomes (centro/topo/base) quando o slider passa perto deles. */
  protected setPosition(value: number): void {
    const named: [Position, number][] = [['top', 0.14], ['center', 0.5], ['bottom', 0.86]];
    const hit = named.find(([, v]) => Math.abs(v - value) < 0.02);
    this.cfg.patch('style', 'position', hit ? hit[0] : Math.round(value * 100) / 100);
  }

  protected same(color: string): boolean {
    return this.s().color.toUpperCase() === color.toUpperCase();
  }

  protected pct(v: number): string {
    return Math.round(v * 100) + '%';
  }
}
