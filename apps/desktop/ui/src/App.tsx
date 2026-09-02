import {
  Button,
  ButtonGroup,
  Card,
  Chip,
  ProgressBar,
} from "@heroui/react";
import {
  Archive,
  Box,
  ChevronRight,
  CircleCheck,
  Database,
  Download,
  FolderOpen,
  Gauge,
  HardDrive,
  Languages,
  Moon,
  PackageCheck,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
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
  clearRuntimeSettings,
  configureRuntimePath,
  configureRuntime,
  getAppVersion,
  getCacheStatus,
  getRuntimeSettings,
  getDesktopFilePath,
  hasDesktopApi,
  hasPreviewApi,
  inspectSource,
  layoutLive2DPreview,
  onLive2DPreviewStatus,
  openLive2DPreview,
  playLive2DPreview,
  controlLive2DPreview,
  setLive2DPreviewExpression,
  PreviewStatus,
  RuntimeSettings,
  SourceInspection,
} from "./app-host";
import {
  appReducer,
  AppSettings,
  initialAppState,
  SettingsSection,
} from "./app-state";
import { Locale, MessageKey, translate } from "./i18n";
import { projectIdFromSourceName, sourcePathFromSelection } from "./source-selection";
import { hasDraggedFiles } from "./file-drop";

const SETUP_KEY = "live2pet.desktop.setup-completed";
const LOCALE_KEY = "live2pet.desktop.locale";
const APPEARANCE_KEY = "live2pet.desktop.appearance";

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

const assignments = [
  ["assignmentIdle", "dot-0"],
  ["assignmentThinking", "dot-1"],
  ["assignmentWorking", "dot-2"],
  ["assignmentAttention", "dot-3"],
  ["assignmentError", "dot-4"],
] as const;

function storedLocale(): Locale {
  return localStorage.getItem(LOCALE_KEY) === "zh-CN" ? "zh-CN" : "en";
}

function storedAppearance(): AppSettings["appearance"] {
  const value = localStorage.getItem(APPEARANCE_KEY);
  return value === "light" || value === "dark" ? value : "system";
}

function BrandMark({ large = false }: { large?: boolean }) {
  return (
    <span className={`brand-mark${large ? " brand-mark-large" : ""}`} aria-hidden="true">
      <i />
      <i />
      <b><em /><em /></b>
      <small />
    </span>
  );
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
    if (event.dataTransfer.files.length !== 1) { setError(t("dropOne")); return; }
    void saveRuntime(event.dataTransfer.files[0]);
  }

  async function removeRuntimes() {
    if (!window.confirm(t("confirmRemoveRuntimes"))) return;
    setBusy(true);
    setError("");
    try {
      const next = await clearRuntimeSettings();
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
          <Button variant="secondary" size="sm" onPress={() => fileInput.current?.click()} isDisabled={busy}>
            <Plus size={15} />{runtimes.length ? t("replaceRuntime") : t("addRuntime")}
          </Button>
          <Button variant="secondary" size="sm" onPress={() => folderInput.current?.click()} isDisabled={busy}>
            <FolderOpen size={15} />{t("addRuntimeFolder")}
          </Button>
        </div>
        {busy && <ProgressBar aria-label={t("loading")} isIndeterminate className="mt-4" />}
        <p className="drop-hint">{t("dropRuntime")}</p>
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
            </div>
          ))}
        </div>
        {error && <p className="inline-error" role="alert">{error}</p>}
        {runtimes.length > 0 && (
          <Button className="danger-link" variant="ghost" size="sm" onPress={removeRuntimes} isDisabled={busy}>
            <Trash2 size={14} />{t("removeAll")}
          </Button>
        )}
      </Card.Content>
    </Card>
  );
}

