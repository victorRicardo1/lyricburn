import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ConfigStore } from '../../core/config.store';
import { ProjectStore } from '../../core/project.store';
import { Slider, Toggle } from '../controls';

/** Seção [audio] do config.py. */
@Component({
  selector: 'lb-audio-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Slider, Toggle],
  template: `
    <lb-slider label="Volume do jogo" [value]="a().game_volume" [min]="0" [max]="1" [step]="0.01"
               [display]="pct(a().game_volume)"
               (changed)="cfg.patch('audio', 'game_volume', $event)" />
    @if (noGameAudio()) {
      <p class="hint warn">o vídeo não tem áudio: este controle não muda nada</p>
    }
    <lb-slider label="Volume da música" [value]="a().music_volume" [min]="0" [max]="2" [step]="0.01"
               [display]="pct(a().music_volume)"
               (changed)="cfg.patch('audio', 'music_volume', $event)" />
    <lb-slider label="Fade-in da música" [value]="a().music_fade_in" [min]="0" [max]="5" [step]="0.1"
               suffix="s"
               (changed)="cfg.patch('audio', 'music_fade_in', $event)" />
    <lb-toggle label="Abaixar o jogo nos picos da música" [value]="a().duck"
               hint="sidechain: o som do jogo cede quando a música está forte"
               (changed)="cfg.patch('audio', 'duck', $event)" />
  `,
  styles: [`
    .warn { margin: -10px 0 18px; }
  `],
})
export class AudioTab {
  protected cfg = inject(ConfigStore);
  private projects = inject(ProjectStore);
  protected a = this.cfg.audio;

  protected noGameAudio(): boolean {
    const meta = this.projects.project()?.meta.video;
    return meta ? !meta.has_audio : false;
  }

  protected pct(v: number): string {
    return Math.round(v * 100) + '%';
  }
}
