import { useEffect, useState } from "react";
import {
  cleanupScanHistory,
  compareScans,
  confirmDuplicates,
  deleteDuplicateEntries,
  deleteScanHistory,
  getConfirmedDuplicates,
  getDuplicateFiles,
  getScanHistory,
  type DuplicateFilePage,
  type DuplicateGroupPage,
  type ScanComparison,
  type ScanComparisonFile,
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
    if (enabled) void loadHistory();
  }, [enabled]);

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
    try {
      setDuplicates(await confirmDuplicates());
      setExpanded({});
      setSelectedEntries(new Set());
      setConfirmDelete(false);
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setDuplicateLoading(false);
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
      const result = await deleteDuplicateEntries(duplicates.scan_id, [
        ...selectedEntries,
      ]);
      setNotice(
        `Перемещено в корзину: ${result.moved_entry_ids.length}. Пропущено изменившихся или недоступных: ${result.failures.length}.`,
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
              Выберите любые два результата одного каталога.
            </p>
          </div>
          <div className="retention-controls">
            <label>
              Хранить последних
              <select
                aria-label="Количество сохраняемых сканирований"
                value={retention}
                onChange={(event) => setRetention(Number(event.target.value))}
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
        </div>
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
  const truncated = [
    comparison.added_files_count,
    comparison.removed_files_count,
    comparison.modified_files_count,
  ].some((count) => BigInt(count) > BigInt(comparison.details_limit));
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
        files={comparison.added_files}
      />
      <ComparisonList
        title="Удалённые файлы"
        count={comparison.removed_files_count}
        files={comparison.removed_files}
      />
      <ComparisonList
        title="Изменённые файлы"
        count={comparison.modified_files_count}
        files={comparison.modified_files}
        modified
      />
      {truncated && (
        <p className="hint">
          Для каждой категории показаны первые {comparison.details_limit}{" "}
          файлов.
        </p>
      )}
    </div>
  );
}

function ComparisonList({
  title,
  count,
  files,
  modified = false,
}: {
  title: string;
  count: string;
  files: ScanComparisonFile[];
  modified?: boolean;
}) {
  return (
    <details>
      <summary>
        {title} ({count})
      </summary>
      {files.length ? (
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
      ) : (
        <p className="hint">Нет файлов.</p>
      )}
    </details>
  );
}

function readableHistoryState(scan: ScanSession): boolean {
  return ["completed", "partial", "cancelled"].includes(scan.state);
}
