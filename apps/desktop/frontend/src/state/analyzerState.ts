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
export type AnalyzerResultMode =
  "structure" | "large" | "categories" | "search";
export type DirectoryColumn = {
  directory: IndexedEntry;
  page: EntryPage | null;
  loading: boolean;
  error: string | null;
};

export type AnalyzerDomainState = {
  root: IndexedEntry | null;
  directory: IndexedEntry | null;
  columns: DirectoryColumn[];
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
  focusedEntryId: string | null;
  focusedColumnIndex: number;
  columnScrollOffsets: Record<string, number>;
  folderSort: FolderSort;
  resultMode: AnalyzerResultMode;
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
  directoryMapRevision: number;
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
      columns: [],
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
      focusedEntryId: null,
      focusedColumnIndex: 0,
      columnScrollOffsets: {},
      folderSort: "size_desc",
      resultMode: "structure",
      visualizationMode: "sunburst",
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
      directoryMapRevision: 0,
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
  | { type: "map/refresh" }
  | { type: "map/metric"; metric: DirectoryMapMetric }
  | { type: "visualization/mode"; mode: DirectoryVisualizationMode }
  | { type: "directory/load-start"; entry: IndexedEntry; parentIndex: number }
  | {
      type: "directory/activate";
      entry: IndexedEntry;
      page: EntryPage;
      parentIndex: number;
    }
  | {
      type: "directory/activate-path";
      entries: IndexedEntry[];
      pages: EntryPage[];
      parentIndex: number;
    }
  | { type: "directory/navigate"; index: number }
  | { type: "directory/page-start"; index: number }
  | { type: "directory/page"; index: number; page: EntryPage }
  | { type: "directory/error"; index: number; message: string }
  | { type: "selection/toggle"; entry: IndexedEntry }
  | { type: "selection/replace"; entries: IndexedEntry[] }
  | { type: "selection/single"; entry: IndexedEntry }
  | { type: "selection/all"; entries: IndexedEntry[] }
  | { type: "selection/clear" }
  | { type: "focus/entry"; entryId: string | null; columnIndex: number }
  | { type: "column/scroll"; directoryId: string; scrollTop: number }
  | { type: "folder/sort"; sort: FolderSort }
  | { type: "result/mode"; mode: AnalyzerResultMode }
  | {
      type: "large/filters";
      minSize?: string;
      category?: FileCategory | "";
      sort?: FileSort;
    }
  | { type: "large/success"; page: EntryPage }
  | { type: "category/success"; category: FileCategory; page: EntryPage }
  | { type: "search/text"; text: string }
  | { type: "search/clear" }
  | { type: "search/success"; query: string; page: EntryPage }
  | { type: "queries/invalidate" };

function clearQueries(state: AnalyzerState) {
  return {
    domain: {
      ...state.domain,
      categoryFiles: null,
      largeFiles: null,
      search: null,
    },
    ui: { ...state.ui, activeCategory: null, searchQuery: "" },
  };
}

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
          columns: [
            {
              directory: action.root,
              page: action.children,
              loading: false,
              error: null,
            },
          ],
          categories: action.categories,
        },
        ui: {
          ...state.ui,
          navigation: [action.root],
          navigationIndex: 0,
          selected: [],
          focusedEntryId: action.children.items[0]?.id ?? null,
          focusedColumnIndex: 0,
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
        ui: { ...state.ui, directoryMapLoading: true, directoryMapError: null },
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
    case "map/refresh":
      return {
        ...state,
        ui: {
          ...state.ui,
          directoryMapRevision: state.ui.directoryMapRevision + 1,
        },
      };
    case "map/metric":
      return {
        ...state,
        ui: { ...state.ui, directoryMapMetric: action.metric },
      };
    case "visualization/mode":
      return { ...state, ui: { ...state.ui, visualizationMode: action.mode } };
    case "directory/load-start":
      return {
        ...state,
        domain: {
          ...state.domain,
          columns: [
            ...state.domain.columns.slice(0, action.parentIndex + 1),
            { directory: action.entry, page: null, loading: true, error: null },
          ],
        },
      };
    case "directory/activate": {
      const navigation = [
        ...state.ui.navigation.slice(0, action.parentIndex + 1),
        action.entry,
      ];
      const cleared = clearQueries(state);
      return {
        ...state,
        domain: {
          ...cleared.domain,
          directory: action.entry,
          columns: [
            ...state.domain.columns.slice(0, action.parentIndex + 1),
            {
              directory: action.entry,
              page: action.page,
              loading: false,
              error: null,
            },
          ],
        },
        ui: {
          ...cleared.ui,
          navigation,
          navigationIndex: navigation.length - 1,
          selected: [],
          focusedEntryId: action.page.items[0]?.id ?? null,
          focusedColumnIndex: navigation.length - 1,
        },
      };
    }
    case "directory/activate-path": {
      const current = action.entries.at(-1);
      const currentPage = action.pages.at(-1);
      if (
        !current ||
        !currentPage ||
        action.entries.length !== action.pages.length
      )
        return state;
      const navigation = [
        ...state.ui.navigation.slice(0, action.parentIndex + 1),
        ...action.entries,
      ];
      const cleared = clearQueries(state);
      return {
        ...state,
        domain: {
          ...cleared.domain,
          directory: current,
          columns: [
            ...state.domain.columns.slice(0, action.parentIndex + 1),
            ...action.entries.map((entry, index) => ({
              directory: entry,
              page: action.pages[index],
              loading: false,
              error: null,
            })),
          ],
        },
        ui: {
          ...cleared.ui,
          navigation,
          navigationIndex: navigation.length - 1,
          selected: [],
          focusedEntryId: currentPage.items[0]?.id ?? null,
          focusedColumnIndex: navigation.length - 1,
        },
      };
    }
    case "directory/navigate": {
      const entry = state.ui.navigation[action.index];
      const column = state.domain.columns[action.index];
      if (!entry || !column?.page) return state;
      const cleared = clearQueries(state);
      return {
        ...state,
        domain: { ...cleared.domain, directory: entry },
        ui: {
          ...cleared.ui,
          navigationIndex: action.index,
          selected: [],
          focusedEntryId: column.page.items[0]?.id ?? null,
          focusedColumnIndex: action.index,
        },
      };
    }
    case "directory/page-start":
      return {
        ...state,
        domain: {
          ...state.domain,
          columns: state.domain.columns.map((column, index) =>
            index === action.index
              ? { ...column, loading: true, error: null }
              : column,
          ),
        },
      };
    case "directory/page":
      return {
        ...state,
        domain: {
          ...state.domain,
          columns: state.domain.columns.map((column, index) =>
            index === action.index
              ? { ...column, page: action.page, loading: false, error: null }
              : column,
          ),
        },
        ui: {
          ...state.ui,
          focusedEntryId: action.page.items[0]?.id ?? null,
          focusedColumnIndex: action.index,
        },
      };
    case "directory/error":
      return {
        ...state,
        domain: {
          ...state.domain,
          columns: state.domain.columns.map((column, index) =>
            index === action.index
              ? { ...column, loading: false, error: action.message }
              : column,
          ),
        },
      };
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
    case "selection/single":
      return {
        ...state,
        ui: {
          ...state.ui,
          selected: [action.entry],
          focusedEntryId: action.entry.id,
        },
      };
    case "selection/all":
      return { ...state, ui: { ...state.ui, selected: action.entries } };
    case "selection/clear":
      return { ...state, ui: { ...state.ui, selected: [] } };
    case "focus/entry":
      return {
        ...state,
        ui: {
          ...state.ui,
          focusedEntryId: action.entryId,
          focusedColumnIndex: action.columnIndex,
        },
      };
    case "column/scroll":
      return {
        ...state,
        ui: {
          ...state.ui,
          columnScrollOffsets: {
            ...state.ui.columnScrollOffsets,
            [action.directoryId]: action.scrollTop,
          },
        },
      };
    case "folder/sort":
      return { ...state, ui: { ...state.ui, folderSort: action.sort } };
    case "result/mode":
      return { ...state, ui: { ...state.ui, resultMode: action.mode } };
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
    case "search/clear":
      return {
        ...state,
        domain: { ...state.domain, search: null },
        ui: { ...state.ui, searchText: "", searchQuery: "", selected: [] },
      };
    case "search/success":
      return {
        ...state,
        domain: { ...state.domain, search: action.page },
        ui: { ...state.ui, searchQuery: action.query },
      };
    case "queries/invalidate": {
      const cleared = clearQueries(state);
      return { ...state, ...cleared };
    }
  }
}
