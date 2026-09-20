import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { createPreviewSession, type OwnedPreviewSession } from './preview-session';
import type { PreviewStatus, VisualSettings } from './app-host';

export function usePreviewSession({ surface, enabled, projectId, sourceFingerprint, visualSettings, retry = 0, allowMinimumBounds = false }: {
  surface: RefObject<HTMLDivElement | null>; enabled: boolean; projectId: string;
  sourceFingerprint?: string; visualSettings?: VisualSettings; retry?: number; allowMinimumBounds?: boolean;
}) {
  const [status, setStatus] = useState<PreviewStatus | null>(null);
  const scope = JSON.stringify([projectId, sourceFingerprint, retry, enabled]);
  const sessionRef = useRef<{ scope: string; session: OwnedPreviewSession } | null>(null);
  const initialVisualSettings = useRef(visualSettings);
  initialVisualSettings.current = visualSettings;
  useEffect(() => {
    if (!enabled || !sourceFingerprint) { setStatus(null); return; }
    let active = true, syncing = false, pendingLayout = false, polling = false;
    const input = { projectId, sourceFingerprint, ...(initialVisualSettings.current ? { visualSettings: initialVisualSettings.current } : {}) };
    const session = createPreviewSession({ input, onStatus: setStatus });
    sessionRef.current = { scope, session };
    setStatus({ schemaVersion: 1, state: 'opening', projectId, sourceFingerprint, visible: false, bounds: null });
    const syncBounds = async () => {
      if (!active || !surface.current) return;
      if (syncing) { pendingLayout = true; return; }
      const rect = surface.current.getBoundingClientRect();
      if (!allowMinimumBounds && (rect.width < 64 || rect.height < 64)) return;
      syncing = true;
      try { await session.layout({ x: rect.x, y: rect.y, width: Math.max(64, rect.width), height: Math.max(64, rect.height) }); }
      catch (cause) {
        if (active) setStatus({ schemaVersion: 1, state: 'failed', projectId, sourceFingerprint, visible: false, bounds: null, error: { code: 'PREVIEW_OPEN_FAILED', message: cause instanceof Error ? cause.message : String(cause) } });
      } finally {
        syncing = false;
        if (pendingLayout) { pendingLayout = false; void syncBounds(); }
      }
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { void syncBounds(); }) : null;
    if (surface.current) observer?.observe(surface.current);
    window.addEventListener('resize', syncBounds);
    window.addEventListener('scroll', syncBounds, true);
    void syncBounds();
    const timer = window.setInterval(async () => {
      if (polling || syncing) return;
      polling = true;
      try { await session.poll(); } catch { /* Commands report actionable errors. */ }
      finally { polling = false; }
    }, 150);
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener('resize', syncBounds);
      window.removeEventListener('scroll', syncBounds, true);
      window.clearInterval(timer);
      sessionRef.current = null;
      void session.dispose();
    };
  }, [enabled, projectId, sourceFingerprint, retry, surface, scope, allowMinimumBounds]);
  const run = useCallback(<T,>(operation: () => Promise<T>) => {
    const current = sessionRef.current;
    return current?.scope === scope ? current.session.run(operation) : Promise.resolve(undefined);
  }, [scope]);
  return { status, setStatus, run };
}
