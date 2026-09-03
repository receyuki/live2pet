import { Button, Input, ProgressBar } from '@heroui/react';
import { Eye, EyeOff, Image as ImageIcon, ImageOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { VisualElement, VisualSettings } from './app-host';
import { translate, type Locale } from './i18n';
import type { VisualElementThumbnailState } from './useVisualThumbnails';

export function soloVisualSettings(elements: VisualElement[], soloId: string): VisualSettings {
  const keep = new Set([soloId]);
  const byId = new Map(elements.map(element => [element.id, element]));
  // Parent opacity also affects descendants. Keep the selected group's
  // ancestors and descendants, but hide its siblings during temporary Solo.
  let parent = byId.get(soloId)?.parentId;
  while (parent && !keep.has(parent)) { keep.add(parent); parent = byId.get(parent)?.parentId; }
  for (const element of elements) {
    let current: string | undefined = element.id;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      if (current === soloId) { keep.add(element.id); break; }
      visited.add(current); current = byId.get(current)?.parentId;
    }
  }
  return { hiddenElementIds: elements.filter(element => !keep.has(element.id)).map(element => element.id).sort() };
}

export function VisibilityPanel({ locale, elements, settings, soloId, busy, thumbnail, thumbnails, onSettings, onSolo, onInspect, onVisible }: {
  locale: Locale; elements: VisualElement[]; settings: VisualSettings; soloId: string | null; busy: boolean;
  thumbnail: VisualElementThumbnailState | null;
  thumbnails: Record<string, VisualElementThumbnailState>;
  onSettings: (settings: VisualSettings) => void; onSolo: (id: string | null) => void; onInspect: (id: string) => void; onVisible: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const hidden = new Set(settings.hiddenElementIds);
  const rows = elements.filter(element => `${element.name} ${element.id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const selected = elements.find(element => element.id === thumbnail?.id);
  const selectedName = selected?.name ?? thumbnail?.id ?? '';
  useEffect(() => {
    const root = list.current;
    if (!root) return;
    const items = [...root.querySelectorAll<HTMLElement>('[data-part-id]')];
    if (typeof IntersectionObserver !== 'function') {
      onVisible(items.slice(0, 8).map(item => item.dataset.partId!));
      return () => onVisible([]);
    }
    const visible = new Set<string>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.partId!;
        if (entry.isIntersecting) visible.add(id); else visible.delete(id);
      }
      onVisible(items.map(item => item.dataset.partId!).filter(id => visible.has(id)));
    }, { root, rootMargin: '80px 0px' });
    items.forEach(item => observer.observe(item));
    return () => { observer.disconnect(); onVisible([]); };
  }, [elements, query, onVisible]);
  return <section className="visibility-panel" aria-label={t('visibility')}>
    <p className="mapping-requirement-hint">{t('visibilityHint')}</p>
    <Input aria-label={t('searchVisualElements')} placeholder={t('search')} value={query} onChange={event => setQuery(event.target.value)} />
    <section className="visibility-inspector" aria-label={t('visualElementPreview')} aria-live="polite">
      {thumbnail ? <>
        <div className="visibility-inspector-heading"><span className="grow-copy"><strong title={selectedName}>{selectedName}</strong><small title={thumbnail.id}>{thumbnail.id}</small></span>{thumbnail.loading && <small>{t('loading')}</small>}</div>
        {thumbnail.loading ? <div className="visibility-thumbnail visibility-thumbnail-loading"><ProgressBar aria-label={t('loading')} isIndeterminate><ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track></ProgressBar></div> : thumbnail.dataUrl ? <img className="visibility-thumbnail" src={thumbnail.dataUrl} alt={`${selectedName} · ${thumbnail.id}`} /> : <div className="visibility-thumbnail visibility-thumbnail-empty"><ImageOff size={18} /><span>{t(thumbnail.failed ? 'thumbnailUnavailable' : 'thumbnailEmpty')}</span></div>}
      </> : <div className="visibility-thumbnail visibility-thumbnail-empty"><ImageIcon size={18} /><span>{t('thumbnailSelectHint')}</span></div>}
    </section>
    <div className="visibility-actions"><Button size="sm" variant="secondary" isDisabled={busy || (!hidden.size && !soloId)} onPress={() => { onSolo(null); onSettings({ hiddenElementIds: [] }); }}>{t('restoreVisibility')}</Button>{soloId && <Button size="sm" variant="ghost" onPress={() => onSolo(null)}>{t('endSolo')}</Button>}</div>
    {soloId && <p role="status" className="mapping-requirement-hint">{t('soloHint')}</p>}
    <div className="motion-list" ref={list}>
      {rows.map(element => <div className="visibility-row" key={element.id} data-part-id={element.id}>
        <Button className="visibility-row-thumbnail" isIconOnly variant={thumbnail?.id === element.id ? 'secondary' : 'ghost'} isDisabled={busy} aria-label={`${t('inspectElement')} · ${element.name}`} aria-pressed={thumbnail?.id === element.id} onPress={() => onInspect(element.id)}>
          {thumbnails[element.id]?.dataUrl ? <img width={64} height={64} src={thumbnails[element.id].dataUrl!} alt={`${element.name} · ${element.id}`} /> : <span className="visibility-row-placeholder" title={t(thumbnails[element.id]?.failed ? 'thumbnailUnavailable' : thumbnails[element.id]?.loading || !thumbnails[element.id] ? 'loading' : 'thumbnailEmpty')}><ImageOff size={18} /><small>{t(thumbnails[element.id]?.failed ? 'thumbnailRetry' : thumbnails[element.id]?.loading || !thumbnails[element.id] ? 'loading' : 'thumbnailEmptyShort')}</small></span>}
        </Button>
        <div className="visibility-row-details"><span className="grow-copy"><strong title={element.name}>{element.name}</strong><small title={element.id}>{element.id}</small></span>
        <div className="visibility-actions"><Button isIconOnly size="sm" variant={hidden.has(element.id) ? 'ghost' : 'secondary'} isDisabled={busy} aria-label={`${t(hidden.has(element.id) ? 'showElement' : 'hideElement')} · ${element.name}`} aria-pressed={!hidden.has(element.id)} onPress={() => { const next = new Set(hidden); if (next.has(element.id)) next.delete(element.id); else next.add(element.id); onSolo(null); onSettings({ hiddenElementIds: [...next].sort() }); }}>{hidden.has(element.id) ? <EyeOff size={15} /> : <Eye size={15} />}</Button>
        <Button size="sm" variant={soloId === element.id ? 'secondary' : 'ghost'} aria-label={`${t('soloElement')} · ${element.name}`} aria-pressed={soloId === element.id} isDisabled={busy} onPress={() => onSolo(soloId === element.id ? null : element.id)}>{t('soloElement')}</Button></div>
        </div>
      </div>)}
      {!rows.length && <p>{t(elements.length ? 'noVisualMatches' : 'noVisualElements')}</p>}
    </div>
    <p className="mapping-requirement-hint">{t('inseparableElements')}</p>
  </section>;
}
