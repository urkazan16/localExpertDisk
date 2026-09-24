import { useEffect, useState } from "react";
import {
  getOldFiles,
  type OldFileCriterion,
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
const criterionLabels: Record<OldFileCriterion, string> = {
  modified: "Дата изменения",
  created: "Дата создания",
  accessed: "Дата последнего доступа",
};
const readableStates = new Set(["completed", "partial", "cancelled"]);

function periodCutoff(days: number): string {
  return (Date.now() - days * 24 * 60 * 60 * 1000).toString();
}

function customDateCutoff(value: string): string | null {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed.toString() : null;
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
  const [period, setPeriod] = useState<number | "custom">(90);
  const [customDate, setCustomDate] = useState("");
  const [criterion, setCriterion] = useState<OldFileCriterion>("modified");
  const [minSizeMiB, setMinSizeMiB] = useState("");
  const [queryCutoff, setQueryCutoff] = useState<string | null>(null);
  const [queryMinSize, setQueryMinSize] = useState<string | null>(null);
  const [result, setResult] = useState<OldFilePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usable = Boolean(enabled && scan && readableStates.has(scan.state));

  useEffect(() => {
    setResult(null);
    setQueryCutoff(null);
    setQueryMinSize(null);
    setError(null);
  }, [scan?.id, usable]);

  function selectedCutoff(): string | null {
    return period === "custom"
      ? customDateCutoff(customDate)
      : periodCutoff(period);
  }

  function selectedMinSize(): string | null {
    if (!minSizeMiB) return null;
    const value = Number(minSizeMiB);
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.floor(value * 1024 * 1024).toString();
  }

  const criterionDescription =
    criterion === "modified"
      ? "файл не изменялся с указанной даты"
      : criterion === "created"
        ? "файл создан до указанной даты"
        : "последний доступ к файлу был до указанной даты";
  const resultDescription =
    criterion === "modified"
      ? "Не изменялся с"
      : criterion === "created"
        ? "Создан"
        : "Последний доступ";

  async function load(afterId: string | null = null) {
    if (!scan) return;
    const activeCutoff = afterId ? queryCutoff : selectedCutoff();
    const activeMinSize = afterId ? queryMinSize : selectedMinSize();
    if (!activeCutoff) return;
    setLoading(true);
    setError(null);
    try {
      const page = await getOldFiles(
        scan.id,
        criterion,
        activeCutoff,
        activeMinSize,
        afterId,
      );
      if (!afterId) {
        setQueryCutoff(activeCutoff);
        setQueryMinSize(activeMinSize);
      }
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
          <p className="hint">Критерий: {criterionDescription}.</p>
          <label className="old-files-filter" htmlFor="old-files-criterion">
            Критерий времени
            <select
              id="old-files-criterion"
              value={criterion}
              onChange={(event) => {
                setCriterion(event.target.value as OldFileCriterion);
                setResult(null);
                setQueryCutoff(null);
                setQueryMinSize(null);
              }}
            >
              {(
                Object.entries(criterionLabels) as [OldFileCriterion, string][]
              ).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {criterion === "accessed" && (
            <p className="hint">
              Время доступа хранится только если его сообщает файловая система;
              на томах с отключённым обновлением atime выборка может быть
              неполной.
            </p>
          )}
          <label className="old-files-filter" htmlFor="old-files-period">
            Период
            <select
              id="old-files-period"
              value={period}
              onChange={(event) => {
                const value = event.target.value;
                setPeriod(value === "custom" ? value : Number(value));
                setResult(null);
                setQueryCutoff(null);
                setQueryMinSize(null);
              }}
            >
              {periods.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
              <option value="custom">Указать дату</option>
            </select>
          </label>
          {period === "custom" && (
            <label className="old-files-filter" htmlFor="old-files-date">
              Дата
              <input
                id="old-files-date"
                type="date"
                value={customDate}
                onChange={(event) => {
                  setCustomDate(event.target.value);
                  setResult(null);
                  setQueryCutoff(null);
                  setQueryMinSize(null);
                }}
              />
            </label>
          )}
          <label className="old-files-filter" htmlFor="old-files-min-size">
            Минимальный размер, МиБ
            <input
              id="old-files-min-size"
              type="number"
              min="0"
              step="1"
              value={minSizeMiB}
              onChange={(event) => {
                setMinSizeMiB(event.target.value);
                setResult(null);
                setQueryCutoff(null);
                setQueryMinSize(null);
              }}
            />
          </label>
          <button
            onClick={() => void load()}
            disabled={loading || selectedCutoff() === null}
          >
            Показать файлы
          </button>
          {loading && <p role="status">Ищем в локальном индексе…</p>}
          {error && <p role="alert">{error}</p>}
          {result &&
            (result.items.length ? (
              <ul className="old-files-list" aria-label="Старые файлы">
                {result.items.map(({ entry, timestamp_ms }) => (
                  <li key={entry.id}>
                    <div>
                      <strong>{entry.name || entry.path}</strong>
                      <span>{entry.path}</span>
                    </div>
                    <span>{formatBytes(entry.logical_size)}</span>
                    <time>
                      {resultDescription} {dateLabel(timestamp_ms)}
                    </time>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">
                Файлов с сохранённой датой по этому критерию нет.
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
