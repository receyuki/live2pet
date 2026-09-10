import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Chip, Input, ProgressBar } from '@heroui/react';
import { Image } from 'lucide-react';
import { setLive2DPreviewExpression, installSpinePack, hasPreviewApi, getLibraryThumbnail, inspectLibrarySource, openLive2DPreview, layoutLive2DPreview, playLive2DPreview, closeLive2DPreview, type SourceLibrary, type SourceLibraryCandidate, type SourceLibrarySelection } from './app-host';
import { translate, type Locale } from './i18n';
import { ThumbnailMemory } from './thumbnail-memory';

const thumbnailMemory = new ThumbnailMemory({ maxEntries: 128, maxBytes: 32 * 1024 * 1024 });

function ModelCard({ library, candidate, selected, onSelect, locale, thumbnailRevision }: { library: SourceLibrary; candidate: SourceLibraryCandidate; selected: boolean; onSelect: () => void; locale: Locale; thumbnailRevision: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const thumbnailKey = `${library.libraryId}:${candidate.id}`;
  const [cover, setCover] = useState<string | null>(() => thumbnailMemory.get(thumbnailKey));
  const [failed, setFailed] = useState(false);
  const unsupportedSpine = candidate.format === 'spine' && Boolean(candidate.runtimeLine) && !['4.0', '4.1', '4.2', '4.3'].includes(candidate.runtimeLine!);
  useEffect(() => {
    let active = true, requested = false;
    const unsubscribe = thumbnailMemory.subscribe((evictedKey) => { if (active && evictedKey === thumbnailKey) setCover(null); });
    if (cover || unsupportedSpine) return () => { active = false; unsubscribe(); };
    const load = () => {
      if (requested) return;
      requested = true;
      void getLibraryThumbnail(library.libraryId, candidate.id)
        .then(result => { if (active) { if (result.dataUrl) thumbnailMemory.set(thumbnailKey, result.dataUrl); setCover(result.dataUrl); setFailed(!result.dataUrl); } })
        .catch(() => { if (active) setFailed(true); });
    };
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { load(); observer?.disconnect(); } }) : null;
    if (observer && ref.current) observer.observe(ref.current); else load();
    return () => { active = false; observer?.disconnect(); unsubscribe(); };
  }, [library.libraryId, candidate.id, thumbnailKey, cover, unsupportedSpine, thumbnailRevision]);
  return <div ref={ref}><Button className={`model-library-card${selected ? ' model-library-card-selected' : ''}`} variant="ghost" aria-pressed={selected} onPress={onSelect}>
    <span className="model-library-cover">{cover ? <img src={cover} alt="" /> : <><Image size={24} /><small>{translate(locale, library.kind === 'github' ? 'libraryDownloadPreview' : unsupportedSpine ? 'librarySpineVersionUnsupported' : failed ? 'libraryPreviewUnavailable' : 'libraryThumbnailLoading', { value: candidate.runtimeLine || '?' })}</small></>}</span>
    <span className="grow-copy"><strong>{candidate.name}</strong><small title={candidate.relativePath}>{candidate.relativePath}</small><span className="model-library-meta">{candidate.format === 'spine' ? `Spine ${candidate.runtimeLine || ''}` : candidate.format === 'live2d-pck' ? 'PCK' : 'Live2D'}</span></span>
  </Button></div>;
}

