import { useEffect, useState } from "react";
import {
  compareScans,
  confirmDuplicates,
  deleteScanHistory,
  getScanHistory,
  type DuplicateGroupPage,
  type ScanComparison,
  type ScanHistoryPage,
} from "./api/generated";
import { errorMessage } from "./api/errors";
import { formatBytes } from "./ScanPanel";

export function HistoryDuplicatesPanel({ enabled }: { enabled: boolean }) {
  const [history, setHistory] = useState<ScanHistoryPage | null>(null);
  const [comparison, setComparison] = useState<ScanComparison | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateGroupPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  function loadHistory() {
    getScanHistory().then(setHistory, (reason: unknown) =>
      setError(errorMessage(reason)),
    );
  }
  useEffect(() => {
    if (!enabled) return;
    loadHistory();
  }, [enabled]);
  if (!enabled) return null;
  return (
    <section className="panel" aria-labelledby="history-title">
      <h2 id="history-title">История и дубликаты</h2>
      {error && <p role="alert">{error}</p>}
      <section className="analysis-block">
        <h3>История сканирований</h3>
        {history?.items.map((scan) => (
          <div className="history-row" key={scan.id}>
            <p>
              #{scan.id} · {formatBytes(scan.logical_size)} · {scan.state}
            </p>
            <button
              className="secondary"
              onClick={() =>
                deleteScanHistory(scan.id).then(
                  loadHistory,
                  (reason: unknown) => setError(errorMessage(reason)),
                )
              }
            >
              Удалить из истории
            </button>
          </div>
        ))}
        {history && history.items.length > 1 && (
          <button
            className="secondary"
            onClick={() =>
              compareScans(history.items[0].id, history.items[1].id).then(
                setComparison,
                (reason: unknown) => setError(errorMessage(reason)),
              )
            }
          >
            Сравнить последние
          </button>
        )}
        {comparison && (
          <div>
            <p>
              Изменение объёма:{" "}
              {formatBytes(comparison.logical_size_delta.replace("-", ""))}
              {comparison.logical_size_delta.startsWith("-")
                ? " меньше"
                : " больше"}
              .
            </p>
            <p className="hint">
              Добавлено: {comparison.added_files_count} · Удалено:{" "}
              {comparison.removed_files_count} · Изменено:{" "}
              {comparison.modified_files_count} · Перемещено:{" "}
              {comparison.moved_files_count}
            </p>
          </div>
        )}
      </section>
      <section className="analysis-block">
        <div className="panel-heading">
          <h3>Кандидаты в дубликаты</h3>
          <button
            className="secondary"
            onClick={() =>
              confirmDuplicates().then(setDuplicates, (reason: unknown) =>
                setError(errorMessage(reason)),
              )
            }
          >
            Проверить содержимое
          </button>
        </div>
        {duplicates &&
          (duplicates.items.length ? (
            <ul className="issues">
              {duplicates.items.map((group) => (
                <li key={group.size}>
                  {formatBytes(group.size)} · {group.files_count} файлов · можно
                  освободить до {formatBytes(group.reclaimable_size)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">Групп одинакового размера нет.</p>
          ))}
        <p className="hint">
          Показаны только группы с совпадающим полным SHA-256. Файлы не
          удаляются автоматически.
        </p>
      </section>
    </section>
  );
}
