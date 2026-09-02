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
  Globe2,
  HardDrive,
  Languages,
  Moon,
  PackageCheck,
  Play,
  Plus,
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
import { ChangeEvent, ReactNode, useEffect, useReducer, useState } from "react";
import {
  clearCache,
  clearRuntimeSettings,
  configureRuntime,
  getAppVersion,
  getCacheStatus,
  getRuntimeSettings,
  hasDesktopApi,
  RuntimeSettings,
} from "./app-host";
import {
  appReducer,
  AppSettings,
  initialAppState,
  SettingsSection,
} from "./app-state";
import { Locale, MessageKey, translate } from "./i18n";

const SETUP_KEY = "live2pet.desktop.setup-completed";
const LOCALE_KEY = "live2pet.desktop.locale";
const APPEARANCE_KEY = "live2pet.desktop.appearance";

const motions = [
  { id: "main-1", name: "Main 1", detail: "Motion · 4.2s", tint: "" },
  { id: "main-2", name: "Main 2", detail: "Motion · 3.6s", tint: "tint-blue" },
  { id: "touch-head", name: "Touch Head", detail: "Motion · 2.1s", tint: "tint-rose" },
  { id: "attention", name: "Attention", detail: "Motion · 1.8s", tint: "tint-amber" },
  { id: "error", name: "Error", detail: "Motion · 2.4s", tint: "tint-cyan" },
] as const;

const assignments = ["idle", "thinking", "working", "attention", "error"];

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

