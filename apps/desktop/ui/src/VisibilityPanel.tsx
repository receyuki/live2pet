import { Button, Input } from '@heroui/react';
import { Eye, EyeOff, X } from 'lucide-react';
import { useState } from 'react';
import type { VisualElement, VisualSettings } from './app-host';
import { translate, type Locale } from './i18n';

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

export function VisibilityPanel({ locale, elements, settings, soloId, busy, onSettings, onSolo, onClose }: {
  locale: Locale; elements: VisualElement[]; settings: VisualSettings; soloId: string | null; busy: boolean;
  onSettings: (settings: VisualSettings) => void; onSolo: (id: string | null) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const hidden = new Set(settings.hiddenElementIds);
  const rows = elements.filter(element => `${element.name} ${element.id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <section className="workspace-panel visibility-panel" aria-label={t('visibility')}>
    <div className="section-heading-row"><h2>{t('visibility')}</h2><Button isIconOnly size="sm" variant="ghost" aria-label={t('closeVisibility')} onPress={onClose}><X size={16} /></Button></div>
    <p className="mapping-requirement-hint">{t('visibilityHint')}</p>
    <Input autoFocus aria-label={t('searchVisualElements')} placeholder={t('search')} value={query} onChange={event => setQuery(event.target.value)} />
    <div className="visibility-actions"><Button size="sm" variant="secondary" isDisabled={busy || (!hidden.size && !soloId)} onPress={() => { onSolo(null); onSettings({ hiddenElementIds: [] }); }}>{t('restoreVisibility')}</Button>{soloId && <Button size="sm" variant="ghost" onPress={() => onSolo(null)}>{t('endSolo')}</Button>}</div>
    {soloId && <p role="status" className="mapping-requirement-hint">{t('soloHint')}</p>}
    <div className="motion-list">
      {rows.map(element => <div className="visibility-row" key={element.id}>
        <span className="grow-copy"><strong title={element.name}>{element.name}</strong>{element.name !== element.id && <small title={element.id}>{element.id}</small>}</span>
        <div className="visibility-actions"><Button isIconOnly size="sm" variant={hidden.has(element.id) ? 'ghost' : 'secondary'} isDisabled={busy} aria-label={`${t(hidden.has(element.id) ? 'showElement' : 'hideElement')} · ${element.name}`} aria-pressed={!hidden.has(element.id)} onPress={() => { const next = new Set(hidden); if (next.has(element.id)) next.delete(element.id); else next.add(element.id); onSolo(null); onSettings({ hiddenElementIds: [...next].sort() }); }}>{hidden.has(element.id) ? <EyeOff size={15} /> : <Eye size={15} />}</Button>
        <Button size="sm" variant={soloId === element.id ? 'secondary' : 'ghost'} aria-label={`${t('soloElement')} · ${element.name}`} aria-pressed={soloId === element.id} isDisabled={busy} onPress={() => onSolo(soloId === element.id ? null : element.id)}>{t('soloElement')}</Button></div>
      </div>)}
      {!rows.length && <p>{t(elements.length ? 'noVisualMatches' : 'noVisualElements')}</p>}
    </div>
    <p className="mapping-requirement-hint">{t('inseparableElements')}</p>
  </section>;
}
