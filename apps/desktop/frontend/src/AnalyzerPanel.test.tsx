import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyzerPanel } from "./AnalyzerPanel";
import {
  getChildren,
  getLargeFiles,
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
  getLargeFiles: vi.fn(),
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

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getScanRoot).mockResolvedValue(root);
  vi.mocked(getChildren).mockResolvedValue({
    items: [
      {
        id: "9",
        parent_id: "8",
        name: "nested",
        path: "/fixture/nested",
        kind: "directory",
        logical_size: "0",
        aggregate_size: "20",
      },
    ],
    next_cursor: null,
  });
});

describe("Analyzer UI", () => {
  it("loads a bounded folder page and drills into an indexed directory", async () => {
    render(<AnalyzerPanel enabled scan={scan} />);
    expect(await screen.findByText("nested")).toBeInTheDocument();
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
    await screen.findByText("Яблоко");
    fireEvent.change(screen.getByLabelText("Сортировка содержимого каталога"), {
      target: { value: "name_asc" },
    });
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Арбуз");
  });

  it("queries large files and search only after the user requests them", async () => {
    vi.mocked(getLargeFiles).mockResolvedValue({
      items: [],
      next_cursor: null,
    });
    vi.mocked(searchEntries).mockResolvedValue({
      items: [],
      next_cursor: null,
    });
    render(<AnalyzerPanel enabled scan={scan} />);
    await screen.findByText("nested");
    expect(getLargeFiles).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Показать крупные файлы" }),
    );
    await waitFor(() => expect(getLargeFiles).toHaveBeenCalledWith("7", null));
    fireEvent.change(screen.getByLabelText("Имя или часть имени"), {
      target: { value: "log" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Найти" }));
    await waitFor(() => expect(searchEntries).toHaveBeenCalledWith("7", "log"));
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
    await screen.findByText("nested");
    fireEvent.click(screen.getByRole("button", { name: "Открыть в системе" }));
    await waitFor(() => expect(openEntry).toHaveBeenCalledWith("7", "9"));
    fireEvent.click(screen.getByRole("button", { name: "Показать в системе" }));
    await waitFor(() => expect(revealEntry).toHaveBeenCalledWith("7", "9"));
  });

  it("offers trash only when the platform advertises it and refreshes the folder", async () => {
    vi.mocked(moveEntryToTrash).mockResolvedValue();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AnalyzerPanel enabled scan={scan} trash />);
    await screen.findByText("nested");
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
    await screen.findByText("nested");
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
    await screen.findByText("first");
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
