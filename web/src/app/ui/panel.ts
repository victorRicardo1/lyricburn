import {
  afterNextRender, ChangeDetectionStrategy, Component, effect, ElementRef, inject, Injector,
  linkedSignal, signal, viewChild,
} from '@angular/core';
import { ConfigStore } from '../core/config.store';
import { ProjectStore } from '../core/project.store';
import { ExportBar } from './export-bar';
import { AudioTab } from './tabs/audio-tab';
import { DotsTab } from './tabs/dots-tab';
import { FilesTab } from './tabs/files-tab';
import { StyleTab } from './tabs/style-tab';
import { TimingTab } from './tabs/timing-tab';

type TabId = 'arquivos' | 'tempo' | 'estilo' | 'audio' | 'pontinhos';

/** Painel da direita: as abas e, fixo embaixo, o botão de exportar. */
@Component({
  selector: 'lb-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FilesTab, TimingTab, StyleTab, AudioTab, DotsTab, ExportBar],
  template: `
    <nav class="tabs" role="tablist">
      @for (tab of tabs; track tab.id) {
        <button type="button" role="tab" [attr.aria-selected]="active() === tab.id"
                [class.on]="active() === tab.id"
                [disabled]="tab.id !== 'arquivos' && !ready()"
                (click)="active.set(tab.id)">{{ tab.label }}</button>
      }
    </nav>

    <div class="body-wrap" [class.more]="more()">
    <div class="body" #body (scroll)="updateMore()">
      @switch (active()) {
        @case ('arquivos') { <lb-files-tab /> }
        @case ('tempo') { <lb-timing-tab /> }
        @case ('estilo') { <lb-style-tab /> }
        @case ('audio') { <lb-audio-tab /> }
        @case ('pontinhos') { <lb-dots-tab /> }
      }
    </div>
    </div>

    <lb-export-bar />
  `,
  styles: [`
    :host {
      display: flex; flex-direction: column; min-height: 0;
      background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-lg);
    }
    .tabs {
      display: flex; flex-wrap: nowrap; gap: 2px; padding: 13px 12px 11px;
      border-bottom: 1px solid var(--line-soft);
    }
    .tabs button {
      padding: 9px 10px; background: none; border: none; border-radius: var(--r-sm);
      color: var(--text-muted); font-size: 13.5px; white-space: nowrap;
      transition: background .12s, color .12s;
    }
    .tabs button:hover:not(:disabled) { color: var(--text); }
    .tabs button.on { background: var(--panel-2); color: var(--text); font-weight: 500; }
    .tabs button:disabled { opacity: .35; cursor: not-allowed; }

    .body-wrap { position: relative; flex: 1; min-height: 0; display: flex; }
    /* sem isso não fica óbvio que o painel rola e os títulos de seção somem cortados */
    .body-wrap::after {
      content: ''; position: absolute; left: 0; right: 10px; bottom: 0; height: 46px;
      background: linear-gradient(to top, var(--panel) 10%, transparent);
      pointer-events: none; opacity: 0; transition: opacity .18s;
    }
    .body-wrap.more::after { opacity: 1; }
    .body { flex: 1; min-height: 0; overflow-y: auto; padding: 22px 18px 30px; }
    .body::-webkit-scrollbar { width: 10px; }
    .body::-webkit-scrollbar-thumb { background: var(--line); border-radius: 999px; }
  `],
})
export class Panel {
  private projects = inject(ProjectStore);
  protected cfg = inject(ConfigStore);

  protected tabs: { id: TabId; label: string }[] = [
    { id: 'arquivos', label: 'Arquivos' },
    { id: 'tempo', label: 'Tempo' },
    { id: 'estilo', label: 'Estilo' },
    { id: 'audio', label: 'Áudio' },
    { id: 'pontinhos', label: 'Pontinhos' },
  ];

  protected ready = this.projects.ready;

  /** Aba atual: volta sozinha pra Arquivos enquanto não houver projeto. */
  protected active = linkedSignal<boolean, TabId>({
    source: this.ready,
    computation: (ready, previous) => (ready ? previous?.value ?? 'arquivos' : 'arquivos'),
  });

  private body = viewChild<ElementRef<HTMLElement>>('body');
  private injector = inject(Injector);

  /** Tem conteúdo abaixo da dobra? É o que acende o degradê no rodapé. */
  protected more = signal(false);

  constructor() {
    // trocar de aba muda a altura do conteúdo: remede depois do render
    effect(() => {
      this.active();
      this.projects.project();
      afterNextRender(() => this.updateMore(), { injector: this.injector });
    });
  }

  protected updateMore(): void {
    const el = this.body()?.nativeElement;
    if (el) this.more.set(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
  }
}
