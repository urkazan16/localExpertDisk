import { useEffect, useState } from "react";
import {
  cancelDuplicateHashing,
  cleanupScanHistory,
  compareScans,
  confirmDuplicates,
  deleteDuplicateEntries,
  deleteScanHistory,
  getConfirmedDuplicates,
  getDuplicateFiles,
  getRetentionPolicy,
  getScanComparisonFiles,
  getScanHistory,
  setRetentionPolicy,
  type DuplicateDeleteFailure,
  type DuplicateFilePage,
  type DuplicateGroupPage,
  type DuplicateHashFailure,
  type DuplicateHashProgress,
  type ErrorCode,
  type ScanComparison,
  type ScanComparisonFilePage,
  type ScanComparisonKind,
  type ScanHistoryPage,
  type ScanSession,
} from "./api/generated";
import { errorMessage } from "./api/errors";
import { formatBytes } from "./ScanPanel";

export function HistoryDuplicatesPanel({
  enabled,
  activeScanId,
  trash,
  onOpenScan,
}: {
  enabled: boolean;
  activeScanId?: string | null;
  trash?: boolean;
  onOpenScan?: (scan: ScanSession) => void;
}) {
  const [history, setHistory] = useState<ScanHistoryPage | null>(null);
  const [selectedScans, setSelectedScans] = useState<string[]>([]);
  const [comparison, setComparison] = useState<ScanComparison | null>(null);
  const [retention, setRetention] = useState(10);
  const [duplicates, setDuplicates] = useState<DuplicateGroupPage | null>(null);
  const [expanded, setExpanded] = useState<Record<string, DuplicateFilePage>>(
    {},
  );
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(
    new Set(),
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [duplicateLoading, setDuplicateLoading] = useState(false);
  const [hashProgress, setHashProgress] =
    useState<DuplicateHashProgress | null>(null);
  const [hashFailures, setHashFailures] = useState<DuplicateHashFailure[]>([]);
  const [deleteFailures, setDeleteFailures] = useState<
    Array<DuplicateDeleteFailure & { path: string }>
  >([]);

  async function loadHistory(after: string | null = null) {
    setHistoryLoading(true);
    setError(null);
    try {
      const page = await getScanHistory(after);
      setHistory((current) =>
        after && current
          ? {
              items: [...current.items, ...page.items],
              next_cursor: page.next_cursor,
            }
          : page,
      );
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (enabled) {
      void loadHistory();
      void getRetentionPolicy()
        .then((policy) => setRetention(policy.keep_latest))
        .catch((reason: unknown) => setError(errorMessage(reason)));
    }
  }, [enabled]);

  async function updateRetention(keepLatest: number) {
    setRetention(keepLatest);
    setError(null);
    try {
      const policy = await setRetentionPolicy(keepLatest);
      setRetention(policy.keep_latest);
      setNotice(
        `Автоочистка сохранена: хранить последних ${policy.keep_latest}.`,
      );
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    }
  }

  function toggleComparedScan(scanId: string) {
    setComparison(null);
    setSelectedScans((current) => {
      if (current.includes(scanId))
        return current.filter((id) => id !== scanId);
      return current.length < 2 ? [...current, scanId] : [current[1], scanId];
    });
  }

  async function compareSelected() {
    if (selectedScans.length !== 2) return;
    setError(null);
    const ordered = [...selectedScans].sort((left, right) =>
      BigInt(right) > BigInt(left) ? 1 : BigInt(right) < BigInt(left) ? -1 : 0,
    );
    try {
      setComparison(await compareScans(ordered[0], ordered[1]));
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    }
  }

  async function removeHistory(scanId: string) {
    setError(null);
    try {
      await deleteScanHistory(scanId);
      setSelectedScans((current) => current.filter((id) => id !== scanId));
      setComparison(null);
      await loadHistory();
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    }
  }

  async function cleanupHistory() {
    setHistoryLoading(true);
    setError(null);
    setNotice(null);
    try {
      const result = await cleanupScanHistory(retention, activeScanId ?? null);
      setSelectedScans((current) =>
        current.filter((id) => !result.deleted_scan_ids.includes(id)),
      );
      setComparison(null);
      setNotice(
        `Удалено старых результатов: ${result.deleted_scan_ids.length}.`,
      );
      await loadHistory();
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setHistoryLoading(false);
    }
  }

  async function verifyDuplicates() {
    setDuplicateLoading(true);
    setError(null);
    setNotice(null);
    setHashFailures([]);
    setDeleteFailures([]);
    try {
      const result = await confirmDuplicates(setHashProgress);
      setDuplicates(result.groups);
      setHashFailures(result.failures);
      if (result.cancelled) {
        setNotice(
          "Проверка остановлена. Следующий запуск продолжит с сохранённого кеша.",
        );
      }
      setExpanded({});
      setSelectedEntries(new Set());
      setConfirmDelete(false);
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setDuplicateLoading(false);
      setHashProgress(null);
    }
  }

  async function cancelHashing() {
    try {
      await cancelDuplicateHashing();
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    }
  }

  async function loadNextDuplicatePage() {
    if (!duplicates?.next_cursor) return;
    setDuplicateLoading(true);
    setError(null);
    try {
      const page = await getConfirmedDuplicates(duplicates.next_cursor);
      setDuplicates({
        scan_id: duplicates.scan_id,
        items: [...duplicates.items, ...page.items],
        next_cursor: page.next_cursor,
      });
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setDuplicateLoading(false);
    }
  }

  async function toggleGroup(contentHash: string) {
    if (expanded[contentHash]) {
      setExpanded((current) => {
        const next = { ...current };
        delete next[contentHash];
        return next;
      });
      return;
    }
    if (!duplicates?.scan_id) return;
    setDuplicateLoading(true);
    setError(null);
    try {
      const page = await getDuplicateFiles(duplicates.scan_id, contentHash);
      setExpanded((current) => ({ ...current, [contentHash]: page }));
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setDuplicateLoading(false);
    }
  }

  async function loadMoreFiles(contentHash: string) {
    const page = expanded[contentHash];
    if (!duplicates?.scan_id || !page?.next_cursor) return;
    setDuplicateLoading(true);
    try {
      const next = await getDuplicateFiles(
        duplicates.scan_id,
        contentHash,
        page.next_cursor,
      );
      setExpanded((current) => ({
        ...current,
        [contentHash]: {
          items: [...page.items, ...next.items],
          next_cursor: next.next_cursor,
        },
      }));
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setDuplicateLoading(false);
    }
  }

  function toggleEntry(entryId: string) {
    setConfirmDelete(false);
    setSelectedEntries((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }

  async function deleteSelectedDuplicates() {
    if (!duplicates?.scan_id || selectedEntries.size === 0) return;
    setDuplicateLoading(true);
    setError(null);
    setNotice(null);
    try {
      const paths = Object.values(expanded)
        .flatMap((page) => page.items)
        .reduce<Record<string, string>>((result, entry) => {
          result[entry.id] = entry.path;
          return result;
        }, {});
      const result = await deleteDuplicateEntries(duplicates.scan_id, [
        ...selectedEntries,
      ]);
      setNotice(
        `Перемещено в корзину: ${result.moved_entry_ids.length}. Пропущено изменившихся или недоступных: ${result.failures.length}.`,
      );
      setDeleteFailures(
        result.failures.map((failure) => ({
          ...failure,
          path: paths[failure.entry_id] ?? `#${failure.entry_id}`,
        })),
      );
      setSelectedEntries(new Set());
      setConfirmDelete(false);
      setExpanded({});
      setDuplicates(await getConfirmedDuplicates());
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setDuplicateLoading(false);
    }
  }

  if (!enabled) return null;
  return (
    <section className="panel" aria-labelledby="history-title">
      <h2 id="history-title">История и дубликаты</h2>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <section className="analysis-block">
        <div className="panel-heading">
          <div>
            <h3>История сканирований</h3>
            <p className="hint">
              Выберите любые два результата одного каталога. Политика хранения
              применяется автоматически после каждого scan.
            </p>
          </div>
          <div className="retention-controls">
            <label>
              Хранить последних
              <select
                aria-label="Количество сохраняемых сканирований"
                value={retention}
                onChange={(event) =>
                  void updateRetention(Number(event.target.value))
                }
              >
                {[5, 10, 25, 50].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary"
              disabled={historyLoading}
              onClick={() => void cleanupHistory()}
            >
              Очистить старые
            </button>
          </div>
        </div>
        {history?.items.map((scan) => {
          const active = scan.id === activeScanId;
          return (
            <div
              className={`history-row${active ? " active" : ""}`}
              data-scan-id={scan.id}
              key={scan.id}
            >
              <label className="history-choice">
                <input
                  type="checkbox"
                  checked={selectedScans.includes(scan.id)}
                  disabled={!readableHistoryState(scan)}
                  onChange={() => toggleComparedScan(scan.id)}
                />
                <span>
                  #{scan.id} · {formatBytes(scan.logical_size)} · {scan.state}
                  {active && (
                    <strong className="active-scan-badge">Активный</strong>
                  )}
                </span>
              </label>
              <div className="history-actions">
                {readableHistoryState(scan) && onOpenScan && (
                  <button
                    className="secondary"
                    onClick={() => onOpenScan(scan)}
                  >
                    Открыть анализ
                  </button>
                )}
                <button
                  className="secondary"
                  disabled={active || !scan.finished_at_ms}
                  onClick={() => void removeHistory(scan.id)}
                >
                  Удалить из истории
                </button>
              </div>
            </div>
          );
        })}
        {history?.next_cursor && (
          <button
            className="secondary"
            disabled={historyLoading}
            onClick={() => void loadHistory(history.next_cursor)}
          >
            Показать более старые
          </button>
        )}
        <button
          className="secondary"
          disabled={selectedScans.length !== 2}
          onClick={() => void compareSelected()}
        >
          Сравнить выбранные
        </button>
        {comparison && <ComparisonDetails comparison={comparison} />}
      </section>
      <section className="analysis-block">
        <div className="panel-heading">
          <div>
            <h3>Подтверждённые дубликаты</h3>
            <p className="hint">
              В каждой группе необходимо оставить хотя бы один файл.
            </p>
          </div>
          <button
            className="secondary"
            disabled={duplicateLoading}
            onClick={() => void verifyDuplicates()}
          >
            {duplicateLoading ? "Проверяем…" : "Проверить содержимое"}
          </button>
          {duplicateLoading && hashProgress && (
            <button className="secondary" onClick={() => void cancelHashing()}>
              Остановить проверку
            </button>
          )}
        </div>
        {hashProgress && (
          <p role="status">
            {hashProgress.phase === "fingerprint" ? "Fingerprint" : "SHA-256"}:{" "}
            {hashProgress.processed_files} / {hashProgress.total_files}
          </p>
        )}
        {hashFailures.length > 0 && (
          <FailureList
            title="Не удалось проверить файлы"
            failures={hashFailures}
          />
        )}
        {deleteFailures.length > 0 && (
          <FailureList
            title="Не удалось переместить файлы"
            failures={deleteFailures}
          />
        )}
        {duplicates &&
          (duplicates.items.length ? (
            <div className="duplicate-groups">
              {duplicates.items.map((group) => {
                const page = expanded[group.content_hash];
                const selectedInGroup =
                  page?.items.filter((entry) => selectedEntries.has(entry.id))
                    .length ?? 0;
                const selectionLimit = Math.max(
                  0,
                  Number(group.files_count) - 1,
                );
                return (
                  <section className="duplicate-group" key={group.content_hash}>
                    <button
                      className="duplicate-group-toggle secondary"
                      aria-expanded={Boolean(page)}
                      onClick={() => void toggleGroup(group.content_hash)}
                    >
                      {formatBytes(group.size)} · {group.files_count} файлов ·
                      можно освободить до {formatBytes(group.reclaimable_size)}
                    </button>
                    {page && (
                      <div className="duplicate-files">
                        {page.items.map((entry) => {
                          const checked = selectedEntries.has(entry.id);
                          return (
                            <label key={entry.id}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={
                                  !trash ||
                                  (!checked &&
                                    selectedInGroup >= selectionLimit)
                                }
                                onChange={() => toggleEntry(entry.id)}
                              />
                              <span>{entry.path}</span>
                            </label>
                          );
                        })}
                        {page.next_cursor && (
                          <button
                            className="secondary"
                            onClick={() =>
                              void loadMoreFiles(group.content_hash)
                            }
                          >
                            Показать остальные файлы группы
                          </button>
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          ) : (
            <p className="hint">Подтверждённых групп дубликатов нет.</p>
          ))}
        {duplicates?.next_cursor && (
          <button
            className="secondary"
            disabled={duplicateLoading}
            onClick={() => void loadNextDuplicatePage()}
          >
            Показать следующие группы
          </button>
        )}
        {selectedEntries.size > 0 && (
          <div className="duplicate-delete-actions">
            {!confirmDelete ? (
              <button
                disabled={!trash || duplicateLoading}
                onClick={() => setConfirmDelete(true)}
              >
                Переместить выбранные в корзину ({selectedEntries.size})
              </button>
            ) : (
              <>
                <p role="alert">
                  Файлы будут перемещены в системную корзину после повторной
                  проверки.
                </p>
                <button
                  disabled={duplicateLoading}
                  onClick={() => void deleteSelectedDuplicates()}
                >
                  Подтвердить перемещение
                </button>
                <button
                  className="secondary"
                  onClick={() => setConfirmDelete(false)}
                >
                  Отмена
                </button>
              </>
            )}
          </div>
        )}
        {!trash && (
          <p className="hint">
            Удаление недоступно на этой платформе. Просмотр групп работает без
            изменений файлов.
          </p>
        )}
        <p className="hint">
          Fingerprint и SHA-256 кешируются только для неизменившихся файлов.
          Исчезнувшие и изменившиеся объекты исключаются при повторной проверке.
        </p>
      </section>
    </section>
  );
}

function ComparisonDetails({ comparison }: { comparison: ScanComparison }) {
  return (
    <div className="comparison-details">
      <p>
        Изменение объёма:{" "}
        {formatBytes(comparison.logical_size_delta.replace("-", ""))}{" "}
        {comparison.logical_size_delta.startsWith("-") ? "меньше" : "больше"}.
      </p>
      <p className="hint">
        Добавлено: {comparison.added_files_count} · Удалено:{" "}
        {comparison.removed_files_count} · Изменено:{" "}
        {comparison.modified_files_count} · Перемещено:{" "}
        {comparison.moved_files_count}
      </p>
      <ComparisonList
        title="Добавленные файлы"
        count={comparison.added_files_count}
        comparison={comparison}
        kind="added"
      />
      <ComparisonList
        title="Удалённые файлы"
        count={comparison.removed_files_count}
        comparison={comparison}
        kind="removed"
      />
      <ComparisonList
        title="Изменённые файлы"
        count={comparison.modified_files_count}
        comparison={comparison}
        kind="modified"
        modified
      />
    </div>
  );
}

function ComparisonList({
  title,
  count,
  comparison,
  kind,
  modified = false,
}: {
  title: string;
  count: string;
  comparison: ScanComparison;
  kind: ScanComparisonKind;
  modified?: boolean;
}) {
  const [page, setPage] = useState<ScanComparisonFilePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setPage(null);
    setLoading(true);
    setLoadError(null);
    void getScanComparisonFiles(
      comparison.newer_scan_id,
      comparison.older_scan_id,
      kind,
    )
      .then((result) => {
        if (active) setPage(result);
      })
      .catch((reason: unknown) => {
        if (active) setLoadError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [comparison.newer_scan_id, comparison.older_scan_id, kind]);

  async function loadMore() {
    if (!page?.next_cursor) return;
    setLoading(true);
    setLoadError(null);
    try {
      const next = await getScanComparisonFiles(
        comparison.newer_scan_id,
        comparison.older_scan_id,
        kind,
        page.next_cursor,
      );
      setPage({
        items: [...page.items, ...next.items],
        next_cursor: next.next_cursor,
      });
    } catch (reason: unknown) {
      setLoadError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }

  const files = page?.items ?? [];
  return (
    <details>
      <summary>
        {title} ({count})
      </summary>
      {files.length ? (
        <>
          <ul className="comparison-files">
            {files.map((file, index) => (
              <li key={`${file.path}-${index}`}>
                <span>{file.path}</span>
                <span>
                  {modified && file.previous_logical_size
                    ? `${formatBytes(file.previous_logical_size)} → `
                    : ""}
                  {formatBytes(file.logical_size)}
                </span>
              </li>
            ))}
          </ul>
          {page?.next_cursor && (
            <button
              className="secondary"
              disabled={loading}
              onClick={() => void loadMore()}
            >
              Показать ещё
            </button>
          )}
        </>
      ) : loading ? (
        <p role="status">Загружаем изменения…</p>
      ) : (
        <p className="hint">Нет файлов.</p>
      )}
      {loadError && <p role="alert">{loadError}</p>}
    </details>
  );
}

function FailureList({
  title,
  failures,
}: {
  title: string;
  failures: Array<{ path: string; code: ErrorCode }>;
}) {
  return (
    <div className="duplicate-failures">
      <strong>{title}</strong>
      <ul>
        {failures.map((failure, index) => (
          <li key={`${failure.path}-${index}`}>
            <span>{failure.path}</span>
            <span>{failureMessage(failure.code)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function failureMessage(code: ErrorCode): string {
  return errorMessage({
    code,
    user_message_key: `errors.${code}`,
    recoverable: true,
  });
}

function readableHistoryState(scan: ScanSession): boolean {
  return ["completed", "partial", "cancelled"].includes(scan.state);
}