function SetupView({ locale, onComplete, onRuntimeSettingsChange }: { locale: Locale; onComplete: () => void; onRuntimeSettingsChange: (settings: RuntimeSettings) => void }) {
  const t = (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values);
  return (
    <main className="setup-view">
      <section className="setup-art" aria-hidden="true">
        <i className="orbit orbit-one" /><i className="orbit orbit-two" />
        <BrandMark large />
        <span className="floating-pill pill-top"><WandSparkles size={15} />Live2D</span>
        <span className="floating-pill pill-bottom"><PackageCheck size={15} />{t("petPackage")}</span>
      </section>
      <section className="setup-content">
        <p className="eyebrow"><Sparkles size={13} />{t("setupEyebrow")}</p>
        <h1>{t("setupTitle")}</h1>
        <p className="lead">{t("setupBody")}</p>
        <RuntimePanel locale={locale} onSettingsChange={onRuntimeSettingsChange} />
        <div className="setup-actions">
          <Button variant="ghost" onPress={onComplete}>{t("setupSkip")}</Button>
          <Button variant="primary" onPress={onComplete}>{t("setupContinue")}<ChevronRight size={16} /></Button>
        </div>
      </section>
    </main>
  );
}

function WelcomeView({ locale, busy, error, onImport, onOpenProject }: { locale: Locale; busy: boolean; error: string; onImport: (files: File[], directDrop?: boolean) => void; onOpenProject: () => void }) {
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
            <Button variant="secondary" size="lg" isDisabled><FolderOpen size={18} />{t("openProject")}</Button>
          </div>
          <p className="import-hint">{busy ? t("loading") : t("importHint")}</p>
          {busy && <ProgressBar aria-label={t("loading")} isIndeterminate className="mt-4" />}
          {error && <p className="inline-error" role="alert">{error}</p>}
          <Button className="button--ghost" variant="ghost" onPress={onOpenProject}>{t("sampleProject")}<ChevronRight size={15} /></Button>
        </div>
        <div className="welcome-visual" aria-hidden="true">
          <i className="visual-glow" /><i className="fake-window fake-back" />
          <span className="fake-window fake-front"><i className="fake-list" /><i className="fake-stage"><BrandMark large /></i><i className="fake-map" /></span>
        </div>
      </section>
      <section className="recent-section">
        <p className="eyebrow">{t("recent")}</p>
        <h2>{t("recent")}</h2>
        <div className="empty-state"><Archive size={18} />{t("noRecent")}</div>
      </section>
    </main>
  );
}

function SourceView({ locale, inspection, runtimeReady, onConfigureRuntime, onMap }: { locale: Locale; inspection?: SourceInspection; runtimeReady: boolean; onConfigureRuntime: () => void; onMap: () => void }) {
  const t = (key: MessageKey) => translate(locale, key);
  const facts = inspection
    ? [["sourceModel", inspection.model.modelFile ?? "—"], ["sourceTextures", String(inspection.model.textures.length)], ["sourceMotions", String(inspection.motions.length)], ["sourceExpressions", String(inspection.expressions.length)]]
    : [["sourceModel", "model3.json"], ["sourceTextures", "4"], ["sourceMotions", "5"], ["sourceExpressions", "3"]];
  const summary = inspection
    ? `Cubism ${inspection.model.cubism} · ${inspection.motions.length} ${t("sourceMotions")} · ${inspection.expressions.length} ${t("sourceExpressions")}`
    : t("sourceSummary");
  return (
    <main className="page">
      <PageHeading eyebrow={t("source")} title={t("sourceTitle")} body={t("sourceBody")} />
      <div className="source-grid">
        <Card className="surface-card"><Card.Content><div className="model-placeholder"><BrandMark large /></div><div className="ready-box"><CircleCheck size={20} /><span><strong>{t("sourceReady")}</strong><small>{summary}</small></span></div>{!runtimeReady && <div className="runtime-required"><Gauge size={18} /><span><strong>{t("runtimeRequired")}</strong><small>{t("runtimeRequiredBody")}</small></span><Button size="sm" variant="secondary" onPress={onConfigureRuntime}>{t("configureRuntime")}</Button></div>}<Button variant="primary" onPress={onMap}>{t("map")}<ChevronRight size={16} /></Button></Card.Content></Card>
        <Card className="surface-card source-facts"><Card.Content>{facts.map(([key, value]) => <div className="fact" key={key}><span>{t(key as MessageKey)}</span><strong title={value}>{value}</strong></div>)}</Card.Content></Card>
      </div>
    </main>
  );
}

