import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPreviewSession } from './preview-session';

const { open, close, layout, read, subscribe } = {
  open: vi.fn(), close: vi.fn(async () => ({})), layout: vi.fn(),
  read: vi.fn(async () => null), subscribe: vi.fn(() => () => {}),
};
const response = (result: unknown) => ({ protocolVersion: 1, ok: true, result });
beforeEach(() => {
  // The injected boundary is Electron's renderer-facing IPC API, not the controller.
  Object.defineProperty(window, 'live2pet', { configurable: true, value: {
    openPreview: async (...args: unknown[]) => response(await open(...args)),
    closePreview: async () => response(await close()),
    layoutPreview: async (...args: unknown[]) => response(await layout(...args)),
    getPreviewStatus: async () => response(await read()), onPreviewStatus: subscribe,
    playPreview: vi.fn(), setPreviewExpression: vi.fn(), controlPreview: vi.fn(),
  } });
});

afterEach(() => { vi.clearAllMocks(); delete window.live2pet; });
const bounds = { x: 0, y: 0, width: 400, height: 400 };
const input = { projectId: 'fixture', sourceFingerprint: 'a'.repeat(64) };
const ready = { schemaVersion: 1, ...input, state: 'ready', visible: true, bounds };

it('an interrupted open cannot hide, close, or publish into its replacement preview', async () => {
  let finish!: (value: unknown) => void;
  open.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(ready);
  const oldStatus = vi.fn(), newStatus = vi.fn();
  const first = createPreviewSession({ input, onStatus: oldStatus });
  const firstOpen = first.layout(bounds);
  await Promise.resolve();
  first.dispose();
  const second = createPreviewSession({ input, onStatus: newStatus });
  const secondOpen = second.layout(bounds);
  finish(ready);
  await Promise.all([firstOpen, secondOpen]);
  const staleCommand = vi.fn();
  await first.run(staleCommand);
  expect(staleCommand).not.toHaveBeenCalled();
  expect(oldStatus).not.toHaveBeenCalled();
  expect(newStatus).toHaveBeenCalledWith(ready);
  expect(layout).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
  expect(close.mock.invocationCallOrder[0]).toBeLessThan(open.mock.invocationCallOrder[1]);
  await second.dispose();
  expect(close).toHaveBeenCalledTimes(2);
});

it('drops a delayed playback response and queued commands after its owner leaves', async () => {
  open.mockResolvedValue(ready);
  const statuses = vi.fn();
  const first = createPreviewSession({ input, onStatus: statuses });
  await first.layout(bounds);
  statuses.mockClear();
  let finish!: (value: unknown) => void;
  const command = first.run(() => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve();
  const queued = vi.fn();
  const stale = first.run(queued);
  const closed = first.dispose();
  finish({ ...ready, playback: { playing: true } });
  await Promise.all([command, stale, closed]);
  expect(statuses).not.toHaveBeenCalled();
  expect(queued).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});

it('releases the previous native surface even when its replacement has no measurable bounds yet', async () => {
  open.mockResolvedValue(ready);
  const first = createPreviewSession({ input, onStatus: vi.fn() });
  await first.layout(bounds);
  const second = createPreviewSession({ input, onStatus: vi.fn() });
  await first.dispose();
  expect(close).toHaveBeenCalledOnce();
  await second.dispose();
});
