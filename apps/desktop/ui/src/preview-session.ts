import {
  closeLive2DPreview, layoutLive2DPreview, onLive2DPreviewStatus,
  openLive2DPreview, readLive2DPreviewStatus,
  type PreviewBounds, type PreviewStatus,
} from './app-host';

// One native surface is shared by Models and Map. Queue ownership changes as
// well as commands so a late callback can never mutate its replacement.
let owner: symbol | null = null;
let nativeOwner: symbol | null = null;
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation, operation);
  queue = result.catch(() => undefined);
  return result;
}

export function createPreviewSession({ input, onStatus }: {
  input: Omit<Parameters<typeof openLive2DPreview>[0], 'bounds'>;
  onStatus: (status: PreviewStatus) => void;
}) {
  const token = Symbol('preview-owner');
  owner = token;
  let disposed = false;
  let opened = false;
  const current = () => !disposed && owner === token;
  function publish(value: unknown) {
    if (current() && value && typeof value === 'object' && 'schemaVersion' in value && 'state' in value) onStatus(value as PreviewStatus);
  }
  const unsubscribe = onLive2DPreviewStatus(status => {
    if (opened && status.projectId === input.projectId && status.sourceFingerprint === input.sourceFingerprint) publish(status);
  });
  async function run<T>(operation: () => Promise<T>): Promise<T | undefined> {
    return enqueue(async () => {
      if (!current()) return undefined;
      try {
        const result = await operation();
        if (!current()) return undefined;
        publish(result);
        return result;
      } catch (error) {
        if (current()) throw error;
        return undefined;
      }
    });
  }
  return {
    run,
    layout: (bounds: PreviewBounds) => run(async () => {
      if (!opened) nativeOwner = token;
      const result = opened
        ? await layoutLive2DPreview({ visible: true, bounds })
        : await openLive2DPreview({ ...input, bounds });
      opened = result.state === 'ready';
      return result;
    }),
    poll: () => opened ? run(readLive2DPreviewStatus) : Promise.resolve(undefined),
    dispose() {
      if (disposed) return Promise.resolve();
      disposed = true;
      unsubscribe();
      return enqueue(async () => {
        if (owner === token) owner = null;
        if (nativeOwner !== token) return;
        nativeOwner = null;
        await closeLive2DPreview().catch(() => undefined);
      });
    },
  };
}

export type OwnedPreviewSession = ReturnType<typeof createPreviewSession>;
