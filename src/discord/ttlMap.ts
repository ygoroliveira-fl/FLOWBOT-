/** Mapa com expiração e tamanho máximo, para estados efêmeros de interação. */
export class TtlMap<V> {
  private readonly map = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxSize = 1000,
    private readonly now: () => number = Date.now,
  ) {}

  set(key: string, value: V): void {
    this.sweep();
    if (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** Lê e remove (uso único). */
  take(key: string): V | undefined {
    const value = this.get(key);
    this.map.delete(key);
    return value;
  }

  get size(): number {
    return this.map.size;
  }

  private sweep(): void {
    const now = this.now();
    for (const [key, entry] of this.map) if (entry.expiresAt <= now) this.map.delete(key);
  }
}
