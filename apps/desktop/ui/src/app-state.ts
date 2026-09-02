export type Destination =
  | "setup"
  | "welcome"
  | "source"
  | "map"
  | "build"
  | "settings";

export type ProjectDestination = Extract<Destination, "source" | "map" | "build">;
export type SettingsSection = "general" | "runtimes" | "targets" | "storage";

export interface AppSettings {
  language: "en" | "zh-CN";
  appearance: "system" | "light" | "dark";
}

export interface ProjectSession {
  id: string;
  name: string;
  sourcePath?: string;
  selectedMotionId: string | null;
  selectedExpressionId: string | null;
}

type ReturnDestination = "welcome" | ProjectDestination;

export interface AppState {
  destination: Destination;
  project: ProjectSession | null;
  settings: AppSettings;
  settingsSection: SettingsSection;
  settingsReturnDestination: ReturnDestination | null;
  setupCompleted: boolean;
}

export type AppAction =
  | {
      type: "OPEN_PROJECT";
      project: Pick<ProjectSession, "id" | "name"> & Partial<Omit<ProjectSession, "id" | "name">>;
    }
  | { type: "CLOSE_PROJECT" }
  | { type: "NAVIGATE"; destination: ProjectDestination }
  | { type: "OPEN_SETTINGS"; section?: SettingsSection }
  | { type: "CLOSE_SETTINGS" }
  | { type: "SELECT_SETTINGS_SECTION"; section: SettingsSection }
  | { type: "SELECT_MOTION"; motionId: string | null }
  | { type: "SELECT_EXPRESSION"; expressionId: string | null }
  | { type: "COMPLETE_SETUP" }
  | { type: "UPDATE_LANGUAGE"; language: AppSettings["language"] }
  | { type: "UPDATE_APPEARANCE"; appearance: AppSettings["appearance"] };

export function initialAppState({ setupCompleted = false }: { setupCompleted?: boolean } = {}): AppState {
  return {
    destination: setupCompleted ? "welcome" : "setup",
    project: null,
    settings: { language: "en", appearance: "system" },
    settingsSection: "general",
    settingsReturnDestination: null,
    setupCompleted,
  };
}

function safeDestination(destination: ReturnDestination, project: ProjectSession | null): ReturnDestination {
  return destination === "welcome" || project ? destination : "welcome";
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "OPEN_PROJECT":
      return {
        ...state,
        destination: "source",
        project: {
          ...action.project,
          selectedMotionId: action.project.selectedMotionId ?? null,
          selectedExpressionId: action.project.selectedExpressionId ?? null,
        },
        settingsReturnDestination: null,
      };

    case "CLOSE_PROJECT":
      return { ...state, destination: "welcome", project: null, settingsReturnDestination: null };

    case "NAVIGATE":
      if (!state.project || state.destination === "setup") return state;
      return { ...state, destination: action.destination, settingsReturnDestination: null };

    case "OPEN_SETTINGS": {
      const current = state.destination === "settings"
        ? state.settingsReturnDestination ?? "welcome"
        : state.destination === "setup"
          ? "welcome"
          : state.destination;
      return {
        ...state,
        destination: "settings",
        settingsSection: action.section ?? state.settingsSection,
        settingsReturnDestination: safeDestination(current, state.project),
      };
    }

    case "CLOSE_SETTINGS":
      if (state.destination !== "settings") return state;
      return {
        ...state,
        destination: safeDestination(state.settingsReturnDestination ?? "welcome", state.project),
        settingsReturnDestination: null,
      };

    case "SELECT_SETTINGS_SECTION":
      return state.destination === "settings" ? { ...state, settingsSection: action.section } : state;

    case "SELECT_MOTION":
      return state.project
        ? { ...state, project: { ...state.project, selectedMotionId: action.motionId } }
        : state;

    case "SELECT_EXPRESSION":
      return state.project
        ? { ...state, project: { ...state.project, selectedExpressionId: action.expressionId } }
        : state;

    case "COMPLETE_SETUP":
      return state.destination === "setup"
        ? { ...state, destination: "welcome", setupCompleted: true }
        : state;

    case "UPDATE_LANGUAGE":
      return { ...state, settings: { ...state.settings, language: action.language } };

    case "UPDATE_APPEARANCE":
      return { ...state, settings: { ...state.settings, appearance: action.appearance } };
  }
}
