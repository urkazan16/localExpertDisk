import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyzerPanel } from "./AnalyzerPanel";
import {
  getChildren,
  getCategories,
  getDirectoryMap,
  getFilesInCategory,
  getFilteredLargeFiles,
  getScanRoot,
  moveEntriesToTrash,
  moveEntryToTrash,
  openEntry,
  revealEntry,
  searchEntries,
  type ScanSession,
} from "./api/generated";

vi.mock("./api/generated", () => ({
  getChildren: vi.fn(),
  getCategories: vi.fn(),
  getDirectoryMap: vi.fn(),
  getFilesInCategory: vi.fn(),
  getFilteredLargeFiles: vi.fn(),
  getScanRoot: vi.fn(),
  moveEntryToTrash: vi.fn(),
  moveEntriesToTrash: vi.fn(),
  searchEntries: vi.fn(),
  openEntry: vi.fn(),
  revealEntry: vi.fn(),
}));

const scan: ScanSession = {
  id: "7",
  root_path: "/fixture",
  state: "completed",
  files_count: "2",
  directories_count: "2",
  symlinks_count: "0",
  skipped_count: "0",
  logical_size: "22",
  allocated_size: null,
  unique_allocated_size: null,
  errors_count: "0",
  started_at_ms: "1",
  finished_at_ms: "2",
  failure: null,
};
const root = {
  id: "8",
  parent_id: null,
  name: "fixture",
  path: "/fixture",
  kind: "directory" as const,
  logical_size: "0",
  aggregate_size: "22",
};
const nestedEntry = {
  id: "9",
  parent_id: "8",
  name: "nested",
  path: "/fixture/nested",
  kind: "directory" as const,
  logical_size: "0",
  aggregate_size: "20",
};

async function findInExplorer(name: string) {
  const list = await screen.findByRole("list", {
    name: "Содержимое каталога",
  });
  return within(list).findByText(name);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getScanRoot).mockResolvedValue(root);
  vi.mocked(getCategories).mockResolvedValue([]);
  vi.mocked(getDirectoryMap).mockImplementation(
    async (_scan, directoryId, metric) => ({
      metric,
      root: {
        entry: directoryId === "8" ? root : nestedEntry,
        size: directoryId === "8" ? "22" : "20",
        children:
          directoryId === "8"
            ? [
                {
                  entry: nestedEntry,
                  size: "20",
                  children: [],
                  remainder: null,
                },
              ]
            : [],
        remainder:
          directoryId === "8" ? { objects_count: "1", size: "2" } : null,
      },
    }),
  );
  vi.mocked(getFilteredLargeFiles).mockResolvedValue({
    items: [],
    next_cursor: null,
  });
  vi.mocked(getChildren).mockResolvedValue({
    items: [
      {
        ...nestedEntry,
      },
    ],
    next_cursor: null,
  });
});

