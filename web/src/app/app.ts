import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Header } from './ui/header';
import { Panel } from './ui/panel';
import { Preview } from './ui/preview';
import { Timeline } from './ui/timeline';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Header, Preview, Panel, Timeline],
  template: `
    <lb-header />
    <main>
      <lb-preview />
      <lb-panel />
    </main>
    <lb-timeline />
  `,
  styles: [`
    :host {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      height: 100dvh;
      gap: 14px;
      padding-bottom: 14px;
    }
    main {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 444px;
      gap: 14px;
      min-height: 0;
      padding: 0 14px;
    }
    lb-timeline { margin: 0 14px; min-width: 0; }

    @media (max-width: 1100px) {
      :host { height: auto; }
      main { grid-template-columns: 1fr; }
      lb-preview { min-height: 50vh; }
    }
  `],
})
export class App {}
