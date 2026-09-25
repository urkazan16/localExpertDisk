import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  getChildren,
  getCategories,
  getFilesInCategory,
  getFilteredLargeFiles,
  getScanRoot,
  moveEntriesToTrash,
  moveEntryToTrash,
  openEntry,
  revealEntry,
  searchEntries,
  type EntryPage,
  type CategorySummary,
  type FileCategory,
  type FileSort,
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
const categoryLabels = {
  video: "Видео",
  images: "Изображения",
  audio: "Аудио",
  documents: "Документы",
  archives: "Архивы",
  applications: "Приложения",
  development: "Разработка",
  disk_images: "Образы дисков",
  databases: "Базы данных",
  other: "Другое",
} as const;
type FolderSort = "size_desc" | "name_asc";
type DirectoryVisualizationMode = "treemap" | "sunburst";
const VIRTUAL_LIST_THRESHOLD = 40;
const VIRTUAL_ROW_HEIGHT = 92;
const VIRTUAL_VIEWPORT_HEIGHT = 430;
const VIRTUAL_OVERSCAN = 4;
const MAX_VISUALIZED_ENTRIES = 18;
const SUNBURST_COLORS = [
  "#486f4d",
  "#63845c",
  "#7d9b6a",
  "#99af7d",
  "#b0bd8c",
  "#c7cba1",
];

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

