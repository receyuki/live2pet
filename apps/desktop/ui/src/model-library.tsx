import { useEffect, useRef, useState } from 'react';
import { Button, ProgressBar } from '@heroui/react';
import { Image } from 'lucide-react';
import { hasPreviewApi, getLibraryThumbnail, inspectLibrarySource, openLive2DPreview, layoutLive2DPreview, playLive2DPreview, type SourceLibrary, type SourceLibraryCandidate, type SourceLibrarySelection } from './app-host';
import { translate, type Locale } from './i18n';

function ModelCard({ library, candidate, index, selected, onSelect, locale, paused }: { library: SourceLibrary; candidate: SourceLibraryCandidate; index: number; selected: boolean; onSelect: () => void; locale: Locale; paused: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [cover, setCover] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const unsupportedSpine = candidate.format === 'spine' && Boolean(candidate.runtimeLine) && !['4.0', '4.1', '4.2', '4.3'].includes(candidate.runtimeLine!);
  useEffect(() => {
    if (library.kind !== 'local' || paused || cover || unsupportedSpine) return;
    let active = true, requested = false;
    const load = () => {
      if (requested) return;
      requested = true;
      void getLibraryThumbnail(library.libraryId, candidate.id)
        .then(result => { if (active) { setCover(result.dataUrl); setFailed(!result.dataUrl); } })
        .catch(() => { if (active) setFailed(true); });
    };
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { load(); observer?.disconnect(); } }) : null;
    if (observer && ref.current) observer.observe(ref.current); else load();
    const backgroundTimer = window.setTimeout(load, 500 + Math.min(index * 35, 1000));
    return () => { active = false; window.clearTimeout(backgroundTimer); observer?.disconnect(); };
  }, [library.libraryId, library.kind, candidate.id, index, paused, cover, unsupportedSpine]);
  return <div ref={ref}><Button className={`model-library-card${selected ? ' model-library-card-selected' : ''}`} variant="ghost" aria-pressed={selected} onPress={onSelect}>
    <span className="model-library-cover">{cover ? <img src={cover} alt="" /> : <><Image size={24} /><small>{translate(locale, library.kind === 'github' ? 'libraryDownloadPreview' : unsupportedSpine ? 'librarySpineVersionUnsupported' : failed ? 'libraryPreviewUnavailable' : 'libraryThumbnailLoading', { value: candidate.runtimeLine || '?' })}</small></>}</span>
    <span className="grow-copy"><strong>{candidate.name}</strong><small title={candidate.relativePath}>{candidate.relativePath}</small><span className="model-library-meta">{candidate.format === 'spine' ? `Spine ${candidate.runtimeLine || ''}` : candidate.format === 'live2d-pck' ? 'PCK' : 'Live2D'}</span></span>
  </Button></div>;
}

function ModelPreview({ library, candidate, locale, onUse, onClose }: { library: SourceLibrary; candidate: SourceLibraryCandidate; locale: Locale; onUse: () => Promise<void>; onClose: () => void }) {
  const surface = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<SourceLibrarySelection | null>(null);
  const [motions, setMotions] = useState<{ id: string; name?: string }[]>([]);
  const [motion, setMotion] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true, opened = false;
    const bounds = () => { const rect = surface.current!.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: Math.max(64, rect.width), height: Math.max(64, rect.height) }; };
    const update = () => { if (opened && active && surface.current) void layoutLive2DPreview({ visible: true, bounds: bounds() }).catch(() => {}); };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    if (surface.current) observer?.observe(surface.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    void (async () => {
      try {
        const result = await inspectLibrarySource(library.libraryId, candidate.id, 'library-preview');
        if (!active) return;
        setSelection(result);
        const status = await openLive2DPreview({ projectId: 'library-preview', sourceFingerprint: result.inspection.source.fingerprint, bounds: bounds() });
        if (!active) return;
        if (status.state !== 'ready') throw new Error(status.error?.message || translate(locale, 'libraryPreviewUnavailable'));
        opened = true;
        const catalog = status.catalog?.motions ?? result.inspection.motions;
        setMotions(catalog); setReady(true);
        if (catalog[0]) { setMotion(catalog[0].id); await playLive2DPreview({ motionId: catalog[0].id, loop: true }); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : String(cause)); }
    })();
    return () => { active = false; observer?.disconnect(); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); if (hasPreviewApi()) void layoutLive2DPreview({ visible: false }).catch(() => {}); };
  }, [library.libraryId, candidate.id, locale]);
  return <aside className="library-detail" aria-label={candidate.name}>
    <div className="section-heading-row"><h3>{candidate.name}</h3><Button size="sm" variant="ghost" onPress={onClose}>{translate(locale, 'close')}</Button></div>
    <div className="library-live-surface" ref={surface} />
    {!ready && !error && <ProgressBar aria-label={translate(locale, 'loading')} isIndeterminate />}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {ready && <label>{translate(locale, 'sourceMotions')}<select aria-label={translate(locale, 'sourceMotions')} value={motion} onChange={event => { const id = event.target.value; setMotion(id); void playLive2DPreview({ motionId: id, loop: true }).catch(cause => setError(String(cause))); }}>{motions.map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>}
    <Button variant="primary" isDisabled={!selection || busy} onPress={() => { setBusy(true); void onUse().finally(() => setBusy(false)); }}>{translate(locale, 'libraryUseModel')}</Button>
    <p>{translate(locale, 'libraryPreviewOnly')}</p>
  </aside>;
}

export function ModelLibrary({ library, locale, onUse }: { library: SourceLibrary; locale: Locale; onUse: (library: SourceLibrary, candidate: SourceLibraryCandidate) => Promise<void> }) {
  const [selected, setSelected] = useState<SourceLibraryCandidate | null>(null);
  return <div className={`library-browser${selected ? ' library-browser-selected' : ''}`}>
    <div className="model-library-grid">{library.candidates.map((candidate, index) => <ModelCard paused={Boolean(selected)} key={candidate.id} library={library} candidate={candidate} index={index} selected={candidate.id === selected?.id} onSelect={() => setSelected(candidate)} locale={locale} />)}</div>
    {selected && <ModelPreview onClose={() => setSelected(null)} key={`${library.libraryId}:${selected.id}`} library={library} candidate={selected} locale={locale} onUse={async () => { await onUse(library, selected); setSelected(null); }} />}
  </div>;
}
