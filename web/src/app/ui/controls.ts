import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** Slider com rótulo à esquerda e valor à direita, como no mockup. */
@Component({
  selector: 'lb-slider',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field">
      <div class="label">
        <span>{{ label() }}</span>
        <span class="value">{{ display() ?? value() + suffix() }}</span>
      </div>
      <input type="range" [min]="min()" [max]="max()" [step]="step()" [value]="value()"
             [attr.aria-label]="label()"
             (input)="changed.emit(+($any($event.target).value))" />
    </div>
  `,
  styles: [`
    input[type='range'] {
      background: linear-gradient(to right, var(--accent) 0 var(--fill, 0%), var(--line) var(--fill, 0%) 100%);
    }
  `],
  host: { '[style.--fill.%]': 'fill()' },
})
export class Slider {
  readonly label = input.required<string>();
  readonly value = input.required<number>();
  readonly min = input(0);
  readonly max = input(100);
  readonly step = input(1);
  readonly suffix = input('');
  readonly display = input<string | null>(null);
  readonly changed = output<number>();

  fill(): number {
    const span = this.max() - this.min();
    return span <= 0 ? 0 : ((this.value() - this.min()) / span) * 100;
  }
}

@Component({
  selector: 'lb-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="check">
      <input type="checkbox" [checked]="value()" (change)="changed.emit($any($event.target).checked)" />
      <span class="box">
        <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
          <path d="M1 5l3.5 3.5L11 1.5" stroke="var(--accent-ink)" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
      <span class="txt">{{ label() }}</span>
    </label>
    @if (hint()) { <p class="hint" style="margin:6px 0 0 30px">{{ hint() }}</p> }
  `,
  styles: [`
    :host { display: block; margin-bottom: 18px; }
    .txt { font-size: 14px; }
  `],
})
export class Toggle {
  readonly label = input.required<string>();
  readonly value = input.required<boolean>();
  readonly hint = input<string | null>(null);
  readonly changed = output<boolean>();
}

/** Campo de texto/número. `kind` separa os dois porque o número volta coerced. */
@Component({
  selector: 'lb-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field">
      <div class="label">
        <span>{{ label() }}</span>
        @if (note()) { <span class="value">{{ note() }}</span> }
      </div>
      @if (kind() === 'number') {
        <input type="number" [value]="value()" [step]="step()" [min]="min()" [max]="max()"
               [attr.aria-label]="label()"
               (input)="changed.emit(+($any($event.target).value))" />
      } @else {
        <input type="text" [value]="value()" [placeholder]="placeholder()"
               [attr.aria-label]="label()"
               (input)="changed.emit($any($event.target).value)" />
      }
      @if (hint()) { <p class="hint" style="margin:6px 0 0">{{ hint() }}</p> }
    </div>
  `,
})
export class Field {
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  readonly kind = input<'text' | 'number'>('text');
  readonly placeholder = input('');
  readonly hint = input<string | null>(null);
  readonly note = input<string | null>(null);
  readonly step = input(1);
  readonly min = input<number | null>(null);
  readonly max = input<number | null>(null);
  readonly changed = output<string | number>();
}

@Component({
  selector: 'lb-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field">
      <div class="label"><span>{{ label() }}</span></div>
      <select [value]="value()" [attr.aria-label]="label()"
              (change)="changed.emit($any($event.target).value)">
        @for (opt of options(); track opt.value) {
          <option [value]="opt.value">{{ opt.label }}</option>
        }
      </select>
      @if (hint()) { <p class="hint" style="margin:6px 0 0">{{ hint() }}</p> }
    </div>
  `,
})
export class Select {
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  readonly options = input.required<{ value: string | number; label: string }[]>();
  readonly hint = input<string | null>(null);
  readonly changed = output<string>();
}
