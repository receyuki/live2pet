import { describe, expect, it } from 'vitest';
import { projectIdFromSourceName, sourcePathFromSelection } from './source-selection';

describe('sourcePathFromSelection', () => {
  it('keeps a PCK file path intact', () => {
    const file = new File(['pck'], 'c311_02.pck');
    expect(sourcePathFromSelection([file], () => '/Users/test/c311_02.pck')).toBe('/Users/test/c311_02.pck');
  });

  it('resolves the selected directory from a nested browser file', () => {
    const file = new File(['{}'], 'model3.json');
    Object.defineProperty(file, 'webkitRelativePath', { value: 'character/model/model3.json' });
    expect(sourcePathFromSelection([file], () => '/Users/test/character/model/model3.json')).toBe('/Users/test/character');
  });

  it('keeps a directory path supplied by a desktop drop', () => {
    const directory = new File([''], 'character');
    expect(sourcePathFromSelection([directory], () => '/Users/test/character', true)).toBe('/Users/test/character');
  });

  it('rejects selections without a Desktop path', () => {
    expect(sourcePathFromSelection([new File([''], 'model3.json')], () => null)).toBeNull();
  });
});

describe('projectIdFromSourceName', () => {
  it('creates a stable filesystem-neutral identifier', () => {
    expect(projectIdFromSourceName('Vicious Khepri 02')).toBe('vicious-khepri-02');
  });
});
