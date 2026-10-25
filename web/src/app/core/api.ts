import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { FontsResponse, Job, LyricConfig, Peaks, PlanResult, Project } from './types';

/** Cliente da API. Os caminhos são relativos: o proxy do ng serve manda pro uvicorn. */
@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);

  createProject(files: { video: File; audio: File; lyrics: File }, peaks = 900): Promise<Project> {
    const form = new FormData();
    form.append('video', files.video);
    form.append('audio', files.audio);
    form.append('lyrics', files.lyrics);
    return firstValueFrom(this.http.post<Project>(`/projects?peaks=${peaks}`, form));
  }

  getProject(id: string): Promise<Project> {
    return firstValueFrom(this.http.get<Project>(`/projects/${id}`));
  }

  plan(id: string, config: LyricConfig): Promise<PlanResult> {
    return firstValueFrom(this.http.post<PlanResult>(`/projects/${id}/plan`, config));
  }

  render(id: string, config: LyricConfig, fast: boolean): Promise<Job> {
    return firstValueFrom(this.http.post<Job>(`/projects/${id}/render`, { ...config, fast }));
  }

  job(id: string): Promise<Job> {
    return firstValueFrom(this.http.get<Job>(`/jobs/${id}`));
  }

  /** Beats da música inteira (segundos). A primeira chamada analisa — leva alguns segundos. */
  beats(id: string): Promise<{ tempo: number; beats: number[] }> {
    return firstValueFrom(this.http.get<{ tempo: number; beats: number[] }>(`/projects/${id}/beats`));
  }

  /** Waveform numa resolução maior que a do upload, pro zoom da timeline. */
  peaks(id: string, buckets: number): Promise<Peaks> {
    return firstValueFrom(this.http.get<Peaks>(`/projects/${id}/peaks?buckets=${buckets}`));
  }

  fonts(): Promise<FontsResponse> {
    return firstValueFrom(this.http.get<FontsResponse>('/fonts'));
  }

  mediaUrl(projectId: string, kind: 'video' | 'audio'): string {
    return `/projects/${projectId}/media/${kind}`;
  }

  previewUrl(projectId: string, format: 'mp4' | 'webm'): string {
    return `/projects/${projectId}/preview?format=${format}`;
  }

  /** O vídeo renderizado, servido pra tocar embutido (o /download força attachment). */
  jobVideoUrl(jobId: string, format: 'mp4' | 'webm'): string {
    return `/jobs/${jobId}/video?format=${format}`;
  }

  /**
   * Espera uma cópia ficar pronta. Essas rotas respondem 202 enquanto convertem,
   * e um HEAD diz o estado sem baixar o vídeo inteiro.
   */
  async waitUntilReady(url: string, stillWanted = () => true, timeoutMs = 10 * 60_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!stillWanted()) throw new Error('espera cancelada');
      const res = await fetch(url, { method: 'HEAD' });
      // não dá pra usar res.ok: 202 ("ainda convertendo") também está na faixa 2xx
      if (res.status === 200) return url;
      if (res.status !== 202) throw new Error(`conversão falhou (HTTP ${res.status})`);
      await new Promise((done) => setTimeout(done, 1500));
    }
    throw new Error('a conversão demorou demais');
  }

  downloadUrl(jobId: string): string {
    return `/jobs/${jobId}/download`;
  }
}

/** Extrai a mensagem do `detail` do FastAPI (que pode ser string ou lista de validação). */
export function apiError(err: unknown): string {
  const detail = (err as { error?: { detail?: unknown } })?.error?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map((d: { loc?: string[]; msg?: string }) =>
      `${d.loc?.slice(1).join('.') ?? ''}: ${d.msg ?? ''}`).join('; ');
  }
  const msg = (err as { message?: string })?.message;
  return msg || 'falha ao falar com a API';
}
