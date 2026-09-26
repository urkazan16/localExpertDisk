import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  type CategorySummary,
  type DirectoryMap,
  type DirectoryMapMetric,
  type DirectoryMapNode,
  type FileCategory,
  type FileSort,
  type IndexedEntry,
  type Platform,
  type ScanSession,
} from "./api/generated";
import { formatBytes } from "./ScanPanel";
import {
  type AnalyzerResultMode,
  type DirectoryVisualizationMode,
  type FolderSort,
} from "./state/analyzerState";
import { useAnalyzerController } from "./state/useAnalyzerController";
import { ColumnBrowser } from "./components/ColumnBrowser";
import { SelectionActionBar } from "./components/SelectionActionBar";
import { revealActionLabel } from "./platformLabels";
import { InlineAlert, SegmentedControl } from "./ui/primitives";

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
const VIRTUAL_LIST_THRESHOLD = 40;
const VIRTUAL_ROW_HEIGHT = 92;
const VIRTUAL_VIEWPORT_HEIGHT = 430;
const VIRTUAL_OVERSCAN = 4;
const SUNBURST_COLORS = [
  "var(--color-visualization-1)",
  "var(--color-visualization-2)",
  "var(--color-visualization-3)",
  "var(--color-visualization-4)",
  "var(--color-visualization-5)",
  "var(--color-visualization-6)",
];

function colorForKey(key: string) {
  let hash = 0;
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return SUNBURST_COLORS[(hash >>> 0) % SUNBURST_COLORS.length];
}

function compactVisualizationLabel(name: string | undefined, path: string) {
  const candidate = name?.trim() || path;
  const source = candidate.split(/[\\/]/).filter(Boolean).at(-1) || candidate;
  return source.length > 18 ? `${source.slice(0, 15)}…` : source;
}