describe("Analyzer UI", () => {
  it("loads a bounded folder page and drills into an indexed directory", async () => {
    render(<AnalyzerPanel enabled scan={scan} />);
    expect(await findInExplorer("nested")).toBeInTheDocument();
    expect(getChildren).toHaveBeenCalledWith("7", "8");
    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));
    await waitFor(() =>
      expect(getChildren).toHaveBeenCalledWith("7", "9", null),
    );
  });

  it("sorts the current folder page by name on request", async () => {
    vi.mocked(getChildren).mockResolvedValue({
      items: [
        {
          id: "9",
          parent_id: "8",
          name: "Яблоко",
          path: "/fixture/Яблоко",
          kind: "file",
          logical_size: "10",
          aggregate_size: "10",
        },
        {
          id: "10",
          parent_id: "8",
          name: "Арбуз",
          path: "/fixture/Арбуз",
          kind: "file",
          logical_size: "20",
          aggregate_size: "20",
        },
      ],
      next_cursor: null,
    });
    render(<AnalyzerPanel enabled scan={scan} />);
    await findInExplorer("Яблоко");
    fireEvent.change(screen.getByLabelText("Сортировка содержимого каталога"), {
      target: { value: "name_asc" },
    });
    expect(
      within(
        screen.getByRole("list", { name: "Содержимое каталога" }),
      ).getAllByRole("listitem")[0],
    ).toHaveTextContent("Арбуз");
  });

  it("virtualizes long entry pages and renders the scrolled window", async () => {
    vi.mocked(getChildren).mockResolvedValue({
      items: Array.from({ length: 100 }, (_, index) => ({
        id: String(100 + index),
        parent_id: "8",
        name: `file-${String(index).padStart(3, "0")}`,
        path: `/fixture/file-${index}`,
        kind: "file" as const,
        logical_size: "1",
        aggregate_size: "1",
      })),
      next_cursor: null,
    });
    render(<AnalyzerPanel enabled scan={scan} />);
    await findInExplorer("file-000");
    expect(screen.queryByText("file-099")).not.toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Содержимое каталога" });
    fireEvent.scroll(list, { target: { scrollTop: 92 * 99 } });
    expect(await findInExplorer("file-099")).toBeInTheDocument();
    expect(within(list).getAllByRole("listitem").length).toBeLessThan(100);
  });

  it("supports breadcrumbs and backward and forward folder navigation", async () => {
    const nested = {
      id: "9",
      parent_id: "8",
      name: "nested",
      path: "/fixture/nested",
      kind: "directory" as const,
      logical_size: "0",
      aggregate_size: "20",
    };
    vi.mocked(getChildren).mockImplementation(async (_scan, directory) => ({
      items: directory === "8" ? [nested] : [],
      next_cursor: null,
    }));
    render(<AnalyzerPanel enabled scan={scan} />);
    fireEvent.click(await screen.findByRole("button", { name: "Открыть" }));
    await screen.findByRole("button", { name: "nested" });
    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    await waitFor(() =>
      expect(getChildren).toHaveBeenLastCalledWith("7", "8", null),
    );
    fireEvent.click(screen.getByRole("button", { name: "Вперёд" }));
    await waitFor(() =>
      expect(getChildren).toHaveBeenLastCalledWith("7", "9", null),
    );
    fireEvent.click(screen.getByRole("button", { name: "fixture" }));
    await waitFor(() =>
      expect(getChildren).toHaveBeenLastCalledWith("7", "8", null),
    );
  });

  it("ignores an older directory response that finishes after a newer one", async () => {
    const other = {
      ...nestedEntry,
      id: "10",
      name: "other",
      path: "/fixture/other",
    };
    let resolveNested!: (page: {
      items: (typeof nestedEntry)[];
      next_cursor: null;
    }) => void;
    let resolveOther!: (page: {
      items: (typeof nestedEntry)[];
      next_cursor: null;
    }) => void;
    vi.mocked(getChildren).mockImplementation(async (_scan, directory) => {
      if (directory === "8")
        return { items: [nestedEntry, other], next_cursor: null };
      return new Promise((resolve) => {
        if (directory === "9") resolveNested = resolve;
        else resolveOther = resolve;
      });
    });
    render(<AnalyzerPanel enabled scan={scan} />);
    const list = await screen.findByRole("list", {
      name: "Содержимое каталога",
    });
    const rows = within(list).getAllByRole("listitem");
    fireEvent.click(within(rows[0]).getByRole("button", { name: "Открыть" }));
    fireEvent.click(within(rows[1]).getByRole("button", { name: "Открыть" }));

    await act(async () => {
      resolveOther({ items: [], next_cursor: null });
    });
    expect(screen.getByRole("button", { name: "other" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await act(async () => {
      resolveNested({ items: [], next_cursor: null });
    });
    expect(screen.getByRole("button", { name: "other" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.queryByRole("button", { name: "nested" }),
    ).not.toBeInTheDocument();
  });

  it("keeps map, breadcrumb, back and forward navigation in one history", async () => {
    const deep = {
      ...nestedEntry,
      id: "10",
      parent_id: "9",
      name: "deep",
      path: "/fixture/nested/deep",
    };
    vi.mocked(getChildren).mockImplementation(async (_scan, directory) => ({
      items:
        directory === "8" ? [nestedEntry] : directory === "9" ? [deep] : [],
      next_cursor: null,
    }));
    vi.mocked(getDirectoryMap).mockImplementation(
      async (_scan, directory, metric) => ({
        metric,
        root: {
          entry:
            directory === "8" ? root : directory === "9" ? nestedEntry : deep,
          size: "20",
          remainder: null,
          children:
            directory === "8"
              ? [
                  {
                    entry: nestedEntry,
                    size: "20",
                    remainder: null,
                    children: [],
                  },
                ]
              : directory === "9"
                ? [{ entry: deep, size: "20", remainder: null, children: [] }]
                : [],
        },
      }),
    );
    render(<AnalyzerPanel enabled scan={scan} />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Открыть каталог nested на карте",
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Открыть каталог deep на карте",
      }),
    );
    expect(await screen.findByRole("button", { name: "deep" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    fireEvent.click(screen.getByRole("button", { name: "nested" }));
    await waitFor(() =>
      expect(getChildren).toHaveBeenLastCalledWith("7", "9", null),
    );
    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    await waitFor(() =>
      expect(getChildren).toHaveBeenLastCalledWith("7", "8", null),
    );
    fireEvent.click(screen.getByRole("button", { name: "Вперёд" }));
    await waitFor(() =>
      expect(getChildren).toHaveBeenLastCalledWith("7", "9", null),
    );
  });

  it("opens an old result and then a partial scan without retaining stale analyzer state", async () => {
    const oldScan = { ...scan, id: "6" };
    const partialScan = {
      ...scan,
      id: "7",
      state: "partial" as const,
      errors_count: "1",
    };
    vi.mocked(getScanRoot).mockImplementation(async (scanId) => ({
      ...root,
      id: scanId === "6" ? "60" : "70",
    }));
    vi.mocked(getChildren).mockResolvedValue({ items: [], next_cursor: null });
    vi.mocked(getDirectoryMap).mockImplementation(
      async (scanId, _directory, metric) => ({
        metric,
        root: {
          entry: { ...root, id: scanId === "6" ? "60" : "70" },
          size: "0",
          children: [],
          remainder: null,
        },
      }),
    );
    const { rerender } = render(<AnalyzerPanel enabled scan={oldScan} />);
    await waitFor(() => expect(getChildren).toHaveBeenCalledWith("6", "60"));
    rerender(<AnalyzerPanel enabled scan={partialScan} />);
    await waitFor(() => expect(getChildren).toHaveBeenCalledWith("7", "70"));
    await waitFor(() =>
      expect(getDirectoryMap).toHaveBeenLastCalledWith(
        "7",
        "70",
        "logical",
        3,
        8,
      ),
    );
  });

  it("keeps a 100K directory payload bounded and renders its first viewport promptly", async () => {
    const hugeScan = { ...scan, files_count: "100001", logical_size: "100001" };
    vi.mocked(getChildren).mockResolvedValue({
      items: Array.from({ length: 100 }, (_, index) => ({
        id: String(1000 + index),
        parent_id: "8",
        name: `wide-${index}`,
        path: `/fixture/wide-${index}`,
        kind: "file" as const,
        logical_size: "1",
        aggregate_size: "1",
      })),
      next_cursor: "1099",
    });
    vi.mocked(getDirectoryMap).mockResolvedValue({
      metric: "logical",
      root: {
        entry: root,
        size: "100001",
        children: Array.from({ length: 8 }, (_, index) => ({
          entry: {
            id: String(2000 + index),
            parent_id: "8",
            name: `largest-${index}`,
            path: `/fixture/largest-${index}`,
            kind: "file" as const,
            logical_size: "1",
            aggregate_size: "1",
          },
          size: "1",
          children: [],
          remainder: null,
        })),
        remainder: { objects_count: "99993", size: "99993" },
      },
    });
    const started = performance.now();
    render(<AnalyzerPanel enabled scan={hugeScan} />);
    expect(await screen.findByText("Остальное (99993)")).toBeInTheDocument();
    expect(performance.now() - started).toBeLessThan(2_000);
    const list = screen.getByRole("list", { name: "Содержимое каталога" });
    expect(within(list).getAllByRole("listitem").length).toBeLessThan(30);
  });

  it("renders a disk overview and opens a category from the treemap", async () => {
    vi.mocked(getCategories).mockResolvedValue([
      { category: "images", files_count: "2", logical_size: "12" },
      { category: "documents", files_count: "1", logical_size: "10" },
    ]);
    vi.mocked(getFilesInCategory).mockResolvedValue({
      items: [],
      next_cursor: null,
    });
    render(<AnalyzerPanel enabled scan={scan} />);
    expect(await screen.findByText("Обзор диска")).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "Карта занятого места" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Показать категорию Изображения",
      }),
    );
    await waitFor(() =>
      expect(getFilesInCategory).toHaveBeenCalledWith("7", "images", null),
    );
  });

  it("drills through the directory treemap and keeps breadcrumbs in sync", async () => {
    const nested = {
      id: "9",
      parent_id: "8",
      name: "nested",
      path: "/fixture/nested",
      kind: "directory" as const,
      logical_size: "0",
      aggregate_size: "20",
    };
    vi.mocked(getChildren).mockImplementation(async (_scan, directory) => ({
      items: directory === "8" ? [nested] : [],
      next_cursor: null,
    }));
    render(<AnalyzerPanel enabled scan={scan} />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Открыть каталог nested на карте",
      }),
    );
    await waitFor(() =>
      expect(getChildren).toHaveBeenLastCalledWith("7", "9", null),
    );
    expect(screen.getByRole("button", { name: "nested" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await waitFor(() =>
      expect(getDirectoryMap).toHaveBeenLastCalledWith(
        "7",
        "9",
        "logical",
        3,
        8,
      ),
    );
    expect(
      await screen.findByText("В каталоге нет объектов ненулевого размера."),
    ).toBeInTheDocument();
  });

  it("switches to Sunburst and opens a directory with keyboard navigation", async () => {
    const deep = {
      ...nestedEntry,
      id: "10",
      parent_id: "9",
      name: "deep",
      path: "/fixture/nested/deep",
    };
    const leaf = {
      ...nestedEntry,
      id: "11",
      parent_id: "10",
      name: "leaf",
      path: "/fixture/nested/deep/leaf",
    };
    vi.mocked(getDirectoryMap).mockResolvedValue({
      metric: "logical",
      root: {
        entry: root,
        size: "22",
        remainder: null,
        children: [
          {
            entry: nestedEntry,
            size: "20",
            remainder: null,
            children: [
              {
                entry: deep,
                size: "20",
                remainder: null,
                children: [
                  {
                    entry: leaf,
                    size: "20",
                    remainder: null,
                    children: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    const { container } = render(<AnalyzerPanel enabled scan={scan} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sunburst" }));
    await waitFor(() =>
      expect(container.querySelectorAll(".sunburst path")).toHaveLength(3),
    );
    const segment = screen.getByRole("button", {
      name: "Открыть каталог nested в Sunburst",
    });
    fireEvent.keyDown(segment, { key: "Enter" });
    await waitFor(() =>
      expect(getChildren).toHaveBeenLastCalledWith("7", "9", null),
    );
  });

  it("renders the exact remainder returned independently from explorer pagination", async () => {
    vi.mocked(getDirectoryMap).mockResolvedValue({
      metric: "logical",
      root: {
        entry: root,
        size: "100",
        children: [],
        remainder: { objects_count: "91", size: "37" },
      },
    });
    render(<AnalyzerPanel enabled scan={scan} />);
    expect(await screen.findByText("Остальное (91)")).toBeInTheDocument();
    expect(screen.getByText("37 Б")).toBeInTheDocument();
  });

  it("reloads the map when the allocated-size metric changes", async () => {
    const scanWithAllocation = {
      ...scan,
      allocated_size: "4096",
      unique_allocated_size: "2048",
    };
    render(<AnalyzerPanel enabled scan={scanWithAllocation} />);
    await waitFor(() => expect(getDirectoryMap).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Метрика карты каталогов"), {
      target: { value: "unique_allocated" },
    });
    await waitFor(() =>
      expect(getDirectoryMap).toHaveBeenLastCalledWith(
        "7",
        "8",
        "unique_allocated",
        3,
        8,
      ),
    );
  });

  it("loads the next category page using its cursor", async () => {
    vi.mocked(getCategories).mockResolvedValue([
      { category: "images", files_count: "101", logical_size: "101" },
    ]);
    vi.mocked(getFilesInCategory)
      .mockResolvedValueOnce({ items: [], next_cursor: "99" })
      .mockResolvedValueOnce({ items: [], next_cursor: null });
    render(<AnalyzerPanel enabled scan={scan} />);
    await screen.findByRole("button", { name: "Изображения" });
    fireEvent.click(screen.getByRole("button", { name: "Изображения" }));
    await screen.findByRole("button", { name: "Следующая страница" });
    fireEvent.click(screen.getByRole("button", { name: "Следующая страница" }));
    await waitFor(() =>
      expect(getFilesInCategory).toHaveBeenLastCalledWith("7", "images", "99"),
    );
  });

  it("queries large files and search only after the user requests them", async () => {
    vi.mocked(searchEntries).mockResolvedValue({
      items: [],
      next_cursor: null,
    });
    render(<AnalyzerPanel enabled scan={scan} />);
    await findInExplorer("nested");
    expect(getFilteredLargeFiles).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Показать крупные файлы" }),
    );
    await waitFor(() =>
      expect(getFilteredLargeFiles).toHaveBeenCalledWith(
        "7",
        "0",
        null,
        "size_desc",
        null,
      ),
    );
    fireEvent.change(screen.getByLabelText("Имя или часть имени"), {
      target: { value: "log" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Найти" }));
    await waitFor(() => expect(searchEntries).toHaveBeenCalledWith("7", "log"));
  });

  it("does not restore a stale query page after directory activation", async () => {
    let resolveSearch!: (page: {
      items: Array<{
        id: string;
        parent_id: string;
        name: string;
        path: string;
        kind: "file";
        logical_size: string;
        aggregate_size: string;
      }>;
      next_cursor: null;
    }) => void;
    vi.mocked(searchEntries).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSearch = resolve;
        }),
    );
    render(<AnalyzerPanel enabled scan={scan} />);
    await findInExplorer("nested");
    fireEvent.change(screen.getByLabelText("Имя или часть имени"), {
      target: { value: "stale" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Найти" }));
    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));
    await screen.findByRole("button", { name: "nested" });
    await act(async () => {
      resolveSearch({
        items: [
          {
            id: "stale",
            parent_id: "8",
            name: "stale-result.txt",
            path: "/fixture/stale-result.txt",
            kind: "file",
            logical_size: "1",
            aggregate_size: "1",
          },
        ],
        next_cursor: null,
      });
    });
    expect(screen.queryByText("stale-result.txt")).not.toBeInTheDocument();
  });

  it("keeps active filters while loading later large-file and search pages", async () => {
    vi.mocked(getFilteredLargeFiles)
      .mockResolvedValueOnce({ items: [], next_cursor: "size:10:4" })
      .mockResolvedValueOnce({ items: [], next_cursor: null });
    vi.mocked(searchEntries)
      .mockResolvedValueOnce({ items: [], next_cursor: "44" })
      .mockResolvedValueOnce({ items: [], next_cursor: null });
    render(<AnalyzerPanel enabled scan={scan} />);
    await findInExplorer("nested");

    fireEvent.click(
      screen.getByRole("button", { name: "Показать крупные файлы" }),
    );
    await screen.findByRole("button", { name: "Следующая страница" });
    fireEvent.click(screen.getByRole("button", { name: "Следующая страница" }));
    await waitFor(() =>
      expect(getFilteredLargeFiles).toHaveBeenLastCalledWith(
        "7",
        "0",
        null,
        "size_desc",
        "size:10:4",
      ),
    );

    fireEvent.change(screen.getByLabelText("Имя или часть имени"), {
      target: { value: "report" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Найти" }));
    await screen.findByRole("button", { name: "Следующая страница поиска" });
    fireEvent.change(screen.getByLabelText("Имя или часть имени"), {
      target: { value: "changed but not submitted" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Следующая страница поиска" }),
    );
    await waitFor(() =>
      expect(searchEntries).toHaveBeenLastCalledWith("7", "report", "44"),
    );
  });

  it("does not query an unfinished scan", () => {
    render(
      <AnalyzerPanel
        enabled
        scan={{ ...scan, state: "scanning", finished_at_ms: null }}
      />,
    );
    expect(getScanRoot).not.toHaveBeenCalled();
    expect(screen.queryByText("Проводник папок")).not.toBeInTheDocument();
  });

  it("uses the indexed entry identifier for system actions", async () => {
    vi.mocked(openEntry).mockResolvedValue();
    vi.mocked(revealEntry).mockResolvedValue();
    render(<AnalyzerPanel enabled scan={scan} />);
    await findInExplorer("nested");
    fireEvent.click(screen.getByRole("button", { name: "Открыть в системе" }));
    await waitFor(() => expect(openEntry).toHaveBeenCalledWith("7", "9"));
    fireEvent.click(screen.getByRole("button", { name: "Показать в системе" }));
    await waitFor(() => expect(revealEntry).toHaveBeenCalledWith("7", "9"));
  });

  it("offers trash only when the platform advertises it and refreshes the folder", async () => {
    vi.mocked(moveEntryToTrash).mockResolvedValue();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AnalyzerPanel enabled scan={scan} trash />);
    await findInExplorer("nested");
    fireEvent.click(screen.getByRole("button", { name: "В корзину" }));
    await waitFor(() =>
      expect(moveEntryToTrash).toHaveBeenCalledWith("7", "9"),
    );
    expect(getChildren).toHaveBeenCalledTimes(2);
  });

  it("confirms and sends selected entries as one batch", async () => {
    vi.mocked(moveEntriesToTrash).mockResolvedValue({
      moved_entry_ids: ["9"],
      failed_entry_ids: [],
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AnalyzerPanel enabled scan={scan} trash />);
    await findInExplorer("nested");
    fireEvent.click(screen.getByLabelText("Выбрать nested"));
    fireEvent.click(
      screen.getByRole("button", { name: "Переместить в корзину" }),
    );
    await waitFor(() =>
      expect(moveEntriesToTrash).toHaveBeenCalledWith("7", ["9"]),
    );
  });

  it("keeps failed batch entries selected for a retry", async () => {
    vi.mocked(getChildren).mockResolvedValue({
      items: [
        {
          id: "9",
          parent_id: "8",
          name: "first",
          path: "/fixture/first",
          kind: "file",
          logical_size: "10",
          aggregate_size: "10",
        },
        {
          id: "10",
          parent_id: "8",
          name: "second",
          path: "/fixture/second",
          kind: "file",
          logical_size: "20",
          aggregate_size: "20",
        },
      ],
      next_cursor: null,
    });
    vi.mocked(moveEntriesToTrash).mockResolvedValue({
      moved_entry_ids: ["9"],
      failed_entry_ids: ["10"],
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AnalyzerPanel enabled scan={scan} trash />);
    await findInExplorer("first");
    fireEvent.click(screen.getByLabelText("Выбрать first"));
    fireEvent.click(screen.getByLabelText("Выбрать second"));
    fireEvent.click(
      screen.getByRole("button", { name: "Переместить в корзину" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Выбрать second")).toBeChecked(),
    );
    expect(screen.getByLabelText("Выбрать first")).not.toBeChecked();
  });
});
