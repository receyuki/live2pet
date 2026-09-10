type Options = { maxEntries: number; maxBytes: number };

export class ThumbnailMemory {
  readonly #maxEntries: number;
  readonly #maxBytes: number;
  readonly #values = new Map<string, { dataUrl: string; bytes: number }>();
  readonly #listeners = new Set<(key: string) => void>();
  #bytes = 0;

  constructor({ maxEntries, maxBytes }: Options) {
    this.#maxEntries = Math.max(1, Math.floor(maxEntries));
    this.#maxBytes = Math.max(1, Math.floor(maxBytes));
  }

  get size() { return this.#values.size; }

  get(key: string): string | null {
    const entry = this.#values.get(key);
    if (!entry) return null;
    this.#values.delete(key);
    this.#values.set(key, entry);
    return entry.dataUrl;
  }

  set(key: string, dataUrl: string) {
    const previous = this.#values.get(key);
    if (previous) { this.#bytes -= previous.bytes; this.#values.delete(key); }
    const entry = { dataUrl, bytes: dataUrl.length };
    this.#values.set(key, entry);
    this.#bytes += entry.bytes;
    while (this.#values.size > this.#maxEntries || this.#bytes > this.#maxBytes) {
      const oldest = this.#values.keys().next().value as string | undefined;
      if (!oldest) break;
      const removed = this.#values.get(oldest)!;
      this.#values.delete(oldest);
      this.#bytes -= removed.bytes;
      if (oldest !== key || this.#values.has(key)) this.#listeners.forEach((listener) => listener(oldest));
    }
  }

  subscribe(listener: (key: string) => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
