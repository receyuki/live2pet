import { describe, expect, it } from 'vitest';
import { ThumbnailMemory } from './thumbnail-memory';

describe('ThumbnailMemory', () => {
  it('evicts least-recently-used thumbnails by entry and byte limits', () => {
    const cache = new ThumbnailMemory({ maxEntries: 2, maxBytes: 12 });
    cache.set('one', '1234');
    cache.set('two', '5678');
    expect(cache.get('one')).toBe('1234');
    cache.set('three', 'abcd');
    expect(cache.get('two')).toBeNull();
    expect(cache.get('one')).toBe('1234');
    expect(cache.get('three')).toBe('abcd');

    cache.set('large', 'abcdefghijkl');
    expect(cache.size).toBe(1);
    expect(cache.get('large')).toBe('abcdefghijkl');
  });
});
