import { describe, expect, it } from 'vitest';
import { isSingleSourceSelection, projectIdFromSourceName, sourcePathFromSelection } from './source-selection';

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

  it('resolves a multi-file folder supplied by a desktop drop', () => {
    const model = new File(['{}'], 'model3.json');
    const texture = new File(['png'], 'texture.png');
    Object.defineProperty(model, 'webkitRelativePath', { value: 'live2d/hero/model3.json' });
    Object.defineProperty(texture, 'webkitRelativePath', { value: 'live2d/hero/textures/texture.png' });
    const files = [model, texture];
    expect(isSingleSourceSelection(files, true)).toBe(true);
    expect(sourcePathFromSelection(files, file => `/Users/test/${file.webkitRelativePath}`, true)).toBe('/Users/test/live2d');
  });

  it('does not combine unrelated files into one dropped source', () => {
    const first = new File([''], 'one.pck');
    const second = new File([''], 'two.pck');
    expect(isSingleSourceSelection([first, second], true)).toBe(false);
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
