import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceLibrary } from './app-host';

const { getLibraryThumbnail } = vi.hoisted(() => ({
  getLibraryThumbnail: vi.fn(async (_libraryId: string, sourceId: string) => ({ dataUrl: `data:image/png;base64,${sourceId}` })),
}));

vi.mock('./app-host', async importOriginal => ({
  ...await importOriginal<typeof import('./app-host')>(),
  getLibraryThumbnail,
}));

import { ModelLibrary } from './model-library';

const library: SourceLibrary = {
  schemaVersion: 1,
  libraryId: 'library-1',
  name: 'Models',
  kind: 'local',
  maxDepth: 2,
  candidates: ['one', 'two', 'three'].map(id => ({ id, name: id, relativePath: `${id}/${id}.model3.json`, format: 'live2d', version: null, runtimeLine: null, binary: false })),
};

describe('ModelLibrary thumbnails', () => {
  let intersections: Array<(entries: Array<{ isIntersecting: boolean }>) => void>;
  beforeEach(() => {
    getLibraryThumbnail.mockClear();
    intersections = [];
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) { intersections.push(callback); }
      observe() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('loads thumbnails only when their cards enter the visible area', async () => {
    render(<ModelLibrary library={library} locale="en" onUse={async () => {}} />);
    expect(getLibraryThumbnail).not.toHaveBeenCalled();
    await act(async () => { intersections[0]([{ isIntersecting: true }]); });
    expect(getLibraryThumbnail).toHaveBeenCalledTimes(1);
    expect(getLibraryThumbnail).toHaveBeenCalledWith('library-1', 'one');
  });

  it('keeps generated thumbnails when the model library is mounted again', async () => {
    const retained = { ...library, libraryId: 'retained-library' };
    const first = render(<ModelLibrary library={retained} locale="en" onUse={async () => {}} />);
    await act(async () => { intersections.forEach(callback => callback([{ isIntersecting: true }])); });
    expect(getLibraryThumbnail).toHaveBeenCalledTimes(3);
    first.unmount();

    const second = render(<ModelLibrary library={retained} locale="en" onUse={async () => {}} />);
    expect(second.container.querySelectorAll('.model-library-cover img')).toHaveLength(3);
    expect(getLibraryThumbnail).toHaveBeenCalledTimes(3);
  });

  it('labels unsupported Spine versions without trying to render them', async () => {
    const unsupported: SourceLibrary = { ...library, candidates: [{ id: 'legacy', name: 'legacy', relativePath: 'legacy/legacy.skel', format: 'spine', version: '3.8.95', runtimeLine: '3.8', binary: true }] };
    render(<ModelLibrary library={unsupported} locale="zh-CN" onUse={async () => {}} />);
    expect(screen.getByText('暂不支持 Spine 3.8 预览')).toBeTruthy();
    expect(getLibraryThumbnail).not.toHaveBeenCalled();
  });

  it('groups model and Source Package guidance in the selected preview sidebar', () => {
    render(<ModelLibrary library={library} locale="en" onUse={async () => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /one/i }));
    expect(screen.getByRole('heading', { name: 'Source Package' })).toBeTruthy();
    expect(screen.getByText('Review model compatibility, included motions, expressions, and textures before mapping.')).toBeTruthy();
    expect(screen.getByText(/Browse and preview models without changing your current project/)).toBeTruthy();
  });
});
