import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { IndexedEntry } from "../api/generated";
import { formatBytes } from "../ScanPanel";
import type { DirectoryColumn, FolderSort } from "../state/analyzerState";
import { Icon } from "../ui/icons";
import { Button, Checkbox } from "../ui/primitives";

export const COLUMN_ROW_HEIGHT_PX = 50;
const VIEWPORT_HEIGHT = 420;
const VIRTUAL_THRESHOLD = 40;
const OVERSCAN = 5;

function sortEntries(items: IndexedEntry[], sort: FolderSort) {
  return [...items].sort((left, right) => {
    if (sort === "name_asc")
      return left.name.localeCompare(right.name, "ru", { sensitivity: "base" });
    const rightSize = BigInt(right.aggregate_size);
    const leftSize = BigInt(left.aggregate_size);
    return rightSize > leftSize
      ? 1
      : rightSize < leftSize
        ? -1
        : left.name.localeCompare(right.name, "ru");
  });
}

function sizeTone(entry: IndexedEntry) {
  const size = BigInt(entry.aggregate_size);
  if (size >= 1024n ** 3n) return "large";
  if (size >= 100n * 1024n ** 2n) return "medium";
  return "normal";
}

function Column({
  column,
  columnIndex,
  activeChildId,
  focusedEntryId,
  selectedIds,
  scrollTop,
  sort,
  onActivate,
  onAction,
  onFocus,
  onLoadNext,
  onNavigate,
  onScroll,
  onSelect,
  onSelectAll,
  onToggle,
}: {
  column: DirectoryColumn;
  columnIndex: number;
  activeChildId?: string;
  focusedEntryId: string | null;
  selectedIds: Set<string>;
  scrollTop: number;
  sort: FolderSort;
  onActivate: (entry: IndexedEntry) => void;
  onAction: (entry: IndexedEntry, action: "open" | "reveal") => void;
  onFocus: (entryId: string | null, columnIndex: number) => void;
  onLoadNext: (columnIndex: number) => void;
  onNavigate: (index: number) => void;
  onScroll: (directoryId: string, scrollTop: number) => void;
  onSelect: (entry: IndexedEntry) => void;
  onSelectAll: (entries: IndexedEntry[]) => void;
  onToggle: (entry: IndexedEntry) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const scrollSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [liveScrollTop, setLiveScrollTop] = useState(scrollTop);
  const items = useMemo(
    () => sortEntries(column.page?.items ?? [], sort),
    [column.page?.items, sort],
  );

  useEffect(() => {
    setLiveScrollTop(scrollTop);
    if (viewportRef.current) viewportRef.current.scrollTop = scrollTop;
  }, [column.directory.id, scrollTop]);

  useEffect(
    () => () => {
      if (scrollSaveTimer.current !== null)
        clearTimeout(scrollSaveTimer.current);
    },
    [],
  );

  const start =
    items.length >= VIRTUAL_THRESHOLD
      ? Math.max(0, Math.floor(liveScrollTop / COLUMN_ROW_HEIGHT_PX) - OVERSCAN)
      : 0;
  const visibleCount =
    Math.ceil(VIEWPORT_HEIGHT / COLUMN_ROW_HEIGHT_PX) + OVERSCAN * 2;
  const end =
    items.length >= VIRTUAL_THRESHOLD
      ? Math.min(items.length, start + visibleCount)
      : items.length;

  function moveFocus(entry: IndexedEntry, delta: number) {
    const index = items.findIndex((item) => item.id === entry.id);
    const nextIndex = Math.max(0, Math.min(items.length - 1, index + delta));
    const next = items[nextIndex];
    if (!next) return;
    onFocus(next.id, columnIndex);
    if (items.length >= VIRTUAL_THRESHOLD) {
      if (viewportRef.current)
        viewportRef.current.scrollTop = Math.max(
          0,
          nextIndex * COLUMN_ROW_HEIGHT_PX - COLUMN_ROW_HEIGHT_PX * 2,
        );
    }
    requestAnimationFrame(() => rowRefs.current.get(next.id)?.focus());
  }

  function handleKey(
    event: KeyboardEvent<HTMLDivElement>,
    entry: IndexedEntry,
  ) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      onSelectAll(
        items.filter(
          (item) => item.kind !== "symlink" && item.kind !== "other",
        ),
      );
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(entry, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "ArrowLeft" && columnIndex > 0) {
      event.preventDefault();
      onNavigate(columnIndex - 1);
    } else if (event.key === "ArrowRight" && entry.kind === "directory") {
      event.preventDefault();
      onActivate(entry);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (entry.kind === "directory") onActivate(entry);
      else onAction(entry, "open");
    } else if (event.key === " ") {
      event.preventDefault();
      onToggle(entry);
    }
  }

  const rows = items.slice(start, end).map((entry, offset) => {
    const itemIndex = start + offset;
    const selected = selectedIds.has(entry.id);
    const active = activeChildId === entry.id;
    return (
      <div
        aria-label={`${entry.name || entry.path}, ${formatBytes(entry.aggregate_size)}`}
        aria-selected={selected}
        className={["column-row", selected && "selected", active && "active"]
          .filter(Boolean)
          .join(" ")}
        key={entry.id}
        onClick={() => onSelect(entry)}
        onDoubleClick={() => entry.kind === "directory" && onActivate(entry)}
        onFocus={() => onFocus(entry.id, columnIndex)}
        onKeyDown={(event) => handleKey(event, entry)}
        ref={(element) => {
          if (element) rowRefs.current.set(entry.id, element);
          else rowRefs.current.delete(entry.id);
        }}
        role="option"
        style={
          items.length >= VIRTUAL_THRESHOLD
            ? {
                transform: `translateY(${itemIndex * COLUMN_ROW_HEIGHT_PX}px)`,
              }
            : undefined
        }
        tabIndex={focusedEntryId === entry.id ? 0 : -1}
      >
        {entry.kind !== "symlink" && entry.kind !== "other" ? (
          <Checkbox
            aria-label={`Выбрать ${entry.name || entry.path}`}
            checked={selected}
            onClick={(event) => event.stopPropagation()}
            onChange={() => onToggle(entry)}
          />
        ) : (
          <span className="column-row__checkbox-placeholder" />
        )}
        <Icon name={entry.kind === "directory" ? "folder" : "file"} size={20} />
        <span className="column-row__name" title={entry.path}>
          {entry.name || entry.path}
        </span>
        <span
          className={`column-row__size column-row__size--${sizeTone(entry)}`}
        >
          {formatBytes(entry.aggregate_size)}
        </span>
        {entry.kind === "directory" && (
          <span className="column-row__chevron" aria-hidden="true">
            ›
          </span>
        )}
      </div>
    );
  });

  return (
    <section
      aria-label={`Колонка каталога ${column.directory.name || column.directory.path}`}
      className="directory-column"
    >
      <header title={column.directory.path}>
        <Icon name="folder" size={16} />
        <strong>{column.directory.name || column.directory.path}</strong>
      </header>
      <div
        aria-label={`Содержимое каталога ${column.directory.name || column.directory.path}`}
        aria-multiselectable="true"
        className="directory-column__viewport"
        onScroll={(event) => {
          const next = event.currentTarget.scrollTop;
          setLiveScrollTop(next);
          if (scrollSaveTimer.current !== null)
            clearTimeout(scrollSaveTimer.current);
          scrollSaveTimer.current = setTimeout(
            () => onScroll(column.directory.id, next),
            100,
          );
        }}
        ref={viewportRef}
        role="listbox"
      >
        {column.loading && !column.page && (
          <p className="column-state" role="status">
            Загружаем каталог…
          </p>
        )}
        {column.error && (
          <p className="column-state column-state--error" role="alert">
            {column.error}
          </p>
        )}
        {!column.loading &&
          !column.error &&
          column.page?.items.length === 0 && (
            <p className="column-state">Папка пуста.</p>
          )}
        {items.length >= VIRTUAL_THRESHOLD ? (
          <div
            className="directory-column__spacer"
            style={{ height: items.length * COLUMN_ROW_HEIGHT_PX }}
          >
            {rows}
          </div>
        ) : (
          rows
        )}
      </div>
      {column.page?.next_cursor && (
        <Button
          className="directory-column__next"
          disabled={column.loading}
          onClick={() => onLoadNext(columnIndex)}
          variant="secondary"
        >
          {column.loading ? "Загрузка…" : "Следующая страница"}
        </Button>
      )}
    </section>
  );
}

