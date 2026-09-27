import { useEffect, useState } from "react";
import {
  getOldFiles,
  moveEntriesToTrash,
  openEntry,
  revealEntry,
  type IndexedEntry,
  type OldFileCriterion,
  type OldFilePage,
  type Platform,
  type ScanSession,
} from "./api/generated";
import { errorMessage } from "./api/errors";
import { formatBytes } from "./ScanPanel";
import { SelectionActionBar } from "./components/SelectionActionBar";
import { Button, Checkbox, InlineAlert, SelectControl } from "./ui/primitives";

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
  platform = null,
  scan,
  trash = false,
}: {
  enabled: boolean;
  platform?: Platform | null;
  scan: ScanSession | null;
  trash?: boolean;
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
  const [selected, setSelected] = useState<IndexedEntry[]>([]);
  const [trashNotice, setTrashNotice] = useState<{
    moved: number;
    failed: number;
  } | null>(null);
  const usable = Boolean(enabled && scan && readableStates.has(scan.state));

  useEffect(() => {
    setResult(null);
    setQueryCutoff(null);
    setQueryMinSize(null);
    setError(null);
    setSelected([]);
    setTrashNotice(null);
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

  function toggleSelection(entry: IndexedEntry) {
    setSelected((current) =>
      current.some((item) => item.id === entry.id)
        ? current.filter((item) => item.id !== entry.id)
        : [...current, entry],
    );
  }

  async function actOnEntry(entry: IndexedEntry, action: "open" | "reveal") {
    if (!scan) return;
    setError(null);
    try {
      if (action === "open") await openEntry(scan.id, entry.id);
      else await revealEntry(scan.id, entry.id);
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    }
  }

  async function trashSelected() {
    if (!scan || selected.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const result = await moveEntriesToTrash(
        scan.id,
        selected.map((entry) => entry.id),
      );
      const failed = new Set(result.failed_entry_ids);
      setSelected((current) => current.filter((entry) => failed.has(entry.id)));
      setTrashNotice({
        moved: result.moved_entry_ids.length,
        failed: result.failed_entry_ids.length,
      });
      await load();
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
            <SelectControl
              aria-label="Критерий времени"
              id="old-files-criterion"
              onValueChange={(value) => {
                setCriterion(value);
                setResult(null);
                setQueryCutoff(null);
                setQueryMinSize(null);
              }}
              options={(
                Object.entries(criterionLabels) as [OldFileCriterion, string][]
              ).map(([value, label]) => ({ value, label }))}
              value={criterion}
            />
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
            <SelectControl
              aria-label="Период"
              id="old-files-period"
              onValueChange={(value) => {
                setPeriod(value);
                setResult(null);
                setQueryCutoff(null);
                setQueryMinSize(null);
              }}
              options={[
                ...periods.map(([value, label]) => ({ value, label })),
                { value: "custom" as const, label: "Указать дату" },
              ]}
              value={period}
            />
          </label>
          {period === "custom" && (
            <label className="old-files-filter" htmlFor="old-files-date">
              Дата
              <input
                className="ui-input"
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
              className="ui-input"
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
          <Button
            onClick={() => void load()}
            disabled={loading || selectedCutoff() === null}
          >
            Показать файлы
          </Button>
          {loading && <p role="status">Ищем в локальном индексе…</p>}
          {error && <p role="alert">{error}</p>}
          {trashNotice && (
            <InlineAlert
              title={
                trashNotice.failed
                  ? "Часть старых файлов не перемещена"
                  : "Старые файлы перемещены"
              }
              tone={trashNotice.failed ? "warning" : "success"}
            >
              Перемещено: {trashNotice.moved}. Не перемещено:{" "}
              {trashNotice.failed}.
            </InlineAlert>
          )}
          {result &&
            (result.items.length ? (
              <ul className="old-files-list" aria-label="Старые файлы">
                {result.items.map(({ entry, timestamp_ms }) => (
                  <li key={entry.id}>
                    <Checkbox
                      aria-label={`Выбрать ${entry.name || entry.path}`}
                      checked={selected.some((item) => item.id === entry.id)}
                      onChange={() => toggleSelection(entry)}
                    />
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
            <Button
              disabled={loading}
              onClick={() => void load(result.next_cursor)}
              variant="secondary"
            >
              Следующая страница
            </Button>
          )}
          <SelectionActionBar
            busy={loading}
            onClear={() => setSelected([])}
            onOpen={(entry) => void actOnEntry(entry, "open")}
            onReveal={(entry) => void actOnEntry(entry, "reveal")}
            onTrash={() => trashSelected()}
            platform={platform}
            selected={selected}
            trashAvailable={trash}
          />
        </>
      )}
    </section>
  );
}
