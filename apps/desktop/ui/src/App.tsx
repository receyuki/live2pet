import {
  Button,
  ButtonGroup,
  Card,
  Chip,
  Input,
  ProgressBar,
  Tabs,
} from "@heroui/react";
import { buttonGroupVariants, buttonVariants } from '@heroui/styles';
import type { ComponentPropsWithRef } from 'react';
import {
  Archive,
  AlertTriangle,
  Box,
  ChevronRight,
  CircleCheck,
  Database,
  ExternalLink,
  FolderOpen,
  Gauge,
  HardDrive,
  Languages,
  Moon,
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
  Sun,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import { ChangeEvent, DragEvent, ReactNode, useEffect, useReducer, useRef, useState } from "react";
import {
  clearCache,
  buildProject,
  cancelBuild,
  clearRuntimeSettings,
  configureRuntimePath,
  configureRuntime,
  getAppVersion,
  getCacheStatus,
  getRecentProjects,
  getRuntimeSettings,
  getDesktopFilePath,
  hasDesktopApi,
  hasPreviewApi,
  inspectSource,
  relinkSourcePath,
  acknowledgeSourceReview,
  Live2PetProject,
  layoutLive2DPreview,
  onLive2DPreviewStatus,
  onBuildProgress,
  onAppCommand,
  openProject,
  openLive2DPreview,
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
  RecentProject,
  saveProject,
  SourceInspection,
  BuildTarget,
} from "./app-host";
import {
  appReducer,
  AppSettings,
  initialAppState,
  SettingsSection,
} from "./app-state";
import { Locale, MessageKey, translate } from "./i18n";
import runtimeHelpLinks from "../../runtime-help-links.json";
import { projectIdFromSourceName, sourcePathFromSelection } from "./source-selection";
import { hasDraggedFiles, isProjectFile } from "./file-drop";
import { CLAWD_PROFILE, CODEX_PROFILE, MappingDestination } from "./target-profiles";
import { BuildView } from "./BuildView";
import { TargetSettings } from "./TargetSettings";
import { VisibilityPanel, soloVisualSettings } from './VisibilityPanel';
import { useVisualThumbnails } from './useVisualThumbnails';
import { OutputSettings } from './OutputSettings';
import { buildReducer, initialBuildState } from "./build-state";
import {
  clearProjectDraft,
  PROJECT_DRAFT_DEBOUNCE_MS,
  readProjectDraft,
  writeProjectDraft,
} from "./project-draft";
import type { ProjectDraft } from "./project-draft";

const SETUP_KEY = "live2pet.desktop.setup-completed";
const LOCALE_KEY = "live2pet.desktop.locale";
const APPEARANCE_KEY = "live2pet.desktop.appearance";

const SLOT_MESSAGE_KEYS: Partial<Record<string, MessageKey>> = {
  idle: "assignmentIdle",
  thinking: "assignmentThinking",
  working: "assignmentWorking",
  attention: "assignmentAttention",
  error: "assignmentError",
};

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

function slotLabel(slot: string): string {
  return slot
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (value) => value.toUpperCase());
}

function storedLocale(): Locale {
  return localStorage.getItem(LOCALE_KEY) === "zh-CN" ? "zh-CN" : "en";
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

function PageHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <header className="page-heading">
      <p className="eyebrow"><Sparkles size={13} />{eyebrow}</p>
      <h1>{title}</h1>
      <p>{body}</p>
    </header>
  );
}

