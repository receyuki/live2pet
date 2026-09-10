import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceLibrary, SourceLibrarySelection } from './app-host';

const { closeLive2DPreview, getLibraryThumbnail, openLive2DPreview, playLive2DPreview } = vi.hoisted(() => ({
  closeLive2DPreview: vi.fn(async () => ({ state: 'idle' })),
  getLibraryThumbnail: vi.fn(async (_libraryId: string, sourceId: string) => ({ dataUrl: `data:image/png;base64,${sourceId}` })),
  openLive2DPreview: vi.fn(async () => ({ schemaVersion: 1, state: 'ready', projectId: 'library-preview', sourceFingerprint: 'a'.repeat(64), visible: true, bounds: { x: 0, y: 0, width: 64, height: 64 } })),
  playLive2DPreview: vi.fn(async () => ({ state: 'ready' })),
}));

vi.mock('./app-host', async importOriginal => ({
  ...await importOriginal<typeof import('./app-host')>(),
  closeLive2DPreview,
  getLibraryThumbnail,
  hasPreviewApi: () => true,
  openLive2DPreview,
  playLive2DPreview,
}));

import { ModelLibrary, ModelPreview } from './model-library';

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
    closeLive2DPreview.mockClear();
    openLive2DPreview.mockClear();
    playLive2DPreview.mockClear();
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

  it('releases the live renderer when the selected model preview closes', async () => {
    const candidate = library.candidates[0];
    const direct = {
      sourcePath: '<selected-source>',
      candidate,
      inspection: {
        schemaVersion: 1,
        source: { kind: 'standard-directory', name: 'one', fingerprint: 'a'.repeat(64), modelConfig: 'one.model3.json' },
        model: { cubism: 4, configFile: 'one.model3.json', modelFile: 'one.moc3', textures: [] },
        motions: [{ id: 'idle', group: 'Idle', index: 0, name: 'Idle', sourceFile: 'idle.motion3.json', duration: 1 }],
        expressions: [],
        resources: [],
        warnings: [],
      },
    } satisfies SourceLibrarySelection;
    const view = render(<ModelPreview candidate={candidate} direct={direct} locale="en" onUse={async () => {}} onClose={() => {}} />);
    await act(async () => { await Promise.resolve(); });
    expect(openLive2DPreview).toHaveBeenCalled();

    view.unmount();
    expect(closeLive2DPreview).toHaveBeenCalledTimes(1);
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

  it('searches model names, paths, formats, and runtime versions without loading hidden thumbnails', () => {
    const searchable: SourceLibrary = { ...library, candidates: [
      { id: 'miku', name: 'Miku', relativePath: 'characters/miku/model3.json', format: 'live2d', version: null, runtimeLine: '4', binary: false },
      { id: 'dragon', name: 'Dragon', relativePath: 'bosses/dragon/dragon.json', format: 'spine', version: '4.2.0', runtimeLine: '4.2', binary: false },
    ] };
    const view = render(<ModelLibrary library={searchable} locale="en" onUse={async () => {}} />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search models' }), { target: { value: 'spine' } });

    expect([...view.container.querySelectorAll('.model-library-card strong')].map(element => element.textContent)).toEqual(['Dragon']);
    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(getLibraryThumbnail).not.toHaveBeenCalled();
  });

  it('sorts matching cards while preserving the source order option', () => {
    const view = render(<ModelLibrary library={library} locale="en" onUse={async () => {}} />);
    const names = () => [...view.container.querySelectorAll('.model-library-card strong')].map(element => element.textContent);

    fireEvent.change(screen.getByRole('combobox', { name: 'Sort models' }), { target: { value: 'name-desc' } });
    expect(names()).toEqual(['two', 'three', 'one']);

    fireEvent.change(screen.getByRole('combobox', { name: 'Sort models' }), { target: { value: 'source' } });
    expect(names()).toEqual(['one', 'two', 'three']);
  });
});
