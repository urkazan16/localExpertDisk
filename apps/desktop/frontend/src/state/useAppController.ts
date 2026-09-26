import { isTauri } from "@tauri-apps/api/core";
import {
  audioDir,
  documentDir,
  downloadDir,
  homeDir,
  pictureDir,
  videoDir,
} from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getAppInfo,
  type AppInfo,
  type Platform,
  type VolumeInfo,
} from "../api/generated";
import { errorMessage } from "../api/errors";
import type { IconName } from "../ui/icons";
import { isTerminal } from "./scanState";
import { useScanController } from "./useScanController";

export type AppView =
  "home" | "structure" | "old-files" | "duplicates" | "history";

export type RuntimeState =
  | { status: "loading" }
  | { status: "browser" }
  | { status: "ready"; info: AppInfo }
  | { status: "error"; message: string; retryable: boolean };

export type LocationTarget = {
  icon: IconName;
  kind: "folder" | "volume";
  label: string;
  path: string;
  volume?: VolumeInfo;
};

export type FavoriteLocation = LocationTarget & { key: string };

export type WorkspaceState =
  | "booting"
  | "browser-preview"
  | "fatal-error"
  | "no-target"
  | "ready"
  | "scanning"
  | "result"
  | "tool";

const readableStates = new Set(["completed", "partial", "cancelled"]);

const favoriteLoaders: Array<{
  icon: IconName;
  key: string;
  label: string;
  load: () => Promise<string>;
}> = [
  { key: "downloads", label: "Загрузки", icon: "downloads", load: downloadDir },
  { key: "documents", label: "Документы", icon: "file", load: documentDir },
  { key: "pictures", label: "Изображения", icon: "folder", load: pictureDir },
  { key: "videos", label: "Видео", icon: "folder", load: videoDir },
  { key: "music", label: "Музыка", icon: "folder", load: audioDir },
];

function retryable(error: unknown): boolean {
  return !(
    typeof error === "object" &&
    error !== null &&
    "recoverable" in error &&
    error.recoverable === false
  );
}

function targetFromPath(path: string, volumes: VolumeInfo[]): LocationTarget {
  const volume = volumes.find((item) => item.mount_point === path);
  const fallbackLabel = path.split(/[\\/]/).filter(Boolean).at(-1) || path;
  return volume
    ? {
        icon: "disk",
        kind: "volume",
        label: volume.name || volume.mount_point || fallbackLabel,
        path,
        volume,
      }
    : { icon: "folder", kind: "folder", label: fallbackLabel, path };
}

async function loadFavorites(): Promise<FavoriteLocation[]> {
  const results = await Promise.allSettled(
    favoriteLoaders.map(async (favorite) => ({
      ...favorite,
      kind: "folder" as const,
      path: await favorite.load(),
    })),
  );
  const paths = new Set<string>();
  return results.flatMap((result) => {
    if (result.status !== "fulfilled" || paths.has(result.value.path))
      return [];
    paths.add(result.value.path);
    return [
      {
        key: result.value.key,
        label: result.value.label,
        path: result.value.path,
        icon: result.value.icon,
        kind: result.value.kind,
      },
    ];
  });
}

