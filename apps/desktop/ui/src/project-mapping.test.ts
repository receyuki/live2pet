import { describe, expect, it } from "vitest";
import type { Live2PetProject } from "./app-host";
import { assignSelectedRecipe, clearAssignment } from "./project-mapping";
import { CLAWD_PROFILE, CODEX_PROFILE } from "./target-profiles";

function project(): Live2PetProject {
  return {
    schemaVersion: 1,
    projectId: "fixture",
    appVersion: "0.1.0",
    name: "Fixture",
    source: { kind: "standard-directory", name: "fixture", fingerprint: "abc" },
    recipes: [],
    targets: {
      clawd: { profile: "clawd", mappings: {}, reactions: {}, recipeMappings: {}, options: {} },
      "codex-pet": { profile: "codex-pet", mappings: {}, reactions: {}, recipeMappings: {}, options: {} },
    },
  };
}

describe("target profiles", () => {
  it("uses the shared target packages", () => {
    expect(CLAWD_PROFILE.id).toBe("clawd");
    expect(CLAWD_PROFILE.states.all).toContain("thinking");
    expect(CODEX_PROFILE.id).toBe("codex-pet");
    expect(CODEX_PROFILE.rowIds).toContain("running-right");
  });
});

describe("persistent project mappings", () => {
  it("deduplicates the same Motion and Expression recipe across slots", () => {
    const first = assignSelectedRecipe(project(), { target: "clawd", category: "states", slot: "idle" }, { motionId: "Idle", expressionId: "smile" });
    const second = assignSelectedRecipe(first, { target: "clawd", category: "states", slot: "thinking" }, { motionId: "Idle", expressionId: "smile" });
    expect(second.recipes).toHaveLength(1);
    expect(second.targets.clawd.recipeMappings?.idle).toBe(second.targets.clawd.recipeMappings?.thinking);
    expect(second.targets.clawd.mappings).toMatchObject({ idle: "motion:Idle", thinking: "motion:Idle" });
  });

  it("creates distinct recipes for different Expressions on one Motion", () => {
    const first = assignSelectedRecipe(project(), { target: "clawd", category: "states", slot: "idle" }, { motionId: "Idle", expressionId: "smile" });
    const second = assignSelectedRecipe(first, { target: "clawd", category: "states", slot: "thinking" }, { motionId: "Idle", expressionId: "angry" });
    expect(second.recipes).toHaveLength(2);
    expect(new Set(second.recipes.map((recipe) => recipe.id)).size).toBe(2);
  });

  it("isolates Clawd states, Clawd reactions, and Codex rows", () => {
    let document = project();
    document = assignSelectedRecipe(document, { target: "clawd", category: "states", slot: "idle" }, { motionId: "Idle", expressionId: null });
    document = assignSelectedRecipe(document, { target: "clawd", category: "reactions", slot: "clickLeft" }, { motionId: "Tap", expressionId: null });
    document = assignSelectedRecipe(document, { target: "codex-pet", category: "rows", slot: "running-right" }, { motionId: "Run", expressionId: null });
    expect(document.targets.clawd.mappings).toEqual({ idle: "motion:Idle" });
    expect(document.targets.clawd.reactions).toEqual({ clickLeft: "motion:Tap" });
    expect(document.targets["codex-pet"].mappings).toEqual({ "running-right": "motion:Run" });
    expect(document.targets["codex-pet"].reactions).toEqual({});
  });

  it("clears only the requested assignment and prunes recipes after their final reference", () => {
    let document = project();
    document = assignSelectedRecipe(document, { target: "clawd", category: "states", slot: "idle" }, { motionId: "Idle", expressionId: null });
    document = assignSelectedRecipe(document, { target: "clawd", category: "states", slot: "thinking" }, { motionId: "Idle", expressionId: null });
    const once = clearAssignment(document, { target: "clawd", category: "states", slot: "idle" });
    expect(once.recipes).toHaveLength(1);
    expect(once.targets.clawd.mappings.idle).toBeUndefined();
    const twice = clearAssignment(once, { target: "clawd", category: "states", slot: "thinking" });
    expect(twice.recipes).toEqual([]);
    expect(twice.targets.clawd.recipeMappings).toEqual({});
  });

  it("rejects slots not present in the shared profiles", () => {
    const document = project();
    expect(assignSelectedRecipe(document, { target: "codex-pet", category: "rows", slot: "invented" }, { motionId: "Idle", expressionId: null })).toBe(document);
    expect(clearAssignment(document, { target: "clawd", category: "states", slot: "invented" })).toBe(document);
  });

  it("keeps repeated assignments and empty clears as no-ops", () => {
    const empty = project();
    expect(clearAssignment(empty, { target: "clawd", category: "states", slot: "idle" })).toBe(empty);
    const assigned = assignSelectedRecipe(empty, { target: "clawd", category: "states", slot: "idle" }, { motionId: "Idle", expressionId: null });
    expect(assignSelectedRecipe(assigned, { target: "clawd", category: "states", slot: "idle" }, { motionId: "Idle", expressionId: null })).toBe(assigned);
  });
});
