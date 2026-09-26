import type {
  CategorySummary,
  DirectoryMap,
  DirectoryMapMetric,
  EntryPage,
  FileCategory,
  FileSort,
  IndexedEntry,
} from "../api/generated";

export type FolderSort = "size_desc" | "name_asc";
export type DirectoryVisualizationMode = "treemap" | "sunburst";

export type AnalyzerDomainState = {
  root: IndexedEntry | null;
  directory: IndexedEntry | null;
  children: EntryPage | null;
  directoryMap: DirectoryMap | null;
  categories: CategorySummary[] | null;
  categoryFiles: EntryPage | null;
  largeFiles: EntryPage | null;
  search: EntryPage | null;
};

export type AnalyzerUiState = {
  navigation: IndexedEntry[];
  navigationIndex: number;
  selected: IndexedEntry[];
  folderSort: FolderSort;
  visualizationMode: DirectoryVisualizationMode;
  directoryMapMetric: DirectoryMapMetric;
  activeCategory: FileCategory | null;
  largeMinSize: string;
  largeCategory: FileCategory | "";
  largeSort: FileSort;
  searchText: string;
  searchQuery: string;
  pendingRequests: number;
  error: string | null;
  directoryMapLoading: boolean;
  directoryMapError: string | null;
};

export type AnalyzerState = {
  scanId: string | null;
  domain: AnalyzerDomainState;
  ui: AnalyzerUiState;
};

export function createAnalyzerState(
  scanId: string | null = null,
): AnalyzerState {
  return {
    scanId,
    domain: {
      root: null,
      directory: null,
      children: null,
      directoryMap: null,
      categories: null,
      categoryFiles: null,
      largeFiles: null,
      search: null,
    },
    ui: {
      navigation: [],
      navigationIndex: -1,
      selected: [],
      folderSort: "size_desc",
      visualizationMode: "treemap",
      directoryMapMetric: "logical",
      activeCategory: null,
      largeMinSize: "0",
      largeCategory: "",
      largeSort: "size_desc",
      searchText: "",
      searchQuery: "",
      pendingRequests: 0,
      error: null,
      directoryMapLoading: false,
      directoryMapError: null,
    },
  };
}

export type AnalyzerAction =
  | { type: "scan/reset"; scanId: string | null }
  | {
      type: "initial/success";
      root: IndexedEntry;
      children: EntryPage;
      categories: CategorySummary[];
    }
  | { type: "request/start" }
  | { type: "request/finish" }
  | { type: "request/error"; message: string }
  | { type: "error/clear" }
  | { type: "map/start" }
  | { type: "map/success"; map: DirectoryMap }
  | { type: "map/error"; message: string }
  | { type: "map/metric"; metric: DirectoryMapMetric }
  | { type: "visualization/mode"; mode: DirectoryVisualizationMode }
  | { type: "directory/activate"; entry: IndexedEntry; page: EntryPage }
  | { type: "directory/navigate"; index: number; page: EntryPage }
  | { type: "directory/page"; page: EntryPage }
  | { type: "selection/toggle"; entry: IndexedEntry }
  | { type: "selection/replace"; entries: IndexedEntry[] }
  | { type: "folder/sort"; sort: FolderSort }
  | {
      type: "large/filters";
      minSize?: string;
      category?: FileCategory | "";
      sort?: FileSort;
    }
  | { type: "large/success"; page: EntryPage }
  | { type: "category/success"; category: FileCategory; page: EntryPage }
  | { type: "search/text"; text: string }
  | { type: "search/success"; query: string; page: EntryPage }
  | { type: "queries/invalidate" };

