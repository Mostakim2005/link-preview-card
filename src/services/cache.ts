import type { PreviewData } from '../types';

interface CacheEntry { data: PreviewData; expiresAt: number; }

export class MetadataCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(private maxEntries: number, private ttlMs: number) {}

  configure(maxEntries: number, ttlMs: number): void {
    this.maxEntries = Math.max(10, maxEntries);
    this.ttlMs = Math.max(0, ttlMs);
    this.trim();
  }

  get(url: string): PreviewData | null {
    const entry = this.entries.get(url);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) { this.entries.delete(url); return null; }
    this.entries.delete(url);
    this.entries.set(url, entry);
    return entry.data;
  }

  set(url: string, data: PreviewData): void {
    if (this.ttlMs === 0) return;
    this.entries.delete(url);
    this.entries.set(url, { data, expiresAt: Date.now() + this.ttlMs });
    this.trim();
  }

  clear(): void { this.entries.clear(); }

  delete(url: string): void { this.entries.delete(url); }

  size(): number { return this.entries.size; }

  private trim(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
  }
}
