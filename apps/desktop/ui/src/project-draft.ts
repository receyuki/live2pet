import type { Live2PetProject } from "./app-host";

export const PROJECT_DRAFT_KEY = "live2pet.desktop.project-draft";
export const PROJECT_DRAFT_SCHEMA_VERSION = 1;
export const PROJECT_DRAFT_MAX_BYTES = 1024 * 1024;
export const PROJECT_DRAFT_DEBOUNCE_MS = 400;

export type ProjectDraft = {
  schemaVersion: typeof PROJECT_DRAFT_SCHEMA_VERSION;
  savedAt: string;
  project: Live2PetProject;
};

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isProject(value: unknown): value is Live2PetProject {
  if (!value || typeof value !== "object") return false;
  const project = value as Partial<Live2PetProject>;
  return (project.schemaVersion === 1 || project.schemaVersion === 2 || project.schemaVersion === 3)
    && typeof project.projectId === "string"
    && typeof project.appVersion === "string"
    && typeof project.name === "string"
    && Boolean(project.source && typeof project.source === "object")
    && Array.isArray(project.recipes)
    && Boolean(project.targets?.clawd && project.targets?.["codex-pet"]);
}

export function readProjectDraft(storage: Storage = localStorage): ProjectDraft | null {
  const raw = storage.getItem(PROJECT_DRAFT_KEY);
  if (!raw || byteLength(raw) > PROJECT_DRAFT_MAX_BYTES) return null;
  try {
    const value = JSON.parse(raw) as Partial<ProjectDraft>;
    if (value.schemaVersion !== PROJECT_DRAFT_SCHEMA_VERSION
      || typeof value.savedAt !== "string"
      || !Number.isFinite(Date.parse(value.savedAt))
      || !isProject(value.project)) return null;
    return value as ProjectDraft;
  } catch {
    return null;
  }
}

export function writeProjectDraft(
  project: Live2PetProject,
  storage: Storage = localStorage,
  now: Date = new Date(),
): ProjectDraft | null {
  // Live2PetProject is the reference-only document. Runtime descriptors,
  // inspections, captured frames, and build artifacts live outside it.
  const draft: ProjectDraft = {
    schemaVersion: PROJECT_DRAFT_SCHEMA_VERSION,
    savedAt: now.toISOString(),
    project,
  };
  const serialized = JSON.stringify(draft);
  if (byteLength(serialized) > PROJECT_DRAFT_MAX_BYTES) return null;
  try {
    storage.setItem(PROJECT_DRAFT_KEY, serialized);
    return draft;
  } catch {
    return null;
  }
}

export function clearProjectDraft(storage: Storage = localStorage): void {
  storage.removeItem(PROJECT_DRAFT_KEY);
}