function PanelHeading({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return <header className="panel-heading"><span className="square-icon">{icon}</span><div><h2>{title}</h2><p>{body}</p></div></header>;
}

function MapView({ locale, projectId, inspection, runtimeReady, selectedMotionId, selectedExpressionId, onConfigureRuntime, onSelectMotion, onSelectExpression }: { locale: Locale; projectId: string; inspection?: SourceInspection; runtimeReady: boolean; selectedMotionId: string | null; selectedExpressionId: string | null; onConfigureRuntime: () => void; onSelectMotion: (id: string) => void; onSelectExpression: (id: string | null) => void }) {
  const t = (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values);
  const previewSurface = useRef<HTMLDivElement>(null);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus | null>(null);
  const [previewRetry, setPreviewRetry] = useState(0);
  const displayedMotions = inspection?.motions.length
    ? inspection.motions.map((motion) => ({ id: motion.id, name: motion.name, seconds: motion.duration?.toFixed(1) ?? "—", tint: "" }))
    : motions.map((motion) => ({ ...motion, name: t(motion.nameKey) }));
  const displayedExpressions = inspection?.expressions.length
    ? inspection.expressions.map((expression) => ({ id: expression.id, name: expression.name }))
    : expressions.map((expression) => ({ ...expression, name: t(expression.nameKey) }));
  const selected = displayedMotions.find((motion) => motion.id === selectedMotionId) ?? displayedMotions[0];
  const selectedExpression = displayedExpressions.find((expression) => expression.id === selectedExpressionId);
  const selectedName = selected?.name ?? "—";
  const nativePreview = Boolean(inspection && runtimeReady && hasPreviewApi());

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
          : await openLive2DPreview({ projectId, sourceFingerprint: inspection.source.fingerprint, bounds });
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
    if (previewStatus?.state === 'ready' && selectedMotionId) void playLive2DPreview({ motionId: selectedMotionId, loop: true, speed: 1 }).catch(() => undefined);
  }, [previewStatus?.state, selectedMotionId]);

  useEffect(() => {
    if (previewStatus?.state === 'ready') void setLive2DPreviewExpression(selectedExpressionId).catch(() => undefined);
  }, [previewStatus?.state, selectedExpressionId]);

  const togglePlayback = () => {
    if (previewStatus?.state !== 'ready') return;
    void controlLive2DPreview(previewStatus.playback?.playing ? 'pause' : 'resume').then(setPreviewStatus).catch(() => undefined);
  };
  return (
    <main className="map-workspace">
      <section className="workspace-panel">
        <PanelHeading icon={<SlidersHorizontal size={16} />} title={t("motions")} body={t("motionsHint")} />
        <label className="search-field"><Search size={14} /><input aria-label={t("searchMotions")} placeholder={t("search")} /></label>
        <div className="motion-list">
          {displayedMotions.map((motion) => (
            <Button key={motion.id} variant={motion.id === selected?.id ? "secondary" : "ghost"} className={`motion-item ${motion.tint}`} onPress={() => onSelectMotion(motion.id)}>
              <span className="motion-icon"><Play size={15} /></span><span className="grow-copy"><strong>{motion.name}</strong><small>{t("motionDuration", { value: motion.seconds })}</small></span>{motion.id === selected?.id && <small>{t("selected")}</small>}
            </Button>
          ))}
          <p className="library-subheading">{t("expressions")}</p>
          <div className="expression-grid">
            <Button size="sm" variant={selectedExpressionId === null ? "secondary" : "ghost"} onPress={() => onSelectExpression(null)}>{t("baseExpression")}</Button>
            {displayedExpressions.map((expression) => <Button key={expression.id} size="sm" variant={expression.id === selectedExpression?.id ? "secondary" : "ghost"} onPress={() => onSelectExpression(expression.id)}>{expression.name}</Button>)}
          </div>
        </div>
      </section>
      <section className="workspace-panel">
        <PanelHeading icon={<Sparkles size={16} />} title={t("preview")} body={t("previewHint")} />
        <div className="preview-caption"><Chip variant="soft">{selectedName} · {selectedExpression?.name ?? t("baseExpression")}</Chip></div>
        <div className="preview-stage"><i className="stage-grid" /><i className="stage-glow" />{!runtimeReady ? <div className="preview-runtime-required"><Gauge size={28} /><strong>{t("runtimeRequired")}</strong><p>{t("runtimeRequiredBody")}</p><Button size="sm" variant="primary" onPress={onConfigureRuntime}>{t("configureRuntime")}</Button></div> : nativePreview ? <><div ref={previewSurface} className="preview-native-surface" />{previewStatus?.state === 'opening' && <div className="preview-message">{t('previewLoading')}</div>}{previewStatus?.state === 'failed' && <div className="preview-runtime-required"><strong>{t('previewFailed')}</strong><p>{previewStatus.error?.message}</p><Button size="sm" variant="primary" onPress={() => setPreviewRetry((value) => value + 1)}>{t('retry')}</Button></div>}</> : <div className="character"><BrandMark large /><i /></div>}</div>
        <div className="playback"><Button isIconOnly aria-label={previewStatus?.playback?.playing ? t('pause') : t('play')} variant="primary" size="sm" isDisabled={previewStatus?.state !== 'ready'} onPress={togglePlayback}>{previewStatus?.playback?.playing ? <Pause size={15} /> : <Play size={15} />}</Button><Button isIconOnly aria-label={t('restart')} variant="ghost" size="sm" isDisabled={previewStatus?.state !== 'ready'} onPress={() => void controlLive2DPreview('restart').then(setPreviewStatus).catch(() => undefined)}><RotateCcw size={15} /></Button><span className="timeline"><i /></span><small>{previewStatus?.state === 'ready' ? t('previewReady') : t('previewWaiting')}</small></div>
      </section>
      <section className="workspace-panel assignment-panel">
        <PanelHeading icon={<WandSparkles size={16} />} title={t("assignment")} body={t("assignmentHint")} />
        <div className="selected-card"><span className="motion-icon"><Play size={15} /></span><span className="grow-copy"><small>{t("selected")}</small><strong>{selectedName}</strong></span></div>
        <div className="assignment-list">{assignments.map(([key, tint], index) => <div className="assignment-row" key={key}><i className={`behavior-dot ${tint}`} /><span className="grow-copy"><strong>{t(key)}</strong><small>{index < 2 ? selectedName : t("assignmentEmpty")}</small></span></div>)}</div>
        <Button className="assign-button" variant="primary" isDisabled>{t("assign")}</Button>
      </section>
    </main>
  );
}

