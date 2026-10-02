import { Button, ButtonGroup, Checkbox, Input, Label, Modal, ProgressBar, TextField } from '@heroui/react';
import { useEffect, useRef, useState } from 'react';
import { Download, FolderOpen } from 'lucide-react';
import {
  cancelAnimationExport, chooseAnimationExportDirectory, exportAnimations, getOutputSettings,
  onAnimationExportProgress, openAnimationExportDirectory,
  type AnimationExportDirectory, type AnimationExportProgress, type AnimationExportRender,
  type AnimationExportResult, type Live2PetProject, type RenderPreset, type SourceInspection,
} from './app-host';
import { CLAWD_PROFILE } from './target-profiles';
import { translate, type Locale, type MessageKey } from './i18n';

type ExportContext = { project: Live2PetProject; inspection: SourceInspection; motionId: string; expressionId: string | null };
type ExportState = { busy: boolean; progress: AnimationExportProgress | null; result: AnimationExportResult | null; error: string | null };
const emptyState = (): ExportState => ({ busy: false, progress: null, result: null, error: null });
export const animationExportPreset = (preset: RenderPreset): AnimationExportRender => {
  const { width, height, fps, quality } = CLAWD_PROFILE.renderPresets[preset];
  return { preset, width, height, fps, quality, lossless: false, loop: true };
};
export function validAnimationExportRender(render: AnimationExportRender): boolean {
  return [render.width, render.height].every(value => Number.isInteger(value) && value >= 1 && value <= 2048)
    && Number.isInteger(render.fps) && render.fps >= 1 && render.fps <= 60
    && Number.isInteger(render.quality) && render.quality >= 1 && render.quality <= 100;
}
export function animationExportStage(event: AnimationExportProgress | null): MessageKey {
  if (event?.stage === 'queue') return 'exportQueued';
  if (event?.cache === 'encoded' || (event?.cache === 'hit' && event.stage === 'encode')) return 'exportCached';
  if (event?.cache === 'frames' || (event?.cache === 'hit' && event.stage === 'render')) return 'exportFramesCached';
  if (event?.stage === 'capture' || event?.stage === 'render') return 'exportCapturing';
  if (event?.stage === 'encode') return 'exportEncoding';
  if (event?.stage === 'save') return 'exportSaving';
  return 'exportPreparing';
}

export function useAnimationExport(locale: Locale) {
  const [isOpen, setOpen] = useState(false);
  const [context, setContext] = useState<ExportContext | null>(null);
  const [state, setState] = useState<ExportState>(emptyState);
  const activeRequest = useRef<string | null>(null);
  const t = (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values);
  useEffect(() => onAnimationExportProgress(event => {
    if (event.requestId !== activeRequest.current) return;
    setState(current => event.sequence <= (current.progress?.sequence ?? 0) ? current : {
      ...current, progress: { ...current.progress, ...event, percent: Math.max(current.progress?.percent ?? 0, Math.min(99, Math.round(event.percent ?? (event.fraction ?? 0) * 100))) },
    });
  }), []);
  const open = (next: ExportContext) => {
    if (!activeRequest.current) {
      setContext(structuredClone(next));
      setState(emptyState());
    }
    setOpen(true);
  };
  const run = async (motionIds: string[], expressionId: string | null, render: AnimationExportRender, directoryId?: string) => {
    if (!context || activeRequest.current) return;
    const requestId = `animation_${crypto.randomUUID()}`;
    activeRequest.current = requestId;
    setState({ ...emptyState(), busy: true });
    try {
      const result = await exportAnimations({ requestId, project: structuredClone(context.project), motionIds, expressionId, render, directoryId });
      setState(current => ({ ...current, result, busy: false }));
    } catch (cause) {
      setState(current => ({ ...current, busy: false, error: cause instanceof Error ? cause.message : t('exportFailed') }));
    } finally { activeRequest.current = null; }
  };
  const cancel = async () => {
    if (!activeRequest.current) return;
    try { await cancelAnimationExport(activeRequest.current); }
    catch (cause) { setState(current => ({ ...current, error: cause instanceof Error ? cause.message : t('exportFailed') })); }
  };
  const label = state.error ? t('exportFailed') : state.busy ? t(animationExportStage(state.progress))
    : state.result?.cancelled ? t('exportCancelled') : t('exportDone', { count: state.result?.files.length ?? 0 });
  return {
    busy: state.busy, isOpen, activeRequest,
    open,
    status: (state.busy || state.result || state.error) && <div className="footer-build" title={label}>
      <Button size="sm" variant="ghost" onPress={() => setOpen(true)}>{t('exportAnimations')} · {state.busy ? `${state.progress?.percent ?? 0}%` : state.error || state.result?.failures.length ? t('failed') : state.result?.cancelled ? t('buildStatus_cancelled') : t('ready')}</Button>
      {state.busy && <ProgressBar size="sm" aria-label={t('exportProgress')} value={state.progress?.percent ?? 0}><ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track></ProgressBar>}
    </div>,
    dialog: context && <AnimationExportDialog key={`${context.project.projectId}:${context.project.source.fingerprint}:${context.motionId}:${context.expressionId}`} locale={locale} context={context} isOpen={isOpen} onOpenChange={setOpen} state={state} onRun={run} onCancel={() => void cancel()} />,
  };
}

