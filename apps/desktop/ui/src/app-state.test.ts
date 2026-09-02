import { describe, expect, it } from "vitest";
import { appReducer, initialAppState } from "./app-state";
import type { Live2PetProject } from "./app-host";

function projectDocument(): Live2PetProject {
  return {
    schemaVersion: 1,
    projectId: "one",
    appVersion: "0.1.0",
    name: "One",
    source: { kind: "standard-directory", name: "one", fingerprint: "abc" },
    recipes: [],
    targets: {
      clawd: { profile: "clawd", mappings: {}, reactions: {}, recipeMappings: {}, options: {} },
      "codex-pet": { profile: "codex-pet", mappings: {}, reactions: {}, recipeMappings: {}, options: {} },
    },
  };
}

describe("initialAppState", () => {
  it("opens Setup once and Welcome for a returning profile", () => {
    expect(initialAppState().destination).toBe("setup");
    expect(initialAppState({ setupCompleted: true }).destination).toBe("welcome");
  });
});

describe("appReducer", () => {
  it("keeps project selections while navigating and visiting Settings", () => {
    let state = initialAppState({ setupCompleted: true });
    state = appReducer(state, {
      type: "OPEN_PROJECT",
      project: { id: "saint-louis", name: "Saint Louis" },
    });
    state = appReducer(state, { type: "NAVIGATE", destination: "map" });
    state = appReducer(state, { type: "SELECT_MOTION", motionId: "main-1" });
    state = appReducer(state, { type: "SELECT_EXPRESSION", expressionId: "smile" });
    state = appReducer(state, { type: "NAVIGATE", destination: "build" });
    state = appReducer(state, { type: "OPEN_SETTINGS", section: "storage" });

    expect(state).toMatchObject({
      destination: "settings",
      settingsReturnDestination: "build",
      settingsSection: "storage",
      project: { selectedMotionId: "main-1", selectedExpressionId: "smile" },
    });

    state = appReducer(state, { type: "CLOSE_SETTINGS" });
    expect(state.destination).toBe("build");
    expect(state.project?.selectedExpressionId).toBe("smile");
  });

  it("does not enter a project destination without an open project", () => {
    const state = appReducer(initialAppState({ setupCompleted: true }), {
      type: "NAVIGATE",
      destination: "map",
    });
    expect(state.destination).toBe("welcome");
  });

  it("closes a project back to Welcome", () => {
    let state = initialAppState({ setupCompleted: true });
    state = appReducer(state, { type: "OPEN_PROJECT", project: { id: "one", name: "One" } });
    state = appReducer(state, { type: "CLOSE_PROJECT" });
    expect(state.destination).toBe("welcome");
    expect(state.project).toBeNull();
  });

  it("updates appearance and language without leaving Settings", () => {
    let state = initialAppState({ setupCompleted: true });
    state = appReducer(state, { type: "OPEN_SETTINGS" });
    state = appReducer(state, { type: "UPDATE_LANGUAGE", language: "zh-CN" });
    state = appReducer(state, { type: "UPDATE_APPEARANCE", appearance: "dark" });
    expect(state.destination).toBe("settings");
    expect(state.settings).toEqual({ language: "zh-CN", appearance: "dark" });
  });

  it("reopens Setup and returns to the active project without losing it", () => {
    let state = initialAppState({ setupCompleted: true });
    state = appReducer(state, { type: "OPEN_PROJECT", project: { id: "one", name: "One" } });
    state = appReducer(state, { type: "NAVIGATE", destination: "map" });
    state = appReducer(state, { type: "OPEN_SETUP" });
    expect(state).toMatchObject({ destination: "setup", setupReturnDestination: "map", project: { id: "one" } });

    state = appReducer(state, { type: "COMPLETE_SETUP" });
    expect(state).toMatchObject({ destination: "map", setupReturnDestination: null, project: { id: "one" } });
  });

  it("keeps selection ephemeral and writes assignments only into the project document", () => {
    let state = initialAppState({ setupCompleted: true });
    state = appReducer(state, { type: "OPEN_PROJECT", project: { id: "one", name: "One", document: projectDocument() } });
    state = appReducer(state, { type: "SELECT_MOTION", motionId: "Idle" });
    state = appReducer(state, { type: "SELECT_EXPRESSION", expressionId: "smile" });
    expect(state.project?.dirty).toBe(false);
    expect(state.project?.document?.recipes).toEqual([]);

    state = appReducer(state, { type: "ASSIGN_SELECTED_RECIPE", destination: { target: "clawd", category: "states", slot: "idle" } });
    expect(state.project?.dirty).toBe(true);
    expect(state.project?.document?.recipes).toHaveLength(1);
    expect(state.project?.document?.targets.clawd.mappings.idle).toBe("motion:Idle");
    expect(state.project).not.toHaveProperty("mappings");
  });

  it("clears assignments in the document, prunes recipes, and marks dirty", () => {
    let state = initialAppState({ setupCompleted: true });
    state = appReducer(state, { type: "OPEN_PROJECT", project: { id: "one", name: "One", document: projectDocument(), selectedMotionId: "Idle" } });
    state = appReducer(state, { type: "ASSIGN_SELECTED_RECIPE", destination: { target: "codex-pet", category: "rows", slot: "idle" } });
    state = appReducer(state, { type: "PROJECT_SAVED", document: state.project!.document!, documentId: "document_123", fileName: "one.live2pet" });
    expect(state.project?.dirty).toBe(false);
    state = appReducer(state, { type: "CLEAR_ASSIGNMENT", destination: { target: "codex-pet", category: "rows", slot: "idle" } });
    expect(state.project?.dirty).toBe(true);
    expect(state.project?.document?.recipes).toEqual([]);
    expect(state.project?.document?.targets["codex-pet"].mappings).toEqual({});
  });

  it("persists target render presets and preserves identity for a no-op", () => {
    let state = initialAppState({ setupCompleted: true });
    state = appReducer(state, { type: "OPEN_PROJECT", project: { id: "one", name: "One", document: projectDocument() } });
    const changed = appReducer(state, { type: "SET_RENDER_PRESET", target: "clawd", preset: "high" });
    expect(changed.project?.document?.targets.clawd.renderPreset).toBe("high");
    expect(changed.project?.document?.targets["codex-pet"].renderPreset).toBeUndefined();
    expect(changed.project?.dirty).toBe(true);
    expect(appReducer(changed, { type: "SET_RENDER_PRESET", target: "clawd", preset: "high" })).toBe(changed);
  });

  it("undoes and redoes document edits without recording ephemeral selections or no-ops", () => {
    let state = appReducer(initialAppState({ setupCompleted: true }), {
      type: "OPEN_PROJECT",
      project: { id: "one", name: "One", document: projectDocument() },
    });
    state = appReducer(state, { type: "SELECT_MOTION", motionId: "Idle" });
    expect(state.projectHistory.past).toHaveLength(0);

    state = appReducer(state, { type: "ASSIGN_SELECTED_RECIPE", destination: { target: "clawd", category: "states", slot: "idle" } });
    expect(state.projectHistory.past).toHaveLength(1);
    const assigned = state.project?.document;
    expect(appReducer(state, { type: "ASSIGN_SELECTED_RECIPE", destination: { target: "clawd", category: "states", slot: "idle" } })).toBe(state);

    state = appReducer(state, { type: "UNDO_PROJECT_EDIT" });
    expect(state.project?.document?.targets.clawd.mappings).toEqual({});
    expect(state.project?.dirty).toBe(false);
    expect(state.projectHistory.future).toHaveLength(1);

    state = appReducer(state, { type: "REDO_PROJECT_EDIT" });
    expect(state.project?.document).toBe(assigned);
    expect(state.project?.dirty).toBe(true);
  });

  it("preserves history across save and computes dirty state against the saved document", () => {
    let state = appReducer(initialAppState({ setupCompleted: true }), {
      type: "OPEN_PROJECT",
      project: { id: "one", name: "One", document: projectDocument(), selectedMotionId: "Idle" },
    });
    state = appReducer(state, { type: "ASSIGN_SELECTED_RECIPE", destination: { target: "codex-pet", category: "rows", slot: "idle" } });
    state = appReducer(state, { type: "PROJECT_SAVED", document: state.project!.document!, documentId: "document_123", fileName: "one.live2pet" });
    expect(state.projectHistory.past).toHaveLength(1);
    expect(state.project?.dirty).toBe(false);

    state = appReducer(state, { type: "UNDO_PROJECT_EDIT" });
    expect(state.project?.dirty).toBe(true);
    state = appReducer(state, { type: "REDO_PROJECT_EDIT" });
    expect(state.project?.dirty).toBe(false);
  });

  it("resets history at project boundaries and caps undo snapshots at 100", () => {
    let state = appReducer(initialAppState({ setupCompleted: true }), {
      type: "OPEN_PROJECT",
      project: { id: "one", name: "One", document: projectDocument() },
    });
    for (let index = 0; index < 110; index += 1) {
      state = appReducer(state, { type: "SET_RENDER_PRESET", target: "clawd", preset: index % 2 ? "compact" : "high" });
    }
    expect(state.projectHistory.past).toHaveLength(100);

    state = appReducer(state, { type: "OPEN_PROJECT", project: { id: "two", name: "Two", document: { ...projectDocument(), projectId: "two" } } });
    expect(state.projectHistory).toMatchObject({ past: [], future: [] });
    state = appReducer(state, { type: "CLOSE_PROJECT" });
    expect(state.projectHistory).toEqual({ past: [], future: [], saved: null });
  });

  it("starts a fresh history boundary when a Source Package is relinked", () => {
    const original = projectDocument();
    let state = appReducer(initialAppState({ setupCompleted: true }), {
      type: "OPEN_PROJECT",
      project: { id: "one", name: "One", document: original },
    });
    state = appReducer(state, { type: "SET_RENDER_PRESET", target: "clawd", preset: "high" });
    const inspection = {
      schemaVersion: 1 as const,
      source: { kind: "pck" as const, name: "replacement", fingerprint: "def", modelConfig: "model.json" },
      model: { cubism: 4, configFile: "model.json", modelFile: "model.moc3", textures: [] },
      motions: [], expressions: [], resources: [], warnings: [],
    };
    const relinked = {
      ...state.project!.document!,
      source: { kind: "pck" as const, name: "replacement", fingerprint: "def", path: "/private/replacement.pck" },
      sourceReview: { required: true, affectedRecipeIds: [] },
    };

    state = appReducer(state, { type: "SOURCE_RELINKED", document: relinked, inspection, sourcePath: "/private/replacement.pck" });
    expect(state.projectHistory.past).toEqual([]);
    expect(state.projectHistory.future).toEqual([]);
    expect(state.project?.dirty).toBe(true);
    expect(state.destination).toBe("source");
    expect(appReducer(state, { type: "UNDO_PROJECT_EDIT" })).toBe(state);
  });

  it("keeps an unchanged relink clean, blocks Map and Build during review, and makes acknowledgement undoable", () => {
    const original = projectDocument();
    let state = appReducer(initialAppState({ setupCompleted: true }), {
      type: "OPEN_PROJECT",
      project: { id: "one", name: "One", document: original },
    });
    const inspection = {
      schemaVersion: 1 as const,
      source: { kind: "standard-directory" as const, name: "one", fingerprint: "abc", modelConfig: "model.json" },
      model: { cubism: 4, configFile: "model.json", modelFile: "model.moc3", textures: [] },
      motions: [], expressions: [], resources: [], warnings: [],
    };
    state = appReducer(state, { type: "SOURCE_RELINKED", document: original, inspection, sourcePath: "/private/one" });
    expect(state.project?.dirty).toBe(false);

    const needsReview = { ...original, sourceReview: { required: true, affectedRecipeIds: ["idle-recipe"] } };
    state = appReducer(state, { type: "SOURCE_RELINKED", document: needsReview, inspection, sourcePath: "/private/one" });
    expect(appReducer(state, { type: "NAVIGATE", destination: "map" })).toBe(state);
    expect(appReducer(state, { type: "NAVIGATE", destination: "build" })).toBe(state);

    const acknowledged = { ...needsReview, sourceReview: { required: false, affectedRecipeIds: ["idle-recipe"], reviewedFingerprint: "abc" } };
    state = appReducer(state, { type: "SOURCE_REVIEW_ACKNOWLEDGED", document: acknowledged });
    expect(state.projectHistory.past).toEqual([needsReview]);
    expect(state.project?.document?.sourceReview?.required).toBe(false);
    state = appReducer(state, { type: "UNDO_PROJECT_EDIT" });
    expect(state.project?.document?.sourceReview?.required).toBe(true);
  });
});
