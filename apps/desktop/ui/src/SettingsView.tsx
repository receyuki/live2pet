import { Button, ButtonGroup, Card, Chip, Input, ProgressBar } from "@heroui/react";
import {
  Box,
  ChevronRight,
  CircleHelp,
  Database,
  ExternalLink,
  FolderOpen,
  Gauge,
  GitBranch,
  HardDrive,
  Languages,
  Moon,
  PackageCheck,
  Plus,
  RefreshCcw,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import { ChangeEvent, DragEvent, ReactNode, useEffect, useRef, useState } from "react";
import {
  clearCache,
  clearRuntimeSettings,
  configureRuntimePath,
  configureRuntime,
  getCacheStatus,
  getRuntimeSettings,
  getSourceLibraryCacheStatus,
  configureSourceLibraryCache,
  clearSourceLibraryCache,
  installSpinePack,
  removeSpinePack,
  getDesktopFilePath,
  hasDesktopApi,
  RuntimeSettings,
  SpinePackStatus,
  UpdateStatus,
} from "./app-host";
import { AppSettings, SettingsSection } from "./app-state";
import { Locale, MessageKey, translate } from "./i18n";
import runtimeHelpLinks from "../../runtime-help-links.json";
import { sourcePathFromSelection } from "./source-selection";
import { hasDraggedFiles, isProjectFile } from "./file-drop";
import { TargetSettings } from "./TargetSettings";
import { OutputSettings } from './OutputSettings';

function PageHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <header className="page-heading">
      <p className="eyebrow"><Sparkles size={13} />{eyebrow}</p>
      <h1>{title}</h1>
      <p>{body}</p>
    </header>
  );
}

