import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  getCategories,
  getChildren,
  getDirectoryMap,
  getFilesInCategory,
  getFilteredLargeFiles,
  getScanRoot,
  moveEntriesToTrash,
  moveEntryToTrash,
  openEntry,
  revealEntry,
  searchEntries,
  type DirectoryMapMetric,
  type FileCategory,
  type FileSort,
  type IndexedEntry,
  type ScanSession,
} from "../api/generated";
import { errorMessage } from "../api/errors";
import {
  analyzerReducer,
  createAnalyzerState,
  type AnalyzerResultMode,
  type DirectoryVisualizationMode,
  type FolderSort,
} from "./analyzerState";

const readableStates = new Set(["completed", "partial", "cancelled"]);

export function useAnalyzerController({
  enabled,
  scan,
}: {
  enabled: boolean;
  scan: ScanSession | null;
}) {
  const [state, dispatch] = useReducer(
    analyzerReducer,
    scan?.id ?? null,
    createAnalyzerState,
  );
  const scanGeneration = useRef(0);
  const directoryGeneration = useRef(0);
  const mapGeneration = useRef(0);
  const largeGeneration = useRef(0);
  const categoryGeneration = useRef(0);
  const searchGeneration = useRef(0);
  const usable = Boolean(enabled && scan && readableStates.has(scan.state));
  const scanId = scan?.id ?? null;

  const invalidateQueries = useCallback(() => {
    largeGeneration.current += 1;
    categoryGeneration.current += 1;
    searchGeneration.current += 1;
  }, []);

  const invalidateRequests = useCallback(() => {
    directoryGeneration.current += 1;
    mapGeneration.current += 1;
    invalidateQueries();
  }, [invalidateQueries]);

  useEffect(() => {
    const currentScan = ++scanGeneration.current;
    invalidateRequests();
    dispatch({ type: "scan/reset", scanId });
    if (!usable || !scanId) return;
    dispatch({ type: "request/start" });
    void getScanRoot(scanId)
      .then(async (root) => {
        const [children, categories] = await Promise.all([
          getChildren(scanId, root.id),
          getCategories(scanId),
        ]);
        if (currentScan === scanGeneration.current) {
          dispatch({ type: "initial/success", root, children, categories });
        }
      })
      .catch((reason: unknown) => {
        if (currentScan === scanGeneration.current) {
          dispatch({ type: "request/error", message: errorMessage(reason) });
        }
      })
      .finally(() => {
        if (currentScan === scanGeneration.current) {
          dispatch({ type: "request/finish" });
        }
      });
    return () => {
      if (currentScan === scanGeneration.current) scanGeneration.current += 1;
    };
  }, [invalidateRequests, scanId, usable]);

  useEffect(() => {
    const directory = state.domain.directory;
    const metric = state.ui.directoryMapMetric;
    const current = ++mapGeneration.current;
    if (!usable || !scan || state.scanId !== scan.id || !directory) return;
    if (
      (metric === "allocated" && scan.allocated_size === null) ||
      (metric === "unique_allocated" && scan.unique_allocated_size === null)
    ) {
      dispatch({ type: "map/metric", metric: "logical" });
      return;
    }
    dispatch({ type: "map/start" });
    void getDirectoryMap(scan.id, directory.id, metric, 3, 8).then(
      (map) => {
        if (current === mapGeneration.current)
          dispatch({ type: "map/success", map });
      },
      (reason: unknown) => {
        if (current === mapGeneration.current)
          dispatch({ type: "map/error", message: errorMessage(reason) });
      },
    );
    return () => {
      if (current === mapGeneration.current) mapGeneration.current += 1;
    };
  }, [
    scan,
    state.domain.directory,
    state.scanId,
    state.ui.directoryMapMetric,
    state.ui.directoryMapRevision,
    usable,
  ]);

  const activateDirectoryPath = useCallback(
    async (entries: IndexedEntry[]) => {
      if (!scan || entries.length === 0) return false;
      const entry = entries.at(-1)!;
      const parentIndex = state.ui.navigationIndex;
      const columnIndex = parentIndex + 1;
      const currentScan = scanGeneration.current;
      const current = ++directoryGeneration.current;
      dispatch({ type: "request/start" });
      dispatch({ type: "directory/load-start", entry, parentIndex });
      try {
        const pages = await Promise.all(
          entries.map((item) => getChildren(scan.id, item.id, null)),
        );
        if (
          currentScan !== scanGeneration.current ||
          current !== directoryGeneration.current
        )
          return false;
        mapGeneration.current += 1;
        invalidateQueries();
        dispatch({
          type: "directory/activate-path",
          entries,
          pages,
          parentIndex,
        });
        return true;
      } catch (reason: unknown) {
        if (
          currentScan === scanGeneration.current &&
          current === directoryGeneration.current
        ) {
          const message = errorMessage(reason);
          dispatch({ type: "directory/error", index: columnIndex, message });
          dispatch({ type: "request/error", message });
        }
      } finally {
        if (currentScan === scanGeneration.current)
          dispatch({ type: "request/finish" });
      }
      return false;
    },
    [invalidateQueries, scan, state.ui.navigationIndex],
  );

  const activateDirectory = useCallback(
    (entry: IndexedEntry) => activateDirectoryPath([entry]),
    [activateDirectoryPath],
  );

  const navigateTo = useCallback(
    (index: number) => {
      if (!state.domain.columns[index]?.page) return false;
      directoryGeneration.current += 1;
      mapGeneration.current += 1;
      invalidateQueries();
      dispatch({ type: "directory/navigate", index });
      return true;
    },
    [invalidateQueries, state.domain.columns],
  );

  const loadNextDirectoryPage = useCallback(
    async (index = state.ui.navigationIndex) => {
      if (!scan) return false;
      const column = state.domain.columns[index];
      const cursor = column?.page?.next_cursor;
      if (!column || !cursor) return false;
      const currentScan = scanGeneration.current;
      const current = ++directoryGeneration.current;
      dispatch({ type: "request/start" });
      dispatch({ type: "directory/page-start", index });
      try {
        const page = await getChildren(scan.id, column.directory.id, cursor);
        if (
          currentScan !== scanGeneration.current ||
          current !== directoryGeneration.current
        )
          return false;
        dispatch({ type: "directory/page", index, page });
        return true;
      } catch (reason: unknown) {
        if (
          currentScan === scanGeneration.current &&
          current === directoryGeneration.current
        ) {
          const message = errorMessage(reason);
          dispatch({ type: "directory/error", index, message });
          dispatch({ type: "request/error", message });
        }
      } finally {
        if (currentScan === scanGeneration.current)
          dispatch({ type: "request/finish" });
      }
      return false;
    },
    [scan, state.domain.columns, state.ui.navigationIndex],
  );

  const showLargeFiles = useCallback(
    async (after: string | null = null) => {
      if (!scan) return;
      const currentScan = scanGeneration.current;
      const current = ++largeGeneration.current;
      dispatch({ type: "request/start" });
      try {
        const page = await getFilteredLargeFiles(
          scan.id,
          state.ui.largeMinSize,
          state.ui.largeCategory || null,
          state.ui.largeSort,
          after,
        );
        if (
          currentScan === scanGeneration.current &&
          current === largeGeneration.current
        )
          dispatch({ type: "large/success", page });
      } catch (reason: unknown) {
        if (
          currentScan === scanGeneration.current &&
          current === largeGeneration.current
        )
          dispatch({ type: "request/error", message: errorMessage(reason) });
      } finally {
        if (currentScan === scanGeneration.current)
          dispatch({ type: "request/finish" });
      }
    },
    [scan, state.ui.largeCategory, state.ui.largeMinSize, state.ui.largeSort],
  );

  const showCategory = useCallback(
    async (category: FileCategory, after: string | null = null) => {
      if (!scan) return;
      const currentScan = scanGeneration.current;
      const current = ++categoryGeneration.current;
      dispatch({ type: "request/start" });
      try {
        const page = await getFilesInCategory(scan.id, category, after);
        if (
          currentScan === scanGeneration.current &&
          current === categoryGeneration.current
        )
          dispatch({ type: "category/success", category, page });
      } catch (reason: unknown) {
        if (
          currentScan === scanGeneration.current &&
          current === categoryGeneration.current
        )
          dispatch({ type: "request/error", message: errorMessage(reason) });
      } finally {
        if (currentScan === scanGeneration.current)
          dispatch({ type: "request/finish" });
      }
    },
    [scan],
  );

  const runSearch = useCallback(
    async (query: string, after: string | null = null) => {
      if (!scan || !query) return;
      const currentScan = scanGeneration.current;
      const current = ++searchGeneration.current;
      dispatch({ type: "request/start" });
      try {
        const page =
          after === null
            ? await searchEntries(scan.id, query)
            : await searchEntries(scan.id, query, after);
        if (
          currentScan === scanGeneration.current &&
          current === searchGeneration.current
        )
          dispatch({ type: "search/success", query, page });
      } catch (reason: unknown) {
        if (
          currentScan === scanGeneration.current &&
          current === searchGeneration.current
        )
          dispatch({ type: "request/error", message: errorMessage(reason) });
      } finally {
        if (currentScan === scanGeneration.current)
          dispatch({ type: "request/finish" });
      }
    },
    [scan],
  );

  const actOnEntry = useCallback(
    async (entry: IndexedEntry, action: "open" | "reveal") => {
      if (!scan) return;
      dispatch({ type: "error/clear" });
      try {
        if (action === "open") await openEntry(scan.id, entry.id);
        else await revealEntry(scan.id, entry.id);
      } catch (reason: unknown) {
        dispatch({ type: "request/error", message: errorMessage(reason) });
      }
    },
    [scan],
  );

  const refreshDirectory = useCallback(async () => {
    const directory = state.domain.directory;
    const index = state.ui.navigationIndex;
    invalidateQueries();
    if (scan && directory && index >= 0) {
      const currentScan = scanGeneration.current;
      const current = ++directoryGeneration.current;
      dispatch({ type: "request/start" });
      dispatch({ type: "directory/page-start", index });
      try {
        const page = await getChildren(scan.id, directory.id, null);
        if (
          currentScan === scanGeneration.current &&
          current === directoryGeneration.current
        )
          dispatch({ type: "directory/page", index, page });
      } catch (reason: unknown) {
        if (
          currentScan === scanGeneration.current &&
          current === directoryGeneration.current
        ) {
          const message = errorMessage(reason);
          dispatch({ type: "directory/error", index, message });
          dispatch({ type: "request/error", message });
        }
      } finally {
        if (currentScan === scanGeneration.current)
          dispatch({ type: "request/finish" });
      }
    }
    dispatch({ type: "map/refresh" });
    dispatch({ type: "queries/invalidate" });
  }, [
    invalidateQueries,
    scan,
    state.domain.directory,
    state.ui.navigationIndex,
  ]);

  const trashEntry = useCallback(
    async (entry: IndexedEntry) => {
      if (!scan) return;
      dispatch({ type: "error/clear" });
      try {
        await moveEntryToTrash(scan.id, entry.id);
        await refreshDirectory();
      } catch (reason: unknown) {
        dispatch({ type: "request/error", message: errorMessage(reason) });
      }
    },
    [refreshDirectory, scan],
  );

  const trashSelected = useCallback(async () => {
    if (!scan || state.ui.selected.length === 0) return;
    dispatch({ type: "request/start" });
    try {
      const result = await moveEntriesToTrash(
        scan.id,
        state.ui.selected.map((entry) => entry.id),
      );
      const failed = new Set(result.failed_entry_ids);
      dispatch({
        type: "selection/replace",
        entries: state.ui.selected.filter((entry) => failed.has(entry.id)),
      });
      if (result.failed_entry_ids.length)
        dispatch({
          type: "request/error",
          message: `Не удалось переместить ${result.failed_entry_ids.length} объектов.`,
        });
      await refreshDirectory();
      if (state.ui.resultMode === "large") await showLargeFiles();
      else if (state.ui.resultMode === "categories" && state.ui.activeCategory)
        await showCategory(state.ui.activeCategory);
      else if (state.ui.resultMode === "search" && state.ui.searchQuery)
        await runSearch(state.ui.searchQuery);
      return result;
    } catch (reason: unknown) {
      dispatch({ type: "request/error", message: errorMessage(reason) });
    } finally {
      dispatch({ type: "request/finish" });
    }
  }, [
    refreshDirectory,
    runSearch,
    scan,
    showCategory,
    showLargeFiles,
    state.ui.activeCategory,
    state.ui.resultMode,
    state.ui.searchQuery,
    state.ui.selected,
  ]);

  return {
    state,
    usable,
    loading: state.ui.pendingRequests > 0,
    activateDirectory,
    activateDirectoryPath,
    navigateTo,
    loadNextDirectoryPage,
    showLargeFiles,
    showCategory,
    runSearch,
    actOnEntry,
    trashEntry,
    trashSelected,
    toggleSelection: (entry: IndexedEntry) =>
      dispatch({ type: "selection/toggle", entry }),
    selectEntry: (entry: IndexedEntry) =>
      dispatch({ type: "selection/single", entry }),
    selectAll: (entries: IndexedEntry[]) =>
      dispatch({ type: "selection/all", entries }),
    clearSelection: () => dispatch({ type: "selection/clear" }),
    focusEntry: (entryId: string | null, columnIndex: number) =>
      dispatch({ type: "focus/entry", entryId, columnIndex }),
    setColumnScroll: (directoryId: string, scrollTop: number) =>
      dispatch({ type: "column/scroll", directoryId, scrollTop }),
    setResultScroll: (
      mode: "large" | "categories" | "search",
      scrollTop: number,
    ) => dispatch({ type: "result/scroll", mode, scrollTop }),
    setFolderSort: (sort: FolderSort) =>
      dispatch({ type: "folder/sort", sort }),
    setResultMode: (mode: AnalyzerResultMode) =>
      dispatch({ type: "result/mode", mode }),
    setDirectoryMapMetric: (metric: DirectoryMapMetric) =>
      dispatch({ type: "map/metric", metric }),
    setVisualizationMode: (mode: DirectoryVisualizationMode) =>
      dispatch({ type: "visualization/mode", mode }),
    setLargeMinSize: (minSize: string) =>
      dispatch({ type: "large/filters", minSize }),
    setLargeCategory: (category: FileCategory | "") =>
      dispatch({ type: "large/filters", category }),
    setLargeSort: (sort: FileSort) => dispatch({ type: "large/filters", sort }),
    setSearchText: (text: string) => dispatch({ type: "search/text", text }),
    clearSearch: () => dispatch({ type: "search/clear" }),
  };
}

export type AnalyzerController = ReturnType<typeof useAnalyzerController>;
