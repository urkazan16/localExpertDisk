import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryDuplicatesPanel } from "./HistoryDuplicatesPanel";
import {
  cancelDuplicateHashing,
  cleanupScanHistory,
  compareScans,
  confirmDuplicates,
  deleteDuplicateEntries,
  getConfirmedDuplicates,
  getDuplicateFiles,
  getRetentionPolicy,
  getScanComparisonFiles,
  getScanHistory,
  setRetentionPolicy,
  type ScanSession,
} from "./api/generated";

vi.mock("./api/generated", () => ({
  cancelDuplicateHashing: vi.fn(),
  cleanupScanHistory: vi.fn(),
  compareScans: vi.fn(),
  confirmDuplicates: vi.fn(),
  deleteDuplicateEntries: vi.fn(),
  deleteScanHistory: vi.fn(),
  getConfirmedDuplicates: vi.fn(),
  getDuplicateFiles: vi.fn(),
  getRetentionPolicy: vi.fn(),
  getScanComparisonFiles: vi.fn(),
  getScanHistory: vi.fn(),
  setRetentionPolicy: vi.fn(),
}));

const scan = (id: string, root = "/archive"): ScanSession => ({
  id,
  root_path: root,
  state: "completed",
  files_count: "10",
  directories_count: "2",
  symlinks_count: "0",
  skipped_count: "0",
  logical_size: "100",
  allocated_size: "4096",
  unique_allocated_size: "4096",
  errors_count: "0",
  started_at_ms: "1",
  finished_at_ms: "2",
  failure: null,
});

const entry = (id: string, path: string) => ({
  id,
  parent_id: "1",
  name: path.split("/").at(-1)!,
  path,
  kind: "file" as const,
  logical_size: "100",
  aggregate_size: "100",
});

