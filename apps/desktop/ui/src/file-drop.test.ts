import { describe, expect, it } from 'vitest';
import { hasDraggedFiles } from './file-drop';

describe('file drop helpers', () => {
  it('recognizes file drags without treating text as a file', () => {
    expect(hasDraggedFiles({ types: ['Files'] })).toBe(true);
    expect(hasDraggedFiles({ types: ['text/plain'] })).toBe(false);
  });
});
