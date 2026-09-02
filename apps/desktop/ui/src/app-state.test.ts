import { describe, expect, it } from "vitest";
import { appReducer, initialAppState } from "./app-state";

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
});