function RuntimePanel({ locale, compact = false, spinePack = null, onSettingsChange, onSpinePackChange }: { locale: Locale; compact?: boolean; spinePack?: SpinePackStatus | null; onSettingsChange?: (settings: RuntimeSettings) => void; onSpinePackChange?: (status: SpinePackStatus) => void }) {
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

  async function changeSpinePack(runtimeLine: string, action: 'install' | 'remove') {
    if (action === 'remove' && !window.confirm(t('confirmRemoveSpinePack'))) return;
    setBusy(true);
    setError('');
    try {
      const next = action === 'install' ? await installSpinePack(runtimeLine) : await removeSpinePack(runtimeLine);
      onSpinePackChange?.(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('error'));
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
        {compact && <>{(spinePack?.packs ?? []).map((pack) => <div className="runtime-item spine-pack-item" key={pack.runtimeLine}>
          <span className="large-icon"><WandSparkles size={19} /></span>
          <span className="grow-copy"><strong>{t('spinePackLine', { value: pack.runtimeLine })}</strong><small>{t('spinePackVersion', { value: pack.version })}</small></span>
          <Chip color={pack.installed ? 'success' : 'default'} size="sm" variant="soft">{t(pack.installed ? 'runtimeAvailable' : 'runtimeMissing')}</Chip>
          <Button variant="secondary" size="sm" isDisabled={busy || !pack.downloadable} onPress={() => void changeSpinePack(pack.runtimeLine, pack.installed ? 'remove' : 'install')}>{t(pack.installed ? 'removeSpinePack' : 'installSpinePack')}</Button>
        </div>)}
        <p className="drop-hint">{t('spinePackHint')}</p></>}
      </Card.Content>
    </Card>
  );
}

export function SetupView({ locale, returning, onComplete, onRuntimeSettingsChange }: { locale: Locale; returning: boolean; onComplete: () => void; onRuntimeSettingsChange: (settings: RuntimeSettings) => void }) {
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

export function SettingsView({ locale, section, appearance, spinePack, appVersion, updateStatus, updateError, updateBusy, automaticUpdateChecks, onCheckForUpdates, onOpenRelease, onAutomaticUpdateChecks, onReplayTutorial, onSection, onLocale, onAppearance, onRuntimeSettingsChange, onSpinePackChange, onClose }: { locale: Locale; section: SettingsSection; appearance: AppSettings["appearance"]; spinePack: SpinePackStatus | null; appVersion: string; updateStatus: UpdateStatus | null; updateError: string; updateBusy: boolean; automaticUpdateChecks: boolean; onCheckForUpdates: () => void; onOpenRelease: () => void; onAutomaticUpdateChecks: (enabled: boolean) => void; onReplayTutorial: () => void; onSection: (section: SettingsSection) => void; onLocale: (locale: Locale) => void; onAppearance: (appearance: AppSettings["appearance"]) => void; onRuntimeSettingsChange: (settings: RuntimeSettings) => void; onSpinePackChange: (status: SpinePackStatus) => void; onClose: () => void }) {
  const t = (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values);
  const [cache, setCache] = useState({ byteLength: 0, entryCount: 0, maxBytes: 0 });
  const [libraryCache, setLibraryCache] = useState({ schemaVersion: 1 as const, byteLength: 0, entryCount: 0, maxBytes: 1024 ** 3 });
  const [libraryCacheGiB, setLibraryCacheGiB] = useState("1");
  const [storageError, setStorageError] = useState("");
  const nav: Array<[SettingsSection, MessageKey, ReactNode]> = [["general", "general", <SlidersHorizontal size={16} />], ["runtimes", "runtimes", <Gauge size={16} />], ["targets", "targetsNav", <PackageCheck size={16} />], ["storage", "storage", <Database size={16} />]];
  useEffect(() => { if (section === "storage") { void getCacheStatus().then(setCache); void getSourceLibraryCacheStatus().then((next) => { setLibraryCache(next); setLibraryCacheGiB(String(Number((next.maxBytes / 1024 ** 3).toFixed(2)))); }); } }, [section]);
  async function clearBuildCache() { if (!window.confirm(t("confirmClearCache"))) return; await clearCache(); setCache(await getCacheStatus()); }
  async function saveLibraryCacheLimit() {
    setStorageError("");
    try {
      const next = await configureSourceLibraryCache(Math.round(Number(libraryCacheGiB) * 1024 ** 3));
      setLibraryCache(next);
      setLibraryCacheGiB(String(Number((next.maxBytes / 1024 ** 3).toFixed(2))));
    } catch (cause) { setStorageError(cause instanceof Error ? cause.message : t("error")); }
  }
  async function clearLibraryCache() {
    if (!window.confirm(t("confirmClearLibraryCache"))) return;
    setStorageError("");
    try { setLibraryCache(await clearSourceLibraryCache()); }
    catch (cause) { setStorageError(cause instanceof Error ? cause.message : t("error")); }
  }
  const updateMessage = updateBusy
    ? t('checkingForUpdates')
    : updateError || (updateStatus?.state === 'available'
      ? t('updateAvailable', { version: updateStatus.latestVersion ?? '' })
      : updateStatus?.state === 'up-to-date'
        ? t('upToDate')
        : updateStatus?.state === 'no-release'
          ? t('noReleasePublished')
          : t('updateNotChecked'));
  return (
    <>
    <header className="app-toolbar settings-toolbar">
      <div className="toolbar-brand"><span>Live2Pet</span><i /><h1 className="toolbar-title">{t("settingsTitle")}</h1></div>
      <div className="toolbar-actions"><Button variant="secondary" size="sm" onPress={onClose}><X size={16} />{t("close")}</Button></div>
    </header>
    <main className="settings-view">
      <aside className="settings-sidebar">
        <nav aria-label={t("settings")}>{nav.map(([id, key, icon]) => <Button key={id} className="settings-nav" variant={section === id ? "secondary" : "ghost"} onPress={() => onSection(id)}>{icon}<span>{t(key)}</span><ChevronRight size={14} /></Button>)}</nav>
      </aside>
      <section className="settings-content">
        {section === "general" && <div className="settings-section">
          <PageHeading eyebrow={t("settings")} title={t("general")} body={t("settingsBody")} />
          <Card className="surface-card"><Card.Content><div className="setting-row"><span className="large-icon"><Languages size={19} /></span><span className="grow-copy"><strong>{t("language")}</strong></span><ButtonGroup><Button variant={locale === "en" ? "primary" : "secondary"} onPress={() => onLocale("en")}>English</Button><Button variant={locale === "zh-CN" ? "primary" : "secondary"} onPress={() => onLocale("zh-CN")}>简体中文</Button></ButtonGroup></div></Card.Content></Card>
          <Card className="surface-card"><Card.Content><div className="setting-row"><span className="large-icon">{appearance === "dark" ? <Moon size={19} /> : <Sun size={19} />}</span><span className="grow-copy"><strong>{t("appearance")}</strong></span><ButtonGroup>{(["system", "light", "dark"] as const).map((item) => <Button key={item} variant={appearance === item ? "primary" : "secondary"} onPress={() => onAppearance(item)}>{t(item)}</Button>)}</ButtonGroup></div></Card.Content></Card>
          <Card className="surface-card"><Card.Content><div className="setting-row"><span className="large-icon"><CircleHelp size={19} /></span><span className="grow-copy"><strong>{t("tutorial")}</strong><small>{t("tutorialHint")}</small></span><Button variant="secondary" onPress={onReplayTutorial}>{t("replayTutorial")}</Button></div></Card.Content></Card>
          <Card className="surface-card"><Card.Content><div className="setting-row update-setting-row"><span className="large-icon"><RefreshCcw size={19} /></span><span className="grow-copy"><strong>{t('updates')} · {appVersion}</strong><small className={updateError ? 'inline-error' : ''}>{updateMessage}</small></span><div className="update-setting-actions"><Button size="sm" variant={automaticUpdateChecks ? "primary" : "secondary"} onPress={() => onAutomaticUpdateChecks(!automaticUpdateChecks)}>{t(automaticUpdateChecks ? 'automaticUpdateChecksOn' : 'automaticUpdateChecksOff')}</Button><Button size="sm" variant="secondary" isDisabled={updateBusy || !hasDesktopApi()} onPress={onCheckForUpdates}>{t('checkNow')}</Button>{updateStatus?.state === 'available' && <Button size="sm" variant="primary" onPress={onOpenRelease}><ExternalLink size={14} />{t('viewRelease')}</Button>}</div></div></Card.Content></Card>
        </div>}
        {section === "runtimes" && <div className="settings-section"><PageHeading eyebrow={t("settings")} title={t("runtimes")} body={t("runtimeBody")} /><RuntimePanel locale={locale} compact spinePack={spinePack} onSettingsChange={onRuntimeSettingsChange} onSpinePackChange={onSpinePackChange} /></div>}
        {section === "targets" && <div className="settings-section"><PageHeading eyebrow={t("settings")} title={t("targets")} body={t("targetBody")} /><TargetSettings locale={locale} /></div>}
        {section === "storage" && <div className="settings-section"><PageHeading eyebrow={t("settings")} title={t("storage")} body={t("storageBody")} /><OutputSettings locale={locale} /><Card className="surface-card"><Card.Content><div className="section-heading-row"><div><p className="eyebrow"><Database size={13} />{t("storageTitle")}</p><h2>{cache.entryCount ? t("cacheEntries", { count: cache.entryCount, size: `${Math.round(cache.byteLength / 1024 / 1024)} MiB` }) : t("cacheEmpty")}</h2></div><Button variant="secondary" onPress={clearBuildCache} isDisabled={!cache.entryCount}><Trash2 size={15} />{t("clearCache")}</Button></div></Card.Content></Card><Card className="surface-card"><Card.Content><div className="section-heading-row"><div><p className="eyebrow"><GitBranch size={13} />{t("githubCacheTitle")}</p><h2>{t("githubCacheUsage", { count: libraryCache.entryCount, size: `${Math.round(libraryCache.byteLength / 1024 / 1024)} MiB` })}</h2><p>{t("githubCacheHint")}</p></div><Button variant="secondary" onPress={() => void clearLibraryCache()} isDisabled={!libraryCache.entryCount}><Trash2 size={15} />{t("clearCache")}</Button></div><div className="cache-limit-row"><Input type="number" min="0.25" max="20" step="0.25" aria-label={t("githubCacheLimit")} value={libraryCacheGiB} onChange={(event) => setLibraryCacheGiB(event.target.value)} /><span>GiB</span><Button variant="primary" onPress={() => void saveLibraryCacheLimit()}>{t("saveCacheLimit")}</Button></div>{storageError && <p className="inline-error" role="alert">{storageError}</p>}</Card.Content></Card></div>}
      </section>
    </main>
    </>
  );
}
