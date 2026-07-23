import AsyncStorage from '@react-native-async-storage/async-storage';
import { analyzeAudioFile, AnalysisResult } from './AudioAnalyzer';

const RESULTS_KEY = '@audio_analysis_v1';
const CONCURRENCY = 3;

export interface QueueItem {
  id: string;
  uri: string;
  filename: string;
  status: 'queued' | 'analyzing' | 'done' | 'error';
  progress: number;  // 0–1
  result?: AnalysisResult;
  error?: string;
  queuedAt: number;
}

type Listener = (items: QueueItem[]) => void;

class AudioAnalysisQueueClass {
  private queue: QueueItem[] = [];
  private results = new Map<string, AnalysisResult>();
  private listeners = new Set<Listener>();
  private active = 0;
  private ready = false;

  async init(): Promise<void> {
    if (this.ready) return;
    this.ready = true;
    try {
      const raw = await AsyncStorage.getItem(RESULTS_KEY);
      if (raw) {
        const arr: AnalysisResult[] = JSON.parse(raw);
        for (const r of arr) this.results.set(r.uri, r);
      }
    } catch {}
  }

  private async persist(): Promise<void> {
    try {
      await AsyncStorage.setItem(RESULTS_KEY, JSON.stringify(Array.from(this.results.values())));
    } catch {}
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn([...this.queue]);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const snap = [...this.queue];
    this.listeners.forEach(fn => fn(snap));
  }

  getResult(uri: string): AnalysisResult | undefined {
    return this.results.get(uri);
  }

  getAllResults(): AnalysisResult[] {
    return Array.from(this.results.values());
  }

  isAnalyzed(uri: string): boolean {
    return this.results.has(uri);
  }

  enqueue(tracks: { uri: string; filename: string }[]): void {
    let added = false;
    for (const t of tracks) {
      if (this.queue.some(q => q.uri === t.uri)) continue;
      this.queue.push({
        id: t.uri,
        uri: t.uri,
        filename: t.filename,
        status: 'queued',
        progress: 0,
        queuedAt: Date.now(),
      });
      added = true;
    }
    if (added) { this.emit(); this.tick(); }
  }

  clearQueue(): void {
    this.queue = this.queue.filter(q => q.status === 'analyzing');
    this.emit();
  }

  clearResults(): void {
    this.results.clear();
    this.persist();
    this.emit();
  }

  private tick(): void {
    while (this.active < CONCURRENCY) {
      const next = this.queue.find(q => q.status === 'queued');
      if (!next) break;
      this.run(next);
    }
  }

  private async run(item: QueueItem): Promise<void> {
    this.active++;
    item.status = 'analyzing';
    item.progress = 0.05;
    this.emit();

    try {
      const result = await analyzeAudioFile(item.uri, item.filename, (p) => {
        item.progress = p;
        this.emit();
      });

      item.status = 'done';
      item.progress = 1;
      item.result = result;

      if (!result.error) {
        this.results.set(item.uri, result);
        await this.persist();
      } else {
        item.status = 'error';
        item.error = result.error;
      }
    } catch (err: any) {
      item.status = 'error';
      item.error = err?.message || 'Fehler';
    }

    this.active--;
    this.emit();
    this.tick();
  }
}

export const analysisQueue = new AudioAnalysisQueueClass();
