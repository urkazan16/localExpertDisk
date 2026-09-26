import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelScan,
  getScan,
  getScanIssues,
  getVolumes,
  startScan,
  type ScanIssuePage,
  type ScanSession,
  type VolumeInfo,
} from "../api/generated";
import { errorMessage } from "../api/errors";
import { isTerminal, mergeScan } from "./scanState";

export type ScanController = ReturnType<typeof useScanController>;

export function useScanController({
  enabled,
  onScanChange,
}: {
  enabled: boolean;
  onScanChange?: (scan: ScanSession | null) => void;
}) {
  const [root, setRoot] = useState("");
  const [volumes, setVolumes] = useState<VolumeInfo[]>([]);
  const [volumeError, setVolumeError] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanSession | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [issuePage, setIssuePage] = useState<ScanIssuePage | null>(null);
  const [issueLoading, setIssueLoading] = useState(false);
  const generation = useRef(0);
  const submitting = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    onScanChange?.(scan);
  }, [onScanChange, scan]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let active = true;
    const current = generation.current;
    setLoading(true);
    setVolumeError(null);
    getVolumes().then(
      (items) => {
        if (active) setVolumes(items);
      },
      (reason: unknown) => {
        if (active) setVolumeError(errorMessage(reason));
      },
    );
    getScan()
      .then(
        (item) => {
          if (active && current === generation.current) {
            setScan((previous) =>
              item ? mergeScan(previous, item) : previous,
            );
            if (item) setRoot((previous) => previous || item.root_path);
            setError(null);
          }
        },
        (reason: unknown) => {
          if (active) setError(errorMessage(reason));
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [enabled, refresh]);

  const activeScan = scan && !isTerminal(scan) ? scan.id : null;
  useEffect(() => {
    if (!enabled || !activeScan) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const current = generation.current;
    const poll = async () => {
      try {
        const update = await getScan(activeScan);
        if (active && current === generation.current && update)
          setScan((previous) => mergeScan(previous, update));
      } catch (reason: unknown) {
        if (active) setError(errorMessage(reason));
      }
      if (active)
        timer = setTimeout(() => {
          void poll();
        }, 1000);
    };
    timer = setTimeout(() => {
      void poll();
    }, 1000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [enabled, activeScan]);

  const start = useCallback(
    async (requestedRoot?: string) => {
      const target = (requestedRoot ?? root).trim();
      if (submitting.current || activeScan || !target || !enabled) return false;
      submitting.current = true;
      setStarting(true);
      setRoot(target);
      setError(null);
      setIssuePage(null);
      const current = ++generation.current;
      try {
        const result = await startScan({ root_path: target }, (update) => {
          if (mounted.current && current === generation.current)
            setScan((previous) => mergeScan(previous, update));
        });
        if (mounted.current && current === generation.current)
          setScan((previous) => mergeScan(previous, result));
        return true;
      } catch (reason: unknown) {
        if (mounted.current) setError(errorMessage(reason));
        return false;
      } finally {
        submitting.current = false;
        if (mounted.current) setStarting(false);
      }
    },
    [activeScan, enabled, root],
  );

  const cancel = useCallback(async () => {
    if (!scan || cancelling) return;
    const current = generation.current;
    setCancelling(true);
    setError(null);
    try {
      const result = await cancelScan(scan.id);
      if (mounted.current && current === generation.current)
        setScan((previous) => mergeScan(previous, result));
    } catch (reason: unknown) {
      if (mounted.current) setError(errorMessage(reason));
    } finally {
      if (mounted.current) setCancelling(false);
    }
  }, [cancelling, scan]);

  const loadIssues = useCallback(async () => {
    if (!scan || issueLoading) return;
    const current = generation.current;
    setIssueLoading(true);
    setError(null);
    try {
      const page = await getScanIssues(scan.id, issuePage?.next_cursor ?? null);
      if (mounted.current && current === generation.current) setIssuePage(page);
    } catch (reason: unknown) {
      if (mounted.current) setError(errorMessage(reason));
    } finally {
      if (mounted.current) setIssueLoading(false);
    }
  }, [issueLoading, issuePage?.next_cursor, scan]);

  const reload = useCallback(() => {
    setIssuePage(null);
    setRefresh((value) => value + 1);
  }, []);

  const openScan = useCallback((nextScan: ScanSession) => {
    generation.current += 1;
    setIssuePage(null);
    setRoot(nextScan.root_path);
    setScan(nextScan);
  }, []);

  return {
    activeScan,
    busy: starting || Boolean(activeScan),
    cancel,
    cancelling,
    error,
    issueLoading,
    issuePage,
    loadIssues,
    loading,
    openScan,
    reload,
    root,
    scan,
    setRoot,
    start,
    starting,
    volumeError,
    volumes,
  };
}
