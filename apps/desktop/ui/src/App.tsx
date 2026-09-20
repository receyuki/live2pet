import { Button, ButtonGroup, Card, Chip, Input, ProgressBar, Tabs } from "@heroui/react";
import { buttonGroupVariants, buttonVariants } from '@heroui/styles';
import type { ComponentPropsWithRef, CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import {
  AlertTriangle,
  Box,
  ChevronRight,
  CircleCheck,
  Download,
  FolderOpen,
  Gauge,
  PackageCheck,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  RotateCcw,
  Save,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Sparkles,
  Upload,
  WandSparkles,
} from "lucide-react";
import { ChangeEvent, DragEvent, ReactNode, useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  checkForUpdates,
  buildProject,
  createBuildRequest,
  cancelBuild,
  getAppVersion,
  getRecentProjects,
  clearRecentProjects,
  getRuntimeSettings,
  getSpinePackStatus,
  installSpinePack,
  inspectLibrarySource,
  getDesktopFilePath,
  hasDesktopApi,
  hasPreviewApi,
  inspectSource,
  relinkSourcePath,
  acknowledgeSourceReview,
  Live2PetProject,
  onBuildProgress,
  onAppCommand,
  openProject,
  openReleasePage,
  readLive2DPreviewStatus,
  playLive2DPreview,
  controlLive2DPreview,
  closeLive2DPreview,
  setLive2DPreviewExpression,
  getPreviewVisualElements,
  scanPreviewVisualElements,
  setPreviewVisualSettings,
  VisualElement,
  VisualSettings,
  PreviewStatus,
  RuntimeSettings,
  SpinePackStatus,
  SourceLibrary,
  SourceLibraryCandidate,
  SourceLibrarySelection,
  RecentProject,
  saveProject,
  SourceInspection,
  BuildTarget,
  UpdateStatus,
} from "./app-host";
import { OnboardingTour } from './onboarding/OnboardingTour';
import {
  completeOnboardingStage,
  readOnboardingState,
  replayOnboarding,
  selectOnboardingStage,
  skipOnboarding,
  writeOnboardingState,
} from './onboarding/onboarding-state';
import { appReducer, AppAction, AppSettings, initialAppState } from "./app-state";
import { Locale, MessageKey, resolveInitialLocale, translate, translateBehavior } from "./i18n";
import { isSingleSourceSelection, projectIdFromSourceName, sourcePathFromSelection } from "./source-selection";
import { hasDraggedFiles, isProjectFile, sourceFilesFromDrop } from "./file-drop";
import { CLAWD_PROFILE, CODEX_PROFILE, MappingDestination } from "./target-profiles";
import { BuildView } from "./BuildView";
import { VisibilityPanel, soloVisualSettings } from './VisibilityPanel';
import { useVisualThumbnails } from './useVisualThumbnails';
import { buildReducer, initialBuildState } from "./build-state";
import { clearProjectDraft, PROJECT_DRAFT_DEBOUNCE_MS, readProjectDraft, writeProjectDraft } from "./project-draft";
import type { ProjectDraft } from "./project-draft";
import { SettingsView, SetupView } from "./SettingsView";
import { ModelsView } from "./ModelsView";
import { projectFromSource } from './project-from-source';
import { usePreviewSession } from './usePreviewSession';
import { getPreviewVisualElementThumbnail } from './app-host';

const SETUP_KEY = "live2pet.desktop.setup-completed";
const LOCALE_KEY = "live2pet.desktop.locale";
const APPEARANCE_KEY = "live2pet.desktop.appearance";
const AUTOMATIC_UPDATE_KEY = "live2pet.desktop.automatic-update-checks";
const LAST_UPDATE_CHECK_KEY = "live2pet.desktop.last-update-check";
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPDATE_CHECK_DELAY_MS = 5000;

const motions = [
  { id: "main-1", nameKey: "motionMainOne", seconds: "4.2", tint: "" },
  { id: "main-2", nameKey: "motionMainTwo", seconds: "3.6", tint: "tint-blue" },
  { id: "touch-head", nameKey: "motionTouchHead", seconds: "2.1", tint: "tint-rose" },
  { id: "attention", nameKey: "motionAttention", seconds: "1.8", tint: "tint-amber" },
  { id: "error", nameKey: "motionError", seconds: "2.4", tint: "tint-cyan" },
] as const;

const expressions = [
  { id: "default", nameKey: "expressionDefault" },
  { id: "smile", nameKey: "expressionSmile" },
  { id: "serious", nameKey: "expressionSerious" },
] as const;

type MappingTargetId = "clawd" | "codex-pet";
type MappingChannel = "mappings" | "reactions";

function mappingDestination(target: MappingTargetId, channel: MappingChannel, slot: string): MappingDestination {
  if (target === "codex-pet") return { target, category: "rows", slot };
  return { target, category: channel === "reactions" ? "reactions" : "states", slot };
}

function storedLocale(): Locale {
  return resolveInitialLocale(localStorage, navigator.language);
}

function storedAppearance(): AppSettings["appearance"] {
  const value = localStorage.getItem(APPEARANCE_KEY);
  return value === "light" || value === "dark" ? value : "system";
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
}

function preserveTextEditingHistory(command: "undo" | "redo"): boolean {
  if (!isEditableTarget(document.activeElement)) return false;
  if (typeof document.execCommand === "function") document.execCommand(command);
  return true;
}


function SourceView({ locale, project, inspection, inspectionRequired, runtimeReady, busy, onConfigureRuntime, onRelink, onAcknowledgeReview, onMap }: { locale: Locale; project: Live2PetProject | null; inspection?: SourceInspection; inspectionRequired: boolean; runtimeReady: boolean; busy: boolean; onConfigureRuntime: () => void; onRelink: (files: File[], directDrop?: boolean) => Promise<void>; onAcknowledgeReview: () => Promise<void>; onMap: () => void }) {
  const t = (key: MessageKey) => translate(locale, key);
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const review = project?.sourceReview?.required ? project.sourceReview : null;
  const affectedRecipes = (review?.affectedRecipeIds ?? []).map((id) => {
    const recipe = project?.recipes.find((candidate) => candidate.id === id);
    return { id, label: recipe?.label };
  });

  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length) void onRelink(files);
  }

  function dropSource(event: DragEvent<HTMLElement>) {
    if (busy || !hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    const files = sourceFilesFromDrop(event.dataTransfer);
    if (files.some(isProjectFile)) return;
    void onRelink(files, true);
  }
  const facts = inspection
    ? [["sourceModel", inspection.model.modelFile ?? "—"], ["sourceTextures", String(inspection.model.textures.length)], ["sourceMotions", String(inspection.motions.length)], ["sourceExpressions", String(inspection.expressions.length)]]
    : inspectionRequired
      ? [["sourceModel", "—"], ["sourceTextures", "—"], ["sourceMotions", "—"], ["sourceExpressions", "—"]]
      : [["sourceModel", "model3.json"], ["sourceTextures", "4"], ["sourceMotions", "5"], ["sourceExpressions", "3"]];
  const summary = inspection
    ? `${inspection.model.format === 'spine' ? `Spine ${inspection.model.runtimeLine}` : `Cubism ${inspection.model.cubism}`} · ${inspection.motions.length} ${t("sourceMotions")} · ${inspection.expressions.length} ${t("sourceExpressions")}`
    : inspectionRequired ? t("sourceRelinkRequired") : t("sourceSummary");
  return (
    <main className="page" aria-label={t("source")}>
      <h2 className="visually-hidden">{t("sourceTitle")}</h2>
      <div className="source-grid">
        <Card
          className={`surface-card drop-zone${dragActive ? " drop-zone-active" : ""}`}
          onDragEnter={(event) => { if (!busy && hasDraggedFiles(event.dataTransfer)) { event.preventDefault(); dragDepth.current += 1; setDragActive(true); } }}
          onDragOver={(event) => { if (hasDraggedFiles(event.dataTransfer)) event.preventDefault(); }}
          onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragActive(false); }}
          onDrop={dropSource}
        ><Card.Content><div className="source-identity"><Box size={32} /><strong>{inspection?.source.name ?? project?.source.name ?? t('source')}</strong><small>{t('sourcePreviewHint')}</small></div><div className="ready-box"><CircleCheck size={20} /><span><strong>{inspectionRequired && !inspection ? t("sourceUnavailable") : t("sourceReady")}</strong><small>{summary}</small></span></div>
          <input ref={fileInput} className="visually-hidden" type="file" accept=".pck" tabIndex={-1} onChange={chooseFiles} disabled={busy} />
          <input ref={folderInput} className="visually-hidden" type="file" multiple {...{ webkitdirectory: "" }} tabIndex={-1} onChange={chooseFiles} disabled={busy} />
          <div className="source-actions"><Button variant="secondary" isDisabled={busy || !project} onPress={() => folderInput.current?.click()}><FolderOpen size={16} />{t("relinkFolder")}</Button><Button variant="secondary" isDisabled={busy || !project} onPress={() => fileInput.current?.click()}><Upload size={16} />{t("relinkPck")}</Button></div>
          <p className="drop-hint">{t("relinkSourceHint")}</p>
          {busy && <ProgressBar aria-label={t("loading")} isIndeterminate className="mt-4" />}
          {dragActive && <div className="drop-overlay" aria-hidden="true"><Upload size={20} />{t("dropSource")}</div>}
          {!runtimeReady && <div className="runtime-required"><Gauge size={18} /><span><strong>{t("runtimeRequired")}</strong><small>{t("runtimeRequiredBody")}</small></span><Button size="sm" variant="secondary" onPress={onConfigureRuntime}>{t(inspection?.model.format === 'spine' ? "installSpinePack" : "configureRuntime")}</Button></div>}
          {review && <section className="source-review-card" aria-label={t("sourceReviewRequired")}><AlertTriangle size={20} /><div className="grow-copy"><strong>{t("sourceReviewRequired")}</strong><p>{t("sourceReviewBody")}</p>{affectedRecipes.length > 0 && <ul>{affectedRecipes.map((recipe) => <li key={recipe.id}><span>{recipe.label || recipe.id}</span>{recipe.label && <small>{recipe.id}</small>}</li>)}</ul>}</div><Button variant="primary" size="sm" isDisabled={busy} onPress={() => void onAcknowledgeReview()}>{t("acknowledgeReview")}</Button></section>}
          <Button variant="primary" isDisabled={(inspectionRequired && !inspection) || Boolean(review)} onPress={onMap}>{t("map")}<ChevronRight size={16} /></Button></Card.Content></Card>
        <Card className="surface-card source-facts"><Card.Content>{facts.map(([key, value]) => <div className="fact" key={key}><span>{t(key as MessageKey)}</span><strong title={value}>{value}</strong></div>)}</Card.Content></Card>
      </div>
    </main>
  );
}

