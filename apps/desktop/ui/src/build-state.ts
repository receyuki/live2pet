import * as buildProgressModule from "../../../mapper/build-progress.js";
import type { BuildArtifact, BuildProgressEvent, BuildSummary, BuildTarget } from "./app-host";

const browserBuildProgress = (globalThis as typeof globalThis & {
  Live2PetBuildProgress?: typeof buildProgressModule;
}).Live2PetBuildProgress;
const progressPercent = buildProgressModule.progressPercent ?? browserBuildProgress?.progressPercent;

if (!progressPercent) throw new Error("Live2Pet build progress helpers are unavailable.");

export type BuildStatus = "idle" | "building" | "succeeded" | "failed" | "cancelled";
export type TargetBuildState = {
  status: BuildStatus;
  buildId: string | null;
  sequence: number;
  progress: number;
  stage: string | null;
  message: string | null;
  error: string | null;
  artifact: BuildArtifact | null;
  summary: BuildSummary | null;
};
export type BuildState = Record<BuildTarget, TargetBuildState>;

const emptyTarget = (): TargetBuildState => ({ status: "idle", buildId: null, sequence: 0, progress: 0, stage: null, message: null, error: null, artifact: null, summary: null });
export const initialBuildState = (): BuildState => ({ clawd: emptyTarget(), "codex-pet": emptyTarget() });

export type BuildAction =
  | { type: "START"; target: BuildTarget }
  | { type: "PROGRESS"; event: BuildProgressEvent }
  | { type: "SUCCEED"; target: BuildTarget; artifact: BuildArtifact; summary: BuildSummary }
  | { type: "FAIL"; target: BuildTarget; error: string }
  | { type: "CANCEL"; target: BuildTarget; message?: string };

export function buildReducer(state: BuildState, action: BuildAction): BuildState {
  const current = state[action.type === "PROGRESS" ? action.event.target : action.target];
  if (action.type === "START") return { ...state, [action.target]: { ...current, status: "building", buildId: null, sequence: 0, progress: 0, stage: null, message: null, error: null } };
  if (action.type === "PROGRESS") {
    const { event } = action;
    if (current.status !== "building" || (current.buildId && current.buildId !== event.buildId) || event.sequence <= current.sequence) return state;
    const fraction = typeof event.fraction === "number" ? event.fraction : event.status === "completed" ? 1 : 0;
    const target = event.target === "codex-pet" ? "codex" : "clawd";
    const progress = Math.max(current.progress, typeof event.percent === "number" ? Math.min(99, Math.max(0, Math.round(event.percent))) : progressPercent(target, event.stage, fraction));
    return { ...state, [event.target]: { ...current, buildId: event.buildId, sequence: event.sequence, progress, stage: event.stage, message: event.message ?? null } };
  }
  if (action.type === "SUCCEED") return { ...state, [action.target]: { ...current, status: "succeeded", buildId: null, sequence: 0, progress: 100, stage: null, message: null, error: null, artifact: action.artifact, summary: action.summary } };
  if (action.type === "FAIL") return { ...state, [action.target]: { ...current, status: "failed", buildId: null, sequence: 0, stage: null, message: null, error: action.error } };
  return { ...state, [action.target]: { ...current, status: "cancelled", buildId: null, sequence: 0, stage: null, message: action.message ?? null, error: null } };
}
