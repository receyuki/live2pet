import { beforeEach, describe, expect, it } from "vitest";
import type { Live2PetProject } from "./app-host";
import {
  clearProjectDraft,
  PROJECT_DRAFT_KEY,
  PROJECT_DRAFT_MAX_BYTES,
  readProjectDraft,
  writeProjectDraft,
} from "./project-draft";

const project: Live2PetProject = {
  schemaVersion: 1,
  projectId: "draft-project",
  appVersion: "0.1.0",
  name: "Draft Project",
  source: { kind: "pck", name: "Source", fingerprint: "fingerprint", path: "/Models/source.pck", modelConfig: "model.json" },
  recipes: [],
  targets: {
    clawd: { profile: "clawd", mappings: {}, reactions: {}, options: {} },
    "codex-pet": { profile: "codex-pet", mappings: {}, reactions: {}, options: {} },
  },
};

describe("project draft persistence", () => {
  beforeEach(() => localStorage.clear());

  it("stores a versioned reference-only project envelope", () => {
    const draft = writeProjectDraft(project, localStorage, new Date("2026-09-03T01:02:03.000Z"));
    expect(draft).toEqual({ schemaVersion: 1, savedAt: "2026-09-03T01:02:03.000Z", project });
    expect(JSON.parse(localStorage.getItem(PROJECT_DRAFT_KEY)!)).toEqual(draft);
    expect(localStorage.getItem(PROJECT_DRAFT_KEY)).not.toContain("inspection");
    expect(localStorage.getItem(PROJECT_DRAFT_KEY)).not.toContain("artifact");
    expect(readProjectDraft()).toEqual(draft);
  });

  it("rejects malformed, unsupported, and oversized envelopes", () => {
    localStorage.setItem(PROJECT_DRAFT_KEY, "not json");
    expect(readProjectDraft()).toBeNull();
    localStorage.setItem(PROJECT_DRAFT_KEY, JSON.stringify({ schemaVersion: 2, savedAt: new Date().toISOString(), project }));
    expect(readProjectDraft()).toBeNull();
    localStorage.setItem(PROJECT_DRAFT_KEY, "x".repeat(PROJECT_DRAFT_MAX_BYTES + 1));
    expect(readProjectDraft()).toBeNull();
  });

  it("does not overwrite storage with an oversized project", () => {
    localStorage.setItem(PROJECT_DRAFT_KEY, "existing");
    const oversized = { ...project, rightsNote: "界".repeat(PROJECT_DRAFT_MAX_BYTES) };
    expect(writeProjectDraft(oversized)).toBeNull();
    expect(localStorage.getItem(PROJECT_DRAFT_KEY)).toBe("existing");
  });

  it("clears only when explicitly requested", () => {
    writeProjectDraft(project);
    clearProjectDraft();
    expect(localStorage.getItem(PROJECT_DRAFT_KEY)).toBeNull();
  });
});
