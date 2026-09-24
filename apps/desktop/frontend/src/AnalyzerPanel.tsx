import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  getChildren,
  getLargeFiles,
  getScanRoot,
  openEntry,
  revealEntry,
  searchEntries,
  type EntryPage,
  type IndexedEntry,
  type ScanSession,
} from "./api/generated";
import { errorMessage } from "./api/errors";
import { formatBytes } from "./ScanPanel";

const readableStates = new Set(["completed", "partial", "cancelled"]);
const kindLabels = {
  directory: "Каталог",
  file: "Файл",
  symlink: "Ссылка",
  other: "Другой объект",
} as const;

function EntryRows({
  items,
  onDirectory,
  onAction,
}: {
  items: IndexedEntry[];
  onDirectory?: (entry: IndexedEntry) => void;
  onAction?: (entry: IndexedEntry, action: "open" | "reveal") => void;
}) {
  if (items.length === 0) return <p className="hint">Нет объектов.</p>;
  return (
    <ul className="entry-list" aria-label="Содержимое каталога">
      {items.map((entry) => (
        <li key={entry.id}>
          <div>
            <strong>{entry.name || entry.path}</strong>
            <span>{kindLabels[entry.kind]}</span>
          </div>
          <span title={`${entry.aggregate_size} байт`}>
            {formatBytes(entry.aggregate_size)}
          </span>
          {entry.kind === "directory" && onDirectory && (
            <button className="secondary" onClick={() => onDirectory(entry)}>
              Открыть
            </button>
          )}
          {onAction && (
            <div className="entry-actions">
              <button
                className="secondary"
                onClick={() => onAction(entry, "open")}
              >
                Открыть в системе
              </button>
              <button
                className="secondary"
                onClick={() => onAction(entry, "reveal")}
              >
                Показать в системе
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function AnalyzerPanel({
  enabled,
  scan,
}: {
  enabled: boolean;
  scan: ScanSession | null;
}) {
  const [root, setRoot] = useState<IndexedEntry | null>(null);
  const [directory, setDirectory] = useState<IndexedEntry | null>(null);
  const [trail, setTrail] = useState<IndexedEntry[]>([]);
  const [children, setChildren] = useState<EntryPage | null>(null);
  const [largeFiles, setLargeFiles] = useState<EntryPage | null>(null);
  const [search, setSearch] = useState<EntryPage | null>(null);
  const [searchText, setSearchText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);
  const usable = Boolean(enabled && scan && readableStates.has(scan.state));

  useEffect(() => {
    const current = ++version.current;
    setRoot(null);
    setDirectory(null);
    setTrail([]);
    setChildren(null);
    setLargeFiles(null);
    setSearch(null);
    setError(null);
    if (!usable || !scan) return;
    setLoading(true);
    getScanRoot(scan.id)
      .then(async (entry) => {
        const page = await getChildren(scan.id, entry.id);
        if (current === version.current) {
          setRoot(entry);
          setDirectory(entry);
          setChildren(page);
        }
      })
      .catch((reason: unknown) => {
        if (current === version.current) setError(errorMessage(reason));
      })
      .finally(() => {
        if (current === version.current) setLoading(false);
      });
  }, [scan, usable]);

  async function showDirectory(
    entry: IndexedEntry,
    after: string | null = null,
  ) {
    if (!scan) return;
    const current = version.current;
    setLoading(true);
    setError(null);
    try {
      const page = await getChildren(scan.id, entry.id, after);
      if (current === version.current) {
        setDirectory(entry);
        setChildren(page);
      }
    } catch (reason: unknown) {
      if (current === version.current) setError(errorMessage(reason));
    } finally {
      if (current === version.current) setLoading(false);
    }
  }

  async function showLargeFiles(after: string | null = null) {
    if (!scan) return;
    setLoading(true);
    setError(null);
    try {
      setLargeFiles(await getLargeFiles(scan.id, after));
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    if (!scan || !searchText.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setSearch(await searchEntries(scan.id, searchText.trim()));
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
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

  if (!scan || !isTerminalCandidate(scan)) return null;
  return (
    <section className="panel analyzer" aria-labelledby="analysis-title">
      <div className="panel-heading">
        <h2 id="analysis-title">Результаты анализа</h2>
        <span className="stage">Данные локальной базы</span>
      </div>
      {!usable && (
        <p className="hint">
          Для этого результата просмотр объектов недоступен.
        </p>
      )}
      {loading && <p role="status">Загружаем индекс…</p>}
      {error && <p role="alert">{error}</p>}
      {usable && root && directory && children && (
        <>
          <section className="analysis-block" aria-labelledby="explorer-title">
            <div className="panel-heading">
              <div>
                <h3 id="explorer-title">Проводник папок</h3>
                <p className="scan-path">{directory.path}</p>
              </div>
              {trail.length > 0 && (
                <button
                  className="secondary"
                  onClick={() => {
                    const previous = trail[trail.length - 1];
                    setTrail((items) => items.slice(0, -1));
                    void showDirectory(previous);
                  }}
                >
                  Назад
                </button>
              )}
            </div>
            <EntryRows
              items={children.items}
              onDirectory={(entry) => {
                setTrail((items) => [...items, directory]);
                void showDirectory(entry);
              }}
              onAction={(entry, action) => void actOnEntry(entry, action)}
            />
            {children.next_cursor && (
              <button
                className="secondary"
                onClick={() =>
                  void showDirectory(directory, children.next_cursor)
                }
              >
                Следующая страница
              </button>
            )}
          </section>
          <section className="analysis-block" aria-labelledby="large-title">
            <div className="panel-heading">
              <h3 id="large-title">Крупные файлы</h3>
              <button
                className="secondary"
                onClick={() => void showLargeFiles()}
              >
                Показать крупные файлы
              </button>
            </div>
            {largeFiles && (
              <>
                <EntryRows
                  items={largeFiles.items}
                  onAction={(entry, action) => void actOnEntry(entry, action)}
                />
                {largeFiles.next_cursor && (
                  <button
                    className="secondary"
                    onClick={() => void showLargeFiles(largeFiles.next_cursor)}
                  >
                    Следующая страница
                  </button>
                )}
              </>
            )}
          </section>
          <section className="analysis-block" aria-labelledby="search-title">
            <h3 id="search-title">Поиск по имени</h3>
            <form
              className="search-form"
              onSubmit={(event) => void submitSearch(event)}
            >
              <label htmlFor="entry-search">Имя или часть имени</label>
              <div className="path-row">
                <input
                  id="entry-search"
                  value={searchText}
                  maxLength={256}
                  onChange={(event) => setSearchText(event.target.value)}
                />
                <button type="submit" disabled={!searchText.trim()}>
                  Найти
                </button>
              </div>
            </form>
            {search && (
              <EntryRows
                items={search.items}
                onAction={(entry, action) => void actOnEntry(entry, action)}
              />
            )}
          </section>
        </>
      )}
    </section>
  );
}

function isTerminalCandidate(scan: ScanSession): boolean {
  return [
    "completed",
    "partial",
    "cancelled",
    "failed",
    "interrupted",
  ].includes(scan.state);
}