function PanelHeading({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return <header className="panel-heading"><span className="square-icon">{icon}</span><div><h2>{title}</h2><p>{body}</p></div></header>;
}

function MapView({ locale, projectId, projectDocument, inspection, runtimeReady, selectedMotionId, selectedExpressionId, onConfigureRuntime, onSelectMotion, onSelectExpression, onAssign, onClear, onVisualSettings }: { locale: Locale; projectId: string; projectDocument: Live2PetProject | null; inspection?: SourceInspection; runtimeReady: boolean; selectedMotionId: string | null; selectedExpressionId: string | null; onConfigureRuntime: () => void; onSelectMotion: (id: string) => void; onSelectExpression: (id: string | null) => void; onAssign: (destination: MappingDestination) => void; onClear: (destination: MappingDestination) => void; onVisualSettings: (settings: VisualSettings) => void }) {
  const t = (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values);
  const sourceKey = `${projectId}\u0000${inspection?.source.fingerprint ?? ''}`;
  const sourceKeyRef = useRef(sourceKey);
  sourceKeyRef.current = sourceKey;
  const previewSurface = useRef<HTMLDivElement>(null);
  const [previewRetry, setPreviewRetry] = useState(0);
  const nativePreview = Boolean(inspection && runtimeReady && hasPreviewApi());
  const { status: previewStatus, setStatus: setPreviewStatus, run: runPreview } = usePreviewSession({
    surface: previewSurface, enabled: nativePreview, projectId,
    sourceFingerprint: inspection?.source.fingerprint, visualSettings: projectDocument?.visualSettings, retry: previewRetry,
  });
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [seekTime, setSeekTime] = useState<number | null>(null);
  const [previewLoop, setPreviewLoop] = useState(true);
  const [previewSpeed, setPreviewSpeed] = useState(1);
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [visualElementState, setVisualElementState] = useState<{ sourceKey: string; elements: VisualElement[] }>({ sourceKey, elements: [] });
  const visualElements = visualElementState.sourceKey === sourceKey ? visualElementState.elements : [];
  const [soloSelection, setSoloSelection] = useState<{ sourceKey: string; id: string | null }>({ sourceKey, id: null });
  const soloId = soloSelection.sourceKey === sourceKey ? soloSelection.id : null;
  const setSoloId = (id: string | null) => setSoloSelection({ sourceKey, id });
  const inspectSolo = (id: string | null, time?: number) => {
    setSoloId(id);
    if (time !== undefined) void runPlayback(() => controlLive2DPreview('seek', time));
  };
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [scanningParts, setScanningParts] = useState(false);
  const thumbnailScope = JSON.stringify([sourceKey, selectedMotionId, selectedExpressionId, previewRetry]);
  const requestThumbnail = useCallback(async (id: string) => {
    const result = await runPreview(() => getPreviewVisualElementThumbnail(id));
    if (!result) throw new Error('Preview session ended.');
    return result;
  }, [runPreview]);
  const visualThumbnails = useVisualThumbnails(
    thumbnailScope,
    visibilityOpen && !visibilityBusy && !scanningParts && previewStatus?.state === 'ready' && visualElements.length > 0,
    requestThumbnail,
  );
  const [motionQuery, setMotionQuery] = useState('');
  const visualSettings = projectDocument?.visualSettings ?? { hiddenElementIds: [] };
  const visualKey = JSON.stringify(visualSettings);
  const commandSequence = useRef(0);
  const runPlayback = async (operation: () => Promise<PreviewStatus>) => {
    const sequence = ++commandSequence.current;
    setPlaybackError(null);
    try { await runPreview(operation); }
    catch (cause) { if (sequence === commandSequence.current) setPlaybackError(cause instanceof Error ? cause.message : t('previewFailed')); }
  };
  const [mappingTarget, setMappingTarget] = useState<MappingTargetId>("clawd");
  const workspaceRef = useRef<HTMLElement>(null);
  const [panelWidths, setPanelWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('live2pet.desktop.map-panel-widths') ?? 'null');
      if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.right)) return { left: Math.max(220, Math.min(saved.left, 640)), right: Math.max(240, Math.min(saved.right, 640)) };
    } catch { /* Ignore an invalid local preference. */ }
    return { left: 280, right: 320 };
  });
  const sourceMotions = inspection?.motions.length ? inspection.motions : (previewStatus?.catalog?.motions ?? []);
  const displayedMotions = inspection
    ? sourceMotions.map((motion) => ({ id: motion.id, name: motion.name, seconds: motion.duration?.toFixed(1) ?? "—", tint: "" }))
    : motions.map((motion) => ({ ...motion, name: t(motion.nameKey) }));
  const displayedExpressions = inspection
    ? inspection.expressions.map((expression) => ({ id: expression.id, name: expression.name }))
    : expressions.map((expression) => ({ ...expression, name: t(expression.nameKey) }));
  const selected = displayedMotions.find((motion) => motion.id === selectedMotionId) ?? displayedMotions[0];
  const selectedExpression = displayedExpressions.find((expression) => expression.id === selectedExpressionId);
  const selectedName = selected?.name ?? "—";
  const selectedDuration = sourceMotions.find((motion) => motion.id === selectedMotionId)?.duration ?? (Number(selected?.seconds) || 0);
  const canEditMappings = Boolean(projectDocument && inspection);
  const canAssign = canEditMappings && Boolean(selectedMotionId);
  const targetDocument = projectDocument?.targets[mappingTarget];
  const mappingSlotLabel = (slot: string) => translateBehavior(locale, slot);

  function assignmentLabel(slot: string, channel: MappingChannel): string {
    const value = targetDocument?.[channel]?.[slot] ?? "";
    if (!value) return t("assignmentEmpty");
    if (value.startsWith("fallback:")) return t("assignmentFallback", { value: mappingSlotLabel(value.slice(9)) });
    if (!value.startsWith("motion:")) return value;
    const motionId = value.slice(7);
    const motion = displayedMotions.find((candidate) => candidate.id === motionId);
    const recipeId = targetDocument?.recipeMappings?.[slot];
    const recipe = projectDocument?.recipes.find((candidate) => candidate.id === recipeId);
    const expression = recipe?.expressionId
      ? displayedExpressions.find((candidate) => candidate.id === recipe.expressionId)
      : null;
    return `${motion?.name ?? motionId} · ${expression?.name ?? t("baseExpression")}`;
  }

  const mappingGroups: Array<{ id: string; title: string; channel: MappingChannel; slots: readonly string[] }> = mappingTarget === "clawd"
    ? [
        { id: "core", title: t("clawdCoreStates"), channel: "mappings", slots: CLAWD_PROFILE.states.core },
        { id: "optional", title: t("clawdOptionalStates"), channel: "mappings", slots: CLAWD_PROFILE.states.optional },
        { id: "full-sleep", title: t("clawdFullSleepStates"), channel: "mappings", slots: CLAWD_PROFILE.states.fullSleep },
        { id: "reactions", title: t("clawdReactions"), channel: "reactions", slots: CLAWD_PROFILE.reactions },
      ]
    : [{ id: "rows", title: t("codexRows"), channel: "mappings", slots: CODEX_PROFILE.rows.map((row) => row.id) }];

  useEffect(() => {
    setVisualElementState({ sourceKey, elements: [] });
    setSoloSelection({ sourceKey, id: null });
  }, [sourceKey]);

  useEffect(() => {
    if (!selectedMotionId && previewStatus?.catalog?.motions[0]?.id) onSelectMotion(previewStatus.catalog.motions[0].id);
  }, [selectedMotionId, previewStatus?.catalog, onSelectMotion]);


  useEffect(() => {
    const expectedSourceFingerprint = inspection?.source.fingerprint;
    if (previewStatus?.state !== 'ready' || !expectedSourceFingerprint || previewStatus.projectId !== projectId || previewStatus.sourceFingerprint !== expectedSourceFingerprint) return;
    const expectedSourceKey = sourceKey;
    let active = true;
    void runPreview(getPreviewVisualElements).then(elements => {
      if (elements && active && sourceKeyRef.current === expectedSourceKey) setVisualElementState({ sourceKey: expectedSourceKey, elements });
    }).catch(cause => {
      if (active && sourceKeyRef.current === expectedSourceKey) setPlaybackError(String(cause instanceof Error ? cause.message : cause));
    });
    return () => { active = false; };
  }, [previewStatus?.state, previewStatus?.projectId, previewStatus?.sourceFingerprint, projectId, inspection?.source.fingerprint, sourceKey]);

  useEffect(() => {
    if (previewStatus?.state !== 'ready' || !visualElements.length) return;
    let active = true;
    setVisibilityBusy(true);
    const effective = soloId ? soloVisualSettings(visualElements, soloId) : visualSettings;
    void runPlayback(() => setPreviewVisualSettings(effective)).finally(() => { if (active) setVisibilityBusy(false); });
    return () => { active = false; };
  }, [visualKey, soloId, visualElements, previewStatus?.state]);

  useEffect(() => {
    setSeekTime(null);
    if (previewStatus?.state === 'ready' && selectedMotionId) void runPlayback(() => playLive2DPreview({ motionId: selectedMotionId, loop: previewLoop, speed: previewSpeed }));
  }, [previewStatus?.state, selectedMotionId, previewLoop, previewSpeed]);

  useEffect(() => {
    if (previewStatus?.state === 'ready') void runPreview(() => setLive2DPreviewExpression(selectedExpressionId)).catch(() => undefined);
  }, [previewStatus?.state, selectedExpressionId]);

  useEffect(() => {
    if (seekTime === null) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      await runPlayback(() => controlLive2DPreview('seek', seekTime));
      if (active) setSeekTime(null);
    }, 80);
    return () => { active = false; window.clearTimeout(timer); };
  }, [seekTime]);


  const togglePlayback = () => {
    if (previewStatus?.state !== 'ready') return;
    void runPlayback(() => controlLive2DPreview(previewStatus.playback?.playing ? 'pause' : 'resume'));
  };
  const resetPreview = () => {
    if (!nativePreview || previewStatus?.state === 'opening') return;
    commandSequence.current += 1;
    setSoloId(null);
    setSeekTime(null);
    setPlaybackError(null);
    setVisualElementState({ sourceKey, elements: [] });
    setPreviewStatus(current => current ? { ...current, state: 'opening', visible: false, playback: undefined, error: undefined } : current);
    setPreviewRetry(value => value + 1);
  };
  const resizePanel = (side: 'left' | 'right', delta: number) => {
    const total = workspaceRef.current?.clientWidth ?? window.innerWidth;
    setPanelWidths(current => {
      const left = side === 'left' ? Math.max(220, Math.min(current.left + delta, total - current.right - 360)) : current.left;
      const right = side === 'right' ? Math.max(240, Math.min(current.right - delta, total - current.left - 340)) : current.right;
      const next = { left, right };
      localStorage.setItem('live2pet.desktop.map-panel-widths', JSON.stringify(next));
      return next;
    });
  };
  const beginResize = (side: 'left' | 'right', event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const start = panelWidths;
    const move = (pointer: PointerEvent) => {
      const total = workspaceRef.current?.clientWidth ?? window.innerWidth;
      const delta = pointer.clientX - startX;
      setPanelWidths({
        left: side === 'left' ? Math.max(220, Math.min(start.left + delta, total - start.right - 360)) : start.left,
        right: side === 'right' ? Math.max(240, Math.min(start.right - delta, total - start.left - 340)) : start.right,
      });
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      setPanelWidths(current => { localStorage.setItem('live2pet.desktop.map-panel-widths', JSON.stringify(current)); return current; });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
  };
  const splitter = (side: 'left' | 'right') => <div className={`map-splitter map-splitter-${side}`} role="separator" aria-label={t(side === 'left' ? 'resizeMotionPanel' : 'resizeAssignmentPanel')} aria-orientation="vertical" tabIndex={0} onPointerDown={event => beginResize(side, event)} onKeyDown={event => { if (event.key === 'ArrowLeft') { event.preventDefault(); resizePanel(side, -16); } else if (event.key === 'ArrowRight') { event.preventDefault(); resizePanel(side, 16); } }}><i /></div>;
  return (
    <main ref={workspaceRef} className="map-workspace" aria-label={t('map')} style={{ '--map-left-width': `${panelWidths.left}px`, '--map-right-width': `${panelWidths.right}px` } as CSSProperties}>
      {inspection && <details className="mapping-source-summary"><summary>{projectDocument?.name} · {inspection.model.format === "spine" ? "Spine " + inspection.model.runtimeLine : "Cubism " + inspection.model.cubism}</summary><p>{projectDocument?.source.path}</p><p>{inspection.motions.length} {t("sourceMotions")} · {inspection.expressions.length} {t("sourceExpressions")} · {inspection.model.textures.length} {t("sourceTextures")}</p></details>}
      <Tabs className="workspace-panel library-tabs map-motion-panel" data-tour-id="map-animations" selectedKey={visibilityOpen ? 'visibility' : 'motions'} onSelectionChange={key => { if (key !== 'visibility') setSoloId(null); setVisibilityOpen(key === 'visibility'); }}>
        <PanelHeading icon={<SlidersHorizontal size={16} />} title={t("animations")} body={t("motionsHint")} />
        <Tabs.List className={buttonGroupVariants().base({ className: 'target-switch library-switch' })} aria-label={t('modelTools')}>
          <Tabs.Tab id="motions" render={props => <div {...props as ComponentPropsWithRef<'div'>} className={buttonVariants({ size: 'sm', variant: !visibilityOpen ? 'primary' : 'secondary' })} />}>{t('motions')}</Tabs.Tab>
          <Tabs.Tab id="visibility" isDisabled={!projectDocument} render={props => <div {...props as ComponentPropsWithRef<'div'>} className={buttonVariants({ size: 'sm', variant: visibilityOpen ? 'primary' : 'secondary' })} />}>{t('visibility')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel id="visibility" className="library-tab-panel"><VisibilityPanel key={sourceKey} locale={locale} elements={visualElements} settings={visualSettings} soloId={soloId} thumbnail={visualThumbnails.thumbnail} thumbnails={visualThumbnails.thumbnails} busy={visibilityBusy || scanningParts || previewStatus?.state !== 'ready'} onSettings={onVisualSettings} onSolo={inspectSolo} onInspect={visualThumbnails.inspect} onVisible={visualThumbnails.onVisible} scanScope={thumbnailScope} onScan={inspection && inspection.model.cubism !== 2 && selectedMotionId ? async () => {
          setScanningParts(true); setSoloId(null); setSeekTime(null);
          try {
            await runPreview(() => setPreviewVisualSettings(visualSettings));
            const result = await runPreview(() => scanPreviewVisualElements(selectedMotionId));
            if (!result) throw new Error('Preview session ended.');
            await runPreview(readLive2DPreviewStatus);
            return result;
          } finally { setScanningParts(false); }
        } : undefined} /></Tabs.Panel>
        <Tabs.Panel id="motions" className="library-tab-panel">
        <Input aria-label={t("searchMotions")} placeholder={t("search")} value={motionQuery} onChange={event => setMotionQuery(event.target.value)} />
        <div className="motion-list">
          {displayedMotions.filter(motion => motion.name.toLocaleLowerCase().includes(motionQuery.toLocaleLowerCase())).map((motion) => (
            <Button key={motion.id} variant={motion.id === selected?.id ? "secondary" : "ghost"} className={`motion-item ${motion.tint}`} onPress={() => onSelectMotion(motion.id)}>
              <span className="motion-icon"><Play size={15} /></span><span className="grow-copy"><strong>{motion.name}</strong><small>{t("motionDuration", { value: motion.seconds })}</small></span>{motion.id === selected?.id && <small>{t("selected")}</small>}
            </Button>
          ))}
          {displayedExpressions.length > 0 ? <><p className="library-subheading">{t("expressions")}</p>
          <div className="expression-grid">
            <Button size="sm" variant={selectedExpressionId === null ? "secondary" : "ghost"} onPress={() => onSelectExpression(null)}>{t("baseExpression")}</Button>
            {displayedExpressions.map((expression) => <Button key={expression.id} size="sm" variant={expression.id === selectedExpression?.id ? "secondary" : "ghost"} onPress={() => onSelectExpression(expression.id)}>{expression.name}</Button>)}
          </div></> : <p className="empty-expression-note">{t('noExpressions')}</p>}
        </div>
        </Tabs.Panel>
      </Tabs>
      {splitter('left')}
      <section className="workspace-panel map-preview-panel" data-tour-id="map-preview">
        <PanelHeading icon={<Sparkles size={16} />} title={t("preview")} body={t("previewHint")} />
        <div className="preview-caption"><Chip variant="soft">{selectedName} · {selectedExpression?.name ?? t("baseExpression")}</Chip><Button size="sm" variant="ghost" aria-label={t('resetPreview')} isDisabled={!nativePreview || previewStatus?.state === 'opening' || visibilityBusy || scanningParts} onPress={resetPreview}><RefreshCcw size={15} />{t('resetPreview')}</Button></div>
        <div className="preview-stage"><i className="stage-grid" />{!runtimeReady ? <div className="preview-runtime-required"><Gauge size={28} /><strong>{t("runtimeRequired")}</strong><p>{t("runtimeRequiredBody")}</p><Button size="sm" variant="primary" onPress={onConfigureRuntime}>{t(inspection?.model.format === 'spine' ? "installSpinePack" : "configureRuntime")}</Button></div> : nativePreview ? <><div ref={previewSurface} className="preview-native-surface" />{previewStatus?.state === 'opening' && <div className="preview-message">{t('previewLoading')}</div>}{previewStatus?.state === 'failed' && <div className="preview-runtime-required"><strong>{t('previewFailed')}</strong><p>{previewStatus.error?.message}</p><Button size="sm" variant="primary" onPress={() => setPreviewRetry((value) => value + 1)}>{t('retry')}</Button></div>}</> : <div className="preview-runtime-required"><Box size={28} aria-hidden="true" /><strong>{t('previewEmptyTitle')}</strong><p>{t(projectDocument ? 'previewDesktopRequired' : 'previewImportHint')}</p></div>}</div>
        <div className="playback"><Button isIconOnly aria-label={previewStatus?.playback?.playing ? t('pause') : t('play')} variant="primary" size="sm" isDisabled={previewStatus?.state !== 'ready'} onPress={togglePlayback}>{previewStatus?.playback?.playing ? <Pause size={15} /> : <Play size={15} />}</Button><Button isIconOnly aria-label={t('restart')} variant="ghost" size="sm" isDisabled={previewStatus?.state !== 'ready'} onPress={() => void runPlayback(() => controlLive2DPreview('restart'))}><RotateCcw size={15} /></Button><input className="timeline" type="range" aria-label={t('seekMotion')} min={0} max={selectedDuration} step={0.01} value={seekTime ?? previewStatus?.playback?.time ?? 0} disabled={previewStatus?.state !== 'ready' || !selectedDuration} onInput={(event) => setSeekTime(Number(event.currentTarget.value))} /><small>{(previewStatus?.playback?.time ?? 0).toFixed(1)} / {selected?.seconds ?? '—'} s</small></div>
        <div className="playback-options">
          <Button size="sm" variant={previewLoop ? 'secondary' : 'ghost'} aria-label={t('loopPreview')} aria-pressed={previewLoop} aria-describedby="preview-options-hint" isDisabled={previewStatus?.state !== 'ready' || !selectedMotionId} onPress={() => setPreviewLoop((value) => !value)}>{t('loopPreview')}</Button>
          <Button size="sm" variant="ghost" aria-label={t('previewSpeed', { value: previewSpeed })} aria-describedby="preview-options-hint" isDisabled={previewStatus?.state !== 'ready' || !selectedMotionId} onPress={() => setPreviewSpeed((value) => { const speeds = [0.5, 1, 1.5, 2]; return speeds[(speeds.indexOf(value) + 1) % speeds.length]; })}>{previewSpeed}×</Button>
          <small id="preview-options-hint">{t('previewOptionsHint')}</small>
        </div>
        {playbackError && <p className="inline-error" role="alert">{playbackError}</p>}
        {previewStatus?.state === 'failed' && visualSettings.hiddenElementIds.length > 0 && <Button size="sm" variant="secondary" onPress={() => { onVisualSettings({ hiddenElementIds: [] }); setSoloId(null); setPreviewRetry(value => value + 1); }}>{t('restoreVisibility')}</Button>}
      </section>
      {splitter('right')}
      <section className="workspace-panel assignment-panel map-assignment-panel" data-tour-id="map-assignment">
        <PanelHeading icon={<WandSparkles size={16} />} title={t("assignment")} body={t("assignmentHint")} />
        <ButtonGroup className="target-switch" aria-label={t("mappingTarget")}>
          <Button size="sm" variant={mappingTarget === "clawd" ? "primary" : "secondary"} onPress={() => setMappingTarget("clawd")}>Clawd</Button>
          <Button size="sm" variant={mappingTarget === "codex-pet" ? "primary" : "secondary"} onPress={() => setMappingTarget("codex-pet")}>Codex Pet</Button>
        </ButtonGroup>
        <div className="selected-card"><span className="motion-icon"><Play size={15} /></span><span className="grow-copy"><small>{t("selectedMotionExpression")}</small><strong>{selectedName}</strong><small>{selectedExpression?.name ?? t("baseExpression")}</small></span></div>
        {!canEditMappings && <p className="mapping-preview-note" role="status">{t("mappingPreviewOnly")}</p>}
        <div className="assignment-list mapping-assignment-list">
          {mappingGroups.map((group) => {
            const required = group.id === 'core' || group.id === 'rows' || (group.id === 'full-sleep' && targetDocument?.options.sleepMode === 'full');
            const hint = group.id === 'full-sleep'
              ? (required ? 'mappingFullSleepRequired' : 'mappingFullSleepOptional')
              : group.id === 'reactions'
                ? 'mappingClawdReactionsHint'
                : required ? 'mappingRequiredHint' : 'mappingOptionalHint';
            return (
            <section className="mapping-group" key={group.id} aria-labelledby={`mapping-group-${group.id}`}>
              <h3 id={`mapping-group-${group.id}`} className="mapping-group-heading"><span>{group.title}</span><Chip size="sm" variant="soft" className={required ? 'mapping-required' : ''}>{t(required ? 'mappingRequired' : 'mappingOptional')}</Chip></h3>
              <p className="mapping-requirement-hint">{t(hint)}</p>
              {group.slots.map((slot) => {
                const value = targetDocument?.[group.channel]?.[slot] ?? "";
                return (
                  <div className="assignment-row mapping-row" key={`${group.channel}:${slot}`}>
                    <span className="grow-copy"><strong>{mappingSlotLabel(slot)}</strong><small>{assignmentLabel(slot, group.channel)}</small></span>
                    <span className="mapping-row-actions">
                      <Button size="sm" variant="secondary" aria-label={`${t("useSelected")} · ${mappingSlotLabel(slot)}`} isDisabled={!canAssign} onPress={() => onAssign(mappingDestination(mappingTarget, group.channel, slot))}>{t("useSelected")}</Button>
                      <Button size="sm" variant="ghost" aria-label={`${t("clearAssignment")} · ${mappingSlotLabel(slot)}`} isDisabled={!canEditMappings || !value} onPress={() => onClear(mappingDestination(mappingTarget, group.channel, slot))}>{t("clearAssignment")}</Button>
                    </span>
                  </div>
                );
              })}
            </section>
          ); })}
        </div>
      </section>
    </main>
  );
}


export function App() {
  const [state, dispatch] = useReducer(appReducer, undefined, () => {
    const initial = initialAppState({ setupCompleted: localStorage.getItem(SETUP_KEY) === "true" });
    return { ...initial, settings: { ...initial.settings, language: storedLocale(), appearance: storedAppearance() } };
  });
  const [buildState, dispatchBuild] = useReducer(buildReducer, undefined, initialBuildState);
  const latestState = useRef(state);
  latestState.current = state;
  const saveInFlight = useRef(false);
  const projectTransition = useRef(false);
  const activeBuilds = useRef(new Set<BuildTarget>());
  const [appVersion, setAppVersion] = useState("0.1.0");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateError, setUpdateError] = useState("");
  const [updateBusy, setUpdateBusy] = useState(false);
  const [automaticUpdateChecks, setAutomaticUpdateChecks] = useState(() => localStorage.getItem(AUTOMATIC_UPDATE_KEY) !== "false");
  const [importBusy, setImportBusy] = useState(false);
  const [selectedLibraryModel, setSelectedLibraryModel] = useState<SourceLibraryCandidate | null>(null);
  const [pendingSource, setPendingSource] = useState<SourceLibrarySelection | null>(null);
  const [modelLibrary, setModelLibrary] = useState<SourceLibrary | null>(null);
  const [importError, setImportError] = useState("");
  const settingsButton = useRef<HTMLButtonElement>(null);
  const previousDestination = useRef(state.destination);
  useEffect(() => {
    if (previousDestination.current === 'settings' && state.destination !== 'settings') settingsButton.current?.focus();
    previousDestination.current = state.destination;
  }, [state.destination]);
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings | null>(null);
  const [spinePack, setSpinePack] = useState<SpinePackStatus | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [actionFeedback, setActionFeedback] = useState("");
  const [projectSaveBusy, setProjectSaveBusy] = useState(false);
  const [projectDraft, setProjectDraft] = useState<ProjectDraft | null>(() => readProjectDraft());
  const [onboarding, setOnboarding] = useState(() => readOnboardingState(localStorage));
  const locale = state.settings.language;
  const appearance = state.settings.appearance;
  const t = (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values);

  useEffect(() => { document.documentElement.lang = locale; localStorage.setItem(LOCALE_KEY, locale); }, [locale]);
  useEffect(() => { writeOnboardingState(onboarding, localStorage); }, [onboarding]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyAppearance = () => { document.documentElement.dataset.theme = appearance === "system" ? (media.matches ? "dark" : "light") : appearance; };
    applyAppearance();
    media.addEventListener("change", applyAppearance);
    localStorage.setItem(APPEARANCE_KEY, appearance);
    return () => media.removeEventListener("change", applyAppearance);
  }, [appearance]);
  useEffect(() => { void getAppVersion().then(setAppVersion).catch(() => undefined); }, []);
  useEffect(() => {
    if (!automaticUpdateChecks || !hasDesktopApi()) return;
    const lastChecked = Number(localStorage.getItem(LAST_UPDATE_CHECK_KEY));
    if (Number.isFinite(lastChecked) && Date.now() - lastChecked < UPDATE_CHECK_INTERVAL_MS) return;
    const timer = window.setTimeout(() => { void runUpdateCheck(false); }, UPDATE_CHECK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [automaticUpdateChecks]);
  useEffect(() => { void getRuntimeSettings().then(setRuntimeSettings).catch(() => undefined); }, []);
  useEffect(() => { void getSpinePackStatus().then(setSpinePack).catch(() => undefined); }, []);
  useEffect(() => { void getRecentProjects().then(setRecentProjects).catch(() => undefined); }, []);
  useEffect(() => onBuildProgress((event) => dispatchBuild({ type: "PROGRESS", event })), []);
  useEffect(() => {
    if (!state.project?.dirty || !state.project.document) return;
    const timer = window.setTimeout(() => {
      writeProjectDraft(state.project!.document!);
    }, PROJECT_DRAFT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [state.project?.dirty, state.project?.document]);
  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!state.project?.dirty) return;
      if (state.project.document) writeProjectDraft(state.project.document);
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [state.project?.dirty, state.project?.document]);
  useEffect(() => {
    const openDroppedProject = (event: globalThis.DragEvent) => {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (!files.some(isProjectFile)) return;
      event.preventDefault();
      if (importBusy) return;
      if (files.length !== 1) { setActionFeedback(t('dropOne')); return; }
      const inputPath = getDesktopFilePath(files[0]);
      if (!inputPath) { setActionFeedback(t('projectDropDesktop')); return; }
      void openProjectDocument(undefined, inputPath);
    };
    window.addEventListener('drop', openDroppedProject, true);
    return () => window.removeEventListener('drop', openDroppedProject, true);
  }, [state.project, importBusy, locale]);
  useEffect(() => {
    const preventFileNavigation = (event: globalThis.DragEvent) => {
      if (event.dataTransfer && hasDraggedFiles(event.dataTransfer)) event.preventDefault();
    };
    window.addEventListener("dragover", preventFileNavigation);
    window.addEventListener("drop", preventFileNavigation);
    return () => {
      window.removeEventListener("dragover", preventFileNavigation);
      window.removeEventListener("drop", preventFileNavigation);
    };
  }, []);
  useEffect(() => {
    if (hasDesktopApi()) return;
    const handleProjectHistoryShortcut = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || event.altKey) return;
      const modifier = event.metaKey || event.ctrlKey;
      const undo = modifier && event.key.toLowerCase() === "z" && !event.shiftKey;
      const redo = modifier && ((event.key.toLowerCase() === "z" && event.shiftKey) || event.key.toLowerCase() === "y");
      if (!undo && !redo) return;
      event.preventDefault();
      editProject({ type: undo ? "UNDO_PROJECT_EDIT" : "REDO_PROJECT_EDIT" });
    };
    window.addEventListener("keydown", handleProjectHistoryShortcut);
    return () => window.removeEventListener("keydown", handleProjectHistoryShortcut);
  }, []);

  function completeSetup() { localStorage.setItem(SETUP_KEY, "true"); dispatch({ type: "COMPLETE_SETUP" }); }
  async function runUpdateCheck(manual: boolean) {
    setUpdateBusy(true);
    if (manual) setUpdateError("");
    try {
      const result = await checkForUpdates();
      setUpdateStatus(result);
      setUpdateError("");
      localStorage.setItem(LAST_UPDATE_CHECK_KEY, String(Date.now()));
    } catch (cause) {
      if (manual) setUpdateError(cause instanceof Error ? cause.message : t('updateCheckFailed'));
    } finally { setUpdateBusy(false); }
  }
  function setAutomaticChecks(enabled: boolean) {
    setAutomaticUpdateChecks(enabled);
    localStorage.setItem(AUTOMATIC_UPDATE_KEY, String(enabled));
  }
  async function openAvailableRelease() {
    if (!updateStatus?.latestVersion) return;
    try { await openReleasePage(updateStatus.latestVersion); }
    catch (cause) { setUpdateError(cause instanceof Error ? cause.message : t('updateCheckFailed')); }
  }
  function beginProjectReplacement(): boolean {
    if (projectTransition.current || importBusy) return false;
    if (activeBuilds.current.size) { setActionFeedback(t('projectReplacementBuildBusy')); return false; }
    const project = latestState.current.project;
    if (project?.dirty) {
      if (!window.confirm(t("confirmReplaceDirtyProject"))) return false;
      if (project.document) writeProjectDraft(project.document);
    }
    projectTransition.current = true;
    return true;
  }
  function editProject(action: AppAction) {
    if (!projectTransition.current) dispatch(action);
  }
  async function startNewProject() {
    if (Object.values(buildState).some(build => build.status === 'building')) { setActionFeedback(t('newProjectBuildBusy')); return; }
    if (!beginProjectReplacement()) return;
    try { if (hasPreviewApi()) await closeLive2DPreview(); } catch { /* Closing an unavailable preview must not trap the current project. */ }
    dispatchBuild({ type: 'RESET' });
    setActionFeedback('');
    setImportError('');
    setPendingSource(null);
    dispatch({ type: 'CLOSE_PROJECT' });
    projectTransition.current = false;
  }

  async function openProjectDocument(documentId?: string, inputPath?: string) {
    if (!beginProjectReplacement()) return;
    setImportBusy(true);
    setImportError("");
    setActionFeedback("");
    try {
      const result = await openProject(documentId, inputPath);
      setRecentProjects(result.recentProjects);
      if (result.cancelled) return;
      let relinked: Awaited<ReturnType<typeof relinkSourcePath>> | undefined;
      let relinkError = "";
      if (!result.project.source.path) {
        relinkError = t("sourceRelinkRequired");
      } else {
        try {
          relinked = await relinkSourcePath(result.project, result.project.source.path);
        } catch {
          relinkError = t("sourceRelinkRequired");
        }
      }
      dispatch({
        type: "OPEN_PROJECT",
        project: {
          id: result.project.projectId,
          name: result.project.name,
          document: result.project,
          documentId: result.documentId,
          fileName: result.fileName,
          dirty: false,
          sourcePath: result.project.source.path,
          selectedMotionId: null,
          selectedExpressionId: null,
        },
      });
      if (relinked && result.project.source.path) {
        dispatch({ type: "SOURCE_RELINKED", document: relinked.project, inspection: relinked.inspection, sourcePath: result.project.source.path });
      }
      if (relinked && !relinked.reviewRequired) dispatch({ type: "NAVIGATE", destination: "map" });
      dispatchBuild({ type: 'RESET' });
      setProjectDraft(null);
      if (relinkError) setActionFeedback(relinkError);
    } catch (cause) {
      setActionFeedback(cause instanceof Error ? cause.message : t("error"));
    } finally {
      projectTransition.current = false;
      setImportBusy(false);
    }
  }

  async function saveProjectDocument(saveAs = false, portable = false) {
    if (saveInFlight.current || projectTransition.current) return;
    const { project, projectSession: session } = latestState.current;
    if (!project?.document) {
      setActionFeedback(t("saveRequiresProject"));
      return;
    }
    const submitted = project.document;
    saveInFlight.current = true;
    setActionFeedback(t(portable ? "savingPortable" : "savingProject"));
    setProjectSaveBusy(true);
    try {
      const result = await saveProject({
        ...(project.documentId ? { documentId: project.documentId } : {}),
        project: submitted,
        ...(saveAs ? { saveAs: true } : {}),
        ...(portable ? { portable: true } : {}),
      });
      setRecentProjects(result.recentProjects);
      if (latestState.current.projectSession !== session) return;
      if (result.cancelled) { setActionFeedback(''); return; }
      dispatch({ type: "PROJECT_SAVED", session, document: submitted, documentId: result.documentId, fileName: result.fileName });
      const current = latestState.current.project?.document;
      if (current && JSON.stringify(current) !== JSON.stringify(submitted)) {
        writeProjectDraft(current);
      } else if (JSON.stringify(readProjectDraft()?.project) === JSON.stringify(submitted)) {
        clearProjectDraft();
        setProjectDraft(null);
      }
      setActionFeedback(t(portable ? "portableSaved" : "projectSaved"));
    } catch (cause) {
      if (latestState.current.projectSession === session) setActionFeedback(cause instanceof Error ? cause.message : t("error"));
    } finally {
      saveInFlight.current = false;
      setProjectSaveBusy(false);
    }
  }

  async function clearRecentProjectHistory() {
    if (!window.confirm(t("confirmClearRecent"))) return;
    try { setRecentProjects(await clearRecentProjects()); }
    catch (cause) { setImportError(cause instanceof Error ? cause.message : t("error")); }
  }

  async function buildProjectTarget(target: BuildTarget) {
    if (projectTransition.current || importBusy || activeBuilds.current.has(target)) return null;
    const { project, projectSession: session } = latestState.current;
    const document = project?.document;
    if (!document) { setActionFeedback(t("buildRequiresProject")); return null; }
    activeBuilds.current.add(target);
    setActionFeedback("");
    let request: Awaited<ReturnType<typeof createBuildRequest>> | undefined;
    try {
      request = await createBuildRequest(document);
      dispatchBuild({ type: "START", target, request, snapshot: JSON.stringify(document) });
      const result = await buildProject(document, target, request);
      if (latestState.current.projectSession !== session) return null;
      if (result.requestId !== request.requestId || result.projectId !== request.projectId || result.snapshotFingerprint !== request.snapshotFingerprint) throw new Error(t('buildResultMismatch'));
      const artifact = result.artifacts.find((item) => item.target === target);
      const summary = result.builds[target];
      if (!artifact || !summary) throw new Error(t("artifactMissing"));
      dispatchBuild({ type: "SUCCEED", target, requestId: request.requestId, artifact, summary });
      return artifact;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("buildFailed");
      if (!request) setActionFeedback(message);
      else if (cause instanceof Error && "code" in cause && String(cause.code) === "BUILD_CANCELLED") dispatchBuild({ type: "CANCEL", target, requestId: request.requestId, message });
      else dispatchBuild({ type: "FAIL", target, requestId: request.requestId, error: message });
      return null;
    } finally {
      activeBuilds.current.delete(target);
    }
  }

  async function cancelProjectBuild(target: BuildTarget) {
    const { buildId, request } = buildState[target];
    if (!buildId || !request) return;
    try {
      const result = await cancelBuild(buildId);
      if (result.cancelled) dispatchBuild({ type: "CANCEL", target, requestId: request.requestId, message: t("buildCancelled") });
    } catch (cause) {
      setActionFeedback(cause instanceof Error ? cause.message : t("buildFailed"));
    }
  }
  async function importSourceFiles(files: File[], directDrop = false) {
    setImportBusy(true);
    setImportError("");
    try {
      if (!isSingleSourceSelection(files, directDrop)) throw new Error(t("dropOne"));
      const sourcePath = sourcePathFromSelection(files, getDesktopFilePath, directDrop);
      if (!sourcePath) throw new Error(t("sourcePathUnavailable"));
      const inspection = await inspectSource(sourcePath, 'library-preview');
      setPendingSource({ sourcePath, inspection, candidate: {
        id: inspection.source.fingerprint, name: inspection.source.name,
        relativePath: inspection.source.modelConfig, format: inspection.model.format === 'spine' ? 'spine' : 'live2d',
        version: null, runtimeLine: inspection.model.runtimeLine ?? null, binary: false,
      } });
    } catch (cause) { setImportError(cause instanceof Error ? cause.message : t("error")); }
    finally { setImportBusy(false); }
  }

  async function refreshRendererSettings() {
    const [runtimes, spine] = await Promise.all([getRuntimeSettings(), getSpinePackStatus()]);
    setRuntimeSettings(runtimes);
    setSpinePack(spine);
  }

  function startMapping(project: ReturnType<typeof projectFromSource>) {
    dispatchBuild({ type: 'RESET' });
    dispatch({ type: 'OPEN_PROJECT', project });
    dispatch({ type: 'NAVIGATE', destination: 'map' });
  }

  async function confirmPendingSource(motion: string) {
    if (!pendingSource || !beginProjectReplacement()) return;
    setImportBusy(true);
    try {
      const { sourcePath, inspection } = pendingSource;
      const projectId = projectIdFromSourceName(inspection.source.name);
      const checked = await inspectSource(sourcePath, projectId);
      await refreshRendererSettings();
      startMapping(projectFromSource({ projectId, appVersion, sourcePath, inspection: checked, motion }));
      setPendingSource(null);
      setProjectDraft(null);
    } finally {
      projectTransition.current = false;
      setImportBusy(false);
    }
  }

  async function openLibrarySource(library: SourceLibrary, candidate: SourceLibraryCandidate, motion: string) {
    if (!beginProjectReplacement()) return;
    setImportBusy(true);
    setImportError("");
    try {
      const projectId = projectIdFromSourceName(candidate.name);
      const { inspection, sourcePath } = await inspectLibrarySource(library.libraryId, candidate.id, projectId);
      await refreshRendererSettings();
      startMapping(projectFromSource({ projectId, appVersion, sourcePath, inspection, motion }));
      setProjectDraft(null);
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : t("error"));
    } finally {
      projectTransition.current = false;
      setImportBusy(false);
    }
  }

  async function relinkCurrentSource(files: File[], directDrop = false) {
    const project = state.project?.document;
    if (!project) return;
    if (projectTransition.current || importBusy) return;
    if (activeBuilds.current.size) { setActionFeedback(t('projectReplacementBuildBusy')); return; }
    projectTransition.current = true;
    setImportBusy(true);
    setActionFeedback("");
    try {
      if (!isSingleSourceSelection(files, directDrop)) throw new Error(t("dropOne"));
      const inputPath = sourcePathFromSelection(files, getDesktopFilePath, directDrop);
      if (!inputPath) throw new Error(t("sourcePathUnavailable"));
      const result = await relinkSourcePath(project, inputPath);
      dispatch({ type: "SOURCE_RELINKED", document: result.project, inspection: result.inspection, sourcePath: inputPath });
      const previousHiddenCount = project.visualSettings?.hiddenElementIds.length ?? 0;
      const nextHiddenCount = result.project.visualSettings?.hiddenElementIds.length ?? 0;
      const sourceChanged = project.source.fingerprint !== result.project.source.fingerprint;
      const feedback = [
        result.reviewRequired ? t("sourceReviewRequired") : "",
        sourceChanged && previousHiddenCount > 0 && nextHiddenCount === 0 ? t("visibilityResetForNewSource") : "",
      ].filter(Boolean).join(" ");
      if (feedback) setActionFeedback(feedback);
    } catch (cause) {
      setActionFeedback(cause instanceof Error ? cause.message : t("error"));
    } finally {
      projectTransition.current = false;
      setImportBusy(false);
    }
  }

  async function acknowledgeCurrentSourceReview() {
    const project = state.project?.document;
    if (!project?.sourceReview?.required) return;
    setImportBusy(true);
    setActionFeedback("");
    try {
      const document = await acknowledgeSourceReview(project);
      dispatch({ type: "SOURCE_REVIEW_ACKNOWLEDGED", document });
      dispatch({ type: "NAVIGATE", destination: "map" });
    } catch (cause) {
      setActionFeedback(cause instanceof Error ? cause.message : t("error"));
    } finally {
      setImportBusy(false);
    }
  }

  async function recoverProjectDraft() {
    if (!projectDraft || !beginProjectReplacement()) return;
    setImportBusy(true);
    setImportError("");
    setActionFeedback("");
    let relinked: Awaited<ReturnType<typeof relinkSourcePath>> | undefined;
    try {
      if (projectDraft.project.source.path) {
        try {
          relinked = await relinkSourcePath(projectDraft.project, projectDraft.project.source.path);
        } catch {
          setActionFeedback(t("sourceRelinkRequired"));
        }
      } else {
        setActionFeedback(t("sourceRelinkRequired"));
      }
      dispatch({
        type: "OPEN_PROJECT",
        project: {
          id: projectDraft.project.projectId,
          name: projectDraft.project.name,
          document: projectDraft.project,
          dirty: true,
          sourcePath: projectDraft.project.source.path,
          selectedMotionId: null,
          selectedExpressionId: null,
        },
      });
      if (relinked && projectDraft.project.source.path) {
        dispatch({ type: "SOURCE_RELINKED", document: relinked.project, inspection: relinked.inspection, sourcePath: projectDraft.project.source.path });
        if (!relinked.reviewRequired) dispatch({ type: "NAVIGATE", destination: "map" });
      }
      dispatchBuild({ type: 'RESET' });
      setProjectDraft(null);
    } catch (cause) {
      setActionFeedback(cause instanceof Error ? cause.message : t("error"));
    } finally {
      projectTransition.current = false;
      setImportBusy(false);
    }
  }

  function discardProjectDraft() {
    clearProjectDraft();
    setProjectDraft(null);
  }

  useEffect(() => onAppCommand((command) => {
    if (command === "new") void startNewProject();
    else if (command === "open") void openProjectDocument();
    else if (command === "save") void saveProjectDocument();
    else if (command === "settings") dispatch({ type: "OPEN_SETTINGS" });
    else if (command === "setup") dispatch({ type: "OPEN_SETUP" });
    else if (command === "build") {
      if (state.project?.document?.sourceReview?.required) setActionFeedback(t("sourceReviewRequired"));
      else if (state.project?.document) dispatch({ type: "NAVIGATE", destination: "build" });
      else setActionFeedback(t("buildRequiresProject"));
    } else if (command === "undo" || command === "redo") {
      if (!projectTransition.current && !preserveTextEditingHistory(command)) editProject({ type: command === "undo" ? "UNDO_PROJECT_EDIT" : "REDO_PROJECT_EDIT" });
    }
  }), [state, locale, buildState]);

  const requiredCubism = state.project?.inspection?.model.cubism;
  const requiredSpine = state.project?.inspection?.model.format === 'spine';
  const matchingSpinePack = spinePack?.packs?.find((pack) => pack.runtimeLine === state.project?.inspection?.model.runtimeLine);
  const runtimeReady = requiredSpine
    ? Boolean(matchingSpinePack?.installed)
    : (!requiredCubism || Boolean(runtimeSettings?.runtimes.some((runtime) => runtime.available && runtime.cubismGenerations.includes(requiredCubism))));
  const openRuntimeSettings = () => dispatch({ type: "OPEN_SETTINGS", section: "runtimes" });
  const configureRequiredRuntime = requiredSpine ? async () => {
    const runtimeLine = state.project?.inspection?.model.runtimeLine;
    if (!runtimeLine) return;
    try { setSpinePack(await installSpinePack(runtimeLine)); } catch (cause) { setActionFeedback(cause instanceof Error ? cause.message : t('error')); }
  } : openRuntimeSettings;
  const onboardingStage = selectOnboardingStage(onboarding, {
    destination: state.destination,
    hasLibrary: Boolean(modelLibrary),
    hasPreview: Boolean(pendingSource || selectedLibraryModel),
  });
  const statusBar = <footer className="status-bar">
    <span className="save-status"><i className="status-dot" />{!hasDesktopApi() ? t("notConnected") : state.project?.dirty ? t("unsaved") : state.project?.documentId ? t("saved") : t("noSavedProject")}</span>
    <div className="footer-builds">{updateStatus?.state === 'available' && <Button size="sm" variant="ghost" onPress={() => void openAvailableRelease()}><Download size={13} />{t('updateAvailableShort', { version: updateStatus.latestVersion ?? '' })}</Button>}{(['clawd', 'codex-pet'] as const).filter(target => buildState[target].status !== 'idle').map(target => {
      const current = buildState[target];
      const name = target === 'clawd' ? 'Clawd' : 'Codex';
      return <div className="footer-build" key={target} title={current.error ?? current.message ?? t('build')}>
        <Button size="sm" variant="ghost" onPress={() => dispatch({ type: 'NAVIGATE', destination: 'build' })}>
          {name} · {t(`buildStatus_${current.status === 'building' && current.stage === 'queue' ? 'queued' : current.status}` as MessageKey)}{current.status === 'building' && current.stage !== 'queue' ? ` ${current.progress}%` : ''}
        </Button>
        {current.status === 'building' && <ProgressBar size="sm" aria-label={`${name} ${t('buildProgress')}`} value={current.progress}><ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track></ProgressBar>}
      </div>;
    })}</div>
    <span className="status-file" title={state.project?.fileName}>{state.project?.fileName ?? `Live2Pet ${appVersion}`}</span>
  </footer>;

  if (state.destination === "setup") return <SetupView locale={locale} returning={state.setupReturnDestination !== null} onComplete={completeSetup} onRuntimeSettingsChange={setRuntimeSettings} />;
  if (state.destination === "settings") return <div className="app-shell settings-shell"><SettingsView locale={locale} section={state.settingsSection} appearance={appearance} spinePack={spinePack} appVersion={appVersion} updateStatus={updateStatus} updateError={updateError} updateBusy={updateBusy} automaticUpdateChecks={automaticUpdateChecks} onCheckForUpdates={() => void runUpdateCheck(true)} onOpenRelease={() => void openAvailableRelease()} onAutomaticUpdateChecks={setAutomaticChecks} onReplayTutorial={() => { setOnboarding(replayOnboarding()); dispatch({ type: "CLOSE_SETTINGS" }); }} onSection={(section) => dispatch({ type: "SELECT_SETTINGS_SECTION", section })} onLocale={(language) => dispatch({ type: "UPDATE_LANGUAGE", language })} onAppearance={(value) => dispatch({ type: "UPDATE_APPEARANCE", appearance: value })} onRuntimeSettingsChange={setRuntimeSettings} onSpinePackChange={setSpinePack} onClose={() => dispatch({ type: "CLOSE_SETTINGS" })} />{statusBar}</div>;

  const projectOpen = state.project !== null;
  const sourceReviewRequired = Boolean(state.project?.document?.sourceReview?.required);
  return (
    <div className="app-shell">
      <header className="app-toolbar" inert={importBusy && projectTransition.current}>
        <div className="toolbar-brand">{projectOpen ? <><span>Live2Pet</span><i /><strong title={state.project?.name}>{state.project?.name}</strong></> : <strong>Live2Pet</strong>}</div>
        {projectOpen ? <nav aria-label={t('projectNavigation')}><ButtonGroup>{(["source", "map", "build"] as const).map((destination) => <Button key={destination} isDisabled={sourceReviewRequired && destination !== "source"} variant={state.destination === destination ? "primary" : "ghost"} onPress={() => dispatch({ type: "NAVIGATE", destination })}>{t(destination)}</Button>)}</ButtonGroup></nav> : <span />}
        <div className="toolbar-actions">{projectOpen && <Button aria-label={t("newProject")} variant="ghost" isDisabled={projectSaveBusy || Object.values(buildState).some(build => build.status === 'building')} onPress={() => void startNewProject()}><Plus size={17} />{t("newProject")}</Button>}{projectOpen && <Button aria-label={t("saveProject")} variant="ghost" isDisabled={projectSaveBusy} onPress={() => void saveProjectDocument()}><Save size={17} />{t("save")}</Button>}{projectOpen && <Button aria-label={t("savePortableProject")} variant="ghost" isDisabled={projectSaveBusy} onPress={() => void saveProjectDocument(true, true)}><PackageCheck size={17} />{t("savePortable")}</Button>}<Button ref={settingsButton} isIconOnly aria-label={t("settings")} variant="ghost" onPress={() => dispatch({ type: "OPEN_SETTINGS" })}><SettingsIcon size={18} /></Button></div>
      </header>
      <div className="app-content" inert={importBusy && projectTransition.current} aria-busy={importBusy}>
        {actionFeedback && <div className="action-feedback" role="alert">{actionFeedback}{projectSaveBusy && <ProgressBar aria-label={actionFeedback} isIndeterminate />}</div>}
        {state.destination === "welcome" && <ModelsView selectedLibraryModel={selectedLibraryModel} onSelectLibraryModel={setSelectedLibraryModel} pendingSource={pendingSource} onConfirmSource={confirmPendingSource} onDismissSource={() => setPendingSource(null)} onConfigureRuntime={() => dispatch({ type: "OPEN_SETTINGS", section: "runtimes" })} library={modelLibrary} setLibrary={library => { setModelLibrary(library); setSelectedLibraryModel(null); setPendingSource(null); }} locale={locale} busy={importBusy} error={importError} recentProjects={recentProjects} draft={projectDraft} onImport={(files, directDrop) => void importSourceFiles(files, directDrop)} onLibrarySelection={openLibrarySource} onOpenProject={() => void openProjectDocument()} onOpenRecent={(project) => project.available ? void openProjectDocument(project.documentId) : setImportError(t("recentUnavailable"))} onClearRecent={() => void clearRecentProjectHistory()} onRecoverDraft={() => void recoverProjectDraft()} onDiscardDraft={discardProjectDraft} />}
        {state.destination === "source" && state.project && <SourceView locale={locale} project={state.project.document} inspection={state.project.inspection} inspectionRequired={Boolean(state.project.document)} runtimeReady={runtimeReady} busy={importBusy} onConfigureRuntime={configureRequiredRuntime} onRelink={relinkCurrentSource} onAcknowledgeReview={acknowledgeCurrentSourceReview} onMap={() => dispatch({ type: "NAVIGATE", destination: "map" })} />}
        {state.destination === "map" && state.project && <MapView locale={locale} projectId={state.project.id} projectDocument={state.project.document} inspection={state.project.inspection} runtimeReady={runtimeReady} selectedMotionId={state.project.selectedMotionId} selectedExpressionId={state.project.selectedExpressionId} onConfigureRuntime={configureRequiredRuntime} onSelectMotion={(motionId) => editProject({ type: "SELECT_MOTION", motionId })} onSelectExpression={(expressionId) => editProject({ type: "SELECT_EXPRESSION", expressionId })} onAssign={(destination) => editProject({ type: "ASSIGN_SELECTED_RECIPE", destination })} onClear={(destination) => editProject({ type: "CLEAR_ASSIGNMENT", destination })} onVisualSettings={(settings) => editProject({ type: "SET_VISUAL_SETTINGS", settings })} />}
        {state.destination === "build" && <BuildView locale={locale} project={state.project?.document ?? null} inspection={state.project?.inspection} runtimeReady={runtimeReady} state={buildState} onName={(name) => editProject({ type: "RENAME_PROJECT", name })} onPreset={(target, preset) => editProject({ type: "SET_RENDER_PRESET", target, preset })} onCustomRender={(settings) => editProject({ type: 'SET_CLAWD_RENDER', settings })} onBuild={buildProjectTarget} onCancel={(target) => void cancelProjectBuild(target)} />}
      </div>
      {statusBar}
      {onboardingStage && <OnboardingTour locale={locale} stage={onboardingStage} onComplete={(stage) => setOnboarding((current) => completeOnboardingStage(current, stage))} onSkip={() => setOnboarding((current) => skipOnboarding(current))} />}
    </div>
  );
}