function BuildView({ locale }: { locale: Locale }) {
  const t = (key: MessageKey) => translate(locale, key);
  return <main className="page"><PageHeading eyebrow={t("build")} title={t("buildTitle")} body={t("buildBody")} /><div className="build-grid">{(["clawdPackage", "codexPackage"] as const).map((target) => <Card className="surface-card build-card" key={target}><Card.Content><div className="build-top"><span className="large-icon"><PackageCheck size={20} /></span><Chip variant="soft">{t("designPreview")}</Chip></div><h2>{t(target)}</h2><p>{t("buildSummaryBody")}</p><Button variant="primary" isDisabled><Download size={16} />{t("buildPackage")}</Button></Card.Content></Card>)}</div></main>;
}

function SettingsView({ locale, section, appearance, onSection, onLocale, onAppearance, onRuntimeSettingsChange, onClose }: { locale: Locale; section: SettingsSection; appearance: AppSettings["appearance"]; onSection: (section: SettingsSection) => void; onLocale: (locale: Locale) => void; onAppearance: (appearance: AppSettings["appearance"]) => void; onRuntimeSettingsChange: (settings: RuntimeSettings) => void; onClose: () => void }) {
  const t = (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values);
  const [cache, setCache] = useState({ byteLength: 0, entryCount: 0, maxBytes: 0 });
  const nav: Array<[SettingsSection, MessageKey, ReactNode]> = [["general", "general", <SlidersHorizontal size={16} />], ["runtimes", "runtimes", <Gauge size={16} />], ["targets", "targets", <PackageCheck size={16} />], ["storage", "storage", <Database size={16} />]];
  useEffect(() => { if (section === "storage") void getCacheStatus().then(setCache); }, [section]);
  async function clearBuildCache() { if (!window.confirm(t("confirmClearCache"))) return; await clearCache(); setCache(await getCacheStatus()); }
  return (
    <main className="settings-view">
      <aside className="settings-sidebar">
        <Button variant="ghost" size="sm" onPress={onClose}><X size={16} />{t("close")}</Button>
        <div className="settings-title"><p className="eyebrow"><SettingsIcon size={13} />Live2Pet</p><h1>{t("settingsTitle")}</h1><p>{t("settingsBody")}</p></div>
        <nav aria-label={t("settings")}>{nav.map(([id, key, icon]) => <Button key={id} className="settings-nav" variant={section === id ? "secondary" : "ghost"} onPress={() => onSection(id)}>{icon}{t(key)}<ChevronRight size={14} /></Button>)}</nav>
      </aside>
      <section className="settings-content">
        {section === "general" && <div className="settings-section"><PageHeading eyebrow={t("settings")} title={t("general")} body={t("settingsBody")} /><Card className="surface-card"><Card.Content><div className="setting-row"><span className="large-icon"><Languages size={19} /></span><span className="grow-copy"><strong>{t("language")}</strong></span><ButtonGroup><Button variant={locale === "en" ? "primary" : "secondary"} onPress={() => onLocale("en")}>English</Button><Button variant={locale === "zh-CN" ? "primary" : "secondary"} onPress={() => onLocale("zh-CN")}>简体中文</Button></ButtonGroup></div></Card.Content></Card><Card className="surface-card"><Card.Content><div className="setting-row"><span className="large-icon">{appearance === "dark" ? <Moon size={19} /> : <Sun size={19} />}</span><span className="grow-copy"><strong>{t("appearance")}</strong></span><ButtonGroup>{(["system", "light", "dark"] as const).map((item) => <Button key={item} variant={appearance === item ? "primary" : "secondary"} onPress={() => onAppearance(item)}>{t(item)}</Button>)}</ButtonGroup></div></Card.Content></Card></div>}
        {section === "runtimes" && <div className="settings-section"><PageHeading eyebrow={t("settings")} title={t("runtimes")} body={t("runtimeBody")} /><RuntimePanel locale={locale} compact onSettingsChange={onRuntimeSettingsChange} /></div>}
        {section === "targets" && <div className="settings-section"><PageHeading eyebrow={t("settings")} title={t("targets")} body={t("targetBody")} /><Card className="surface-card"><Card.Content>{["Clawd", "hatch-pet"].map((target) => <div className="runtime-item" key={target}><span className="large-icon"><PackageCheck size={19} /></span><span className="grow-copy"><strong>{target}</strong><small>{t("askEveryTime")}</small></span><Chip variant="soft">{t("ready")}</Chip></div>)}</Card.Content></Card></div>}
        {section === "storage" && <div className="settings-section"><PageHeading eyebrow={t("settings")} title={t("storage")} body={t("storageBody")} /><Card className="surface-card"><Card.Content><div className="section-heading-row"><div><p className="eyebrow"><Database size={13} />{t("storageTitle")}</p><h2>{cache.entryCount ? t("cacheEntries", { count: cache.entryCount, size: `${Math.round(cache.byteLength / 1024 / 1024)} MiB` }) : t("cacheEmpty")}</h2></div><Button variant="secondary" onPress={clearBuildCache} isDisabled={!cache.entryCount}><Trash2 size={15} />{t("clearCache")}</Button></div></Card.Content></Card></div>}
      </section>
    </main>
  );
}

