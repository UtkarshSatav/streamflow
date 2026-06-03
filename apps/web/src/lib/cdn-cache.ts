import type { CacheStats } from "@streaming/types";

/**
 * CDN Cache Simulation — LRU (Least Recently Used) cache.
 *
 * In production, CDNs like CloudFront/Akamai cache content at edge locations.
 * This simulates that behavior with an in-memory LRU cache:
 *
 * - Cache hit: serve from memory (fast, ~5ms simulated)
 * - Cache miss: fetch from origin storage (slow, ~200ms simulated)
 * - Eviction: when cache is full, remove least recently accessed entry
 *
 * This demonstrates the core CDN concept: move content closer to users.
 */

interface CacheItem {
  data: Buffer;
  size: number;
  lastAccessed: number;
  hits: number;
  key: string;
}

const MAX_CACHE_SIZE = 500 * 1024 * 1024; // 500MB

class CDNCache {
  private cache = new Map<string, CacheItem>();
  private currentSize = 0;
  private totalRequests = 0;
  private cacheHits = 0;
  private cacheMisses = 0;

  /**
   * Try to get a cached segment. Returns null on cache miss.
   */
  get(key: string): Buffer | null {
    this.totalRequests++;

    const item = this.cache.get(key);
    if (item) {
      this.cacheHits++;
      item.lastAccessed = Date.now();
      item.hits++;
      return item.data;
    }

    this.cacheMisses++;
    return null;
  }

  /**
   * Store a segment in the cache. Evicts LRU entries if necessary.
   */
  put(key: string, data: Buffer): void {
    // Don't cache if single item exceeds limit
    if (data.length > MAX_CACHE_SIZE) return;

    // Evict until we have room
    while (this.currentSize + data.length > MAX_CACHE_SIZE && this.cache.size > 0) {
      this.evictLRU();
    }

    // Remove existing entry if updating
    const existing = this.cache.get(key);
    if (existing) {
      this.currentSize -= existing.size;
    }

    const item: CacheItem = {
      data,
      size: data.length,
      lastAccessed: Date.now(),
      hits: 0,
      key,
    };

    this.cache.set(key, item);
    this.currentSize += data.length;
  }

  /**
   * Remove the least recently accessed entry.
   */
  private evictLRU(): void {
    let oldest: CacheItem | null = null;

    for (const item of this.cache.values()) {
      if (!oldest || item.lastAccessed < oldest.lastAccessed) {
        oldest = item;
      }
    }

    if (oldest) {
      this.cache.delete(oldest.key);
      this.currentSize -= oldest.size;
    }
  }

  /**
   * Get cache statistics for analytics dashboard.
   */
  getStats(): CacheStats {
    return {
      totalRequests: this.totalRequests,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      hitRate: this.totalRequests > 0 ? this.cacheHits / this.totalRequests : 0,
      currentSize: this.currentSize,
      maxSize: MAX_CACHE_SIZE,
    };
  }

  /**
   * Clear the entire cache.
   */
  flush(): void {
    this.cache.clear();
    this.currentSize = 0;
  }
}

// Singleton — shared across all API routes (simulates a single edge node)
export const cdnCache = new CDNCache();