describe("History and duplicates UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getScanHistory).mockResolvedValue({
      items: [],
      next_cursor: null,
    });
    vi.mocked(cleanupScanHistory).mockResolvedValue({ deleted_scan_ids: [] });
    vi.mocked(getRetentionPolicy).mockResolvedValue({ keep_latest: 10 });
    vi.mocked(setRetentionPolicy).mockImplementation(async (keep_latest) => ({
      keep_latest,
    }));
    vi.mocked(getScanComparisonFiles).mockResolvedValue({
      items: [],
      next_cursor: null,
    });
    vi.mocked(cancelDuplicateHashing).mockResolvedValue();
  });

  it("loads later confirmed duplicate groups without hashing everything again", async () => {
    vi.mocked(confirmDuplicates).mockResolvedValue({
      groups: {
        scan_id: "7",
        items: [
          {
            content_hash: "a".repeat(64),
            size: "100",
            files_count: "2",
            reclaimable_size: "100",
          },
        ],
        next_cursor: "50",
      },
      failures: [],
      cancelled: false,
    });
    vi.mocked(getConfirmedDuplicates).mockResolvedValue({
      scan_id: "7",
      items: [
        {
          content_hash: "b".repeat(64),
          size: "10",
          files_count: "3",
          reclaimable_size: "20",
        },
      ],
      next_cursor: null,
    });
    render(<HistoryDuplicatesPanel enabled />);
    fireEvent.click(
      screen.getByRole("button", { name: "Проверить содержимое" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Показать следующие группы" }),
    );
    await waitFor(() =>
      expect(getConfirmedDuplicates).toHaveBeenCalledWith("50"),
    );
    expect(confirmDuplicates).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/3 файлов/)).toBeInTheDocument();
    expect(screen.getByText(/2 файлов/)).toBeInTheDocument();
  });

  it("highlights and opens the active historical scan", async () => {
    const historical = scan("41");
    vi.mocked(getScanHistory).mockResolvedValue({
      items: [historical],
      next_cursor: null,
    });
    const onOpenScan = vi.fn();
    render(
      <HistoryDuplicatesPanel
        enabled
        activeScanId="41"
        onOpenScan={onOpenScan}
      />,
    );
    expect(await screen.findByText("Активный")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Удалить из истории" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Открыть анализ" }));
    expect(onOpenScan).toHaveBeenCalledWith(historical);
  });

  it("compares any two selected scans and renders change lists", async () => {
    vi.mocked(getScanHistory).mockResolvedValue({
      items: [scan("12"), scan("9"), scan("3")],
      next_cursor: null,
    });
    vi.mocked(compareScans).mockResolvedValue({
      newer_scan_id: "12",
      older_scan_id: "3",
      files_delta: "1",
      directories_delta: "0",
      logical_size_delta: "30",
      added_files_count: "1",
      removed_files_count: "1",
      modified_files_count: "1",
      moved_files_count: "0",
    });
    vi.mocked(getScanComparisonFiles).mockImplementation(
      async (_, __, kind, after) => ({
        items:
          kind === "added"
            ? after
              ? [
                  {
                    path: "/archive/newer.bin",
                    logical_size: "20",
                    previous_logical_size: null,
                  },
                ]
              : [
                  {
                    path: "/archive/new.bin",
                    logical_size: "10",
                    previous_logical_size: null,
                  },
                ]
            : kind === "modified"
              ? [
                  {
                    path: "/archive/edit.bin",
                    logical_size: "30",
                    previous_logical_size: "10",
                  },
                ]
              : [],
        next_cursor: kind === "added" && !after ? "101" : null,
      }),
    );
    render(<HistoryDuplicatesPanel enabled />);
    const rows = await screen.findAllByText(/#(?:12|9|3)/);
    fireEvent.click(within(rows[0].closest("label")!).getByRole("checkbox"));
    fireEvent.click(within(rows[2].closest("label")!).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Сравнить выбранные" }));
    await waitFor(() => expect(compareScans).toHaveBeenCalledWith("12", "3"));
    fireEvent.click(await screen.findByText("Добавленные файлы (1)"));
    expect(await screen.findByText("/archive/new.bin")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Показать ещё" }));
    expect(await screen.findByText("/archive/newer.bin")).toBeInTheDocument();
    expect(getScanComparisonFiles).toHaveBeenCalledWith(
      "12",
      "3",
      "added",
      "101",
    );
    fireEvent.click(screen.getByText("Изменённые файлы (1)"));
    expect(await screen.findByText("10 Б → 30 Б")).toBeInTheDocument();
  });

  it("persists the selected retention policy", async () => {
    render(<HistoryDuplicatesPanel enabled />);
    fireEvent.change(
      screen.getByLabelText("Количество сохраняемых сканирований"),
      { target: { value: "25" } },
    );
    await waitFor(() => expect(setRetentionPolicy).toHaveBeenCalledWith(25));
    expect(
      await screen.findByText("Автоочистка сохранена: хранить последних 25."),
    ).toBeInTheDocument();
  });

  it("cleans old results while protecting the open scan", async () => {
    vi.mocked(cleanupScanHistory).mockResolvedValue({
      deleted_scan_ids: ["1", "2"],
    });
    render(<HistoryDuplicatesPanel enabled activeScanId="7" />);
    const cleanup = screen.getByRole("button", { name: "Очистить старые" });
    await waitFor(() => expect(cleanup).toBeEnabled());
    fireEvent.change(
      screen.getByLabelText("Количество сохраняемых сканирований"),
      { target: { value: "5" } },
    );
    fireEvent.click(cleanup);
    await waitFor(() =>
      expect(cleanupScanHistory).toHaveBeenCalledWith(5, "7"),
    );
    expect(
      await screen.findByText("Удалено старых результатов: 2."),
    ).toBeInTheDocument();
  });

  it("expands a group, selects one duplicate and confirms safe batch trash", async () => {
    const hash = "c".repeat(64);
    vi.mocked(confirmDuplicates).mockResolvedValue({
      groups: {
        scan_id: "7",
        items: [
          {
            content_hash: hash,
            size: "100",
            files_count: "2",
            reclaimable_size: "100",
          },
        ],
        next_cursor: null,
      },
      failures: [],
      cancelled: false,
    });
    vi.mocked(getDuplicateFiles).mockResolvedValue({
      items: [entry("21", "/a.bin"), entry("22", "/b.bin")],
      next_cursor: null,
    });
    vi.mocked(deleteDuplicateEntries).mockResolvedValue({
      moved_entry_ids: ["22"],
      failures: [],
    });
    vi.mocked(getConfirmedDuplicates).mockResolvedValue({
      scan_id: "7",
      items: [],
      next_cursor: null,
    });
    render(<HistoryDuplicatesPanel enabled trash />);
    fireEvent.click(
      screen.getByRole("button", { name: "Проверить содержимое" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: /2 файлов/ }));
    await screen.findByText("/b.bin");
    const fileLabel = screen.getByText("/b.bin").closest("label")!;
    fireEvent.click(within(fileLabel).getByRole("checkbox"));
    expect(
      within(screen.getByText("/a.bin").closest("label")!).getByRole(
        "checkbox",
      ),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Переместить выбранные в корзину (1)",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Подтвердить перемещение" }),
    );
    await waitFor(() =>
      expect(deleteDuplicateEntries).toHaveBeenCalledWith("7", ["22"]),
    );
    expect(
      await screen.findByText(/Перемещено в корзину: 1/),
    ).toBeInTheDocument();
  });

  it("shows hashing progress, supports cancel and lists each failed file", async () => {
    let resolveHashing:
      | ((value: Awaited<ReturnType<typeof confirmDuplicates>>) => void)
      | undefined;
    vi.mocked(confirmDuplicates).mockImplementation(
      (onProgress) =>
        new Promise((resolve) => {
          resolveHashing = resolve;
          onProgress({
            scan_id: "7",
            phase: "sha256",
            processed_files: "2",
            total_files: "5",
          });
        }),
    );
    render(<HistoryDuplicatesPanel enabled />);
    fireEvent.click(
      screen.getByRole("button", { name: "Проверить содержимое" }),
    );
    expect(await screen.findByText("SHA-256: 2 / 5")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Остановить проверку" }),
    );
    await waitFor(() => expect(cancelDuplicateHashing).toHaveBeenCalled());
    resolveHashing?.({
      groups: { scan_id: "7", items: [], next_cursor: null },
      failures: [
        {
          entry_id: "22",
          path: "/archive/locked.bin",
          code: "permission_denied",
        },
      ],
      cancelled: true,
    });
    expect(await screen.findByText("/archive/locked.bin")).toBeInTheDocument();
    expect(
      screen.getByText(/Нет доступа к выбранному каталогу/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Следующий запуск продолжит с сохранённого кеша/),
    ).toBeInTheDocument();
  });

  it("shows the path and reason for every rejected trash operation", async () => {
    const hash = "d".repeat(64);
    vi.mocked(confirmDuplicates).mockResolvedValue({
      groups: {
        scan_id: "7",
        items: [
          {
            content_hash: hash,
            size: "100",
            files_count: "3",
            reclaimable_size: "200",
          },
        ],
        next_cursor: null,
      },
      failures: [],
      cancelled: false,
    });
    vi.mocked(getDuplicateFiles).mockResolvedValue({
      items: [
        entry("21", "/a.bin"),
        entry("22", "/b.bin"),
        entry("23", "/changed.bin"),
      ],
      next_cursor: null,
    });
    vi.mocked(deleteDuplicateEntries).mockResolvedValue({
      moved_entry_ids: ["22"],
      failures: [{ entry_id: "23", code: "entry_changed" }],
    });
    vi.mocked(getConfirmedDuplicates).mockResolvedValue({
      scan_id: "7",
      items: [],
      next_cursor: null,
    });
    render(<HistoryDuplicatesPanel enabled trash />);
    fireEvent.click(
      screen.getByRole("button", { name: "Проверить содержимое" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: /3 файлов/ }));
    for (const path of ["/b.bin", "/changed.bin"]) {
      const label = (await screen.findByText(path)).closest("label")!;
      fireEvent.click(within(label).getByRole("checkbox"));
    }
    fireEvent.click(
      screen.getByRole("button", {
        name: "Переместить выбранные в корзину (2)",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Подтвердить перемещение" }),
    );
    expect(
      await screen.findByText(/Объект изменился после сканирования/),
    ).toBeInTheDocument();
    expect(screen.getByText("/changed.bin")).toBeInTheDocument();
  });
});