export function ColumnBrowser(props: {
  columns: DirectoryColumn[];
  currentIndex: number;
  focusedEntryId: string | null;
  navigation: IndexedEntry[];
  scrollOffsets: Record<string, number>;
  selected: IndexedEntry[];
  sort: FolderSort;
  onActivate: (entry: IndexedEntry) => void;
  onAction: (entry: IndexedEntry, action: "open" | "reveal") => void;
  onFocus: (entryId: string | null, columnIndex: number) => void;
  onLoadNext: (columnIndex: number) => void;
  onNavigate: (index: number) => void;
  onScroll: (directoryId: string, scrollTop: number) => void;
  onSelect: (entry: IndexedEntry) => void;
  onSelectAll: (entries: IndexedEntry[]) => void;
  onToggle: (entry: IndexedEntry) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const hasPendingColumn = Boolean(
    props.columns[props.currentIndex + 1] &&
    props.navigation.length === props.currentIndex + 1,
  );
  const visible = props.columns.slice(
    0,
    props.currentIndex + (hasPendingColumn ? 2 : 1),
  );

  useEffect(() => {
    if (scroller.current)
      scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [visible.length]);

  return (
    <div
      aria-label="Колонки каталогов"
      className="column-browser"
      ref={scroller}
      role="group"
    >
      {visible.map((column, index) => (
        <Column
          activeChildId={props.navigation[index + 1]?.id}
          column={column}
          columnIndex={index}
          focusedEntryId={props.focusedEntryId}
          key={`${column.directory.id}-${index}`}
          onActivate={props.onActivate}
          onAction={props.onAction}
          onFocus={props.onFocus}
          onLoadNext={props.onLoadNext}
          onNavigate={props.onNavigate}
          onScroll={props.onScroll}
          onSelect={props.onSelect}
          onSelectAll={props.onSelectAll}
          onToggle={props.onToggle}
          scrollTop={props.scrollOffsets[column.directory.id] ?? 0}
          selectedIds={new Set(props.selected.map((entry) => entry.id))}
          sort={props.sort}
        />
      ))}
    </div>
  );
}