function RuntimePanel({ locale, compact = false }: { locale: Locale; compact?: boolean }) {
  const t = (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values);
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void getRuntimeSettings().then(setSettings).catch((cause: Error) => setError(cause.message));
  }, []);

  async function addRuntime(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      setSettings(await configureRuntime(file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  async function removeRuntimes() {
    setBusy(true);
    setError("");
    try {
      setSettings(await clearRuntimeSettings());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  const runtimes = settings?.runtimes ?? [];
  return (
    <Card className="surface-card">
      <Card.Content>
        <div className="section-heading-row">
          <div>
            <p className="eyebrow"><Gauge size={13} />{t("setupRuntime")}</p>
            <h2>{compact ? t("runtimeTitle") : t("setupRuntime")}</h2>
            <p>{t("runtimeBody")}</p>
          </div>
          <label className="upload-control">
            <input className="visually-hidden" type="file" onChange={addRuntime} disabled={busy} />
            <span aria-disabled={busy}>
              <Plus size={15} />{runtimes.length ? t("replaceRuntime") : t("addRuntime")}
            </span>
          </label>
        </div>
        {busy && <ProgressBar aria-label={t("loading")} isIndeterminate className="mt-4" />}
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
        {error && <p className="inline-error">{error}</p>}
        {runtimes.length > 0 && (
          <Button className="danger-link" variant="ghost" size="sm" onPress={removeRuntimes} isDisabled={busy}>
            <Trash2 size={14} />{t("removeAll")}
          </Button>
        )}
      </Card.Content>
    </Card>
  );
}

function SetupView({ locale, onComplete }: { locale: Locale; onComplete: () => void }) {
  const t = (key: MessageKey) => translate(locale, key);
  return (
    <main className="setup-view">
      <section className="setup-art" aria-hidden="true">
        <i className="orbit orbit-one" /><i className="orbit orbit-two" />
        <BrandMark large />
        <span className="floating-pill pill-top"><WandSparkles size={15} />Live2D</span>
        <span className="floating-pill pill-bottom"><PackageCheck size={15} />Pet theme</span>
      </section>
      <section className="setup-content">
        <p className="eyebrow"><Sparkles size={13} />{t("setupEyebrow")}</p>
        <h1>{t("setupTitle")}</h1>
        <p className="lead">{t("setupBody")}</p>
        <RuntimePanel locale={locale} />
        <div className="setup-actions">
          <Button variant="ghost" onPress={onComplete}>{t("setupSkip")}</Button>
          <Button variant="primary" onPress={onComplete}>{t("setupContinue")}<ChevronRight size={16} /></Button>
        </div>
      </section>
    </main>
  );
}

function WelcomeView({ locale, onOpenProject }: { locale: Locale; onOpenProject: () => void }) {
  const t = (key: MessageKey) => translate(locale, key);
  return (
    <main className="welcome-view">
      <section className="welcome-hero">
        <div className="welcome-copy">
          <p className="eyebrow"><Sparkles size={13} />{t("welcomeEyebrow")}</p>
          <h1>{t("welcomeTitle")}</h1>
          <p>{t("welcomeBody")}</p>
          <div className="welcome-actions">
            <Button variant="primary" size="lg"><Upload size={18} />{t("importSource")}</Button>
            <Button variant="secondary" size="lg"><FolderOpen size={18} />{t("openProject")}</Button>
          </div>
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

function SourceView({ locale, onMap }: { locale: Locale; onMap: () => void }) {
  const t = (key: MessageKey) => translate(locale, key);
  return (
    <main className="page">
      <PageHeading eyebrow={t("source")} title={t("sourceTitle")} body={t("sourceBody")} />
      <div className="source-grid">
        <Card className="surface-card"><Card.Content><div className="model-placeholder"><BrandMark large /></div><div className="ready-box"><CircleCheck size={20} /><span><strong>{t("sourceReady")}</strong><small>Cubism 4 · 5 motions · 3 expressions</small></span></div><Button variant="primary" onPress={onMap}>{t("map")}<ChevronRight size={16} /></Button></Card.Content></Card>
        <Card className="surface-card source-facts"><Card.Content>{[["Model", "model3.json"], ["Textures", "4"], ["Motions", "5"], ["Expressions", "3"]].map(([label, value]) => <div className="fact" key={label}><span>{label}</span><strong>{value}</strong></div>)}</Card.Content></Card>
      </div>
    </main>
  );
}

function PanelHeading({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return <header className="panel-heading"><span className="square-icon">{icon}</span><div><h2>{title}</h2><p>{body}</p></div></header>;
}

function MapView({ locale, selectedMotionId, onSelect }: { locale: Locale; selectedMotionId: string | null; onSelect: (id: string) => void }) {
  const t = (key: MessageKey) => translate(locale, key);
  const selected = motions.find((motion) => motion.id === selectedMotionId) ?? motions[0];
  return (
    <main className="map-workspace">
      <section className="workspace-panel">
        <PanelHeading icon={<SlidersHorizontal size={16} />} title={t("motions")} body={t("motionsHint")} />
        <label className="search-field"><Search size={14} /><input aria-label="Search motions" placeholder="Search" /></label>
        <div className="motion-list">
          {motions.map((motion) => (
            <Button key={motion.id} variant={motion.id === selected.id ? "secondary" : "ghost"} className={`motion-item ${motion.tint}`} onPress={() => onSelect(motion.id)}>
              <span className="motion-icon"><Play size={15} /></span><span className="grow-copy"><strong>{motion.name}</strong><small>{motion.detail}</small></span>{motion.id === selected.id && <small>{t("selected")}</small>}
            </Button>
          ))}
        </div>
      </section>
      <section className="workspace-panel">
        <PanelHeading icon={<Sparkles size={16} />} title={t("preview")} body={t("previewHint")} />
        <div className="preview-stage"><i className="stage-grid" /><i className="stage-glow" /><Chip className="stage-chip" variant="soft">{selected.name}</Chip><div className="character"><BrandMark large /><i /></div></div>
        <div className="playback"><Button isIconOnly aria-label={t("play")} variant="primary" size="sm"><Play size={15} /></Button><span className="timeline"><i /></span><small>00:01 / 00:04</small></div>
      </section>
      <section className="workspace-panel assignment-panel">
        <PanelHeading icon={<WandSparkles size={16} />} title={t("assignment")} body={t("assignmentHint")} />
        <div className="selected-card"><span className="motion-icon"><Play size={15} /></span><span className="grow-copy"><small>{t("selected")}</small><strong>{selected.name}</strong></span></div>
        <div className="assignment-list">{assignments.map((item, index) => <div className="assignment-row" key={item}><i className={`behavior-dot dot-${index}`} /><span className="grow-copy"><strong>{item}</strong><small>{index < 2 ? selected.name : t("assignmentEmpty")}</small></span></div>)}</div>
        <Button className="assign-button" variant="primary">{t("assign")}</Button>
      </section>
    </main>
  );
}

function BuildView({ locale }: { locale: Locale }) {
  const t = (key: MessageKey) => translate(locale, key);
  return <main className="page"><PageHeading eyebrow={t("build")} title={t("buildTitle")} body={t("buildBody")} /><div className="build-grid">{["Clawd", "hatch-pet"].map((target) => <Card className="surface-card build-card" key={target}><Card.Content><div className="build-top"><span className="large-icon"><PackageCheck size={20} /></span><Chip color="success" variant="soft">{t("ready")}</Chip></div><h2>{target}</h2><p>{t("buildSummaryBody")}</p><Button variant="primary"><Download size={16} />{t("buildTheme")}</Button></Card.Content></Card>)}</div></main>;
}

function SettingsView({ locale, section, appearance, onSection, onLocale, onAppearance, onClose }: { locale: Locale; section: SettingsSection; appearance: AppSettings["appearance"]; onSection: (section: SettingsSection) => void; onLocale: (locale: Locale) => void; onAppearance: (appearance: AppSettings["appearance"]) => void; onClose: () => void }) {
  const t = (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values);
  const [cache, setCache] = useState({ byteLength: 0, entryCount: 0, maxBytes: 0 });
  const nav: Array<[SettingsSection, MessageKey, ReactNode]> = [["general", "general", <SlidersHorizontal size={16} />], ["runtimes", "runtimes", <Gauge size={16} />], ["targets", "targets", <PackageCheck size={16} />], ["storage", "storage", <Database size={16} />]];
  useEffect(() => { if (section === "storage") void getCacheStatus().then(setCache); }, [section]);
  async function clearBuildCache() { await clearCache(); setCache(await getCacheStatus()); }
  return (
    <main className="settings-view">
      <aside className="settings-sidebar">
        <Button variant="ghost" size="sm" onPress={onClose}><X size={16} />{t("close")}</Button>
        <div className="settings-title"><p className="eyebrow"><SettingsIcon size={13} />Live2Pet</p><h1>{t("settingsTitle")}</h1><p>{t("settingsBody")}</p></div>
        <nav aria-label={t("settings")}>{nav.map(([id, key, icon]) => <Button key={id} className="settings-nav" variant={section === id ? "secondary" : "ghost"} onPress={() => onSection(id)}>{icon}{t(key)}<ChevronRight size={14} /></Button>)}</nav>
      </aside>
      <section className="settings-content">
        {section === "general" && <div className="settings-section"><PageHeading eyebrow={t("settings")} title={t("general")} body={t("settingsBody")} /><Card className="surface-card"><Card.Content><div className="setting-row"><span className="large-icon"><Languages size={19} /></span><span className="grow-copy"><strong>{t("language")}</strong></span><ButtonGroup><Button variant={locale === "en" ? "primary" : "secondary"} onPress={() => onLocale("en")}>English</Button><Button variant={locale === "zh-CN" ? "primary" : "secondary"} onPress={() => onLocale("zh-CN")}>简体中文</Button></ButtonGroup></div></Card.Content></Card><Card className="surface-card"><Card.Content><div className="setting-row"><span className="large-icon">{appearance === "dark" ? <Moon size={19} /> : <Sun size={19} />}</span><span className="grow-copy"><strong>{t("appearance")}</strong></span><ButtonGroup>{(["system", "light", "dark"] as const).map((item) => <Button key={item} variant={appearance === item ? "primary" : "secondary"} onPress={() => onAppearance(item)}>{t(item)}</Button>)}</ButtonGroup></div></Card.Content></Card></div>}
        {section === "runtimes" && <div className="settings-section"><PageHeading eyebrow={t("settings")} title={t("runtimes")} body={t("runtimeBody")} /><RuntimePanel locale={locale} compact /></div>}
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
  const locale = state.settings.language;
  const appearance = state.settings.appearance;
  const t = (key: MessageKey) => translate(locale, key);

  useEffect(() => { document.documentElement.lang = locale; localStorage.setItem(LOCALE_KEY, locale); }, [locale]);
  useEffect(() => { document.documentElement.dataset.theme = appearance; localStorage.setItem(APPEARANCE_KEY, appearance); }, [appearance]);
  useEffect(() => { void getAppVersion().then(setAppVersion).catch(() => undefined); }, []);

  function completeSetup() { localStorage.setItem(SETUP_KEY, "true"); dispatch({ type: "COMPLETE_SETUP" }); }
  function openPreview() { dispatch({ type: "OPEN_PROJECT", project: { id: "design-preview", name: t("project"), selectedMotionId: motions[0].id } }); }

  if (state.destination === "setup") return <SetupView locale={locale} onComplete={completeSetup} />;
  if (state.destination === "settings") return <SettingsView locale={locale} section={state.settingsSection} appearance={appearance} onSection={(section) => dispatch({ type: "SELECT_SETTINGS_SECTION", section })} onLocale={(language) => dispatch({ type: "UPDATE_LANGUAGE", language })} onAppearance={(value) => dispatch({ type: "UPDATE_APPEARANCE", appearance: value })} onClose={() => dispatch({ type: "CLOSE_SETTINGS" })} />;

  const projectOpen = state.project !== null;
  return (
    <div className="app-shell">
      <header className="app-toolbar">
        <div className="toolbar-brand"><BrandMark /><strong>Live2Pet</strong>{projectOpen && <><i /><span>{state.project?.name}</span></>}</div>
        {projectOpen ? <nav aria-label="Project"><ButtonGroup>{(["source", "map", "build"] as const).map((destination) => <Button key={destination} variant={state.destination === destination ? "primary" : "ghost"} onPress={() => dispatch({ type: "NAVIGATE", destination })}>{t(destination)}</Button>)}</ButtonGroup></nav> : <span />}
        <div className="toolbar-actions"><Chip className="chip" size="sm" variant="soft"><span className="status-dot" />{t("designPreview")}</Chip><Button isIconOnly aria-label={t("settings")} variant="ghost" onPress={() => dispatch({ type: "OPEN_SETTINGS" })}><SettingsIcon size={18} /></Button></div>
      </header>
      <div className="app-content">
        {state.destination === "welcome" && <WelcomeView locale={locale} onOpenProject={openPreview} />}
        {state.destination === "source" && <SourceView locale={locale} onMap={() => dispatch({ type: "NAVIGATE", destination: "map" })} />}
        {state.destination === "map" && <MapView locale={locale} selectedMotionId={state.project?.selectedMotionId ?? null} onSelect={(motionId) => dispatch({ type: "SELECT_MOTION", motionId })} />}
        {state.destination === "build" && <BuildView locale={locale} />}
      </div>
      <footer className="status-bar"><span><i className="status-dot" />{hasDesktopApi() ? t("saved") : t("notConnected")}</span><span>Live2Pet {appVersion}</span></footer>
    </div>
  );
}
