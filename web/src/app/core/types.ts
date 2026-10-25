/**
 * Espelho do config.py. Os nomes e os defaults são os mesmos do DEFAULTS de lá —
 * se mudar um, mude nos dois. `input` e `output` não entram: são do servidor.
 */

export interface TimingConfig {
  music_start: string | number;   // "2:26", "146" ou 146
  start_at_lyric: string;         // alternativa ao music_start
  lead_in: number;                // segundos antes da linha escolhida
  occurrence: number;             // qual ocorrência da linha (1 = primeira)
  video_offset: number;           // em que segundo do vídeo a música entra
  lyrics_offset: number;          // + atrasa a letra, - adianta
  end: 'auto' | 'video' | 'music';
  max_duration: number;           // 0 = sem limite
}

export interface AudioConfig {
  game_volume: number;
  music_volume: number;
  music_fade_in: number;
  duck: boolean;                  // abaixa o jogo quando a música está forte
}

export interface VideoConfig {
  resolution: number;             // lado menor: 720 | 1080 ...
  fade_in: number;
  fade_out: number;
  crf: number;
  preset: string;
}

export type Position = 'center' | 'bottom' | 'top' | number;

export interface StyleConfig {
  font: string;
  size: number;                   // px num vídeo de 720p (escala sozinho)
  spacing: number;
  color: string;                  // #RRGGBB
  outline: number;
  shadow: number;
  position: Position;             // center | bottom | top | 0..1
  line_fade_ms: number;
  back_font: string;
  back_size: number;
  back_italic: boolean;
  back_opacity: number;
}

export interface DotsConfig {
  enabled: boolean;
  min_gap: number;                // pausa mínima sem voz pra mostrar os pontos
  reactive: boolean;              // reage às notas (precisa do librosa)
  radius: number;
  spacing: number;
}

export interface LyricConfig {
  timing: TimingConfig;
  audio: AudioConfig;
  video: VideoConfig;
  style: StyleConfig;
  dots: DotsConfig;
}

/** Mesmos valores do DEFAULTS do config.py. */
export const DEFAULT_CONFIG: LyricConfig = {
  timing: {
    music_start: 0,
    start_at_lyric: '',
    lead_in: 2.0,
    occurrence: 1,
    video_offset: 0,
    lyrics_offset: 0,
    end: 'auto',
    max_duration: 0,
  },
  audio: { game_volume: 0.3, music_volume: 1.0, music_fade_in: 0.8, duck: false },
  video: { resolution: 720, fade_in: 1.2, fade_out: 2.5, crf: 22, preset: 'slow' },
  style: {
    font: 'Space Grotesk Medium',
    size: 48,
    spacing: 0.2,
    color: '#F5F5F5',
    outline: 1.4,
    shadow: 1.6,
    position: 'center',
    line_fade_ms: 220,
    back_font: 'Space Grotesk',
    back_size: 32,
    back_italic: true,
    back_opacity: 0.8,
  },
  dots: { enabled: true, min_gap: 1.2, reactive: true, radius: 5.5, spacing: 26 },
};

// ---------- respostas da API ----------

export interface LyricLine {
  index?: number;
  start: number;
  end: number;
  text: string;
  track: 'main' | 'back';
}

export interface Peaks {
  sample_rate: number;
  buckets: number;
  duration: number;
  values: number[];
}

export interface VideoMeta {
  duration: number;
  width: number;
  height: number;
  orientation: 'horizontal' | 'vertical';
  fps: number | null;
  codec: string | null;
  has_audio: boolean;
  container: string | null;
  bytes: number;
}

export interface AudioMeta {
  duration: number;
  music_end: number;
  codec: string | null;
  sample_rate: number | null;
  channels: number | null;
  container: string | null;
  bytes: number;
}

export interface FileInfo {
  original: string;
  stored: string;
  bytes: number;
  content_type: string | null;
}

export interface Project {
  id: string;
  created: number;
  files: { video: FileInfo; audio: FileInfo; lyrics: FileInfo };
  meta: { video: VideoMeta; audio: AudioMeta };
  lines: LyricLine[];
  peaks: Peaks;
  warnings: string[];
  media: { video: string; audio: string };
}

export interface Gap {
  start: number;
  end: number;
  notes: number[][];              // [tempo, força 0–1, altura 0–1]
}

export interface PlanSummary {
  music_start: number;
  video_offset: number;
  duration: number;
  width: number;
  height: number;
  has_game_audio: boolean;
  reactive_dots: boolean;
  line_count: number;
  lines: LyricLine[];             // em tempo do VÍDEO, já recortadas
  gaps: Gap[];
  note_count: number;
  warnings: string[];
  ignored_config_keys: string[];
  text: string;
}

export interface PlanResult {
  project_id: string;
  summary: PlanSummary;
  ass: string;                    // a fase 3a entrega isso pro JASSUB
  config: Record<string, unknown>;
}

export type JobStatus = 'queued' | 'preparing' | 'rendering' | 'done' | 'error';

export interface Job {
  id: string;
  project_id: string;
  status: JobStatus;
  fast: boolean;
  progress: number;               // 0–1
  out_time: number;
  duration: number;
  frame: number;
  fps: number | null;
  speed: number | null;
  eta: number | null;
  size_bytes: number;
  message: string | null;
  filename: string | null;
  summary: PlanSummary | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  elapsed: number;
  download_url: string | null;
}

export interface FontInfo {
  file: string;
  family: string;
  full_name: string | null;
  subfamily: string | null;
  typographic_family: string | null;
  italic: boolean;
  bold: boolean;
  weight: number | null;
  bytes: number;
  source: string;
  url: string;
}

export interface FontsResponse {
  fonts: FontInfo[];
  families: string[];
}