export function useAppController() {
  const [attempt, setAttempt] = useState(0);
  const [runtime, setRuntime] = useState<RuntimeState>({ status: "loading" });
  const [selectedTarget, setSelectedTarget] = useState<LocationTarget | null>(
    null,
  );
  const [favorites, setFavorites] = useState<FavoriteLocation[]>([]);
  const [homePath, setHomePath] = useState<string | null>(null);
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [view, setView] = useState<AppView>("home");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    let active = true;
    if (!isTauri()) {
      setRuntime({ status: "browser" });
      return;
    }
    setRuntime({ status: "loading" });
    getAppInfo().then(
      (info) => {
        if (active) setRuntime({ status: "ready", info });
      },
      (error: unknown) => {
        if (active)
          setRuntime({
            status: "error",
            message: errorMessage(error),
            retryable: retryable(error),
          });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  const scan = useScanController({ enabled: runtime.status === "ready" });

  useEffect(() => {
    if (runtime.status !== "ready") return;
    let active = true;
    setFavoritesLoading(true);
    Promise.all([homeDir(), loadFavorites()])
      .then(([home, items]) => {
        if (!active) return;
        setHomePath(home);
        setFavorites(items);
        setLocationError(null);
      })
      .catch((reason: unknown) => {
        if (active) setLocationError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setFavoritesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [runtime.status]);

  useEffect(() => {
    if (!scan.scan) return;
    const restored = targetFromPath(scan.scan.root_path, scan.volumes);
    if (!selectedTarget) {
      setSelectedTarget(restored);
    } else if (
      selectedTarget.path === restored.path &&
      selectedTarget.kind !== "volume" &&
      restored.kind === "volume"
    ) {
      setSelectedTarget(restored);
    }
  }, [scan.scan, scan.volumes, selectedTarget]);

  useEffect(() => {
    if (
      scan.scan &&
      selectedTarget?.path === scan.scan.root_path &&
      readableStates.has(scan.scan.state)
    )
      setView("structure");
  }, [scan.scan, selectedTarget?.path]);

  const selectTarget = useCallback(
    (target: LocationTarget) => {
      if (scan.busy) return;
      setSelectedTarget(target);
      scan.setRoot(target.path);
      setLocationError(null);
      setView("home");
    },
    [scan],
  );

  const selectFolderPath = useCallback(
    (path: string) => {
      const normalized = path.trim();
      if (normalized) selectTarget(targetFromPath(normalized, scan.volumes));
    },
    [scan.volumes, selectTarget],
  );

  const selectVolume = useCallback(
    (volume: VolumeInfo) => {
      if (!volume.mount_point) return;
      selectTarget(targetFromPath(volume.mount_point, scan.volumes));
    },
    [scan.volumes, selectTarget],
  );

  const selectHome = useCallback(() => {
    if (!homePath) {
      setView("home");
      return;
    }
    selectTarget({
      icon: "home",
      kind: "folder",
      label: homePath.split(/[\\/]/).filter(Boolean).at(-1) || "Домой",
      path: homePath,
    });
  }, [homePath, selectTarget]);

  const chooseFolder = useCallback(async () => {
    if (runtime.status !== "ready" || scan.busy || pickerLoading) return;
    setPickerLoading(true);
    setLocationError(null);
    try {
      const result = await open({
        directory: true,
        multiple: false,
        title: "Выберите папку для анализа",
      });
      const path = Array.isArray(result) ? result[0] : result;
      if (path) selectFolderPath(path);
    } catch (reason: unknown) {
      setLocationError(errorMessage(reason));
    } finally {
      setPickerLoading(false);
    }
  }, [pickerLoading, runtime.status, scan.busy, selectFolderPath]);

  const startSelected = useCallback(async () => {
    if (!selectedTarget) return;
    await scan.start(selectedTarget.path);
  }, [scan, selectedTarget]);

  const openHistoricalScan = useCallback(
    (historicalScan: Parameters<typeof scan.openScan>[0]) => {
      scan.openScan(historicalScan);
      setSelectedTarget(targetFromPath(historicalScan.root_path, scan.volumes));
      setView("structure");
    },
    [scan],
  );

  const matchingScan = Boolean(
    scan.scan && selectedTarget?.path === scan.scan.root_path,
  );
  const workspace: WorkspaceState = useMemo(() => {
    if (runtime.status === "loading") return "booting";
    if (runtime.status === "browser") return "browser-preview";
    if (runtime.status === "error") return "fatal-error";
    if (scan.activeScan) return "scanning";
    if (view === "old-files" || view === "duplicates" || view === "history")
      return "tool";
    if (
      view === "structure" &&
      matchingScan &&
      scan.scan &&
      isTerminal(scan.scan)
    )
      return "result";
    return selectedTarget ? "ready" : "no-target";
  }, [
    matchingScan,
    runtime.status,
    scan.activeScan,
    scan.scan,
    selectedTarget,
    view,
  ]);

  return {
    chooseFolder,
    favorites,
    favoritesLoading,
    homePath,
    locationError,
    openHistoricalScan,
    pickerLoading,
    platform: runtime.status === "ready" ? runtime.info.platform : null,
    retry: () => setAttempt((value) => value + 1),
    runtime,
    scan,
    selectHome,
    selectFolderPath,
    selectTarget,
    selectVolume,
    selectedTarget,
    setSidebarCollapsed,
    setView,
    sidebarCollapsed,
    startSelected,
    view,
    workspace,
  };
}

export type AppController = ReturnType<typeof useAppController>;

export const platformLabels: Record<Platform, string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
  unsupported: "Не поддерживается",
};
