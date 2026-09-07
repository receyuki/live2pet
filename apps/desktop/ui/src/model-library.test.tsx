import { act, cleanup, render, screen } from '@testing-library/react';
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
  beforeEach(() => {
    vi.useFakeTimers();
    getLibraryThumbnail.mockClear();
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('loads offscreen model thumbnails in the background', async () => {
    render(<ModelLibrary library={library} locale="en" onUse={async () => {}} />);
    expect(getLibraryThumbnail).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(getLibraryThumbnail).toHaveBeenCalledTimes(3);
  });

  it('labels unsupported Spine versions without trying to render them', async () => {
    const unsupported: SourceLibrary = { ...library, candidates: [{ id: 'legacy', name: 'legacy', relativePath: 'legacy/legacy.skel', format: 'spine', version: '3.8.95', runtimeLine: '3.8', binary: true }] };
    render(<ModelLibrary library={unsupported} locale="zh-CN" onUse={async () => {}} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByText('暂不支持 Spine 3.8 预览')).toBeTruthy();
    expect(getLibraryThumbnail).not.toHaveBeenCalled();
  });
});