export function ModelPreview({ library, candidate, locale, onUse, onClose, direct, onConfigureRuntime }: { library?: SourceLibrary; candidate: SourceLibraryCandidate; locale: Locale; onUse: (motion: string) => Promise<void>; onClose: () => void; direct?: SourceLibrarySelection; onConfigureRuntime?: () => void }) {
  const surface = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<SourceLibrarySelection | null>(null);
  const [motions, setMotions] = useState<{ id: string; name?: string }[]>([]);
  const [motion, setMotion] = useState('');
  const [expression, setExpression] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const inspection = selection?.inspection;
  const format = inspection?.model.format === 'spine'
    ? `Spine ${inspection.model.runtimeLine}`
    : inspection?.model.cubism ? `Cubism ${inspection.model.cubism}` : candidate.format === 'spine' ? `Spine ${candidate.runtimeLine || ''}`.trim() : candidate.format === 'live2d-pck' ? 'PCK' : 'Live2D';
  useEffect(() => {
    setReady(false); setError('');
    let active = true, opened = false;
    const bounds = () => { const rect = surface.current!.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: Math.max(64, rect.width), height: Math.max(64, rect.height) }; };
    const update = () => { if (opened && active && surface.current) void layoutLive2DPreview({ visible: true, bounds: bounds() }).catch(() => {}); };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    if (surface.current) observer?.observe(surface.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    void (async () => {
      try {
        const result = direct ?? await inspectLibrarySource(library!.libraryId, candidate.id, 'library-preview');
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
    return () => { active = false; observer?.disconnect(); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); if (hasPreviewApi()) void closeLive2DPreview().catch(() => {}); };
  }, [library?.libraryId, candidate.id, locale, direct, retry]);
  return <aside className="library-detail" aria-label={candidate.name} data-tour-id="model-preview">
    <header className="library-detail-header"><div><p className="eyebrow">{translate(locale, 'source')}</p><h3>{candidate.name}</h3><small title={candidate.relativePath}>{candidate.relativePath}</small></div><Button size="sm" variant="ghost" onPress={onClose}>{translate(locale, 'close')}</Button></header>
    <section className="library-package-summary" aria-labelledby="library-package-title">
      <div><h4 id="library-package-title">{translate(locale, 'sourceTitle')}</h4><Chip size="sm" variant="soft">{format}</Chip></div>
      <p>{translate(locale, 'sourceBody')}</p>
      {inspection && <small>{inspection.model.textures.length} {translate(locale, 'sourceTextures')} · {inspection.motions.length} {translate(locale, 'sourceMotions')} · {inspection.expressions.length} {translate(locale, 'sourceExpressions')}</small>}
    </section>
    <div className="library-live-surface" ref={surface} />
    {!ready && !error && <ProgressBar aria-label={translate(locale, 'loading')} isIndeterminate />}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {error && inspection?.model.format === 'spine' && ['4.0', '4.1', '4.2', '4.3'].includes(inspection.model.runtimeLine ?? '') && <Button isDisabled={busy} variant="secondary" onPress={() => { setBusy(true); void installSpinePack(inspection.model.runtimeLine!).then(() => setRetry(value => value + 1)).catch(cause => setError(String(cause))).finally(() => setBusy(false)); }}>{translate(locale, 'installSpinePack')}</Button>}
    {error && <div className="source-actions"><Button variant="secondary" onPress={onConfigureRuntime}>{translate(locale, 'configureRuntime')}</Button><Button variant="ghost" onPress={() => setRetry(value => value + 1)}>{translate(locale, 'retry')}</Button></div>}
    {inspection?.resources.filter(resource => resource.required && !resource.exists).map(resource => <p className="inline-error" key={resource.path}>{resource.path}</p>)}
    {inspection?.warnings.map((warning, index) => <p key={index}>{warning.code}{warning.resource ? ` · ${warning.resource}` : ''}</p>)}
    {ready && <label>{translate(locale, 'sourceMotions')}<select aria-label={translate(locale, 'sourceMotions')} value={motion} onChange={event => { const id = event.target.value; setMotion(id); void playLive2DPreview({ motionId: id, loop: true }).catch(cause => setError(String(cause))); }}>{motions.map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>}
    {ready && !!inspection?.expressions.length && <label>{translate(locale, 'sourceExpressions')}<select aria-label={translate(locale, 'sourceExpressions')} value={expression} onChange={event => { setExpression(event.target.value); void setLive2DPreviewExpression(event.target.value || null).catch(cause => setError(String(cause))); }}><option value="">—</option>{inspection.expressions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    <footer className="library-detail-actions"><Button variant="primary" isDisabled={!ready || !!error || busy || inspection?.resources.some(resource => resource.required && !resource.exists)} onPress={() => { setBusy(true); void onUse(motion).catch(cause => setError(String(cause))).finally(() => setBusy(false)); }}>{translate(locale, 'libraryUseModel')}</Button><small>{translate(locale, 'libraryPreviewOnly')}</small></footer>
  </aside>;
}

export function ModelLibrary({ library, locale, onUse, onConfigureRuntime, selectedModel, onSelectModel, thumbnailRevision = 0 }: { library: SourceLibrary; locale: Locale; onUse: (library: SourceLibrary, candidate: SourceLibraryCandidate, motion: string) => Promise<void>; onConfigureRuntime?: () => void; selectedModel?: SourceLibraryCandidate | null; onSelectModel?: (model: SourceLibraryCandidate | null) => void; thumbnailRevision?: number }) {
  const [localSelected, setLocalSelected] = useState<SourceLibraryCandidate | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('source');
  const selected = selectedModel === undefined ? localSelected : selectedModel;
  const setSelected = onSelectModel ?? setLocalSelected;
  const candidates = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    const filtered = normalizedQuery ? library.candidates.filter(candidate => [candidate.name, candidate.relativePath, candidate.format, candidate.version, candidate.runtimeLine]
      .filter(Boolean)
      .some(value => String(value).toLocaleLowerCase(locale).includes(normalizedQuery))) : [...library.candidates];
    if (sort === 'source') return filtered;
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    const byName = (left: SourceLibraryCandidate, right: SourceLibraryCandidate) => collator.compare(left.name, right.name) || collator.compare(left.relativePath, right.relativePath);
    if (sort === 'name-desc') return filtered.sort((left, right) => byName(right, left));
    if (sort === 'format') return filtered.sort((left, right) => collator.compare(left.format, right.format) || byName(left, right));
    return filtered.sort(byName);
  }, [library.candidates, locale, query, sort]);
  return <div className={`library-browser${selected ? ' library-browser-selected' : ''}`}>
    <div className="model-library-results">
      <div className="model-library-toolbar">
        <Input type="search" aria-label={translate(locale, 'searchModels')} placeholder={translate(locale, 'searchModels')} value={query} onChange={event => setQuery(event.target.value)} />
        <select aria-label={translate(locale, 'sortModels')} value={sort} onChange={event => setSort(event.target.value)}>
          <option value="source">{translate(locale, 'sortSourceOrder')}</option>
          <option value="name-asc">{translate(locale, 'sortNameAscending')}</option>
          <option value="name-desc">{translate(locale, 'sortNameDescending')}</option>
          <option value="format">{translate(locale, 'sortModelType')}</option>
        </select>
        <small>{translate(locale, 'modelLibraryVisibleCount', { visible: candidates.length, total: library.candidates.length })}</small>
      </div>
      {candidates.length ? <div className="model-library-grid">{candidates.map(candidate => <ModelCard key={candidate.id} library={library} candidate={candidate} selected={candidate.id === selected?.id} onSelect={() => setSelected(candidate)} locale={locale} thumbnailRevision={thumbnailRevision} />)}</div> : <div className="empty-state">{translate(locale, 'noModelMatches')}</div>}
    </div>
    {selected && <ModelPreview onConfigureRuntime={onConfigureRuntime} onClose={() => setSelected(null)} key={`${library.libraryId}:${selected.id}`} library={library} candidate={selected} locale={locale} onUse={motion => onUse(library, selected, motion)} />}
  </div>;
}
