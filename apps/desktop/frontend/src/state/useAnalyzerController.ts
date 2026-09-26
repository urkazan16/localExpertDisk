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
    usable,
  ]);

  const loadDirectory = useCallback(
    async (
      entry: IndexedEntry,
      mode: "activate" | "navigate" | "page",
      index = -1,
      after: string | null = null,
    ) => {
      if (!scan) return false;
      const currentScan = scanGeneration.current;
      const current = ++directoryGeneration.current;
      dispatch({ type: "request/start" });
      try {
        const page = await getChildren(scan.id, entry.id, after);
        if (
          currentScan !== scanGeneration.current ||
          current !== directoryGeneration.current
        )
          return false;
        if (mode !== "page") {
          mapGeneration.current += 1;
          invalidateQueries();
        }
        if (mode === "activate")
          dispatch({ type: "directory/activate", entry, page });
        else if (mode === "navigate")
          dispatch({ type: "directory/navigate", index, page });
        else dispatch({ type: "directory/page", page });
        return true;
      } catch (reason: unknown) {
        if (
          currentScan === scanGeneration.current &&
          current === directoryGeneration.current
        )
          dispatch({ type: "request/error", message: errorMessage(reason) });
      } finally {
        if (currentScan === scanGeneration.current)
          dispatch({ type: "request/finish" });
      }
      return false;
    },
    [invalidateQueries, scan],
  );

  const activateDirectory = useCallback(
    (entry: IndexedEntry) => loadDirectory(entry, "activate"),
    [loadDirectory],
  );

  const navigateTo = useCallback(
    (index: number) => {
      const entry = state.ui.navigation[index];
      return entry
        ? loadDirectory(entry, "navigate", index)
        : Promise.resolve(false);
    },
    [loadDirectory, state.ui.navigation],
  );

  const loadNextDirectoryPage = useCallback(() => {
    const entry = state.domain.directory;
    const cursor = state.domain.children?.next_cursor;
    return entry && cursor
      ? loadDirectory(entry, "page", state.ui.navigationIndex, cursor)
      : Promise.resolve(false);
  }, [
    loadDirectory,
    state.domain.children?.next_cursor,
    state.domain.directory,
    state.ui.navigationIndex,
  ]);

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
    invalidateQueries();
    if (directory) await loadDirectory(directory, "page");
    dispatch({ type: "queries/invalidate" });
  }, [invalidateQueries, loadDirectory, state.domain.directory]);

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
    } catch (reason: unknown) {
      dispatch({ type: "request/error", message: errorMessage(reason) });
    } finally {
      dispatch({ type: "request/finish" });
    }
  }, [refreshDirectory, scan, state.ui.selected]);

  return {
    state,
    usable,
    loading: state.ui.pendingRequests > 0,
    activateDirectory,
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
    setFolderSort: (sort: FolderSort) =>
      dispatch({ type: "folder/sort", sort }),
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
  };
}

export type AnalyzerController = ReturnType<typeof useAnalyzerController>;
