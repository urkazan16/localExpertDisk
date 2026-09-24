import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  getChildren,
  getLargeFiles,
  getScanRoot,
  moveEntriesToTrash,
  moveEntryToTrash,
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
type FolderSort = "size_desc" | "name_asc";

function sortFolderItems(items: IndexedEntry[], sort: FolderSort) {
  return [...items].sort((left, right) => {
    if (sort === "name_asc") {
      return left.name.localeCompare(right.name, "ru", { sensitivity: "base" });
    }
    const sizeOrder =
      BigInt(right.aggregate_size) > BigInt(left.aggregate_size)
        ? 1
        : BigInt(right.aggregate_size) < BigInt(left.aggregate_size)
          ? -1
          : 0;
    return sizeOrder || left.name.localeCompare(right.name, "ru");
  });
}

function EntryRows({
  items,
  onDirectory,
  onAction,
  onTrash,
  selected,
  onToggle,
}: {
  items: IndexedEntry[];
  onDirectory?: (entry: IndexedEntry) => void;
  onAction?: (entry: IndexedEntry, action: "open" | "reveal") => void;
  onTrash?: (entry: IndexedEntry) => void;
  selected?: Set<string>;
  onToggle?: (entry: IndexedEntry) => void;
}) {
  if (items.length === 0) return <p className="hint">Нет объектов.</p>;
  return (
    <ul className="entry-list" aria-label="Содержимое каталога">
      {items.map((entry) => (
        <li key={entry.id}>
          {onToggle && entry.kind !== "symlink" && entry.kind !== "other" && (
            <input
              aria-label={`Выбрать ${entry.name || entry.path}`}
              type="checkbox"
              checked={selected?.has(entry.id) ?? false}
              onChange={() => onToggle(entry)}
            />
          )}
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
          {onTrash && entry.kind !== "symlink" && entry.kind !== "other" && (
            <button className="secondary danger" onClick={() => onTrash(entry)}>
              В корзину
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function AnalyzerPanel({
  enabled,
  scan,
  trash = false,
}: {
  enabled: boolean;
  scan: ScanSession | null;
  trash?: boolean;
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
  const [selected, setSelected] = useState<IndexedEntry[]>([]);
  const [folderSort, setFolderSort] = useState<FolderSort>("size_desc");
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
    setSelected([]);
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

  async function trashEntry(entry: IndexedEntry) {
    if (!scan) return;
    if (!window.confirm(`Переместить «${entry.name || entry.path}» в корзину?`))
      return;
    setError(null);
    try {
      await moveEntryToTrash(scan.id, entry.id);
      if (directory) await showDirectory(directory);
      setLargeFiles(null);
      setSearch(null);
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    }
  }

  function toggleSelection(entry: IndexedEntry) {
    setSelected((items) =>
      items.some((item) => item.id === entry.id)
        ? items.filter((item) => item.id !== entry.id)
        : [...items, entry],
    );
  }

  async function trashSelected() {
    if (!scan || selected.length === 0) return;
    if (!window.confirm(`Переместить в корзину ${selected.length} объектов?`))
      return;
    setLoading(true);
    setError(null);
    try {
      const result = await moveEntriesToTrash(
        scan.id,
        selected.map((entry) => entry.id),
      );
      const failed = new Set(result.failed_entry_ids);
      setSelected((items) => items.filter((entry) => failed.has(entry.id)));
      if (result.failed_entry_ids.length) {
        setError(
          `Не удалось переместить ${result.failed_entry_ids.length} объектов.`,
        );
      }
      if (directory) await showDirectory(directory);
      setLargeFiles(null);
      setSearch(null);
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
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
            <label className="folder-sort">
              Сортировка
              <select
                aria-label="Сортировка содержимого каталога"
                value={folderSort}
                onChange={(event) =>
                  setFolderSort(event.target.value as FolderSort)
                }
              >
                <option value="size_desc">Размер: больше сначала</option>
                <option value="name_asc">Имя: А–Я</option>
              </select>
            </label>
            <EntryRows
              items={sortFolderItems(children.items, folderSort)}
              selected={new Set(selected.map((entry) => entry.id))}
              onToggle={toggleSelection}
              onDirectory={(entry) => {
                setTrail((items) => [...items, directory]);
                void showDirectory(entry);
              }}
              onAction={(entry, action) => void actOnEntry(entry, action)}
              onTrash={trash ? (entry) => void trashEntry(entry) : undefined}
            />
            {trash && selected.length > 0 && (
              <div className="selection-bar">
                Выбрано: {selected.length} ·{" "}
                {formatBytes(
                  selected
                    .reduce(
                      (total, entry) => total + BigInt(entry.aggregate_size),
                      0n,
                    )
                    .toString(),
                )}
                <button
                  className="secondary danger"
                  disabled={loading}
                  onClick={() => void trashSelected()}
                >
                  Переместить в корзину
                </button>
              </div>
            )}
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
                  onTrash={
                    trash ? (entry) => void trashEntry(entry) : undefined
                  }
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
                onTrash={trash ? (entry) => void trashEntry(entry) : undefined}
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
