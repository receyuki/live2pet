import { assignSelectedRecipe, clearAssignment } from "./project-mapping";
import type { MappingDestination } from "./target-profiles";
import type { ClawdRenderSettings } from './app-host';

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
  document: import('./app-host').Live2PetProject | null;
  documentId?: string;
  fileName?: string;
  dirty: boolean;
  sourcePath?: string;
  inspection?: import('./app-host').SourceInspection;
  selectedMotionId: string | null;
  selectedExpressionId: string | null;
}

export interface ProjectDocumentHistory {
  past: import('./app-host').Live2PetProject[];
  future: import('./app-host').Live2PetProject[];
  saved: import('./app-host').Live2PetProject | null;
}

type ReturnDestination = "welcome" | ProjectDestination;
type SetupReturnDestination = Exclude<Destination, "setup">;

export interface AppState {
  destination: Destination;
  project: ProjectSession | null;
  settings: AppSettings;
  settingsSection: SettingsSection;
  settingsReturnDestination: ReturnDestination | null;
  setupReturnDestination: SetupReturnDestination | null;
  setupCompleted: boolean;
  projectHistory: ProjectDocumentHistory;
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
  | { type: "ASSIGN_SELECTED_RECIPE"; destination: MappingDestination }
  | { type: "CLEAR_ASSIGNMENT"; destination: MappingDestination }
  | { type: "RENAME_PROJECT"; name: string }
  | { type: "SET_VISUAL_SETTINGS"; settings: import('./app-host').VisualSettings }
  | { type: "SET_RENDER_PRESET"; target: "clawd" | "codex-pet"; preset: "compact" | "balanced" | "high" }
  | { type: 'SET_CLAWD_RENDER'; settings: ClawdRenderSettings | null }
  | { type: "SOURCE_RELINKED"; document: import('./app-host').Live2PetProject; inspection: import('./app-host').SourceInspection; sourcePath: string }
  | { type: "SOURCE_REVIEW_ACKNOWLEDGED"; document: import('./app-host').Live2PetProject }
  | { type: "UNDO_PROJECT_EDIT" }
  | { type: "REDO_PROJECT_EDIT" }
  | { type: "PROJECT_SAVED"; document: import('./app-host').Live2PetProject; documentId: string; fileName: string }
  | { type: "OPEN_SETUP" }
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
    setupReturnDestination: null,
    setupCompleted,
    projectHistory: { past: [], future: [], saved: null },
  };
}

const HISTORY_LIMIT = 100;

function sameDocument(
  left: import('./app-host').Live2PetProject | null,
  right: import('./app-host').Live2PetProject | null,
): boolean {
  return left === right || (left !== null && right !== null && JSON.stringify(left) === JSON.stringify(right));
}

function dirtyFromBaseline(
  document: import('./app-host').Live2PetProject,
  saved: import('./app-host').Live2PetProject | null,
): boolean {
  return saved === null || !sameDocument(document, saved);
}

function applyDocumentEdit(state: AppState, document: import('./app-host').Live2PetProject): AppState {
  if (!state.project?.document || document === state.project.document) return state;
  return {
    ...state,
    project: { ...state.project, document, name: document.name, dirty: dirtyFromBaseline(document, state.projectHistory.saved) },
    projectHistory: {
      past: [...state.projectHistory.past, state.project.document].slice(-HISTORY_LIMIT),
      future: [],
      saved: state.projectHistory.saved,
    },
  };
}