function EntryRowContent({
  entry,
  onDirectory,
  onAction,
  onTrash,
  selected,
  onToggle,
}: {
  entry: IndexedEntry;
  onDirectory?: (entry: IndexedEntry) => void;
  onAction?: (entry: IndexedEntry, action: "open" | "reveal") => void;
  onTrash?: (entry: IndexedEntry) => void;
  selected?: Set<string>;
  onToggle?: (entry: IndexedEntry) => void;
}) {
  return (
    <>
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
          <button className="secondary" onClick={() => onAction(entry, "open")}>
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
    </>
  );
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
  const [scrollTop, setScrollTop] = useState(0);
  useEffect(() => setScrollTop(0), [items]);
  if (items.length === 0) return <p className="hint">Нет объектов.</p>;
  const row = (entry: IndexedEntry): ReactNode => (
    <EntryRowContent
      entry={entry}
      onDirectory={onDirectory}
      onAction={onAction}
      onTrash={onTrash}
      selected={selected}
      onToggle={onToggle}
    />
  );
  if (items.length >= VIRTUAL_LIST_THRESHOLD) {
    const start = Math.max(
      0,
      Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN,
    );
    const visibleCount =
      Math.ceil(VIRTUAL_VIEWPORT_HEIGHT / VIRTUAL_ROW_HEIGHT) +
      VIRTUAL_OVERSCAN * 2;
    const end = Math.min(items.length, start + visibleCount);
    return (
      <div
        className="entry-list virtual-entry-list"
        role="list"
        aria-label="Содержимое каталога"
        tabIndex={0}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div
          className="virtual-entry-spacer"
          style={{ height: items.length * VIRTUAL_ROW_HEIGHT }}
        >
          {items.slice(start, end).map((entry, offset) => (
            <div
              className="virtual-entry-row"
              role="listitem"
              key={entry.id}
              style={{
                height: VIRTUAL_ROW_HEIGHT,
                transform: `translateY(${(start + offset) * VIRTUAL_ROW_HEIGHT}px)`,
              }}
            >
              {row(entry)}
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <ul className="entry-list" aria-label="Содержимое каталога">
      {items.map((entry) => (
        <li key={entry.id}>{row(entry)}</li>
      ))}
    </ul>
  );
}

type DirectorySegment = {
  entry: IndexedEntry | null;
  label: string;
  size: bigint;
  percent: number;
  ratio: number;
};

function directorySegments(items: IndexedEntry[]): DirectorySegment[] {
  const sorted = [...items]
    .filter((entry) => BigInt(entry.aggregate_size) > 0n)
    .sort((left, right) => {
      const leftSize = BigInt(left.aggregate_size);
      const rightSize = BigInt(right.aggregate_size);
      return rightSize > leftSize ? 1 : rightSize < leftSize ? -1 : 0;
    });
  const hasOverflow = sorted.length > MAX_VISUALIZED_ENTRIES;
  const visible = hasOverflow
    ? sorted.slice(0, MAX_VISUALIZED_ENTRIES - 1)
    : sorted;
  const remaining = hasOverflow ? sorted.slice(MAX_VISUALIZED_ENTRIES - 1) : [];
  const segments: Omit<DirectorySegment, "percent" | "ratio">[] = visible.map(
    (entry) => ({
      entry,
      label: entry.name || entry.path,
      size: BigInt(entry.aggregate_size),
    }),
  );
  if (remaining.length > 0) {
    segments.push({
      entry: null,
      label: `Остальные объекты (${remaining.length})`,
      size: remaining.reduce(
        (total, entry) => total + BigInt(entry.aggregate_size),
        0n,
      ),
    });
  }
  const total = segments.reduce((sum, segment) => sum + segment.size, 0n);
  return segments.map((segment) => {
    const ratio = total === 0n ? 0 : Number(segment.size) / Number(total);
    return { ...segment, ratio, percent: ratio * 100 };
  });
}

function polarPoint(radius: number, angle: number) {
  return {
    x: 160 + radius * Math.cos(angle - Math.PI / 2),
    y: 160 + radius * Math.sin(angle - Math.PI / 2),
  };
}

function ringSegmentPath(startAngle: number, endAngle: number) {
  const safeEnd = Math.min(endAngle, startAngle + Math.PI * 2 - 0.0001);
  const outerStart = polarPoint(132, startAngle);
  const outerEnd = polarPoint(132, safeEnd);
  const innerEnd = polarPoint(62, safeEnd);
  const innerStart = polarPoint(62, startAngle);
  const largeArc = safeEnd - startAngle > Math.PI ? 1 : 0;
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A 132 132 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A 62 62 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

function DirectoryVisualization({
  directory,
  items,
  truncated,
  onDirectory,
}: {
  directory: IndexedEntry;
  items: IndexedEntry[];
  truncated: boolean;
  onDirectory: (entry: IndexedEntry) => void;
}) {
  const [mode, setMode] = useState<DirectoryVisualizationMode>("treemap");
  const segments = directorySegments(items);
  let angle = 0;
  const arcs = segments.map((segment, index) => {
    const startAngle = angle;
    angle += segment.ratio * Math.PI * 2;
    return {
      ...segment,
      startAngle,
      endAngle: index === segments.length - 1 ? Math.PI * 2 : angle,
    };
  });
  return (
    <section className="analysis-block" aria-labelledby="directory-map-title">
      <div className="panel-heading directory-map-heading">
        <div>
          <h3 id="directory-map-title">Структура каталога</h3>
          <p className="hint">
            {directory.path} · нажмите на каталог, чтобы перейти внутрь.
          </p>
        </div>
        <div className="view-switcher" aria-label="Вид структуры каталога">
          <button
            className={mode === "treemap" ? "active" : "secondary"}
            aria-pressed={mode === "treemap"}
            onClick={() => setMode("treemap")}
          >
            Treemap
          </button>
          <button
            className={mode === "sunburst" ? "active" : "secondary"}
            aria-pressed={mode === "sunburst"}
            onClick={() => setMode("sunburst")}
          >
            Sunburst
          </button>
        </div>
      </div>
      {truncated && (
        <p className="warning">
          Карта отражает только текущую страницу каталога — до 100 объектов.
          Остальные доступны через страницы Проводника.
        </p>
      )}
      {segments.length === 0 ? (
        <p className="hint">В каталоге нет объектов ненулевого размера.</p>
      ) : mode === "treemap" ? (
        <div
          className="directory-treemap"
          role="list"
          aria-label={`Treemap каталога ${directory.name || directory.path}`}
        >
          {segments.map((segment, index) => {
            const content = (
              <>
                <strong>{segment.label}</strong>
                <span>{formatBytes(segment.size.toString())}</span>
                <span>
                  {segment.percent > 0 && segment.percent < 0.1
                    ? "<0,1"
                    : segment.percent.toLocaleString("ru-RU", {
                        maximumFractionDigits: 1,
                      })}
                  %
                </span>
              </>
            );
            return (
              <div
                className="directory-treemap-item"
                key={segment.entry?.id ?? "remaining"}
                role="listitem"
                style={{
                  flexGrow: Math.max(segment.percent, 1),
                  flexBasis: `${Math.max(segment.percent, 14)}%`,
                  background: SUNBURST_COLORS[index % SUNBURST_COLORS.length],
                }}
              >
                {segment.entry?.kind === "directory" ? (
                  <button
                    aria-label={`Открыть каталог ${segment.label} на карте`}
                    onClick={() => onDirectory(segment.entry!)}
                  >
                    {content}
                  </button>
                ) : (
                  <div>{content}</div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="sunburst-layout">
          <svg
            className="sunburst"
            viewBox="0 0 320 320"
            role="img"
            aria-label={`Sunburst каталога ${directory.name || directory.path}`}
          >
            {arcs.map((segment, index) => {
              const path = (
                <path
                  d={ringSegmentPath(segment.startAngle, segment.endAngle)}
                  fill={SUNBURST_COLORS[index % SUNBURST_COLORS.length]}
                />
              );
              return segment.entry?.kind === "directory" ? (
                <g
                  className="sunburst-directory"
                  key={segment.entry.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Открыть каталог ${segment.label} в Sunburst`}
                  onClick={() => onDirectory(segment.entry!)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onDirectory(segment.entry!);
                    }
                  }}
                >
                  <title>
                    {segment.label}: {formatBytes(segment.size.toString())}
                  </title>
                  {path}
                </g>
              ) : (
                <g key={segment.entry?.id ?? "remaining"}>
                  <title>
                    {segment.label}: {formatBytes(segment.size.toString())}
                  </title>
                  {path}
                </g>
              );
            })}
            <text x="160" y="154" textAnchor="middle">
              {directory.name || directory.path}
            </text>
            <text x="160" y="176" textAnchor="middle" className="sunburst-size">
              {formatBytes(directory.aggregate_size)}
            </text>
          </svg>
          <ul className="sunburst-legend" aria-label="Легенда Sunburst">
            {segments.map((segment, index) => (
              <li key={segment.entry?.id ?? "remaining"}>
                <span
                  aria-hidden="true"
                  style={{
                    background: SUNBURST_COLORS[index % SUNBURST_COLORS.length],
                  }}
                />
                {segment.label} · {formatBytes(segment.size.toString())}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function DiskOverview({
  scan,
  categories,
  onCategory,
}: {
  scan: ScanSession;
  categories: CategorySummary[];
  onCategory: (category: FileCategory) => void;
}) {
  const total = categories.reduce(
    (sum, category) => sum + BigInt(category.logical_size),
    0n,
  );
  return (
    <section className="analysis-block" aria-labelledby="overview-title">
      <div className="panel-heading">
        <div>
          <h3 id="overview-title">Обзор диска</h3>
          <p className="hint">
            Распределение логического размера по категориям.
          </p>
        </div>
        <strong>{formatBytes(scan.logical_size)}</strong>
      </div>
      <dl className="disk-overview-metrics">
        <div>
          <dt>Логический размер</dt>
          <dd>{formatBytes(scan.logical_size)}</dd>
        </div>
        {scan.allocated_size !== null && (
          <div>
            <dt>На диске</dt>
            <dd>{formatBytes(scan.allocated_size)}</dd>
          </div>
        )}
        {scan.unique_allocated_size !== null && (
          <div>
            <dt>Уникально на диске</dt>
            <dd>{formatBytes(scan.unique_allocated_size)}</dd>
          </div>
        )}
      </dl>
      {categories.length === 0 ? (
        <p className="hint">Нет файлов для построения карты.</p>
      ) : (
        <div className="treemap" role="list" aria-label="Карта занятого места">
          {categories.map((category) => {
            const size = BigInt(category.logical_size);
            const percent =
              total === 0n ? 0 : Number((size * 1_000n) / total) / 10;
            return (
              <div
                className="treemap-item"
                key={category.category}
                role="listitem"
                style={{
                  flexGrow: Math.max(percent, 1),
                  flexBasis: `${Math.max(percent, 12)}%`,
                }}
              >
                <button
                  className="treemap-tile"
                  aria-label={`Показать категорию ${categoryLabels[category.category]}`}
                  onClick={() => onCategory(category.category)}
                >
                  <strong>{categoryLabels[category.category]}</strong>
                  <span>{formatBytes(category.logical_size)}</span>
                  <span>
                    {percent.toLocaleString("ru-RU", {
                      maximumFractionDigits: 1,
                    })}
                    %
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
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
  const [navigation, setNavigation] = useState<IndexedEntry[]>([]);
  const [navigationIndex, setNavigationIndex] = useState(-1);
  const [children, setChildren] = useState<EntryPage | null>(null);
  const [folderPageIsPartial, setFolderPageIsPartial] = useState(false);
  const [categories, setCategories] = useState<CategorySummary[] | null>(null);
  const [categoryFiles, setCategoryFiles] = useState<EntryPage | null>(null);
  const [activeCategory, setActiveCategory] = useState<FileCategory | null>(
    null,
  );
  const [largeFiles, setLargeFiles] = useState<EntryPage | null>(null);
  const [largeMinSize, setLargeMinSize] = useState("0");
  const [largeCategory, setLargeCategory] = useState<FileCategory | "">("");
  const [largeSort, setLargeSort] = useState<FileSort>("size_desc");
  const [search, setSearch] = useState<EntryPage | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
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
    setNavigation([]);
    setNavigationIndex(-1);
    setChildren(null);
    setFolderPageIsPartial(false);
    setCategories(null);
    setCategoryFiles(null);
    setActiveCategory(null);
    setLargeFiles(null);
    setSearch(null);
    setSearchQuery("");
    setError(null);
    setSelected([]);
    if (!usable || !scan) return;
    setLoading(true);
    getScanRoot(scan.id)
      .then(async (entry) => {
        const [page, categoryItems] = await Promise.all([
          getChildren(scan.id, entry.id),
          getCategories(scan.id),
        ]);
        if (current === version.current) {
          setRoot(entry);
          setDirectory(entry);
          setNavigation([entry]);
          setNavigationIndex(0);
          setChildren(page);
          setFolderPageIsPartial(page.next_cursor !== null);
          setCategories(categoryItems);
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
  ): Promise<boolean> {
    if (!scan) return false;
    const current = version.current;
    setLoading(true);
    setError(null);
    try {
      const page = await getChildren(scan.id, entry.id, after);
      if (current === version.current) {
        setDirectory(entry);
        setChildren(page);
        setFolderPageIsPartial(after !== null || page.next_cursor !== null);
        if (after === null) setSelected([]);
        return true;
      }
    } catch (reason: unknown) {
      if (current === version.current) setError(errorMessage(reason));
    } finally {
      if (current === version.current) setLoading(false);
    }
    return false;
  }

  async function openDirectory(entry: IndexedEntry) {
    if (!(await showDirectory(entry))) return;
    setNavigation((items) => [...items.slice(0, navigationIndex + 1), entry]);
    setNavigationIndex((index) => index + 1);
  }

  async function moveInNavigation(index: number) {
    const target = navigation[index];
    if (!target || !(await showDirectory(target))) return;
    setNavigationIndex(index);
  }

  async function showLargeFiles(after: string | null = null) {
    if (!scan) return;
    setLoading(true);
    setError(null);
    try {
      setLargeFiles(
        await getFilteredLargeFiles(
          scan.id,
          largeMinSize,
          largeCategory || null,
          largeSort,
          after,
        ),
      );
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }

  async function showCategory(
    category: FileCategory,
    after: string | null = null,
  ) {
    if (!scan) return;
    setLoading(true);
    setError(null);
    try {
      setActiveCategory(category);
      setCategoryFiles(await getFilesInCategory(scan.id, category, after));
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    const query = searchText.trim();
    if (!scan || !query) return;
    setLoading(true);
    setError(null);
    try {
      setSearchQuery(query);
      setSearch(await searchEntries(scan.id, query));
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }

  async function nextSearchPage() {
    if (!scan || !search?.next_cursor || !searchQuery) return;
    setLoading(true);
    setError(null);
    try {
      setSearch(await searchEntries(scan.id, searchQuery, search.next_cursor));
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
              <div className="navigation-actions" aria-label="История папок">
                <button
                  className="secondary"
                  disabled={navigationIndex <= 0}
                  onClick={() => void moveInNavigation(navigationIndex - 1)}
                >
                  Назад
                </button>
                <button
                  className="secondary"
                  disabled={navigationIndex >= navigation.length - 1}
                  onClick={() => void moveInNavigation(navigationIndex + 1)}
                >
                  Вперёд
                </button>
              </div>
            </div>
            <nav className="breadcrumbs" aria-label="Путь к каталогу">
              <ol>
                {navigation
                  .slice(0, navigationIndex + 1)
                  .map((entry, index) => (
                    <li key={`${entry.id}-${index}`}>
                      <button
                        className="breadcrumb"
                        disabled={index === navigationIndex}
                        aria-current={
                          index === navigationIndex ? "page" : undefined
                        }
                        onClick={() => void moveInNavigation(index)}
                      >
                        {index === 0 ? entry.name || entry.path : entry.name}
                      </button>
                    </li>
                  ))}
              </ol>
            </nav>
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
              onDirectory={(entry) => void openDirectory(entry)}
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
          <DirectoryVisualization
            directory={directory}
            items={children.items}
            truncated={folderPageIsPartial}
            onDirectory={(entry) => void openDirectory(entry)}
          />
          {categories && (
            <DiskOverview
              scan={scan}
              categories={categories}
              onCategory={(category) => void showCategory(category)}
            />
          )}
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
            <div className="old-files-filter">
              <label>
                Минимум, байт{" "}
                <input
                  value={largeMinSize}
                  inputMode="numeric"
                  onChange={(event) =>
                    setLargeMinSize(event.target.value.replace(/\D/g, ""))
                  }
                />
              </label>
              <label>
                Категория{" "}
                <select
                  value={largeCategory}
                  onChange={(event) =>
                    setLargeCategory(event.target.value as FileCategory | "")
                  }
                >
                  <option value="">Все</option>
                  {Object.entries(categoryLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Сортировка{" "}
                <select
                  value={largeSort}
                  onChange={(event) =>
                    setLargeSort(event.target.value as FileSort)
                  }
                >
                  <option value="size_desc">Размер</option>
                  <option value="modified_desc">Изменён</option>
                  <option value="name_asc">Имя</option>
                </select>
              </label>
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
          <section
            className="analysis-block"
            aria-labelledby="categories-title"
          >
            <h3 id="categories-title">Категории файлов</h3>
            {categories &&
              (categories.length ? (
                <ul className="category-list">
                  {categories.map((item) => (
                    <li key={item.category}>
                      <button
                        className="secondary"
                        onClick={() => void showCategory(item.category)}
                      >
                        {categoryLabels[item.category]}
                      </button>
                      <strong>
                        {formatBytes(item.logical_size)} · {item.files_count}{" "}
                        шт.
                      </strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="hint">Файлы для категоризации не найдены.</p>
              ))}
          </section>
          {activeCategory && categoryFiles && (
            <section
              className="analysis-block"
              aria-labelledby="category-files-title"
            >
              <h3 id="category-files-title">
                {categoryLabels[activeCategory]}
              </h3>
              <EntryRows
                items={categoryFiles.items}
                onAction={(entry, action) => void actOnEntry(entry, action)}
                onTrash={trash ? (entry) => void trashEntry(entry) : undefined}
              />
              {categoryFiles.next_cursor && (
                <button
                  className="secondary"
                  onClick={() =>
                    void showCategory(activeCategory, categoryFiles.next_cursor)
                  }
                >
                  Следующая страница
                </button>
              )}
            </section>
          )}
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
              <>
                <EntryRows
                  items={search.items}
                  onAction={(entry, action) => void actOnEntry(entry, action)}
                  onTrash={
                    trash ? (entry) => void trashEntry(entry) : undefined
                  }
                />
                {search.next_cursor && (
                  <button
                    className="secondary"
                    disabled={loading}
                    onClick={() => void nextSearchPage()}
                  >
                    Следующая страница поиска
                  </button>
                )}
              </>
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
