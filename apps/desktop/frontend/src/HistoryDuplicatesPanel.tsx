import { useEffect, useState } from "react";
import {
  compareScans,
  getDuplicateCandidates,
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
  useEffect(() => {
    if (!enabled) return;
    getScanHistory().then(setHistory, (reason: unknown) =>
      setError(errorMessage(reason)),
    );
  }, [enabled]);
  if (!enabled) return null;
  return (
    <section className="panel" aria-labelledby="history-title">
      <h2 id="history-title">История и дубликаты</h2>
      {error && <p role="alert">{error}</p>}
      <section className="analysis-block">
        <h3>История сканирований</h3>
        {history?.items.map((scan) => (
          <p key={scan.id}>
            #{scan.id} · {formatBytes(scan.logical_size)} · {scan.state}
          </p>
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
          <p>
            Изменение объёма:{" "}
            {formatBytes(comparison.logical_size_delta.replace("-", ""))}
            {comparison.logical_size_delta.startsWith("-")
              ? " меньше"
              : " больше"}
            .
          </p>
        )}
      </section>
      <section className="analysis-block">
        <div className="panel-heading">
          <h3>Кандидаты в дубликаты</h3>
          <button
            className="secondary"
            onClick={() =>
              getDuplicateCandidates().then(setDuplicates, (reason: unknown) =>
                setError(errorMessage(reason)),
              )
            }
          >
            Показать
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
          Это кандидаты по одинаковому размеру. Содержимое ещё не хешировалось.
        </p>
      </section>
    </section>
  );
}