function safeDestination(destination: ReturnDestination, project: ProjectSession | null): ReturnDestination {
  return destination === "welcome" || project ? destination : "welcome";
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_VISUAL_SETTINGS": {
      if (!state.project?.document) return state;
      const settings = { hiddenElementIds: [...new Set(action.settings.hiddenElementIds)].sort() };
      if (JSON.stringify(settings) === JSON.stringify(state.project.document.visualSettings)) return state;
      return applyDocumentEdit(state, { ...state.project.document, format: 'live2pet-project', schemaVersion: 3, visualSettings: settings });
    }
    case "RENAME_PROJECT":
      return state.project?.document ? applyDocumentEdit(state, { ...state.project.document, name: action.name }) : state;
    case "OPEN_PROJECT":
      return {
        ...state,
        destination: "source",
        project: {
          ...action.project,
          document: action.project.document ?? null,
          dirty: action.project.dirty ?? false,
          selectedMotionId: action.project.selectedMotionId ?? null,
          selectedExpressionId: action.project.selectedExpressionId ?? null,
        },
        settingsReturnDestination: null,
        setupReturnDestination: null,
        projectHistory: {
          past: [],
          future: [],
          saved: action.project.dirty || !action.project.document ? null : action.project.document,
        },
      };

    case "CLOSE_PROJECT":
      return { ...state, destination: "welcome", project: null, settingsReturnDestination: null, projectHistory: { past: [], future: [], saved: null } };

    case "NAVIGATE":
      if (!state.project || state.destination === "setup") return state;
      if ((action.destination === "map" || action.destination === "build") && state.project.document?.sourceReview?.required) return state;
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

    case "ASSIGN_SELECTED_RECIPE": {
      if (!state.project?.document || !state.project.selectedMotionId) return state;
      const document = assignSelectedRecipe(state.project.document, action.destination, {
        motionId: state.project.selectedMotionId,
        expressionId: state.project.selectedExpressionId,
      });
      return applyDocumentEdit(state, document);
    }

    case "CLEAR_ASSIGNMENT": {
      if (!state.project?.document) return state;
      const document = clearAssignment(state.project.document, action.destination);
      return applyDocumentEdit(state, document);
    }

    case "SET_RENDER_PRESET": {
      if (!state.project?.document) return state;
      const previous = state.project.document.targets[action.target];
      if (previous.renderPreset === action.preset && !previous.options.renderOverrides) return state;
      const options = { ...previous.options };
      delete options.renderOverrides;
      const target = { ...previous, renderPreset: action.preset, options };
      const document = { ...state.project.document, targets: { ...state.project.document.targets, [action.target]: target } };
      return applyDocumentEdit(state, document);
    }

    case 'SET_CLAWD_RENDER': {
      if (!state.project?.document) return state;
      const project = state.project.document;
      const options = { ...project.targets.clawd.options };
      if (action.settings) options.renderOverrides = { ...action.settings }; else delete options.renderOverrides;
      return applyDocumentEdit(state, { ...project, targets: { ...project.targets, clawd: { ...project.targets.clawd, options } } });
    }

    case "SOURCE_RELINKED": {
      if (!state.project) return state;
      const dirty = dirtyFromBaseline(action.document, state.projectHistory.saved);
      return {
        ...state,
        destination: "source",
        project: {
          ...state.project,
          id: action.document.projectId,
          name: action.document.name,
          document: action.document,
          dirty,
          sourcePath: action.sourcePath,
          inspection: action.inspection,
          selectedMotionId: action.inspection.motions[0]?.id ?? null,
          selectedExpressionId: null,
        },
        projectHistory: { past: [], future: [], saved: dirty ? state.projectHistory.saved : action.document },
      };
    }

    case "SOURCE_REVIEW_ACKNOWLEDGED":
      return applyDocumentEdit(state, action.document);

    case "UNDO_PROJECT_EDIT": {
      if (!state.project?.document || state.projectHistory.past.length === 0) return state;
      const document = state.projectHistory.past[state.projectHistory.past.length - 1];
      return {
        ...state,
        destination: document.sourceReview?.required ? "source" : state.destination,
        project: { ...state.project, document, name: document.name, dirty: dirtyFromBaseline(document, state.projectHistory.saved) },
        projectHistory: {
          past: state.projectHistory.past.slice(0, -1),
          future: [state.project.document, ...state.projectHistory.future].slice(0, HISTORY_LIMIT),
          saved: state.projectHistory.saved,
        },
      };
    }

    case "REDO_PROJECT_EDIT": {
      if (!state.project?.document || state.projectHistory.future.length === 0) return state;
      const [document, ...future] = state.projectHistory.future;
      return {
        ...state,
        project: { ...state.project, document, name: document.name, dirty: dirtyFromBaseline(document, state.projectHistory.saved) },
        projectHistory: {
          past: [...state.projectHistory.past, state.project.document].slice(-HISTORY_LIMIT),
          future,
          saved: state.projectHistory.saved,
        },
      };
    }

    case "PROJECT_SAVED":
      return state.project
        ? {
            ...state,
            project: {
              ...state.project,
              id: action.document.projectId,
              name: action.document.name,
              document: action.document,
              documentId: action.documentId,
              fileName: action.fileName,
              dirty: false,
            },
            projectHistory: { ...state.projectHistory, saved: action.document },
          }
        : state;

    case "OPEN_SETUP":
      if (state.destination === "setup") return state;
      return { ...state, destination: "setup", setupReturnDestination: state.destination };

    case "COMPLETE_SETUP":
      return state.destination === "setup"
        ? {
            ...state,
            destination: state.setupReturnDestination === "settings"
              ? "settings"
              : safeDestination(state.setupReturnDestination ?? "welcome", state.project),
            setupCompleted: true,
            setupReturnDestination: null,
          }
        : state;

    case "UPDATE_LANGUAGE":
      return { ...state, settings: { ...state.settings, language: action.language } };

    case "UPDATE_APPEARANCE":
      return { ...state, settings: { ...state.settings, appearance: action.appearance } };
  }
}