export function analyzerReducer(
  state: AnalyzerState,
  action: AnalyzerAction,
): AnalyzerState {
  switch (action.type) {
    case "scan/reset":
      return createAnalyzerState(action.scanId);
    case "initial/success":
      return {
        ...state,
        domain: {
          ...state.domain,
          root: action.root,
          directory: action.root,
          children: action.children,
          categories: action.categories,
        },
        ui: {
          ...state.ui,
          navigation: [action.root],
          navigationIndex: 0,
          selected: [],
        },
      };
    case "request/start":
      return {
        ...state,
        ui: {
          ...state.ui,
          pendingRequests: state.ui.pendingRequests + 1,
          error: null,
        },
      };
    case "request/finish":
      return {
        ...state,
        ui: {
          ...state.ui,
          pendingRequests: Math.max(0, state.ui.pendingRequests - 1),
        },
      };
    case "request/error":
      return { ...state, ui: { ...state.ui, error: action.message } };
    case "error/clear":
      return { ...state, ui: { ...state.ui, error: null } };
    case "map/start":
      return {
        ...state,
        domain: { ...state.domain, directoryMap: null },
        ui: {
          ...state.ui,
          directoryMapLoading: true,
          directoryMapError: null,
        },
      };
    case "map/success":
      return {
        ...state,
        domain: { ...state.domain, directoryMap: action.map },
        ui: { ...state.ui, directoryMapLoading: false },
      };
    case "map/error":
      return {
        ...state,
        ui: {
          ...state.ui,
          directoryMapLoading: false,
          directoryMapError: action.message,
        },
      };
    case "map/metric":
      return {
        ...state,
        ui: { ...state.ui, directoryMapMetric: action.metric },
      };
    case "visualization/mode":
      return {
        ...state,
        ui: { ...state.ui, visualizationMode: action.mode },
      };
    case "directory/activate": {
      const navigation = [
        ...state.ui.navigation.slice(0, state.ui.navigationIndex + 1),
        action.entry,
      ];
      return {
        ...state,
        domain: {
          ...state.domain,
          directory: action.entry,
          children: action.page,
          categoryFiles: null,
          largeFiles: null,
          search: null,
        },
        ui: {
          ...state.ui,
          navigation,
          navigationIndex: navigation.length - 1,
          selected: [],
          activeCategory: null,
          searchQuery: "",
        },
      };
    }
    case "directory/navigate": {
      const entry = state.ui.navigation[action.index];
      if (!entry) return state;
      return {
        ...state,
        domain: {
          ...state.domain,
          directory: entry,
          children: action.page,
          categoryFiles: null,
          largeFiles: null,
          search: null,
        },
        ui: {
          ...state.ui,
          navigationIndex: action.index,
          selected: [],
          activeCategory: null,
          searchQuery: "",
        },
      };
    }
    case "directory/page":
      return { ...state, domain: { ...state.domain, children: action.page } };
    case "selection/toggle": {
      const selected = state.ui.selected.some(
        (item) => item.id === action.entry.id,
      )
        ? state.ui.selected.filter((item) => item.id !== action.entry.id)
        : [...state.ui.selected, action.entry];
      return { ...state, ui: { ...state.ui, selected } };
    }
    case "selection/replace":
      return { ...state, ui: { ...state.ui, selected: action.entries } };
    case "folder/sort":
      return { ...state, ui: { ...state.ui, folderSort: action.sort } };
    case "large/filters":
      return {
        ...state,
        ui: {
          ...state.ui,
          largeMinSize: action.minSize ?? state.ui.largeMinSize,
          largeCategory: action.category ?? state.ui.largeCategory,
          largeSort: action.sort ?? state.ui.largeSort,
        },
      };
    case "large/success":
      return { ...state, domain: { ...state.domain, largeFiles: action.page } };
    case "category/success":
      return {
        ...state,
        domain: { ...state.domain, categoryFiles: action.page },
        ui: { ...state.ui, activeCategory: action.category },
      };
    case "search/text":
      return { ...state, ui: { ...state.ui, searchText: action.text } };
    case "search/success":
      return {
        ...state,
        domain: { ...state.domain, search: action.page },
        ui: { ...state.ui, searchQuery: action.query },
      };
    case "queries/invalidate":
      return {
        ...state,
        domain: {
          ...state.domain,
          categoryFiles: null,
          largeFiles: null,
          search: null,
        },
        ui: {
          ...state.ui,
          activeCategory: null,
          searchQuery: "",
        },
      };
  }
}