export function App() {
  const [state, dispatch] = useReducer(appReducer, undefined, () => {
    const initial = initialAppState({ setupCompleted: localStorage.getItem(SETUP_KEY) === "true" });
    return { ...initial, settings: { ...initial.settings, language: storedLocale(), appearance: storedAppearance() } };
  });
  const [appVersion, setAppVersion] = useState("0.1.0");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings | null>(null);
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

  function completeSetup() { localStorage.setItem(SETUP_KEY, "true"); dispatch({ type: "COMPLETE_SETUP" }); }
  function openPreview() { dispatch({ type: "OPEN_PROJECT", project: { id: "design-preview", name: t("project"), selectedMotionId: motions[0].id } }); }
  async function importSourceFiles(files: File[], directDrop = false) {
    setImportBusy(true);
    setImportError("");
    try {
      if (directDrop && files.length !== 1) throw new Error(t("dropOne"));
      const inputPath = sourcePathFromSelection(files, getDesktopFilePath, directDrop);
      if (!inputPath) throw new Error(t("sourcePathUnavailable"));
      const sourceName = files[0]?.webkitRelativePath?.split('/')[0] || files[0]?.name.replace(/\.pck$/i, '') || 'Live2Pet';
      const projectId = projectIdFromSourceName(sourceName);
      const inspection = await inspectSource(inputPath, projectId);
      dispatch({
        type: "OPEN_PROJECT",
        project: {
          id: projectId,
          name: inspection.source.name,
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

  const requiredCubism = state.project?.inspection?.model.cubism;
  const runtimeReady = !requiredCubism || Boolean(runtimeSettings?.runtimes.some((runtime) => runtime.available && runtime.cubismGenerations.includes(requiredCubism)));
  const openRuntimeSettings = () => dispatch({ type: "OPEN_SETTINGS", section: "runtimes" });

  if (state.destination === "setup") return <SetupView locale={locale} onComplete={completeSetup} onRuntimeSettingsChange={setRuntimeSettings} />;
  if (state.destination === "settings") return <SettingsView locale={locale} section={state.settingsSection} appearance={appearance} onSection={(section) => dispatch({ type: "SELECT_SETTINGS_SECTION", section })} onLocale={(language) => dispatch({ type: "UPDATE_LANGUAGE", language })} onAppearance={(value) => dispatch({ type: "UPDATE_APPEARANCE", appearance: value })} onRuntimeSettingsChange={setRuntimeSettings} onClose={() => dispatch({ type: "CLOSE_SETTINGS" })} />;

  const projectOpen = state.project !== null;
  return (
    <div className="app-shell">
      <header className="app-toolbar">
        <div className="toolbar-brand"><BrandMark /><strong>Live2Pet</strong>{projectOpen && <><i /><span>{state.project?.name}</span></>}</div>
        {projectOpen ? <nav aria-label="Project"><ButtonGroup>{(["source", "map", "build"] as const).map((destination) => <Button key={destination} variant={state.destination === destination ? "primary" : "ghost"} onPress={() => dispatch({ type: "NAVIGATE", destination })}>{t(destination)}</Button>)}</ButtonGroup></nav> : <span />}
        <div className="toolbar-actions"><Chip className="chip" size="sm" variant="soft"><span className="status-dot" />{state.project?.inspection ? t("localProject") : t("designPreview")}</Chip><Button isIconOnly aria-label={t("settings")} variant="ghost" onPress={() => dispatch({ type: "OPEN_SETTINGS" })}><SettingsIcon size={18} /></Button></div>
      </header>
      <div className="app-content">
        {state.destination === "welcome" && <WelcomeView locale={locale} busy={importBusy} error={importError} onImport={(files, directDrop) => void importSourceFiles(files, directDrop)} onOpenProject={openPreview} />}
        {state.destination === "source" && <SourceView locale={locale} inspection={state.project?.inspection} runtimeReady={runtimeReady} onConfigureRuntime={openRuntimeSettings} onMap={() => dispatch({ type: "NAVIGATE", destination: "map" })} />}
        {state.destination === "map" && state.project && <MapView locale={locale} projectId={state.project.id} inspection={state.project.inspection} runtimeReady={runtimeReady} selectedMotionId={state.project.selectedMotionId} selectedExpressionId={state.project.selectedExpressionId} onConfigureRuntime={openRuntimeSettings} onSelectMotion={(motionId) => dispatch({ type: "SELECT_MOTION", motionId })} onSelectExpression={(expressionId) => dispatch({ type: "SELECT_EXPRESSION", expressionId })} />}
        {state.destination === "build" && <BuildView locale={locale} />}
      </div>
      <footer className="status-bar"><span><i className="status-dot" />{hasDesktopApi() ? t("saved") : t("notConnected")}</span><span>Live2Pet {appVersion}</span></footer>
    </div>
  );
}
