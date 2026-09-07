import { Button, ButtonGroup, Card, Chip, ProgressBar, Input, Label, TextField } from "@heroui/react";
import { CircleCheck, Download, FolderOpen, PackageCheck, Square, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { BuildArtifact, BuildTarget, InstallRootResult, Live2PetProject, RenderPreset, SourceInspection, TargetInstallations, ClawdRenderSettings } from "./app-host";
import { chooseInstallRoot, DesktopApiError, hasBuildApi, installArtifact, getTargetInstallations, hasTargetInstallationApi } from "./app-host";
import { downloadBuildArtifact } from "./build-artifact";
import type { BuildState } from "./build-state";
import { GeneratedPreview } from "./generated-preview";
import { Locale, MessageKey, translate, translateBehavior } from "./i18n";
import { CLAWD_PROFILE, CODEX_PROFILE } from "./target-profiles";
import { formatBytes } from './format-bytes';

export type TargetReadiness = { ready: boolean; missing: string[] };

export function targetReadiness(project: Live2PetProject | null, inspection: SourceInspection | undefined, runtimeReady: boolean, target: BuildTarget): TargetReadiness {
  if (!project || !inspection) return { ready: false, missing: ["source"] };
  const commonMissing = [
    ...(!project.name.trim() ? ["package name"] : []),
    ...(!runtimeReady ? [inspection.model.format === 'spine' ? "Spine renderer pack" : "matching Cubism runtime"] : []),
    ...(project.sourceReview?.required ? ["source review"] : []),
  ];
  const mappings = project.targets[target].mappings;
  if (target === "codex-pet") {
    const missing = [...commonMissing, ...CODEX_PROFILE.rowIds.filter((slot) => !mappings[slot])];
    return { ready: missing.length === 0, missing };
  }
  const missingDirect = CLAWD_PROFILE.states.requiredDirect.filter((slot) => !mappings[slot]?.startsWith("motion:"));
  const fullSleep = project.targets.clawd.options.sleepMode === "full"
    ? CLAWD_PROFILE.states.fullSleep.filter((slot) => !mappings[slot]?.startsWith("motion:"))
    : [];
  const missing = [...commonMissing, ...missingDirect, ...(!mappings.sleeping ? ["sleeping"] : []), ...fullSleep];
  return { ready: missing.length === 0, missing };
}

type Props = {
  locale: Locale;
  project: Live2PetProject | null;
  inspection?: SourceInspection;
  runtimeReady: boolean;
  state: BuildState;
  onPreset: (target: BuildTarget, preset: RenderPreset) => void;
  onBuild: (target: BuildTarget) => Promise<BuildArtifact | null> | BuildArtifact | null | void;
  onCancel: (target: BuildTarget) => void;
  onName?: (name: string) => void;
  onCustomRender?: (settings: ClawdRenderSettings | null) => void;
};

const targets: BuildTarget[] = ["clawd", "codex-pet"];
const presets: RenderPreset[] = ["compact", "balanced", "high"];

export function BuildView({ locale, project, inspection, runtimeReady, state, onPreset, onBuild, onCancel, onName, onCustomRender }: Props) {
  const t = (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values);
  const readinessLabel = (value: string) => {
    if (value === 'source') return t('sourceTitle');
    if (value === 'package name') return t('packageName');
    if (value === 'Spine renderer pack') return t('spinePackTitle');
    if (value === 'matching Cubism runtime') return t('runtimeRequired');
    if (value === 'source review') return t('sourceReviewRequired');
    return translateBehavior(locale, value);
  };
  const [locations, setLocations] = useState<Partial<Record<BuildTarget, Extract<InstallRootResult, { cancelled: false }>>>>({});
  const [feedback, setFeedback] = useState<Partial<Record<BuildTarget, string>>>({});
  const [installations, setInstallations] = useState<TargetInstallations | null>(null);
  const [showCodexDetails, setShowCodexDetails] = useState(false);
  const hostReady = hasBuildApi();
  useEffect(() => {
    if (!hasTargetInstallationApi()) return;
    let active = true;
    void getTargetInstallations().then(value => { if (active) setInstallations(value); }).catch(() => {});
    return () => { active = false; };
  }, []);

  async function download(artifact: BuildArtifact) {
    try {
      const result = await downloadBuildArtifact(artifact);
      if (result.cancelled) return;
      setFeedback((value) => ({ ...value, [artifact.target]: t("packageSaved", { path: result.path }) }));
    } catch (cause) {
      setFeedback((value) => ({ ...value, [artifact.target]: cause instanceof Error ? cause.message : t("buildFailed") }));
    }
  }

  async function chooseFolder(target: BuildTarget) {
    try {
      const result = await chooseInstallRoot(target);
      if (!result.cancelled) {
        const detected = hasTargetInstallationApi() ? await getTargetInstallations() : null;
        if (detected) setInstallations(detected);
        setLocations((value) => ({ ...value, [target]: { ...result, displayPath: detected?.targets.find(record => record.target === target)?.root.path } }));
        setFeedback((value) => ({ ...value, [target]: t("installFolderChosen") }));
      }
    } catch (cause) {
      setFeedback((value) => ({ ...value, [target]: cause instanceof Error ? cause.message : t("buildFailed") }));
    }
  }

  async function install(target: BuildTarget, artifact: BuildArtifact) {
    try {
      const detected = hasTargetInstallationApi() ? await getTargetInstallations() : null;
      if (detected) setInstallations(detected);
      const destination = detected?.targets.find(record => record.target === target);
      const selected = locations[target];
      const locationId = destination?.locationId ?? selected?.locationId;
      const installPath = destination?.root.path ?? selected?.displayPath;
      if (destination && !['ready', 'will-create'].includes(destination.root.state)) throw new Error(t(`targetRoot_${destination.root.state}`));
      const warning = destination && destination.application.status !== 'found' ? `\n\n${t('installAppMissing')}` : '';
      const sizeWarning = target === 'clawd' && artifact.byteLength > CLAWD_PROFILE.package.maxBytes ? `\n\n${t('clawdSizeWarning', { size: formatBytes(artifact.byteLength), limit: formatBytes(CLAWD_PROFILE.package.maxBytes) })}` : '';
      if (!window.confirm((installPath ? t('confirmInstallAt', { filename: artifact.filename, path: installPath }) : t("confirmInstallArtifact", { filename: artifact.filename })) + warning + sizeWarning)) return;
      const request = { artifactId: artifact.artifactId, target, confirmInstall: true as const, ...(locationId ? { locationId } : {}) };
      try {
        await installArtifact({ ...request, conflict: 'cancel' });
      } catch (cause) {
        if (!(cause instanceof DesktopApiError) || cause.code !== 'INSTALL_CONFLICT') throw cause;
        if (!window.confirm(t('confirmReplaceInstall', { filename: artifact.filename }))) return;
        await installArtifact({ ...request, conflict: 'upgrade' });
      }
      setFeedback((value) => ({ ...value, [target]: t("installSucceeded") }));
    } catch (cause) {
      setFeedback((value) => ({ ...value, [target]: cause instanceof Error ? cause.message : t("buildFailed") }));
    }
  }

  async function buildAndInstall(target: BuildTarget) {
    const artifact = await onBuild(target);
    if (artifact) await install(target, artifact);
  }

  return (
    <main className="page build-page">
      <header className="page-heading"><p className="eyebrow">{t("build")}</p><h1>{t("buildTitle")}</h1><p>{t("buildBody")}</p></header>
      {project && <TextField className="package-name-field" value={project.name} onChange={onName} isRequired isDisabled={targets.some((target) => state[target].status === 'building')}><Label>{t('packageName')}</Label><Input maxLength={256} /><small>{t('packageNameHint')}</small></TextField>}
      {!hostReady && <div className="action-feedback" role="alert">{t("buildHostUnavailable")}</div>}
      <div className="build-grid">
        {targets.map((target) => {
          const current = state[target];
          const readiness = targetReadiness(project, inspection, runtimeReady, target);
          const artifact = current.artifact;
          const preset = project?.targets[target].renderPreset ?? "balanced";
          const custom = target === 'clawd' ? project?.targets.clawd.options.renderOverrides : undefined;
          const defaults = CLAWD_PROFILE.renderPresets[preset];
          const settings: ClawdRenderSettings = { width: custom?.width ?? defaults.width, height: custom?.height ?? defaults.height, fps: custom?.fps ?? defaults.fps, quality: custom?.quality ?? defaults.quality };
          const sizeWarning = artifact && target === 'clawd' && artifact.byteLength > CLAWD_PROFILE.package.maxBytes
            ? t('clawdSizeWarning', { size: formatBytes(artifact.byteLength), limit: formatBytes(CLAWD_PROFILE.package.maxBytes) }) : null;
          const title = target === "clawd" ? t("clawdPackage") : t("codexPackage");
          return (
            <Card className="surface-card build-card" key={target}>
              <Card.Content>
                <div className="build-top"><span className="large-icon"><PackageCheck size={20} /></span><Chip variant="soft">{readiness.ready ? t("ready") : t("notReady")}</Chip></div>
                <h2>{title}</h2>
                {(locations[target]?.displayPath || installations?.targets.find(record => record.target === target)) && <p className="install-destination">{t('targetRoot')} · {locations[target]?.displayPath ?? installations?.targets.find(record => record.target === target)?.root.path}</p>}
                {!readiness.ready && <p>{t("targetMissing", { value: readiness.missing.map(readinessLabel).join(locale === 'zh-CN' ? '、' : ', ') })}</p>}
                {target === 'clawd' && readiness.ready && <p>{t('targetReadyBody')}</p>}
                <div className="preset-row"><strong>{t("renderPreset")}</strong><ButtonGroup aria-label={`${title} ${t("renderPreset")}`}>{presets.map((value) => <Button size="sm" key={value} isDisabled={current.status === 'building'} variant={!custom && preset === value ? "primary" : "secondary"} onPress={() => onPreset(target, value)}>{t(value)}</Button>)}{target === 'clawd' && onCustomRender && <Button size="sm" variant={custom ? 'primary' : 'secondary'} isDisabled={!project || current.status === 'building'} onPress={() => onCustomRender(settings)}>{t('customRender')}</Button>}</ButtonGroup></div>
                {target === 'clawd' && <small>{settings.width} × {settings.height} px · {settings.fps} FPS · {t('webpQuality')} {settings.quality}</small>}
                {custom && onCustomRender && <fieldset className="custom-render-settings" disabled={current.status === 'building'}><legend>{t('customRender')}</legend>
                  <label>{t('renderResolution')} <output>{settings.width} × {settings.height} px</output><input type="range" aria-label={t('renderResolution')} min={128} max={2048} step={64} value={settings.width} onChange={event => { const size = Number(event.target.value); onCustomRender({ ...settings, width: size, height: size }); }} /></label>
                  <label>{t('renderFps')} <output>{settings.fps} FPS</output><input type="range" aria-label={t('renderFps')} min={1} max={60} step={1} value={settings.fps} onChange={event => onCustomRender({ ...settings, fps: Number(event.target.value) })} /></label>
                  <label>{t('webpQuality')} <output>{settings.quality}</output><input type="range" aria-label={t('webpQuality')} min={1} max={100} step={1} value={settings.quality} onChange={event => onCustomRender({ ...settings, quality: Number(event.target.value) })} /></label>
                  <small>{t('customRenderHint')}</small>
                </fieldset>}
                <div className={`build-result build-result-${current.status}`} role="status" aria-live="polite">
                  <div><strong>{t(`buildStatus_${current.status === 'building' && current.stage === 'queue' ? 'queued' : current.status}` as MessageKey)}</strong><span>{current.progress}%</span></div>
                  <ProgressBar aria-label={`${title} ${t("buildProgress")}`} value={current.progress}><ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track></ProgressBar>
                  <small>{current.error ?? (current.status === 'building' && current.stage === 'queue' ? t('buildQueuedHint') : current.message ?? (current.status === 'building' && (!current.stage || current.stage === 'prepare') ? t('buildPreparing') : current.stage ? t("buildStage", { value: current.stage }) : current.status === 'idle' ? t('buildWaiting') : t(`buildStatus_${current.status}` as MessageKey)))}</small>
                </div>
                <div className="build-actions">
                  {current.status === "building" ? <Button variant="secondary" onPress={() => onCancel(target)} isDisabled={!current.buildId}><Square size={14} />{t("cancelBuild")}</Button> : <><Button variant="primary" onPress={() => void onBuild(target)} isDisabled={!hostReady || !readiness.ready}><PackageCheck size={16} />{t("buildPackage")}</Button><Button variant="secondary" aria-label={`${t('buildAndInstall')} ${title}`} onPress={() => void buildAndInstall(target)} isDisabled={!hostReady || !readiness.ready}>{t('buildAndInstall')}</Button></>}
                  {target === 'codex-pet' && <Button size="sm" variant="ghost" aria-expanded={showCodexDetails} aria-controls="codex-format-details" onPress={() => setShowCodexDetails(value => !value)}>{t('codexFormatDetails')}</Button>}
                </div>
                {target === 'codex-pet' && <div id="codex-format-details" hidden={!showCodexDetails}><p>{t('codexV2Hint')}</p><p>{t('codexTimingHint')}</p></div>}
                {artifact && <div className="artifact-panel"><div><CircleCheck size={17} /><span><strong>{artifact.filename}</strong><small>{formatBytes(artifact.byteLength)} ZIP</small></span></div><div className="artifact-actions"><Button size="sm" variant="secondary" aria-label={`${t("savePackage")} ${title}`} onPress={() => void download(artifact)}><Download size={14} />{t("savePackage")}</Button><Button size="sm" variant="secondary" aria-label={`${t("chooseFolder")} ${title}`} onPress={() => void chooseFolder(target)}><FolderOpen size={14} />{t("chooseFolder")}</Button><Button size="sm" variant="primary" aria-label={`${t("install")} ${title}`} onPress={() => void install(target, artifact)}>{t("install")}</Button></div></div>}
                {artifact && <GeneratedPreview artifact={artifact} locale={locale} />}
                {sizeWarning && <p role="alert" className="build-size-warning">{sizeWarning}</p>}
                {current.summary && <div className="validation-summary">{current.summary.preview?.ready ? <CircleCheck size={15} /> : <XCircle size={15} />}<span>{t("previewSummary", { value: current.summary.preview?.ready ? t("ready") : t("unavailable") })} · {t("validationSummary", { value: current.summary.validation?.ok ? t("passed") : t("failed") })}</span></div>}
                {feedback[target] && <p className="build-feedback">{feedback[target]}</p>}
              </Card.Content>
            </Card>
          );
        })}
      </div>
    </main>
  );
}
