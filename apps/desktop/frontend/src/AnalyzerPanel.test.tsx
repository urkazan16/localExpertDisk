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
  return screen.findByText(name, { selector: ".column-row__name" });
}

async function findExplorerOption(name: string) {
  const label = await findInExplorer(name);
  const option = label.closest('[role="option"]');
  if (!option) throw new Error(`Explorer option not found: ${name}`);
  return option as HTMLElement;
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
    fireEvent.doubleClick(await findExplorerOption("nested"));
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
        screen.getByRole("listbox", {
          name: "Содержимое каталога fixture",
        }),
      ).getAllByRole("option")[0],
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
    const list = screen.getByRole("listbox", {
      name: "Содержимое каталога fixture",
    });
    fireEvent.scroll(list, { target: { scrollTop: 44 * 99 } });
    expect(await findInExplorer("file-099")).toBeInTheDocument();
    expect(within(list).getAllByRole("option").length).toBeLessThan(100);
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
    fireEvent.doubleClick(await findExplorerOption("nested"));
    await screen.findByRole("button", { name: "nested" });
    const callsAfterOpen = vi.mocked(getChildren).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    expect(screen.getByRole("button", { name: "fixture" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    fireEvent.click(screen.getByRole("button", { name: "Вперёд" }));
    expect(screen.getByRole("button", { name: "nested" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    fireEvent.click(screen.getByRole("button", { name: "fixture" }));
    expect(vi.mocked(getChildren).mock.calls).toHaveLength(callsAfterOpen);
  });

  it("keeps three directory levels as cached columns", async () => {
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
    render(<AnalyzerPanel enabled scan={scan} />);
    fireEvent.doubleClick(await findExplorerOption("nested"));
    fireEvent.doubleClick(await findExplorerOption("deep"));
    await waitFor(() => expect(screen.getAllByRole("listbox")).toHaveLength(3));
    expect(
      screen.getByRole("listbox", { name: "Содержимое каталога fixture" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("listbox", { name: "Содержимое каталога nested" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("listbox", { name: "Содержимое каталога deep" }),
    ).toBeInTheDocument();

    const callsAfterOpen = vi.mocked(getChildren).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "fixture" }));
    expect(screen.getAllByRole("listbox")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Вперёд" }));
    fireEvent.click(screen.getByRole("button", { name: "Вперёд" }));
    expect(screen.getByRole("button", { name: "deep" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(vi.mocked(getChildren).mock.calls).toHaveLength(callsAfterOpen);
  });

  it("supports keyboard focus, selection and select-all in a column", async () => {
    const second = {
      ...nestedEntry,
      id: "10",
      name: "second",
      path: "/fixture/second",
      kind: "file" as const,
    };
    vi.mocked(getChildren).mockResolvedValue({
      items: [nestedEntry, second],
      next_cursor: null,
    });
    render(<AnalyzerPanel enabled scan={scan} />);
    const firstRow = await findExplorerOption("nested");
    const secondRow = await findExplorerOption("second");
    fireEvent.focus(firstRow);
    fireEvent.keyDown(firstRow, { key: "ArrowDown" });
    await waitFor(() => expect(secondRow).toHaveAttribute("tabindex", "0"));
    fireEvent.keyDown(secondRow, { key: " " });
    expect(screen.getByLabelText("Выбрать second")).toBeChecked();
    fireEvent.keyDown(secondRow, { key: "a", ctrlKey: true });
    expect(screen.getByLabelText("Выбрать nested")).toBeChecked();
    expect(screen.getByLabelText("Выбрать second")).toBeChecked();
  });

  it("loads a later page inside its directory column", async () => {
    const later = {
      ...nestedEntry,
      id: "10",
      name: "later",
      path: "/fixture/later",
      kind: "file" as const,
    };
    vi.mocked(getChildren)
      .mockResolvedValueOnce({ items: [nestedEntry], next_cursor: "cursor-1" })
      .mockResolvedValueOnce({ items: [later], next_cursor: null });
    render(<AnalyzerPanel enabled scan={scan} />);
    await findInExplorer("nested");
    fireEvent.click(screen.getByRole("button", { name: "Следующая страница" }));
    expect(await findInExplorer("later")).toBeInTheDocument();
    expect(getChildren).toHaveBeenLastCalledWith("7", "8", "cursor-1");
  });

  it("shows a directory-specific error without leaving the current folder", async () => {
    vi.mocked(getChildren).mockImplementation(async (_scan, directory) => {
      if (directory === "8") return { items: [nestedEntry], next_cursor: null };
      throw new Error("Доступ запрещён");
    });
    render(<AnalyzerPanel enabled scan={scan} />);
    fireEvent.doubleClick(await findExplorerOption("nested"));
    const failedColumn = await screen.findByRole("region", {
      name: "Колонка каталога nested",
    });
    expect(await within(failedColumn).findByRole("alert")).toHaveTextContent(
      "Не удалось связаться с приложением",
    );
    expect(screen.getByRole("button", { name: "fixture" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("listbox", { name: "Содержимое каталога nested" }),
    ).toBeInTheDocument();
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
    const list = await screen.findByRole("listbox", {
      name: "Содержимое каталога fixture",
    });
    const rows = within(list).getAllByRole("option");
    fireEvent.doubleClick(rows[0]);
    fireEvent.doubleClick(rows[1]);

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
    fireEvent.keyDown(
      await screen.findByRole("button", {
        name: "Выбрать nested в Sunburst",
      }),
      { key: "Enter" },
    );
    fireEvent.keyDown(
      await screen.findByRole("button", {
        name: "Выбрать deep в Sunburst",
      }),
      { key: "Enter" },
    );
    expect(await screen.findByRole("button", { name: "deep" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    fireEvent.click(screen.getByRole("button", { name: "nested" }));
    expect(getChildren).toHaveBeenCalledWith("7", "9", null);
    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    expect(screen.getByRole("button", { name: "fixture" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    fireEvent.click(screen.getByRole("button", { name: "Вперёд" }));
    expect(screen.getByRole("button", { name: "nested" })).toHaveAttribute(
      "aria-current",
      "page",
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
    expect(
      await screen.findByRole("list", { name: "Легенда Sunburst" }),
    ).toHaveTextContent("Остальное (99993)");
    expect(performance.now() - started).toBeLessThan(2_000);
    const list = screen.getByRole("listbox", {
      name: "Содержимое каталога fixture",
    });
    expect(within(list).getAllByRole("option").length).toBeLessThan(30);
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
    fireEvent.click(await screen.findByRole("button", { name: "Категории" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Treemap" }));
    fireEvent.doubleClick(
      await screen.findByRole("button", {
        name: "Выбрать nested на карте",
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
    expect(
      await screen.findByRole("button", { name: "Sunburst" }),
    ).toHaveAttribute("aria-pressed", "true");
    await waitFor(() =>
      expect(container.querySelectorAll(".sunburst path")).toHaveLength(3),
    );
    const segment = screen.getByRole("button", {
      name: "Выбрать nested в Sunburst",
    });
    fireEvent.keyDown(segment, { key: "Enter" });
    await waitFor(() =>
      expect(getChildren).toHaveBeenLastCalledWith("7", "9", null),
    );
  });

  it("keeps row and Sunburst selection synchronized by entry id", async () => {
    const { container } = render(<AnalyzerPanel enabled scan={scan} />);
    const segment = await screen.findByRole("button", {
      name: "Выбрать nested в Sunburst",
    });
    fireEvent.click(segment);
    const row = await findExplorerOption("nested");
    expect(row).toHaveAttribute("aria-selected", "true");
    expect(
      container.querySelector(".sunburst-segment.selected"),
    ).not.toBeNull();

    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-selected", "true");
    expect(
      container.querySelector(".sunburst-segment.selected"),
    ).not.toBeNull();
  });

  it("shows real path, size and percentage in the focused segment tooltip", async () => {
    render(<AnalyzerPanel enabled scan={scan} />);
    fireEvent.focus(
      await screen.findByRole("button", {
        name: "Выбрать nested в Sunburst",
      }),
    );
    const tooltip = await screen.findByRole("status");
    expect(tooltip).toHaveTextContent("/fixture/nested");
    expect(tooltip).toHaveTextContent("20 Б");
    expect(tooltip).toHaveTextContent("90,9% родительской папки");
  });

  it("opens a deep Sunburst trail as one atomic column transition", async () => {
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
                children: [],
              },
            ],
          },
        ],
      },
    });
    render(<AnalyzerPanel enabled scan={scan} />);
    fireEvent.keyDown(
      await screen.findByRole("button", {
        name: "Выбрать deep в Sunburst",
      }),
      { key: "Enter" },
    );
    await waitFor(() => expect(screen.getAllByRole("listbox")).toHaveLength(3));
    expect(getChildren).toHaveBeenCalledWith("7", "9", null);
    expect(getChildren).toHaveBeenCalledWith("7", "10", null);
    expect(screen.getByRole("button", { name: "deep" })).toHaveAttribute(
      "aria-current",
      "page",
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
    const legend = await screen.findByRole("list", {
      name: "Легенда Sunburst",
    });
    expect(legend).toHaveTextContent("Остальное (91)");
    expect(legend).toHaveTextContent("37 Б");
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
    fireEvent.click(await screen.findByRole("button", { name: "Категории" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Крупные файлы" }));
    fireEvent.click(screen.getByRole("button", { name: "Обновить выборку" }));
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

  it("keeps one selection model while switching result modes", async () => {
    const largeEntry = {
      ...nestedEntry,
      id: "20",
      name: "large.bin",
      path: "/fixture/large.bin",
      kind: "file" as const,
      aggregate_size: "100",
      logical_size: "100",
    };
    vi.mocked(getFilteredLargeFiles).mockResolvedValue({
      items: [largeEntry],
      next_cursor: null,
    });
    render(<AnalyzerPanel enabled scan={scan} />);
    fireEvent.click(await screen.findByLabelText("Выбрать nested"));
    expect(screen.getByText("Выбрано: 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Крупные файлы" }));
    fireEvent.click(screen.getByRole("button", { name: "Обновить выборку" }));
    fireEvent.click(await screen.findByLabelText("Выбрать large.bin"));
    expect(screen.getByText("Выбрано: 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Структура" }));
    expect(screen.getByLabelText("Выбрать nested")).toBeChecked();
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
    fireEvent.click(screen.getByRole("button", { name: "Структура" }));
    fireEvent.doubleClick(await findExplorerOption("nested"));
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

    fireEvent.click(screen.getByRole("button", { name: "Крупные файлы" }));
    fireEvent.click(screen.getByRole("button", { name: "Обновить выборку" }));
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
    fireEvent.click(await findExplorerOption("nested"));
    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));
    await waitFor(() => expect(openEntry).toHaveBeenCalledWith("7", "9"));
    fireEvent.click(screen.getByRole("button", { name: "Показать в системе" }));
    await waitFor(() => expect(revealEntry).toHaveBeenCalledWith("7", "9"));
  });

  it("offers trash only when the platform advertises it and refreshes the folder", async () => {
    vi.mocked(moveEntriesToTrash).mockResolvedValue({
      moved_entry_ids: ["9"],
      failed_entry_ids: [],
    });
    render(<AnalyzerPanel enabled scan={scan} trash />);
    fireEvent.click(await findExplorerOption("nested"));
    fireEvent.click(screen.getByRole("button", { name: "В корзину" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Подтвердить перемещение" }),
    );
    await waitFor(() =>
      expect(moveEntriesToTrash).toHaveBeenCalledWith("7", ["9"]),
    );
    expect(getChildren).toHaveBeenCalledTimes(2);
  });

  it("confirms and sends selected entries as one batch", async () => {
    vi.mocked(moveEntriesToTrash).mockResolvedValue({
      moved_entry_ids: ["9"],
      failed_entry_ids: [],
    });
    render(<AnalyzerPanel enabled scan={scan} trash />);
    await findInExplorer("nested");
    fireEvent.click(screen.getByLabelText("Выбрать nested"));
    fireEvent.click(screen.getByRole("button", { name: "В корзину" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Подтвердить перемещение" }),
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
    render(<AnalyzerPanel enabled scan={scan} trash />);
    await findInExplorer("first");
    fireEvent.click(screen.getByLabelText("Выбрать first"));
    fireEvent.click(screen.getByLabelText("Выбрать second"));
    fireEvent.click(screen.getByRole("button", { name: "В корзину" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Подтвердить перемещение" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Выбрать second")).toBeChecked(),
    );
    expect(screen.getByLabelText("Выбрать first")).not.toBeChecked();
  });
});
