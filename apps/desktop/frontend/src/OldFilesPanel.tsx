import { useEffect, useState } from "react";
import {
  getOldFiles,
  type OldFilePage,
  type ScanSession,
} from "./api/generated";
import { errorMessage } from "./api/errors";
import { formatBytes } from "./ScanPanel";

const periods = [
  [30, "Более 30 дней"],
  [90, "Более 90 дней"],
  [183, "Более 6 месяцев"],
  [365, "Более 1 года"],
  [730, "Более 2 лет"],
] as const;
const readableStates = new Set(["completed", "partial", "cancelled"]);

function cutoff(days: number): string {
  return (Date.now() - days * 24 * 60 * 60 * 1000).toString();
}

function dateLabel(value: string): string {
  const date = new Date(Number(value));
  return Number.isNaN(date.valueOf())
    ? "дата не определена"
    : new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(date);
}

export function OldFilesPanel({
  enabled,
  scan,
}: {
  enabled: boolean;
  scan: ScanSession | null;
}) {
  const [days, setDays] = useState(90);
  const [queryCutoff, setQueryCutoff] = useState<string | null>(null);
  const [result, setResult] = useState<OldFilePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usable = Boolean(enabled && scan && readableStates.has(scan.state));

  useEffect(() => {
    setResult(null);
    setQueryCutoff(null);
    setError(null);
  }, [scan?.id, usable]);

  async function load(afterId: string | null = null) {
    if (!scan) return;
    const activeCutoff = afterId ? queryCutoff : cutoff(days);
    if (!activeCutoff) return;
    setLoading(true);
    setError(null);
    try {
      const page = await getOldFiles(scan.id, activeCutoff, afterId);
      if (!afterId) setQueryCutoff(activeCutoff);
      setResult((previous) =>
        afterId && previous
          ? {
              items: [...previous.items, ...page.items],
              next_cursor: page.next_cursor,
            }
          : page,
      );
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }

  if (
    !scan ||
    !["completed", "partial", "cancelled", "failed", "interrupted"].includes(
      scan.state,
    )
  ) {
    return null;
  }
  return (
    <section className="panel" aria-labelledby="old-files-title">
      <div className="panel-heading">
        <h2 id="old-files-title">Старые файлы</h2>
        <span className="stage">Индекс последнего сканирования</span>
      </div>
      {!usable ? (
        <p className="hint">Для этого результата выборка недоступна.</p>
      ) : (
        <>
          <p className="hint">
            Критерий: файл не изменялся с указанной даты. Данные о последнем
            доступе не используются: их достоверность зависит от файловой
            системы.
          </p>
          <label className="old-files-filter" htmlFor="old-files-period">
            Возраст файла
            <select
              id="old-files-period"
              value={days}
              onChange={(event) => {
                setDays(Number(event.target.value));
                setResult(null);
                setQueryCutoff(null);
              }}
            >
              {periods.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => void load()} disabled={loading}>
            Показать файлы
          </button>
          {loading && <p role="status">Ищем в локальном индексе…</p>}
          {error && <p role="alert">{error}</p>}
          {result &&
            (result.items.length ? (
              <ul className="old-files-list" aria-label="Старые файлы">
                {result.items.map(({ entry, modified_at_ms }) => (
                  <li key={entry.id}>
                    <div>
                      <strong>{entry.name || entry.path}</strong>
                      <span>{entry.path}</span>
                    </div>
                    <span>{formatBytes(entry.logical_size)}</span>
                    <time>Не изменялся с {dateLabel(modified_at_ms)}</time>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">
                Файлов с сохранённой датой изменения по этому критерию нет.
              </p>
            ))}
          {result?.next_cursor && (
            <button
              className="secondary"
              disabled={loading}
              onClick={() => void load(result.next_cursor)}
            >
              Следующая страница
            </button>
          )}
        </>
      )}
    </section>
  );
}
