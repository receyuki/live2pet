import { Button, ButtonGroup, Card, Chip, ProgressBar, Input, Label, TextField } from "@heroui/react";
import { CircleCheck, Download, FolderOpen, PackageCheck, Square, XCircle } from "lucide-react";
import { useState } from "react";
import type { BuildArtifact, BuildTarget, InstallRootResult, Live2PetProject, RenderPreset, SourceInspection } from "./app-host";
import { chooseInstallRoot, hasBuildApi, installArtifact } from "./app-host";
import { downloadBuildArtifact } from "./build-artifact";
import type { BuildState } from "./build-state";
import { GeneratedPreview } from "./generated-preview";
import { Locale, MessageKey, translate } from "./i18n";
import { CLAWD_PROFILE, CODEX_PROFILE } from "./target-profiles";

export type TargetReadiness = { ready: boolean; missing: string[] };

export function targetReadiness(project: Live2PetProject | null, inspection: SourceInspection | undefined, runtimeReady: boolean, target: BuildTarget): TargetReadiness {
  if (!project || !inspection) return { ready: false, missing: ["source"] };
  const commonMissing = [
    ...(!project.name.trim() ? ["package name"] : []),
    ...(!runtimeReady ? ["matching Cubism runtime"] : []),
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
  onBuild: (target: BuildTarget) => void;
  onCancel: (target: BuildTarget) => void;
  onName?: (name: string) => void;
};

const targets: BuildTarget[] = ["clawd", "codex-pet"];
const presets: RenderPreset[] = ["compact", "balanced", "high"];

export function BuildView({ locale, project, inspection, runtimeReady, state, onPreset, onBuild, onCancel, onName }: Props) {
  const t = (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values);
  const [locations, setLocations] = useState<Partial<Record<BuildTarget, Extract<InstallRootResult, { cancelled: false }>>>>({});
  const [feedback, setFeedback] = useState<Partial<Record<BuildTarget, string>>>({});
  const hostReady = hasBuildApi();

  async function download(artifact: BuildArtifact) {
    try {
      await downloadBuildArtifact(artifact);
      setFeedback((value) => ({ ...value, [artifact.target]: t("downloadReady", { filename: artifact.filename }) }));
    } catch (cause) {
      setFeedback((value) => ({ ...value, [artifact.target]: cause instanceof Error ? cause.message : t("buildFailed") }));
    }
  }

  async function chooseFolder(target: BuildTarget) {
    try {
      const result = await chooseInstallRoot(target);
      if (!result.cancelled) {
        setLocations((value) => ({ ...value, [target]: result }));
        setFeedback((value) => ({ ...value, [target]: t("installFolderChosen") }));
      }
    } catch (cause) {
      setFeedback((value) => ({ ...value, [target]: cause instanceof Error ? cause.message : t("buildFailed") }));
    }
  }

  async function install(target: BuildTarget, artifact: BuildArtifact) {
    if (!window.confirm(t("confirmInstallArtifact", { filename: artifact.filename }))) return;
    try {
      await installArtifact({ artifactId: artifact.artifactId, target, conflict: "cancel", confirmInstall: true, ...(locations[target] ? { locationId: locations[target]!.locationId } : {}) });
      setFeedback((value) => ({ ...value, [target]: t("installSucceeded") }));
    } catch (cause) {
      setFeedback((value) => ({ ...value, [target]: cause instanceof Error ? cause.message : t("buildFailed") }));
    }
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
          const title = target === "clawd" ? t("clawdPackage") : t("codexPackage");
          return (
            <Card className="surface-card build-card" key={target}>
              <Card.Content>
                <div className="build-top"><span className="large-icon"><PackageCheck size={20} /></span><Chip variant="soft">{readiness.ready ? t("ready") : t("notReady")}</Chip></div>
                <h2>{title}</h2>
                {target === 'codex-pet' && <p>{t('codexTimingHint')}</p>}
                <p>{readiness.ready ? t("targetReadyBody") : t("targetMissing", { value: readiness.missing.join(", ") })}</p>
                <div className="preset-row"><strong>{t("renderPreset")}</strong><ButtonGroup aria-label={`${title} ${t("renderPreset")}`}>{presets.map((value) => <Button size="sm" key={value} variant={preset === value ? "primary" : "secondary"} onPress={() => onPreset(target, value)}>{t(value)}</Button>)}</ButtonGroup></div>
                <div className={`build-result build-result-${current.status}`} role="status" aria-live="polite">
                  <div><strong>{t(`buildStatus_${current.status}` as MessageKey)}</strong><span>{current.progress}%</span></div>
                  <ProgressBar aria-label={`${title} ${t("buildProgress")}`} value={current.progress} />
                  <small>{current.error ?? current.message ?? (current.stage ? t("buildStage", { value: current.stage }) : t("buildWaiting"))}</small>
                </div>
                <div className="build-actions">
                  {current.status === "building" ? <Button variant="secondary" onPress={() => onCancel(target)} isDisabled={!current.buildId}><Square size={14} />{t("cancelBuild")}</Button> : <Button variant="primary" onPress={() => onBuild(target)} isDisabled={!hostReady || !readiness.ready}><PackageCheck size={16} />{t("buildPackage")}</Button>}
                </div>
                {artifact && <div className="artifact-panel"><div><CircleCheck size={17} /><span><strong>{artifact.filename}</strong><small>{t("artifactSize", { value: Math.ceil(artifact.byteLength / 1024) })}</small></span></div><div className="artifact-actions"><Button size="sm" variant="secondary" aria-label={`${t("download")} ${title}`} onPress={() => void download(artifact)}><Download size={14} />{t("download")}</Button><Button size="sm" variant="secondary" aria-label={`${t("chooseFolder")} ${title}`} onPress={() => void chooseFolder(target)}><FolderOpen size={14} />{t("chooseFolder")}</Button><Button size="sm" variant="primary" aria-label={`${t("install")} ${title}`} onPress={() => void install(target, artifact)}>{t("install")}</Button></div></div>}
                {artifact && <GeneratedPreview artifact={artifact} locale={locale} />}
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