function ExportCheck({ children, selected, onChange, disabled = false }: { children: React.ReactNode; selected: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <Checkbox isSelected={selected} onChange={onChange} isDisabled={disabled}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control><Label>{children}</Label></Checkbox.Content></Checkbox>;
}

function AnimationExportDialog({ locale, context, isOpen, onOpenChange, state, onRun, onCancel }: {
  locale: Locale; context: ExportContext; isOpen: boolean; onOpenChange: (value: boolean) => void; state: ExportState;
  onRun: (motionIds: string[], expressionId: string | null, render: AnimationExportRender, directoryId?: string) => Promise<void>; onCancel: () => void;
}) {
  const t = (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values);
  const [scope, setScope] = useState<'current' | 'selected' | 'all'>('current');
  const [selected, setSelected] = useState([context.motionId]);
  const [query, setQuery] = useState('');
  const [preset, setPreset] = useState<RenderPreset | 'custom'>('balanced');
  const [render, setRender] = useState(() => animationExportPreset('balanced'));
  const [lockRatio, setLockRatio] = useState(true);
  const [expression, setExpression] = useState<string | null>(context.expressionId);
  const [directory, setDirectory] = useState<AnimationExportDirectory | null>(null);
  const [defaultFolder, setDefaultFolder] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [format, setFormat] = useState<'webp' | 'apng'>('webp');
  const [settingsReady, setSettingsReady] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    setSettingsReady(false);
    void getOutputSettings().then(settings => {
      if (!alive) return;
      setDefaultFolder(settings.mode === 'folder' ? settings.folder ?? null : null);
      setFormat(settings.animationFormat ?? 'webp');
      setSettingsReady(true);
    }).catch(cause => { if (alive) setLocalError(String(cause)); });
    return () => { alive = false; };
  }, [isOpen]);
  const motions = context.inspection.motions;
  const ids = scope === 'current' ? [context.motionId] : scope === 'all' ? motions.map(motion => motion.id) : selected;
  const included = motions.filter(motion => ids.includes(motion.id));
  const knownDuration = included.every(motion => motion.duration !== null && motion.duration > 0);
  const seconds = included.reduce((sum, motion) => sum + (motion.duration ?? 0), 0);
  const frames = included.reduce((sum, motion) => sum + Math.ceil((motion.duration ?? 0) * render.fps), 0);
  const valid = settingsReady && ids.length > 0 && validAnimationExportRender(render);
  const changeScope = (value: typeof scope) => { setScope(value); setExpression(value === 'current' ? context.expressionId : null); };
  const changeDimension = (field: 'width' | 'height', value: string) => {
    const number = Number(value);
    const other = field === 'width' ? 'height' : 'width';
    setRender(current => ({ ...current, [field]: number, ...(lockRatio && current[field] > 0 && number > 0 ? { [other]: Math.round(number * current[other] / current[field]) } : {}) }));
  };
  const chooseDirectory = async () => {
    try { const value = await chooseAnimationExportDirectory(); if (!value.cancelled) setDirectory(value); }
    catch (cause) { setLocalError(String(cause)); }
  };
  const openFolder = async () => {
    if (!state.result?.directoryId) return;
    try { await openAnimationExportDirectory(state.result.directoryId); }
    catch (cause) { setLocalError(String(cause)); }
  };
  const choosePreset = (value: RenderPreset | 'custom') => { setPreset(value); if (value !== 'custom') setRender(animationExportPreset(value)); };
  return <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
    <Modal.Backdrop><Modal.Container size="lg" scroll="inside"><Modal.Dialog className="animation-export-dialog">
      <Modal.Header><Modal.Heading>{t('exportAnimations')}</Modal.Heading><p>{t('exportHint')}</p></Modal.Header>
      <Modal.Body className="animation-export-body">
        <fieldset disabled={state.busy}>
          <legend>{t('exportScope')}</legend>
          <ButtonGroup aria-label={t('exportScope')}>{(['current', 'selected', 'all'] as const).map(value => <Button key={value} size="sm" isDisabled={state.busy} aria-pressed={scope === value} variant={scope === value ? 'primary' : 'secondary'} onPress={() => changeScope(value)}>{t(value === 'current' ? 'exportCurrent' : value === 'selected' ? 'exportSelected' : 'exportAll')}</Button>)}</ButtonGroup>
          {scope === 'selected' && <>
            <Input aria-label={t('searchMotions')} placeholder={t('search')} value={query} onChange={event => setQuery(event.target.value)} />
            <div className="animation-export-actions"><Button size="sm" variant="ghost" onPress={() => setSelected(motions.map(motion => motion.id))}>{t('exportSelectAll')}</Button><Button size="sm" variant="ghost" onPress={() => setSelected([])}>{t('exportClearSelection')}</Button></div>
            <div className="animation-export-motion-list">{motions.filter(motion => motion.name.toLowerCase().includes(query.toLowerCase())).map(motion => <ExportCheck key={motion.id} selected={selected.includes(motion.id)} onChange={checked => setSelected(current => checked ? [...current, motion.id] : current.filter(id => id !== motion.id))}>{motion.name}</ExportCheck>)}</div>
          </>}
          {scope === 'current' && <p>{motions.find(motion => motion.id === context.motionId)?.name}</p>}
          <small>{t('exportCount', { count: ids.length })}</small>
          {context.inspection.expressions.length > 0 && <div className="animation-export-expressions" role="group" aria-label={t('exportExpression')}><Label>{t('exportExpression')}</Label><div className="animation-export-actions"><Button size="sm" variant={expression === null ? 'primary' : 'secondary'} onPress={() => setExpression(null)}>{t('baseExpression')}</Button>{context.inspection.expressions.map(value => <Button key={value.id} size="sm" variant={expression === value.id ? 'primary' : 'secondary'} onPress={() => setExpression(value.id)}>{value.name}</Button>)}</div></div>}
        </fieldset>
        <fieldset disabled={state.busy}>
          <legend>{t('exportFormat')}</legend>
          <p>{format === 'apng' ? 'APNG' : 'WebP'} · {t('animationFormatFromSettings')}</p>
          <ButtonGroup aria-label={t('renderPreset')}>{(['compact', 'balanced', 'high', 'custom'] as const).map(value => <Button key={value} size="sm" isDisabled={state.busy} aria-pressed={preset === value} variant={preset === value ? 'primary' : 'secondary'} onPress={() => choosePreset(value)}>{t(value === 'custom' ? 'customRender' : value)}</Button>)}</ButtonGroup>
          <Button size="sm" variant="ghost" isDisabled={state.busy} onPress={() => { const target = context.project.targets.clawd; setRender({ ...animationExportPreset(target.renderPreset ?? 'balanced'), ...target.options.renderOverrides }); setPreset('custom'); }}>{t('exportUseClawd')}</Button>
          {preset === 'custom' ? <><div className="animation-export-grid">
            <TextField value={String(render.width)} onChange={value => changeDimension('width', value)}><Label>{t('exportWidth')}</Label><Input type="number" min={1} max={2048} step={1} /></TextField>
            <TextField value={String(render.height)} onChange={value => changeDimension('height', value)}><Label>{t('exportHeight')}</Label><Input type="number" min={1} max={2048} step={1} /></TextField>
            <TextField value={String(render.fps)} onChange={value => setRender(current => ({ ...current, fps: Number(value) }))}><Label>{t('renderFps')}</Label><Input type="number" min={1} max={60} step={1} /></TextField>
            {format === 'webp' && <TextField isDisabled={render.lossless} value={String(render.quality)} onChange={value => setRender(current => ({ ...current, quality: Number(value) }))}><Label>{t('webpQuality')}</Label><Input type="number" min={1} max={100} step={1} /></TextField>}
          </div><ExportCheck selected={lockRatio} onChange={setLockRatio}>{t('exportLockRatio')}</ExportCheck></> : <p>{render.width} × {render.height} px · {render.fps} FPS{format === 'webp' ? ` · ${t('webpQuality')} ${render.quality}` : ''}</p>}
          <div className="animation-export-actions">{format === 'webp' ? <ExportCheck selected={render.lossless} onChange={lossless => setRender(current => ({ ...current, lossless }))}>{t('exportLossless')}</ExportCheck> : <small>{t('animationApngHint')}</small>}<ExportCheck selected={render.loop} onChange={loop => setRender(current => ({ ...current, loop }))}>{t('exportLoop')}</ExportCheck></div>
          <small>{knownDuration && valid ? t('exportFrames', { count: frames, seconds: seconds.toFixed(1) }) : t('exportUnknownDuration')}</small>
          <small>{t('exportClawdHint')}</small>
        </fieldset>
        <fieldset disabled={state.busy}><legend>{t('exportSaveLocation')}</legend><p className="animation-export-path">{directory?.directoryPath ?? defaultFolder ?? t('exportDefaultLocation')}</p><Button size="sm" variant="secondary" isDisabled={state.busy} onPress={() => void chooseDirectory()}><FolderOpen size={14} />{t('chooseFolder')}</Button><small>{t('exportFilesHint')}</small></fieldset>
        {settingsReady && !valid && <p role="alert">{t('exportInvalid')}</p>}
        {(state.error || localError) && <p className="inline-error" role="alert">{state.error ?? localError}</p>}
        {state.busy && <div className="animation-export-progress" role="status"><strong>{t(animationExportStage(state.progress))}</strong><ProgressBar aria-label={t('exportProgress')} value={state.progress?.percent ?? 0}><ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track></ProgressBar><span>{t('exportWorking', { completed: state.progress?.completed ?? 0, total: state.progress?.total ?? ids.length, percent: state.progress?.percent ?? 0 })}</span><small>{t('exportSnapshot')}</small></div>}
        {state.result && <div role="status"><p>{t('exportDone', { count: state.result.files.length })}</p>{state.result.cancelled && <p>{t('exportCancelled')}</p>}{state.result.failures.length > 0 && <><p>{t('exportPartial', { count: state.result.failures.length })}</p><ul>{state.result.failures.map(item => <li key={item.motionId}>{motions.find(motion => motion.id === item.motionId)?.name ?? item.motionId}: {item.message}</li>)}</ul></>}{state.result.files.length > 0 && state.result.directoryId && <Button variant="secondary" onPress={() => void openFolder()}><FolderOpen size={14} />{t('exportOpenFolder')}</Button>}</div>}
      </Modal.Body>
      <Modal.Footer><Button variant="ghost" onPress={() => onOpenChange(false)}>{t('exportClose')}</Button>{state.busy ? <Button variant="secondary" onPress={onCancel}>{t('exportCancel')}</Button> : <Button variant="primary" isDisabled={!valid} onPress={() => { setLocalError(null); void onRun(ids, expression, { ...render, format, lossless: format === 'apng' || render.lossless }, directory?.directoryId); }}><Download size={15} />{t('exportStart', { count: ids.length })}</Button>}</Modal.Footer>
    </Modal.Dialog></Modal.Container></Modal.Backdrop>
  </Modal>;
}
