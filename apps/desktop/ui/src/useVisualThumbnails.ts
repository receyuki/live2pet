import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { getPreviewVisualElementThumbnail } from './app-host';

export type VisualElementThumbnailState = {
  id: string;
  dataUrl: string | null;
  loading: boolean;
  failed?: boolean;
};

// One low-priority request at a time: never fill the renderer command queue
// with the whole model, and let playback/visibility commands run between Parts.
export function useVisualThumbnails(scope: string, enabled: boolean) {
  const store = useRef({ scope, values: {} as Record<string, VisualElementThumbnailState> });
  if (store.current.scope !== scope) store.current = { scope, values: {} };
  const [selection, setSelection] = useState({ scope, id: null as string | null });
  const selectedId = selection.scope === scope ? selection.id : null;
  const [visibleIds, setVisibleIds] = useState<string[]>([]);
  const [revision, refresh] = useReducer(value => value + 1, 0);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const onVisible = useCallback((ids: string[]) => setVisibleIds(previous =>
    previous.length === ids.length && previous.every((id, index) => id === ids[index]) ? previous : ids), []);

  useEffect(() => {
    if (!enabled || pending.current) return;
    const current = store.current;
    const id = [...(selectedId ? [selectedId] : []), ...visibleIds].find(candidate => !current.values[candidate]);
    if (!id) return;
    const timer = window.setTimeout(() => {
      pending.current = true;
      current.values[id] = { id, dataUrl: null, loading: true };
      refresh();
      void Promise.resolve().then(() => getPreviewVisualElementThumbnail(id)).then(result => {
        if (result.id !== id) throw new Error('Thumbnail identity mismatch');
        current.values[id] = { ...result, loading: false };
      }).catch(() => {
        current.values[id] = { id, dataUrl: null, loading: false, failed: true };
      }).finally(() => {
        pending.current = false;
        if (mounted.current) refresh();
      });
    }, 32);
    return () => window.clearTimeout(timer);
  }, [scope, enabled, selectedId, visibleIds, revision]);

  const inspect = (id: string) => {
    if (store.current.values[id]?.failed) delete store.current.values[id];
    setSelection({ scope, id });
    refresh();
  };
  return {
    thumbnails: store.current.values,
    thumbnail: selectedId ? store.current.values[selectedId] ?? { id: selectedId, dataUrl: null, loading: true } : null,
    inspect,
    onVisible,
  };
}
