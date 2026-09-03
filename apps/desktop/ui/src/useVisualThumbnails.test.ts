import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getPreviewVisualElementThumbnail } from './app-host';
import { useVisualThumbnails } from './useVisualThumbnails';

vi.mock('./app-host', () => ({ getPreviewVisualElementThumbnail: vi.fn() }));
const load = vi.mocked(getPreviewVisualElementThumbnail);
beforeEach(() => { vi.useFakeTimers(); load.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(40); });

it('serializes visible requests, caches across tabs, and leaves offscreen Parts alone', async () => {
  let resolve!: (value: { id: string; dataUrl: string | null }) => void;
  load.mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue({ id: 'BODY', dataUrl: null });
  const { result, rerender } = renderHook(({ enabled }) => useVisualThumbnails('model-a', enabled), { initialProps: { enabled: true } });
  act(() => result.current.onVisible(['BG', 'BODY']));
  await tick(); await tick();
  expect(load).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledWith('BG');
  await act(async () => resolve({ id: 'BG', dataUrl: 'image-a' }));
  await tick();
  expect(load).toHaveBeenCalledTimes(2);
  expect(result.current.thumbnails.BG.dataUrl).toBe('image-a');
  act(() => result.current.inspect('BG'));
  rerender({ enabled: false }); await tick(); rerender({ enabled: true }); await tick();
  expect(load).toHaveBeenCalledTimes(2);
  expect(result.current.thumbnail?.dataUrl).toBe('image-a');
});
it('discards stale model images and stops scheduling while the panel is inactive', async () => {
  let resolve!: (value: { id: string; dataUrl: string | null }) => void;
  load.mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue({ id: 'BG', dataUrl: 'new-image' });
  const { result, rerender } = renderHook(({ scope, enabled }) => useVisualThumbnails(scope, enabled), { initialProps: { scope: 'old', enabled: true } });
  act(() => result.current.onVisible(['BG', 'BODY'])); await tick();
  rerender({ scope: 'new', enabled: false });
  await act(async () => resolve({ id: 'BG', dataUrl: 'old-image' })); await tick();
  expect(result.current.thumbnails).toEqual({});
  expect(load).toHaveBeenCalledTimes(1);
  act(() => result.current.onVisible(['BG'])); rerender({ scope: 'new', enabled: true }); await tick();
  expect(result.current.thumbnails.BG.dataUrl).toBe('new-image');
});
it('records failures without retry loops, and retries when the image is clicked', async () => {
  load.mockRejectedValueOnce(new Error('gone')).mockResolvedValue({ id: 'BG', dataUrl: null });
  const { result } = renderHook(() => useVisualThumbnails('model', true));
  act(() => result.current.onVisible(['BG'])); await tick(); await tick();
  expect(load).toHaveBeenCalledTimes(1);
  expect(result.current.thumbnails.BG.failed).toBe(true);
  act(() => result.current.inspect('BG')); await tick();
  expect(load).toHaveBeenCalledTimes(2);
  expect(result.current.thumbnail).toEqual({ id: 'BG', dataUrl: null, loading: false });
});