function EntryRowContent({
  entry,
  onDirectory,
  onAction,
  onTrash,
  platform,
  selected,
  onToggle,
}: {
  entry: IndexedEntry;
  onDirectory?: (entry: IndexedEntry) => void;
  onAction?: (entry: IndexedEntry, action: "open" | "reveal") => void;
  onTrash?: (entry: IndexedEntry) => void;
  platform: Platform | null;
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
            {revealActionLabel(platform)}
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
  platform,
  selected,
  onToggle,
}: {
  items: IndexedEntry[];
  onDirectory?: (entry: IndexedEntry) => void;
  onAction?: (entry: IndexedEntry, action: "open" | "reveal") => void;
  onTrash?: (entry: IndexedEntry) => void;
  platform: Platform | null;
  selected?: Set<string>;
  onToggle?: (entry: IndexedEntry) => void;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const pageIdentity = `${items.length}:${items[0]?.id ?? ""}:${items.at(-1)?.id ?? ""}`;
  useEffect(() => setScrollTop(0), [pageIdentity]);
  if (items.length === 0) return <p className="hint">Нет объектов.</p>;
  const row = (entry: IndexedEntry): ReactNode => (
    <EntryRowContent
      entry={entry}
      onDirectory={onDirectory}
      onAction={onAction}
      onTrash={onTrash}
      platform={platform}
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
  node: DirectoryMapNode | null;
  label: string;
  size: bigint;
  percent: number;
  ratio: number;
  key: string;
};

function directorySegments(node: DirectoryMapNode): DirectorySegment[] {
  const segments: Omit<DirectorySegment, "percent" | "ratio">[] = node.children
    .filter((child) => BigInt(child.size) > 0n)
    .map((child) => ({
      node: child,
      label: child.entry.name || child.entry.path,
      size: BigInt(child.size),
      key: child.entry.id,
    }));
  if (node.remainder) {
    segments.push({
      node: null,
      label: `Остальное (${node.remainder.objects_count})`,
      size: BigInt(node.remainder.size),
      key: `remainder-${node.entry.id}`,
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

function ringSegmentPath(
  startAngle: number,
  endAngle: number,
  innerRadius: number,
  outerRadius: number,
) {
  const safeEnd = Math.min(endAngle, startAngle + Math.PI * 2 - 0.0001);
  const outerStart = polarPoint(outerRadius, startAngle);
  const outerEnd = polarPoint(outerRadius, safeEnd);
  const innerEnd = polarPoint(innerRadius, safeEnd);
  const innerStart = polarPoint(innerRadius, startAngle);
  const largeArc = safeEnd - startAngle > Math.PI ? 1 : 0;
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

type SunburstArc = DirectorySegment & {
  depth: number;
  startAngle: number;
  endAngle: number;
  color: string;
  trail: IndexedEntry[];
};

function sunburstArcs(root: DirectoryMapNode): SunburstArc[] {
  const arcs: SunburstArc[] = [];
  function append(
    node: DirectoryMapNode,
    depth: number,
    startAngle: number,
    endAngle: number,
    trail: IndexedEntry[],
  ) {
    const segments = directorySegments(node);
    let angle = startAngle;
    segments.forEach((segment, index) => {
      const segmentStart = angle;
      angle += segment.ratio * (endAngle - startAngle);
      const segmentEnd = index === segments.length - 1 ? endAngle : angle;
      const color = colorForKey(segment.key);
      const segmentTrail = segment.node
        ? [...trail, segment.node.entry]
        : trail;
      arcs.push({
        ...segment,
        depth,
        startAngle: segmentStart,
        endAngle: segmentEnd,
        color,
        trail: segmentTrail,
      });
      if (segment.node && segment.node.children.length > 0 && depth < 3) {
        append(segment.node, depth + 1, segmentStart, segmentEnd, segmentTrail);
      }
    });
  }
  append(root, 1, 0, Math.PI * 2, []);
  return arcs;
}

function DirectoryVisualization({
  map,
  metric,
  mode,
  scan,
  loading,
  error,
  onMetric,
  onMode,
  onDirectory,
  onSelect,
  selected,
}: {
  map: DirectoryMap | null;
  metric: DirectoryMapMetric;
  mode: DirectoryVisualizationMode;
  scan: ScanSession;
  loading: boolean;
  error: string | null;
  onMetric: (metric: DirectoryMapMetric) => void;
  onMode: (mode: DirectoryVisualizationMode) => void;
  onDirectory: (entries: IndexedEntry[]) => void;
  onSelect: (entry: IndexedEntry) => void;
  selected: IndexedEntry[];
}) {
  const [activeSegment, setActiveSegment] = useState<DirectorySegment | null>(
    null,
  );
  const segments = map ? directorySegments(map.root) : [];
  const arcs = map ? sunburstArcs(map.root) : [];
  const directory = map?.root.entry;
  const selectedIds = new Set(selected.map((entry) => entry.id));
  return (
    <section className="analysis-block" aria-labelledby="directory-map-title">
      <div className="panel-heading directory-map-heading">
        <div>
          <h3 id="directory-map-title">Структура каталога</h3>
          <p className="hint">
            {directory?.path ?? "Загружаем структуру…"} · один клик выбирает,
            двойной клик или Enter открывает каталог.
          </p>
        </div>
        <div className="view-switcher" aria-label="Вид структуры каталога">
          <label>
            Размер
            <select
              aria-label="Метрика карты каталогов"
              value={metric}
              onChange={(event) =>
                onMetric(event.target.value as DirectoryMapMetric)
              }
            >
              <option value="logical">Логический</option>
              <option value="allocated" disabled={scan.allocated_size === null}>
                На диске
              </option>
              <option
                value="unique_allocated"
                disabled={scan.unique_allocated_size === null}
              >
                Уникально на диске
              </option>
            </select>
          </label>
          <button
            className={mode === "treemap" ? "active" : "secondary"}
            aria-pressed={mode === "treemap"}
            onClick={() => onMode("treemap")}
          >
            Treemap
          </button>
          <button
            className={mode === "sunburst" ? "active" : "secondary"}
            aria-pressed={mode === "sunburst"}
            onClick={() => onMode("sunburst")}
          >
            Sunburst
          </button>
        </div>
      </div>
      {loading && <p role="status">Строим карту каталогов…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && map && segments.length === 0 ? (
        <p className="hint">В каталоге нет объектов ненулевого размера.</p>
      ) : map && mode === "treemap" ? (
        <div
          className="directory-treemap"
          role="list"
          aria-label={`Treemap каталога ${directory?.name || directory?.path}`}
        >
          {segments.map((segment) => {
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
                className={[
                  "directory-treemap-item",
                  segment.node && selectedIds.has(segment.node.entry.id)
                    ? "selected"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={segment.key}
                role="listitem"
                style={{
                  flexGrow: Math.max(segment.percent, 1),
                  flexBasis: `${Math.max(segment.percent, 14)}%`,
                  background: colorForKey(segment.key),
                }}
              >
                {segment.node ? (
                  <button
                    aria-label={`Выбрать ${segment.label} на карте`}
                    onClick={() => onSelect(segment.node!.entry)}
                    onBlur={() => setActiveSegment(null)}
                    onDoubleClick={() => {
                      if (segment.node!.entry.kind === "directory")
                        onDirectory([segment.node!.entry]);
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        segment.node!.entry.kind === "directory"
                      ) {
                        event.preventDefault();
                        onDirectory([segment.node!.entry]);
                      } else if (event.key === " ") {
                        event.preventDefault();
                        onSelect(segment.node!.entry);
                      }
                    }}
                    onFocus={() => setActiveSegment(segment)}
                    onMouseEnter={() => setActiveSegment(segment)}
                    onMouseLeave={() => setActiveSegment(null)}
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
      ) : map ? (
        <div className="sunburst-layout">
          <svg
            className="sunburst"
            viewBox="0 0 320 320"
            role="img"
            aria-label={`Sunburst каталога ${directory?.name || directory?.path}`}
          >
            {arcs.map((segment) => {
              const innerRadius = 30 + (segment.depth - 1) * 42;
              const path = (
                <path
                  d={ringSegmentPath(
                    segment.startAngle,
                    segment.endAngle,
                    innerRadius,
                    innerRadius + 40,
                  )}
                  fill={segment.color}
                />
              );
              return segment.node ? (
                <g
                  className={[
                    "sunburst-segment",
                    segment.node.entry.kind === "directory"
                      ? "sunburst-directory"
                      : "",
                    selectedIds.has(segment.node.entry.id) ? "selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={`${segment.depth}-${segment.key}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Выбрать ${segment.label} в Sunburst`}
                  onClick={() => onSelect(segment.node!.entry)}
                  onBlur={() => setActiveSegment(null)}
                  onDoubleClick={() => {
                    if (segment.node!.entry.kind === "directory")
                      onDirectory(segment.trail);
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      segment.node!.entry.kind === "directory"
                    ) {
                      event.preventDefault();
                      onDirectory(segment.trail);
                    } else if (event.key === " ") {
                      event.preventDefault();
                      onSelect(segment.node!.entry);
                    }
                  }}
                  onFocus={() => setActiveSegment(segment)}
                  onMouseEnter={() => setActiveSegment(segment)}
                  onMouseLeave={() => setActiveSegment(null)}
                >
                  <title>
                    {segment.label} — {segment.node.entry.path} —{" "}
                    {formatBytes(segment.size.toString())} —{" "}
                    {segment.percent.toLocaleString("ru-RU", {
                      maximumFractionDigits: 1,
                    })}
                    % родительской папки
                  </title>
                  {path}
                </g>
              ) : (
                <g key={`${segment.depth}-${segment.key}`}>
                  <title>
                    {segment.label}: {formatBytes(segment.size.toString())}
                  </title>
                  {path}
                </g>
              );
            })}
            <text x="160" y="154" textAnchor="middle">
              {compactVisualizationLabel(
                directory?.name,
                directory?.path ?? "",
              )}
            </text>
            <text x="160" y="176" textAnchor="middle" className="sunburst-size">
              {formatBytes(map.root.size)}
            </text>
          </svg>
          <ul className="sunburst-legend" aria-label="Легенда Sunburst">
            {segments.map((segment) => (
              <li key={segment.key}>
                <span
                  aria-hidden="true"
                  style={{
                    background: colorForKey(segment.key),
                  }}
                />
                {segment.label} · {formatBytes(segment.size.toString())}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {activeSegment?.node && (
        <div className="map-tooltip" role="status">
          <strong>{activeSegment.label}</strong>
          <span>{activeSegment.node.entry.path}</span>
          <span>
            {formatBytes(activeSegment.size.toString())} ·{" "}
            {activeSegment.percent.toLocaleString("ru-RU", {
              maximumFractionDigits: 1,
            })}
            % родительской папки
          </span>
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
  platform = null,
  scan,
  trash = false,
}: {
  enabled: boolean;
  platform?: Platform | null;
  scan: ScanSession | null;
  trash?: boolean;
}) {
  const controller = useAnalyzerController({ enabled, scan });
  const [trashNotice, setTrashNotice] = useState<{
    moved: number;
    failed: IndexedEntry[];
  } | null>(null);
  const { domain, ui } = controller.state;
  const {
    root,
    directory,
    columns,
    directoryMap,
    categories,
    categoryFiles,
    largeFiles,
    search,
  } = domain;
  const {
    navigation,
    navigationIndex,
    selected,
    focusedEntryId,
    folderSort,
    visualizationMode,
    directoryMapMetric,
    directoryMapLoading,
    directoryMapError,
    activeCategory,
    largeMinSize,
    largeCategory,
    largeSort,
    searchText,
    searchQuery,
    resultMode,
    error,
  } = ui;
  const { loading, usable } = controller;

  useEffect(() => setTrashNotice(null), [scan?.id]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const query = searchText.trim();
    if (!query) return;
    controller.setResultMode("search");
    void controller.runSearch(query);
  }

  async function trashSelected() {
    const before = [...selected];
    const result = await controller.trashSelected();
    if (!result) return;
    const failedIds = new Set(result.failed_entry_ids);
    setTrashNotice({
      moved: result.moved_entry_ids.length,
      failed: before.filter((entry) => failedIds.has(entry.id)),
    });
  }

  if (!scan || !isTerminalCandidate(scan)) return null;
  return (
    <section
      className="panel analyzer"
      aria-labelledby="analysis-title"
      data-analyzer-scan-id={scan.id}
    >
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
      {usable && root && directory && columns[0]?.page && (
        <>
          <div className="analyzer-mode-header">
            <SegmentedControl<AnalyzerResultMode>
              label="Режим результатов"
              onChange={controller.setResultMode}
              options={[
                { value: "structure", label: "Структура" },
                { value: "large", label: "Крупные файлы" },
                { value: "categories", label: "Категории" },
                { value: "search", label: "Поиск" },
              ]}
              value={resultMode}
            />
            <form className="analyzer-header-search" onSubmit={submitSearch}>
              <label htmlFor="entry-search">Имя или часть имени</label>
              <input
                id="entry-search"
                maxLength={256}
                onChange={(event) =>
                  controller.setSearchText(event.target.value)
                }
                placeholder="Имя или часть имени"
                value={searchText}
              />
              <button type="submit" disabled={!searchText.trim()}>
                Найти
              </button>
            </form>
          </div>

          {resultMode === "structure" && (
            <div className="structure-workspace">
              <section
                className="analysis-block"
                aria-labelledby="explorer-title"
              >
                <div className="panel-heading">
                  <div>
                    <h3 id="explorer-title">Проводник папок</h3>
                    <p className="scan-path">{directory.path}</p>
                  </div>
                  <div
                    className="navigation-actions"
                    aria-label="История папок"
                  >
                    <button
                      className="secondary"
                      disabled={navigationIndex <= 0}
                      onClick={() =>
                        void controller.navigateTo(navigationIndex - 1)
                      }
                    >
                      Назад
                    </button>
                    <button
                      className="secondary"
                      disabled={navigationIndex >= navigation.length - 1}
                      onClick={() =>
                        void controller.navigateTo(navigationIndex + 1)
                      }
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
                            onClick={() => void controller.navigateTo(index)}
                          >
                            {index === 0
                              ? entry.name || entry.path
                              : entry.name}
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
                      controller.setFolderSort(event.target.value as FolderSort)
                    }
                  >
                    <option value="size_desc">Размер: больше сначала</option>
                    <option value="name_asc">Имя: А–Я</option>
                  </select>
                </label>
                <ColumnBrowser
                  columns={columns}
                  currentIndex={navigationIndex}
                  focusedEntryId={focusedEntryId}
                  navigation={navigation}
                  scrollOffsets={ui.columnScrollOffsets}
                  selected={selected}
                  sort={folderSort}
                  onActivate={(entry) =>
                    void controller.activateDirectory(entry)
                  }
                  onAction={(entry, action) =>
                    void controller.actOnEntry(entry, action)
                  }
                  onFocus={controller.focusEntry}
                  onLoadNext={(index) =>
                    void controller.loadNextDirectoryPage(index)
                  }
                  onNavigate={(index) => void controller.navigateTo(index)}
                  onScroll={controller.setColumnScroll}
                  onSelect={controller.selectEntry}
                  onSelectAll={controller.selectAll}
                  onToggle={controller.toggleSelection}
                />
              </section>
              <DirectoryVisualization
                map={directoryMap}
                metric={directoryMapMetric}
                mode={visualizationMode}
                scan={scan}
                loading={directoryMapLoading}
                error={directoryMapError}
                onMetric={controller.setDirectoryMapMetric}
                onMode={controller.setVisualizationMode}
                onDirectory={(entries) =>
                  void controller.activateDirectoryPath(entries)
                }
                onSelect={controller.selectEntry}
                selected={selected}
              />
            </div>
          )}

          {resultMode === "large" && (
            <section className="analysis-block" aria-labelledby="large-title">
              <div className="panel-heading">
                <div>
                  <h3 id="large-title">Крупные файлы</h3>
                  <p className="hint">
                    Выборка строится по сохранённому локальному индексу.
                  </p>
                </div>
                <button
                  className="secondary"
                  disabled={loading}
                  onClick={() => void controller.showLargeFiles()}
                >
                  Обновить выборку
                </button>
              </div>
              <div className="result-filters">
                <label>
                  Минимум, байт
                  <input
                    aria-label="Минимальный размер крупного файла"
                    inputMode="numeric"
                    onChange={(event) =>
                      controller.setLargeMinSize(
                        event.target.value.replace(/\D/g, ""),
                      )
                    }
                    value={largeMinSize}
                  />
                </label>
                <label>
                  Категория
                  <select
                    aria-label="Категория крупных файлов"
                    onChange={(event) =>
                      controller.setLargeCategory(
                        event.target.value as FileCategory | "",
                      )
                    }
                    value={largeCategory}
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
                  Сортировка
                  <select
                    aria-label="Сортировка крупных файлов"
                    onChange={(event) =>
                      controller.setLargeSort(event.target.value as FileSort)
                    }
                    value={largeSort}
                  >
                    <option value="size_desc">Размер</option>
                    <option value="modified_desc">Изменён</option>
                    <option value="name_asc">Имя</option>
                  </select>
                </label>
              </div>
              {!largeFiles ? (
                <p className="hint">
                  Нажмите «Обновить выборку», чтобы показать файлы.
                </p>
              ) : largeFiles.items.length ? (
                <EntryRows
                  items={largeFiles.items}
                  onToggle={controller.toggleSelection}
                  platform={platform}
                  selected={new Set(selected.map((entry) => entry.id))}
                />
              ) : (
                <p className="hint">Крупные файлы не найдены.</p>
              )}
              {largeFiles?.next_cursor && (
                <button
                  className="secondary"
                  disabled={loading}
                  onClick={() =>
                    void controller.showLargeFiles(largeFiles.next_cursor)
                  }
                >
                  Следующая страница
                </button>
              )}
            </section>
          )}

          {resultMode === "categories" && categories && (
            <>
              <DiskOverview
                scan={scan}
                categories={categories}
                onCategory={(category) => {
                  controller.setResultMode("categories");
                  void controller.showCategory(category);
                }}
              />
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
                            onClick={() =>
                              void controller.showCategory(item.category)
                            }
                          >
                            {categoryLabels[item.category]}
                          </button>
                          <strong>
                            {formatBytes(item.logical_size)} ·{" "}
                            {item.files_count} шт.
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
                    onToggle={controller.toggleSelection}
                    platform={platform}
                    selected={new Set(selected.map((entry) => entry.id))}
                  />
                  {categoryFiles.next_cursor && (
                    <button
                      className="secondary"
                      onClick={() =>
                        void controller.showCategory(
                          activeCategory,
                          categoryFiles.next_cursor,
                        )
                      }
                    >
                      Следующая страница
                    </button>
                  )}
                </section>
              )}
            </>
          )}

          {resultMode === "search" && (
            <section className="analysis-block" aria-labelledby="search-title">
              <div className="panel-heading">
                <div>
                  <h3 id="search-title">Результаты поиска</h3>
                  <p className="hint">
                    {searchQuery
                      ? `Запрос: «${searchQuery}»`
                      : "Введите имя в строке поиска выше."}
                  </p>
                </div>
                {searchQuery && (
                  <button
                    className="secondary"
                    onClick={() => controller.clearSearch()}
                  >
                    Очистить
                  </button>
                )}
              </div>
              {!search ? null : search.items.length ? (
                <EntryRows
                  items={search.items}
                  onToggle={controller.toggleSelection}
                  platform={platform}
                  selected={new Set(selected.map((entry) => entry.id))}
                />
              ) : (
                <p className="hint">Совпадения не найдены.</p>
              )}
              {search?.next_cursor && (
                <button
                  className="secondary"
                  disabled={loading}
                  onClick={() =>
                    void controller.runSearch(searchQuery, search.next_cursor)
                  }
                >
                  Следующая страница поиска
                </button>
              )}
            </section>
          )}

          {trashNotice && (
            <InlineAlert
              title={
                trashNotice.failed.length
                  ? "Часть объектов не перемещена"
                  : "Объекты перемещены в корзину"
              }
              tone={trashNotice.failed.length ? "warning" : "success"}
            >
              Перемещено: {trashNotice.moved}. Не перемещено:{" "}
              {trashNotice.failed.length}.
              {trashNotice.failed.length > 0 && (
                <details>
                  <summary>Показать оставшиеся объекты</summary>
                  <ul>
                    {trashNotice.failed.map((entry) => (
                      <li key={entry.id}>{entry.path}</li>
                    ))}
                  </ul>
                </details>
              )}
            </InlineAlert>
          )}
          <SelectionActionBar
            busy={loading}
            onClear={controller.clearSelection}
            onOpen={(entry) => void controller.actOnEntry(entry, "open")}
            onReveal={(entry) => void controller.actOnEntry(entry, "reveal")}
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

function isTerminalCandidate(scan: ScanSession): boolean {
  return [
    "completed",
    "partial",
    "cancelled",
    "failed",
    "interrupted",
  ].includes(scan.state);
}
