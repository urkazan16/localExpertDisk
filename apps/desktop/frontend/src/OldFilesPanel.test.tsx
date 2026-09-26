import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OldFilesPanel } from "./OldFilesPanel";
import {
  getOldFiles,
  moveEntriesToTrash,
  openEntry,
  revealEntry,
  type ScanSession,
} from "./api/generated";

vi.mock("./api/generated", () => ({
  getOldFiles: vi.fn(),
  moveEntriesToTrash: vi.fn(),
  openEntry: vi.fn(),
  revealEntry: vi.fn(),
}));

const scan: ScanSession = {
  id: "7",
  root_path: "/fixture",
  state: "completed",
  files_count: "1",
  directories_count: "1",
  symlinks_count: "0",
  skipped_count: "0",
  logical_size: "20",
  allocated_size: null,
  unique_allocated_size: null,
  errors_count: "0",
  started_at_ms: "1",
  finished_at_ms: "2",
  failure: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getOldFiles).mockResolvedValue({
    items: [
      {
        entry: {
          id: "8",
          parent_id: "7",
          name: "archive.zip",
          path: "/fixture/archive.zip",
          kind: "file",
          logical_size: "20",
          aggregate_size: "20",
        },
        timestamp_ms: "1704067200000",
      },
    ],
    next_cursor: null,
  });
});

describe("Old files UI", () => {
  it("states the selected criterion and queries only on request", async () => {
    render(<OldFilesPanel enabled scan={scan} />);
    expect(screen.getByText(/Критерий: файл не изменялся/)).toBeInTheDocument();
    expect(getOldFiles).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Показать файлы" }));
    await waitFor(() =>
      expect(getOldFiles).toHaveBeenCalledWith(
        "7",
        "modified",
        expect.any(String),
        null,
        null,
      ),
    );
    expect(await screen.findByText("archive.zip")).toBeInTheDocument();
    expect(screen.getByText(/Не изменялся с/)).toBeInTheDocument();
  });

  it("does not offer data from a failed scan", () => {
    render(<OldFilesPanel enabled scan={{ ...scan, state: "failed" }} />);
    expect(
      screen.getByText("Для этого результата выборка недоступна."),
    ).toBeInTheDocument();
    expect(getOldFiles).not.toHaveBeenCalled();
  });

  it("keeps the first cutoff while loading the next page", async () => {
    vi.mocked(getOldFiles)
      .mockResolvedValueOnce({ items: [], next_cursor: "1700000000000:8" })
      .mockResolvedValueOnce({ items: [], next_cursor: null });
    render(<OldFilesPanel enabled scan={scan} />);
    fireEvent.click(screen.getByRole("button", { name: "Показать файлы" }));
    await screen.findByRole("button", { name: "Следующая страница" });
    fireEvent.click(screen.getByRole("button", { name: "Следующая страница" }));
    await waitFor(() => expect(getOldFiles).toHaveBeenCalledTimes(2));
    const firstCutoff = vi.mocked(getOldFiles).mock.calls[0][2];
    expect(vi.mocked(getOldFiles).mock.calls[1]).toEqual([
      "7",
      "modified",
      firstCutoff,
      null,
      "1700000000000:8",
    ]);
  });

  it("uses the selected timestamp criterion and a custom date", async () => {
    render(<OldFilesPanel enabled scan={scan} />);
    fireEvent.change(screen.getByLabelText("Критерий времени"), {
      target: { value: "created" },
    });
    fireEvent.change(screen.getByLabelText("Период"), {
      target: { value: "custom" },
    });
    const button = screen.getByRole("button", { name: "Показать файлы" });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Дата"), {
      target: { value: "2024-01-01" },
    });
    fireEvent.click(button);
    await waitFor(() =>
      expect(getOldFiles).toHaveBeenCalledWith(
        "7",
        "created",
        "1704067200000",
        null,
        null,
      ),
    );
  });

  it("passes the minimum size to the indexed query", async () => {
    render(<OldFilesPanel enabled scan={scan} />);
    fireEvent.change(screen.getByLabelText("Минимальный размер, МиБ"), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Показать файлы" }));
    await waitFor(() =>
      expect(getOldFiles).toHaveBeenCalledWith(
        "7",
        "modified",
        expect.any(String),
        "4194304",
        null,
      ),
    );
  });

  it("uses the common selection review before moving old files", async () => {
    vi.mocked(moveEntriesToTrash).mockResolvedValue({
      moved_entry_ids: ["8"],
      failed_entry_ids: [],
    });
    render(<OldFilesPanel enabled scan={scan} trash />);
    fireEvent.click(screen.getByRole("button", { name: "Показать файлы" }));
    fireEvent.click(await screen.findByLabelText("Выбрать archive.zip"));
    expect(screen.getByText("Выбрано: 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "В корзину" }));
    const dialog = screen.getByRole("dialog", {
      name: "Проверка перед перемещением",
    });
    expect(dialog).toHaveTextContent("/fixture/archive.zip");
    expect(dialog).toHaveTextContent("20 Б");
    fireEvent.click(
      screen.getByRole("button", { name: "Подтвердить перемещение" }),
    );
    await waitFor(() =>
      expect(moveEntriesToTrash).toHaveBeenCalledWith("7", ["8"]),
    );
  });

  it("keeps common actions disabled until one old file is selected", async () => {
    render(<OldFilesPanel enabled scan={scan} />);
    expect(screen.getByRole("button", { name: "Открыть" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Показать в системе" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "В корзину" }),
    ).not.toBeInTheDocument();
    expect(openEntry).not.toHaveBeenCalled();
    expect(revealEntry).not.toHaveBeenCalled();
  });
});