function RuntimePanel({ locale, compact = false, onSettingsChange }: { locale: Locale; compact?: boolean; onSettingsChange?: (settings: RuntimeSettings) => void }) {
  const t = (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values);
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getRuntimeSettings().then(setSettings).catch((cause: Error) => setError(cause.message));
  }, []);
  async function saveRuntime(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const next = await configureRuntime(file);
      setSettings(next);
      onSettingsChange?.(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  function addRuntime(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    void saveRuntime(file);
  }

  async function addRuntimeFolder(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    const inputPath = sourcePathFromSelection(files, getDesktopFilePath);
    if (!inputPath) { setError(t("sourcePathUnavailable")); return; }
    setBusy(true);
    setError("");
    try {
      const next = await configureRuntimePath(inputPath);
      setSettings(next);
      onSettingsChange?.(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  function dropRuntime(event: DragEvent<HTMLElement>) {
    if (busy || !hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    if (Array.from(event.dataTransfer.files).some(isProjectFile)) return;
    if (event.dataTransfer.files.length !== 1) { setError(t("dropOne")); return; }
    void saveRuntime(event.dataTransfer.files[0]);
  }

  async function removeRuntimes(fingerprint?: string) {
    if (!window.confirm(t(fingerprint ? "confirmRemoveRuntime" : "confirmRemoveRuntimes"))) return;
    setBusy(true);
    setError("");
    try {
      const next = await clearRuntimeSettings(fingerprint);
      setSettings(next);
      onSettingsChange?.(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  const runtimes = settings?.runtimes ?? [];
  return (
    <Card
      aria-label={t("setupRuntime")}
      className={`surface-card drop-zone${dragActive ? " drop-zone-active" : ""}`}
      onDragEnter={(event) => { if (!busy && hasDraggedFiles(event.dataTransfer)) { event.preventDefault(); dragDepth.current += 1; setDragActive(true); } }}
      onDragOver={(event) => { if (hasDraggedFiles(event.dataTransfer)) event.preventDefault(); }}
      onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragActive(false); }}
      onDrop={dropRuntime}
    >
      <Card.Content>
        <div className="section-heading-row">
          <div>
            <p className="eyebrow"><Gauge size={13} />{t("setupRuntime")}</p>
            <h2>{compact ? t("runtimeTitle") : t("setupRuntime")}</h2>
            <p>{t("runtimeBody")}</p>
          </div>
          <input ref={fileInput} className="visually-hidden" type="file" tabIndex={-1} onChange={addRuntime} disabled={busy} />
          <input ref={folderInput} className="visually-hidden" type="file" multiple {...{ webkitdirectory: "" }} tabIndex={-1} onChange={addRuntimeFolder} disabled={busy} />
          <div className="runtime-actions"><Button variant="secondary" size="sm" onPress={() => fileInput.current?.click()} isDisabled={busy}>
            <Plus size={15} />{runtimes.length ? t("replaceRuntime") : t("addRuntime")}
          </Button>
          <Button variant="secondary" size="sm" onPress={() => folderInput.current?.click()} isDisabled={busy}>
            <FolderOpen size={15} />{t("addRuntimeFolder")}
          </Button>
          </div>
        </div>
        {busy && <ProgressBar aria-label={t("loading")} isIndeterminate className="mt-4" />}
        <p className="drop-hint">{t("dropRuntime")}</p>
        <Button variant="ghost" size="sm" onPress={() => window.open(runtimeHelpLinks[locale], '_blank', 'noopener,noreferrer')}>
          <ExternalLink size={14} />{t("runtimeHelp")}
        </Button>
        {dragActive && <div className="drop-overlay" aria-hidden="true"><Upload size={20} />{t("dropRuntime")}</div>}
        <div className="runtime-list">
          {runtimes.length === 0 ? (
            <div className="empty-state"><HardDrive size={17} />{t("setupEmpty")}</div>
          ) : runtimes.map((runtime) => (
            <div className="runtime-item" key={runtime.fingerprint}>
              <span className="large-icon"><Box size={19} /></span>
              <span className="grow-copy">
                <strong>{runtime.runtimeName}</strong>
                <small>{t("generations", { value: runtime.cubismGenerations.join(", ") })}</small>
              </span>
              <Chip color="success" size="sm" variant="soft">{t("runtimeAvailable")}</Chip>
              <Button isIconOnly aria-label={t('removeRuntime', { name: runtime.runtimeName })} variant="ghost" size="sm" isDisabled={busy} onPress={() => void removeRuntimes(runtime.fingerprint)}><Trash2 size={14} /></Button>
            </div>
          ))}
        </div>
        {error && <p className="inline-error" role="alert">{error}</p>}
        {runtimes.length > 0 && (
          <Button className="danger-link" variant="ghost" size="sm" onPress={() => void removeRuntimes()} isDisabled={busy}>
            <Trash2 size={14} />{t("removeAll")}
          </Button>
        )}
      </Card.Content>
    </Card>
  );
}

function SetupView({ locale, returning, onComplete, onRuntimeSettingsChange }: { locale: Locale; returning: boolean; onComplete: () => void; onRuntimeSettingsChange: (settings: RuntimeSettings) => void }) {
  const t = (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values);
  return (
    <main className="setup-view">
      <section className="setup-content">
        <p className="eyebrow"><Sparkles size={13} />{t("setupEyebrow")}</p>
        <h1>{t("setupTitle")}</h1>
        <p className="lead">{t("setupBody")}</p>
        <RuntimePanel locale={locale} onSettingsChange={onRuntimeSettingsChange} />
        <div className="setup-actions">
          <Button variant="ghost" onPress={onComplete}>{t("setupSkip")}</Button>
          <Button variant="primary" onPress={onComplete}>{returning ? t("setupDone") : t("setupContinue")}<ChevronRight size={16} /></Button>
        </div>
      </section>
    </main>
  );
}

function WelcomeView({ locale, busy, error, recentProjects, draft, onImport, onOpenProject, onOpenRecent, onOpenPreview, onRecoverDraft, onDiscardDraft }: { locale: Locale; busy: boolean; error: string; recentProjects: RecentProject[]; draft: ProjectDraft | null; onImport: (files: File[], directDrop?: boolean) => void; onOpenProject: () => void; onOpenRecent: (project: RecentProject) => void; onOpenPreview: () => void; onRecoverDraft: () => void; onDiscardDraft: () => void }) {
  const t = (key: MessageKey) => translate(locale, key);
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const folderInput = useRef<HTMLInputElement>(null);
  const pckInput = useRef<HTMLInputElement>(null);
  function selected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length) onImport(files);
  }
  function dropSource(event: DragEvent<HTMLElement>) {
    if (busy || !hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.some(isProjectFile)) return;
    if (files.length) onImport(files, true);
  }
  return (
    <main className="welcome-view">
      <section
        aria-label={t("importSource")}
        className={`welcome-hero drop-zone${dragActive ? " drop-zone-active" : ""}`}
        onDragEnter={(event) => { if (!busy && hasDraggedFiles(event.dataTransfer)) { event.preventDefault(); dragDepth.current += 1; setDragActive(true); } }}
        onDragOver={(event) => { if (hasDraggedFiles(event.dataTransfer)) event.preventDefault(); }}
        onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragActive(false); }}
        onDrop={dropSource}
      >
        {dragActive && <div className="drop-overlay" aria-hidden="true"><Upload size={22} />{t("dropSource")}</div>}
        <div className="welcome-copy">
          <p className="eyebrow"><Sparkles size={13} />{t("welcomeEyebrow")}</p>
          <h1>{t("welcomeTitle")}</h1>
          <p>{t("welcomeBody")}</p>
          <div className="welcome-actions">
            <input ref={folderInput} className="visually-hidden" type="file" multiple {...{ webkitdirectory: "" }} onChange={selected} />
            <input ref={pckInput} className="visually-hidden" type="file" accept=".pck" onChange={selected} />
            <Button variant="primary" size="lg" isDisabled={busy || !hasDesktopApi()} onPress={() => folderInput.current?.click()}><Upload size={18} />{t("importFolder")}</Button>
            <Button variant="secondary" size="lg" isDisabled={busy || !hasDesktopApi()} onPress={() => pckInput.current?.click()}><Box size={18} />{t("importPck")}</Button>
            <Button variant="secondary" size="lg" isDisabled={busy || !hasDesktopApi()} onPress={onOpenProject}><FolderOpen size={18} />{t("openProject")}</Button>
          </div>
          <p className="import-hint">{busy ? t("loading") : t("importHint")}</p>
          {busy && <ProgressBar aria-label={t("loading")} isIndeterminate className="mt-4" />}
          {error && <p className="inline-error" role="alert">{error}</p>}
          <Button className="button--ghost" variant="ghost" onPress={onOpenPreview}>{t("sampleProject")}<ChevronRight size={15} /></Button>
        </div>
      </section>
      {draft && <section className="draft-recovery" aria-label={t("draftRecoveryTitle")}>
        <Card className="surface-card"><Card.Content>
          <div className="draft-recovery-copy">
            <span className="large-icon"><RotateCcw size={18} /></span>
            <span><strong>{t("draftRecoveryTitle")}</strong><small>{translate(locale, "draftRecoveryBody", { name: draft.project.name, savedAt: new Date(draft.savedAt).toLocaleString(locale) })}</small></span>
          </div>
          <div className="draft-recovery-actions">
            <Button variant="ghost" isDisabled={busy} onPress={onDiscardDraft}>{t("discardDraft")}</Button>
            <Button variant="primary" isDisabled={busy} onPress={onRecoverDraft}>{t("recoverDraft")}</Button>
          </div>
        </Card.Content></Card>
      </section>}
      <section className="recent-section">
        <p className="eyebrow">{t("recent")}</p>
        <h2>{t("recent")}</h2>
        {recentProjects.length === 0 ? <div className="empty-state"><Archive size={18} />{t("noRecent")}</div> : (
          <div className="recent-list">
            {recentProjects.map((project) => (
              <Button
                key={project.documentId}
                className={`recent-project${project.available ? "" : " recent-project-unavailable"}`}
                variant="ghost"
                onPress={() => onOpenRecent(project)}
              >
                <span className="large-icon"><FolderOpen size={18} /></span>
                <span className="grow-copy"><strong>{project.name}</strong><small>{project.fileName}</small></span>
                <Chip color={project.available ? "success" : "default"} size="sm" variant="soft">{t(project.available ? "available" : "unavailable")}</Chip>
              </Button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
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
    if (Array.from(event.dataTransfer.files).some(isProjectFile)) return;
    void onRelink(Array.from(event.dataTransfer.files), true);
  }
  const facts = inspection
    ? [["sourceModel", inspection.model.modelFile ?? "—"], ["sourceTextures", String(inspection.model.textures.length)], ["sourceMotions", String(inspection.motions.length)], ["sourceExpressions", String(inspection.expressions.length)]]
    : inspectionRequired
      ? [["sourceModel", "—"], ["sourceTextures", "—"], ["sourceMotions", "—"], ["sourceExpressions", "—"]]
      : [["sourceModel", "model3.json"], ["sourceTextures", "4"], ["sourceMotions", "5"], ["sourceExpressions", "3"]];
  const summary = inspection
    ? `Cubism ${inspection.model.cubism} · ${inspection.motions.length} ${t("sourceMotions")} · ${inspection.expressions.length} ${t("sourceExpressions")}`
    : inspectionRequired ? t("sourceRelinkRequired") : t("sourceSummary");
  return (
    <main className="page">
      <PageHeading eyebrow={t("source")} title={t("sourceTitle")} body={t("sourceBody")} />
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
          {!runtimeReady && <div className="runtime-required"><Gauge size={18} /><span><strong>{t("runtimeRequired")}</strong><small>{t("runtimeRequiredBody")}</small></span><Button size="sm" variant="secondary" onPress={onConfigureRuntime}>{t("configureRuntime")}</Button></div>}
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
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus | null>(null);
  const [previewRetry, setPreviewRetry] = useState(0);
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
  const visualThumbnails = useVisualThumbnails(
    thumbnailScope,
    visibilityOpen && !visibilityBusy && !scanningParts && previewStatus?.state === 'ready' && visualElements.length > 0,
  );
  const [motionQuery, setMotionQuery] = useState('');
  const visualSettings = projectDocument?.visualSettings ?? { hiddenElementIds: [] };
  const visualKey = JSON.stringify(visualSettings);
  const commandSequence = useRef(0);
  const runPlayback = async (operation: () => Promise<PreviewStatus>) => {
    const sequence = ++commandSequence.current;
    setPlaybackError(null);
    try { const status = await operation(); if (sequence === commandSequence.current) setPreviewStatus(status); }
    catch (cause) { if (sequence === commandSequence.current) setPlaybackError(cause instanceof Error ? cause.message : t('previewFailed')); }
  };
  const [mappingTarget, setMappingTarget] = useState<MappingTargetId>("clawd");
  const displayedMotions = inspection
    ? inspection.motions.map((motion) => ({ id: motion.id, name: motion.name, seconds: motion.duration?.toFixed(1) ?? "—", tint: "" }))
    : motions.map((motion) => ({ ...motion, name: t(motion.nameKey) }));
  const displayedExpressions = inspection
    ? inspection.expressions.map((expression) => ({ id: expression.id, name: expression.name }))
    : expressions.map((expression) => ({ ...expression, name: t(expression.nameKey) }));
  const selected = displayedMotions.find((motion) => motion.id === selectedMotionId) ?? displayedMotions[0];
  const selectedExpression = displayedExpressions.find((expression) => expression.id === selectedExpressionId);
  const selectedName = selected?.name ?? "—";
  const selectedDuration = inspection?.motions.find((motion) => motion.id === selectedMotionId)?.duration ?? (Number(selected?.seconds) || 0);
  const nativePreview = Boolean(inspection && runtimeReady && hasPreviewApi());
  const canEditMappings = Boolean(projectDocument && inspection);
  const canAssign = canEditMappings && Boolean(selectedMotionId);
  const targetDocument = projectDocument?.targets[mappingTarget];
  const mappingSlotLabel = (slot: string) => SLOT_MESSAGE_KEYS[slot] ? t(SLOT_MESSAGE_KEYS[slot]!) : slotLabel(slot);

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
    if (!nativePreview || !inspection) return;
    let active = true;
    let opened = false;
    let syncing = false;
    const syncBounds = async () => {
      const element = previewSurface.current;
      if (!element || !active || syncing) return;
      const rect = element.getBoundingClientRect();
      if (rect.width < 64 || rect.height < 64) return;
      const bounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      syncing = true;
      try {
        const status = opened
          ? await layoutLive2DPreview({ visible: true, bounds })
          : await openLive2DPreview({ projectId, sourceFingerprint: inspection.source.fingerprint, bounds, visualSettings });
        opened = true;
        if (active) setPreviewStatus(status);
        else await layoutLive2DPreview({ visible: false }).catch(() => undefined);
      } catch (cause) {
        if (active) setPreviewStatus({ schemaVersion: 1, state: 'failed', projectId, sourceFingerprint: inspection.source.fingerprint, visible: false, bounds: null, error: { code: cause instanceof Error && 'code' in cause ? String(cause.code) : 'PREVIEW_OPEN_FAILED', message: cause instanceof Error ? cause.message : t('previewFailed') } });
      } finally {
        syncing = false;
      }
    };
    const unsubscribe = onLive2DPreviewStatus((status) => { if (active) setPreviewStatus(status); });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { void syncBounds(); }) : null;
    if (previewSurface.current) observer?.observe(previewSurface.current);
    window.addEventListener('resize', syncBounds);
    void syncBounds();
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener('resize', syncBounds);
      unsubscribe();
      void layoutLive2DPreview({ visible: false }).catch(() => undefined);
    };
  }, [inspection, nativePreview, previewRetry, projectId]);

  useEffect(() => {
    const expectedSourceFingerprint = inspection?.source.fingerprint;
    if (previewStatus?.state !== 'ready' || !expectedSourceFingerprint || previewStatus.projectId !== projectId || previewStatus.sourceFingerprint !== expectedSourceFingerprint) return;
    const expectedSourceKey = sourceKey;
    let active = true;
    void getPreviewVisualElements().then(elements => {
      if (active && sourceKeyRef.current === expectedSourceKey) setVisualElementState({ sourceKey: expectedSourceKey, elements });
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
    if (previewStatus?.state === 'ready') void setLive2DPreviewExpression(selectedExpressionId).catch(() => undefined);
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

  useEffect(() => {
    if (previewStatus?.state !== 'ready') return;
    let active = true;
    let pending = false;
    const timer = window.setInterval(async () => {
      if (pending) return;
      pending = true;
      const sequence = commandSequence.current;
      try { const status = await readLive2DPreviewStatus(); if (active && status && sequence === commandSequence.current) setPreviewStatus(status); }
      catch { /* Command errors remain visible; transient status reads are retried. */ }
      finally { pending = false; }
    }, 150);
    return () => { active = false; window.clearInterval(timer); };
  }, [previewStatus?.state]);

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
  return (
    <main className="map-workspace">
      <Tabs className="workspace-panel library-tabs" selectedKey={visibilityOpen ? 'visibility' : 'motions'} onSelectionChange={key => { if (key !== 'visibility') setSoloId(null); setVisibilityOpen(key === 'visibility'); }}>
        <Tabs.List className={buttonGroupVariants().base({ className: 'target-switch library-switch' })} aria-label={t('modelTools')}>
          <Tabs.Tab id="motions" render={props => <div {...props as ComponentPropsWithRef<'div'>} className={buttonVariants({ size: 'sm', variant: !visibilityOpen ? 'primary' : 'secondary' })} />}>{t('motionsAndExpressions')}</Tabs.Tab>
          <Tabs.Tab id="visibility" isDisabled={!projectDocument} render={props => <div {...props as ComponentPropsWithRef<'div'>} className={buttonVariants({ size: 'sm', variant: visibilityOpen ? 'primary' : 'secondary' })} />}>{t('visibility')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel id="visibility" className="library-tab-panel"><VisibilityPanel key={sourceKey} locale={locale} elements={visualElements} settings={visualSettings} soloId={soloId} thumbnail={visualThumbnails.thumbnail} thumbnails={visualThumbnails.thumbnails} busy={visibilityBusy || scanningParts || previewStatus?.state !== 'ready'} onSettings={onVisualSettings} onSolo={inspectSolo} onInspect={visualThumbnails.inspect} onVisible={visualThumbnails.onVisible} scanScope={thumbnailScope} onScan={inspection && inspection.model.cubism !== 2 && selectedMotionId ? async () => {
          setScanningParts(true); setSoloId(null); setSeekTime(null);
          try {
            await setPreviewVisualSettings(visualSettings);
            const result = await scanPreviewVisualElements(selectedMotionId);
            if (sourceKeyRef.current === sourceKey) setPreviewStatus(await readLive2DPreviewStatus());
            return result;
          } finally { setScanningParts(false); }
        } : undefined} /></Tabs.Panel>
        <Tabs.Panel id="motions" className="library-tab-panel">
        <PanelHeading icon={<SlidersHorizontal size={16} />} title={t("motions")} body={t("motionsHint")} />
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
      <section className="workspace-panel">
        <PanelHeading icon={<Sparkles size={16} />} title={t("preview")} body={t("previewHint")} />
        <div className="preview-caption"><Chip variant="soft">{selectedName} · {selectedExpression?.name ?? t("baseExpression")}</Chip><Button size="sm" variant="ghost" aria-label={t('resetPreview')} isDisabled={!nativePreview || previewStatus?.state === 'opening' || visibilityBusy || scanningParts} onPress={resetPreview}><RefreshCcw size={15} />{t('resetPreview')}</Button></div>
        <div className="preview-stage"><i className="stage-grid" />{!runtimeReady ? <div className="preview-runtime-required"><Gauge size={28} /><strong>{t("runtimeRequired")}</strong><p>{t("runtimeRequiredBody")}</p><Button size="sm" variant="primary" onPress={onConfigureRuntime}>{t("configureRuntime")}</Button></div> : nativePreview ? <><div ref={previewSurface} className="preview-native-surface" />{previewStatus?.state === 'opening' && <div className="preview-message">{t('previewLoading')}</div>}{previewStatus?.state === 'failed' && <div className="preview-runtime-required"><strong>{t('previewFailed')}</strong><p>{previewStatus.error?.message}</p><Button size="sm" variant="primary" onPress={() => setPreviewRetry((value) => value + 1)}>{t('retry')}</Button></div>}</> : <div className="preview-runtime-required"><Box size={28} aria-hidden="true" /><strong>{t('previewEmptyTitle')}</strong><p>{t(projectDocument ? 'previewDesktopRequired' : 'previewImportHint')}</p></div>}</div>
        <div className="playback"><Button isIconOnly aria-label={previewStatus?.playback?.playing ? t('pause') : t('play')} variant="primary" size="sm" isDisabled={previewStatus?.state !== 'ready'} onPress={togglePlayback}>{previewStatus?.playback?.playing ? <Pause size={15} /> : <Play size={15} />}</Button><Button isIconOnly aria-label={t('restart')} variant="ghost" size="sm" isDisabled={previewStatus?.state !== 'ready'} onPress={() => void runPlayback(() => controlLive2DPreview('restart'))}><RotateCcw size={15} /></Button><input className="timeline" type="range" aria-label={t('seekMotion')} min={0} max={selectedDuration} step={0.01} value={seekTime ?? previewStatus?.playback?.time ?? 0} disabled={previewStatus?.state !== 'ready' || !selectedDuration} onInput={(event) => setSeekTime(Number(event.currentTarget.value))} /><small>{(previewStatus?.playback?.time ?? 0).toFixed(1)} / {selected?.seconds ?? '—'} s</small></div>
        <div className="playback-options">
          <Button size="sm" variant={previewLoop ? 'secondary' : 'ghost'} aria-label={t('loopPreview')} aria-pressed={previewLoop} aria-describedby="preview-options-hint" isDisabled={previewStatus?.state !== 'ready' || !selectedMotionId} onPress={() => setPreviewLoop((value) => !value)}>{t('loopPreview')}</Button>
          <Button size="sm" variant="ghost" aria-label={t('previewSpeed', { value: previewSpeed })} aria-describedby="preview-options-hint" isDisabled={previewStatus?.state !== 'ready' || !selectedMotionId} onPress={() => setPreviewSpeed((value) => { const speeds = [0.5, 1, 1.5, 2]; return speeds[(speeds.indexOf(value) + 1) % speeds.length]; })}>{previewSpeed}×</Button>
          <small id="preview-options-hint">{t('previewOptionsHint')}</small>
        </div>
        {playbackError && <p className="inline-error" role="alert">{playbackError}</p>}
        {previewStatus?.state === 'failed' && visualSettings.hiddenElementIds.length > 0 && <Button size="sm" variant="secondary" onPress={() => { onVisualSettings({ hiddenElementIds: [] }); setSoloId(null); setPreviewRetry(value => value + 1); }}>{t('restoreVisibility')}</Button>}
      </section>
      <section className="workspace-panel assignment-panel">
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
            const hint = group.id === 'full-sleep' ? (required ? 'mappingFullSleepRequired' : 'mappingFullSleepOptional') : required ? 'mappingRequiredHint' : 'mappingOptionalHint';
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

function SettingsView({ locale, section, appearance, onSection, onLocale, onAppearance, onRuntimeSettingsChange, onClose }: { locale: Locale; section: SettingsSection; appearance: AppSettings["appearance"]; onSection: (section: SettingsSection) => void; onLocale: (locale: Locale) => void; onAppearance: (appearance: AppSettings["appearance"]) => void; onRuntimeSettingsChange: (settings: RuntimeSettings) => void; onClose: () => void }) {
  const t = (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values);
  const [cache, setCache] = useState({ byteLength: 0, entryCount: 0, maxBytes: 0 });
  const nav: Array<[SettingsSection, MessageKey, ReactNode]> = [["general", "general", <SlidersHorizontal size={16} />], ["runtimes", "runtimes", <Gauge size={16} />], ["targets", "targets", <PackageCheck size={16} />], ["storage", "storage", <Database size={16} />]];
  useEffect(() => { if (section === "storage") void getCacheStatus().then(setCache); }, [section]);
  async function clearBuildCache() { if (!window.confirm(t("confirmClearCache"))) return; await clearCache(); setCache(await getCacheStatus()); }
  return (
    <>
    <header className="app-toolbar settings-toolbar">
      <div className="toolbar-brand"><span>Live2Pet</span><i /><h1 className="toolbar-title">{t("settingsTitle")}</h1></div>
      <div className="toolbar-actions"><Button variant="secondary" size="sm" onPress={onClose}><X size={16} />{t("close")}</Button></div>
    </header>
    <main className="settings-view">
      <aside className="settings-sidebar">
        <nav aria-label={t("settings")}>{nav.map(([id, key, icon]) => <Button key={id} className="settings-nav" variant={section === id ? "secondary" : "ghost"} onPress={() => onSection(id)}>{icon}{t(key)}<ChevronRight size={14} /></Button>)}</nav>
      </aside>
      <section className="settings-content">
        {section === "general" && <div className="settings-section"><PageHeading eyebrow={t("settings")} title={t("general")} body={t("settingsBody")} /><Card className="surface-card"><Card.Content><div className="setting-row"><span className="large-icon"><Languages size={19} /></span><span className="grow-copy"><strong>{t("language")}</strong></span><ButtonGroup><Button variant={locale === "en" ? "primary" : "secondary"} onPress={() => onLocale("en")}>English</Button><Button variant={locale === "zh-CN" ? "primary" : "secondary"} onPress={() => onLocale("zh-CN")}>简体中文</Button></ButtonGroup></div></Card.Content></Card><Card className="surface-card"><Card.Content><div className="setting-row"><span className="large-icon">{appearance === "dark" ? <Moon size={19} /> : <Sun size={19} />}</span><span className="grow-copy"><strong>{t("appearance")}</strong></span><ButtonGroup>{(["system", "light", "dark"] as const).map((item) => <Button key={item} variant={appearance === item ? "primary" : "secondary"} onPress={() => onAppearance(item)}>{t(item)}</Button>)}</ButtonGroup></div></Card.Content></Card></div>}
        {section === "runtimes" && <div className="settings-section"><PageHeading eyebrow={t("settings")} title={t("runtimes")} body={t("runtimeBody")} /><RuntimePanel locale={locale} compact onSettingsChange={onRuntimeSettingsChange} /></div>}
        {section === "targets" && <div className="settings-section"><PageHeading eyebrow={t("settings")} title={t("targets")} body={t("targetBody")} /><TargetSettings locale={locale} /></div>}
        {section === "storage" && <div className="settings-section"><PageHeading eyebrow={t("settings")} title={t("storage")} body={t("storageBody")} /><OutputSettings locale={locale} /><Card className="surface-card"><Card.Content><div className="section-heading-row"><div><p className="eyebrow"><Database size={13} />{t("storageTitle")}</p><h2>{cache.entryCount ? t("cacheEntries", { count: cache.entryCount, size: `${Math.round(cache.byteLength / 1024 / 1024)} MiB` }) : t("cacheEmpty")}</h2></div><Button variant="secondary" onPress={clearBuildCache} isDisabled={!cache.entryCount}><Trash2 size={15} />{t("clearCache")}</Button></div></Card.Content></Card></div>}
      </section>
    </main>
    </>
  );
}

export function App() {
  const [state, dispatch] = useReducer(appReducer, undefined, () => {
    const initial = initialAppState({ setupCompleted: localStorage.getItem(SETUP_KEY) === "true" });
    return { ...initial, settings: { ...initial.settings, language: storedLocale(), appearance: storedAppearance() } };
  });
  const [buildState, dispatchBuild] = useReducer(buildReducer, undefined, initialBuildState);
  const [appVersion, setAppVersion] = useState("0.1.0");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [actionFeedback, setActionFeedback] = useState("");
  const [projectDraft, setProjectDraft] = useState<ProjectDraft | null>(() => readProjectDraft());
  const locale = state.settings.language;
  const appearance = state.settings.appearance;
  const t = (key: MessageKey) => translate(locale, key);

  useEffect(() => { document.documentElement.lang = locale; localStorage.setItem(LOCALE_KEY, locale); }, [locale]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyAppearance = () => { document.documentElement.dataset.theme = appearance === "system" ? (media.matches ? "dark" : "light") : appearance; };
    applyAppearance();
    media.addEventListener("change", applyAppearance);
    localStorage.setItem(APPEARANCE_KEY, appearance);
    return () => media.removeEventListener("change", applyAppearance);
  }, [appearance]);
  useEffect(() => { void getAppVersion().then(setAppVersion).catch(() => undefined); }, []);
  useEffect(() => { void getRuntimeSettings().then(setRuntimeSettings).catch(() => undefined); }, []);
  useEffect(() => { void getRecentProjects().then(setRecentProjects).catch(() => undefined); }, []);
  useEffect(() => onBuildProgress((event) => dispatchBuild({ type: "PROGRESS", event })), []);
  useEffect(() => {
    if (!state.project?.dirty || !state.project.document) return;
    const timer = window.setTimeout(() => {
      const draft = writeProjectDraft(state.project!.document!);
      if (draft) setProjectDraft(draft);
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
      dispatch({ type: undo ? "UNDO_PROJECT_EDIT" : "REDO_PROJECT_EDIT" });
    };
    window.addEventListener("keydown", handleProjectHistoryShortcut);
    return () => window.removeEventListener("keydown", handleProjectHistoryShortcut);
  }, []);

  function completeSetup() { localStorage.setItem(SETUP_KEY, "true"); dispatch({ type: "COMPLETE_SETUP" }); }
  function confirmProjectReplacement(): boolean {
    if (!state.project?.dirty) return true;
    if (!window.confirm(t("confirmReplaceDirtyProject"))) return false;
    if (state.project.document) {
      const draft = writeProjectDraft(state.project.document);
      if (draft) setProjectDraft(draft);
    }
    return true;
  }
  function openPreview() {
    if (!confirmProjectReplacement()) return;
    dispatch({ type: "OPEN_PROJECT", project: { id: "design-preview", name: t("project"), selectedMotionId: motions[0].id } });
  }

  async function startNewProject() {
    if (Object.values(buildState).some(build => build.status === 'building')) { setActionFeedback(t('newProjectBuildBusy')); return; }
    if (!confirmProjectReplacement()) return;
    try { if (hasPreviewApi()) await closeLive2DPreview(); } catch { /* Closing an unavailable preview must not trap the current project. */ }
    dispatchBuild({ type: 'RESET' });
    setActionFeedback('');
    setImportError('');
    dispatch({ type: 'CLOSE_PROJECT' });
  }

  async function openProjectDocument(documentId?: string, inputPath?: string) {
    if (!confirmProjectReplacement()) return;
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
      if (relinkError) setActionFeedback(relinkError);
    } catch (cause) {
      setActionFeedback(cause instanceof Error ? cause.message : t("error"));
    } finally {
      setImportBusy(false);
    }
  }

  async function saveProjectDocument(saveAs = false) {
    if (!state.project?.document) {
      setActionFeedback(t("saveRequiresProject"));
      return;
    }
    setActionFeedback("");
    try {
      const result = await saveProject({
        ...(state.project.documentId ? { documentId: state.project.documentId } : {}),
        project: state.project.document,
        ...(saveAs ? { saveAs: true } : {}),
      });
      setRecentProjects(result.recentProjects);
      if (result.cancelled) return;
      dispatch({ type: "PROJECT_SAVED", document: result.project, documentId: result.documentId, fileName: result.fileName });
      clearProjectDraft();
      setProjectDraft(null);
    } catch (cause) {
      setActionFeedback(cause instanceof Error ? cause.message : t("error"));
    }
  }

  async function buildProjectTarget(target: BuildTarget) {
    const document = state.project?.document;
    if (!document) { setActionFeedback(t("buildRequiresProject")); return; }
    setActionFeedback("");
    dispatchBuild({ type: "START", target });
    try {
      const result = await buildProject(document, target);
      const artifact = result.artifacts.find((item) => item.target === target);
      const summary = result.builds[target];
      if (!artifact || !summary) throw new Error(t("artifactMissing"));
      dispatchBuild({ type: "SUCCEED", target, artifact, summary });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("buildFailed");
      if (cause instanceof Error && "code" in cause && String(cause.code) === "BUILD_CANCELLED") dispatchBuild({ type: "CANCEL", target, message });
      else dispatchBuild({ type: "FAIL", target, error: message });
    }
  }

  async function cancelProjectBuild(target: BuildTarget) {
    const buildId = buildState[target].buildId;
    if (!buildId) return;
    try {
      const result = await cancelBuild(buildId);
      if (result.cancelled) dispatchBuild({ type: "CANCEL", target, message: t("buildCancelled") });
    } catch (cause) {
      dispatchBuild({ type: "FAIL", target, error: cause instanceof Error ? cause.message : t("buildFailed") });
    }
  }
  async function importSourceFiles(files: File[], directDrop = false) {
    if (!confirmProjectReplacement()) return;
    setImportBusy(true);
    setImportError("");
    try {
      if (directDrop && files.length !== 1) throw new Error(t("dropOne"));
      const inputPath = sourcePathFromSelection(files, getDesktopFilePath, directDrop);
      if (!inputPath) throw new Error(t("sourcePathUnavailable"));
      const sourceName = files[0]?.webkitRelativePath?.split('/')[0] || files[0]?.name.replace(/\.pck$/i, '') || 'Live2Pet';
      const projectId = projectIdFromSourceName(sourceName);
      const inspection = await inspectSource(inputPath, projectId);
      const document: Live2PetProject = {
        schemaVersion: 2,
        visualSettings: { hiddenElementIds: [] },
        projectId,
        appVersion,
        name: inspection.source.name,
        source: {
          kind: inspection.source.kind,
          name: inspection.source.name,
          fingerprint: inspection.source.fingerprint,
          path: inputPath,
          modelConfig: inspection.source.modelConfig,
        },
        recipes: [],
        targets: {
          clawd: { profile: "clawd", mappings: {}, reactions: {}, options: {} },
          "codex-pet": { profile: "codex-pet", mappings: {}, reactions: {}, options: {} },
        },
      };
      dispatch({
        type: "OPEN_PROJECT",
        project: {
          id: projectId,
          name: inspection.source.name,
          document,
          dirty: true,
          sourcePath: inputPath,
          inspection,
          selectedMotionId: inspection.motions[0]?.id ?? null,
          selectedExpressionId: null,
        },
      });
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : t("error"));
    } finally {
      setImportBusy(false);
    }
  }

  async function relinkCurrentSource(files: File[], directDrop = false) {
    const project = state.project?.document;
    if (!project) return;
    setImportBusy(true);
    setActionFeedback("");
    try {
      if (directDrop && files.length !== 1) throw new Error(t("dropOne"));
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
    } catch (cause) {
      setActionFeedback(cause instanceof Error ? cause.message : t("error"));
    } finally {
      setImportBusy(false);
    }
  }

  async function recoverProjectDraft() {
    if (!projectDraft || !confirmProjectReplacement()) return;
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
      }
    } catch (cause) {
      setActionFeedback(cause instanceof Error ? cause.message : t("error"));
    } finally {
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
      if (!preserveTextEditingHistory(command)) dispatch({ type: command === "undo" ? "UNDO_PROJECT_EDIT" : "REDO_PROJECT_EDIT" });
    }
  }), [state, locale, buildState]);

  const requiredCubism = state.project?.inspection?.model.cubism;
  const runtimeReady = !requiredCubism || Boolean(runtimeSettings?.runtimes.some((runtime) => runtime.available && runtime.cubismGenerations.includes(requiredCubism)));
  const openRuntimeSettings = () => dispatch({ type: "OPEN_SETTINGS", section: "runtimes" });
  const statusBar = <footer className="status-bar">
    <span className="save-status"><i className="status-dot" />{!hasDesktopApi() ? t("notConnected") : state.project?.dirty ? t("unsaved") : state.project?.documentId ? t("saved") : t("noSavedProject")}</span>
    <div className="footer-builds">{(['clawd', 'codex-pet'] as const).filter(target => buildState[target].status !== 'idle').map(target => {
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
  if (state.destination === "settings") return <div className="app-shell settings-shell"><SettingsView locale={locale} section={state.settingsSection} appearance={appearance} onSection={(section) => dispatch({ type: "SELECT_SETTINGS_SECTION", section })} onLocale={(language) => dispatch({ type: "UPDATE_LANGUAGE", language })} onAppearance={(value) => dispatch({ type: "UPDATE_APPEARANCE", appearance: value })} onRuntimeSettingsChange={setRuntimeSettings} onClose={() => dispatch({ type: "CLOSE_SETTINGS" })} />{statusBar}</div>;

  const projectOpen = state.project !== null;
  const sourceReviewRequired = Boolean(state.project?.document?.sourceReview?.required);
  return (
    <div className="app-shell">
      <header className="app-toolbar">
        <div className="toolbar-brand">{projectOpen ? <><span>Live2Pet</span><i /><strong title={state.project?.name}>{state.project?.name}</strong></> : <strong>Live2Pet</strong>}</div>
        {projectOpen ? <nav aria-label="Project"><ButtonGroup>{(["source", "map", "build"] as const).map((destination) => <Button key={destination} isDisabled={sourceReviewRequired && destination !== "source"} variant={state.destination === destination ? "primary" : "ghost"} onPress={() => dispatch({ type: "NAVIGATE", destination })}>{t(destination)}</Button>)}</ButtonGroup></nav> : <span />}
        <div className="toolbar-actions">{!state.project?.inspection && <Chip className="chip" size="sm" variant="soft"><span className="status-dot" />{t("designPreview")}</Chip>}{projectOpen && <Button aria-label={t("newProject")} variant="ghost" isDisabled={Object.values(buildState).some(build => build.status === 'building')} onPress={() => void startNewProject()}><Plus size={17} />{t("newProject")}</Button>}{projectOpen && <Button aria-label={t("saveProject")} variant="ghost" onPress={() => void saveProjectDocument()}><Save size={17} />{t("save")}</Button>}<Button isIconOnly aria-label={t("settings")} variant="ghost" onPress={() => dispatch({ type: "OPEN_SETTINGS" })}><SettingsIcon size={18} /></Button></div>
      </header>
      <div className="app-content">
        {actionFeedback && <div className="action-feedback" role="alert">{actionFeedback}</div>}
        {state.destination === "welcome" && <WelcomeView locale={locale} busy={importBusy} error={importError} recentProjects={recentProjects} draft={projectDraft} onImport={(files, directDrop) => void importSourceFiles(files, directDrop)} onOpenProject={() => void openProjectDocument()} onOpenRecent={(project) => project.available ? void openProjectDocument(project.documentId) : setImportError(t("recentUnavailable"))} onOpenPreview={openPreview} onRecoverDraft={() => void recoverProjectDraft()} onDiscardDraft={discardProjectDraft} />}
        {state.destination === "source" && <SourceView locale={locale} project={state.project?.document ?? null} inspection={state.project?.inspection} inspectionRequired={Boolean(state.project?.document)} runtimeReady={runtimeReady} busy={importBusy} onConfigureRuntime={openRuntimeSettings} onRelink={relinkCurrentSource} onAcknowledgeReview={acknowledgeCurrentSourceReview} onMap={() => dispatch({ type: "NAVIGATE", destination: "map" })} />}
        {state.destination === "map" && state.project && <MapView locale={locale} projectId={state.project.id} projectDocument={state.project.document} inspection={state.project.inspection} runtimeReady={runtimeReady} selectedMotionId={state.project.selectedMotionId} selectedExpressionId={state.project.selectedExpressionId} onConfigureRuntime={openRuntimeSettings} onSelectMotion={(motionId) => dispatch({ type: "SELECT_MOTION", motionId })} onSelectExpression={(expressionId) => dispatch({ type: "SELECT_EXPRESSION", expressionId })} onAssign={(destination) => dispatch({ type: "ASSIGN_SELECTED_RECIPE", destination })} onClear={(destination) => dispatch({ type: "CLEAR_ASSIGNMENT", destination })} onVisualSettings={(settings) => dispatch({ type: "SET_VISUAL_SETTINGS", settings })} />}
        {state.destination === "build" && <BuildView locale={locale} project={state.project?.document ?? null} inspection={state.project?.inspection} runtimeReady={runtimeReady} state={buildState} onName={(name) => dispatch({ type: "RENAME_PROJECT", name })} onPreset={(target, preset) => dispatch({ type: "SET_RENDER_PRESET", target, preset })} onCustomRender={(settings) => dispatch({ type: 'SET_CLAWD_RENDER', settings })} onBuild={(target) => void buildProjectTarget(target)} onCancel={(target) => void cancelProjectBuild(target)} />}
      </div>
      {statusBar}
    </div>
  );
}
