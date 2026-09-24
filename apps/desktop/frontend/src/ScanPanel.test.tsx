import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScanPanel, formatBytes, formatCount } from "./ScanPanel";
import {
  cancelScan,
  getScan,
  getScanIssues,
  getVolumes,
  startScan,
  type ScanSession,
} from "./api/generated";
vi.mock("./api/generated", () => ({
  cancelScan: vi.fn(),
  getScan: vi.fn(),
  getScanIssues: vi.fn(),
  getVolumes: vi.fn(),
  startScan: vi.fn(),
}));
const initial: ScanSession = {
  id: "1",
  root_path: "/fixture",
  state: "created",
  files_count: "0",
  directories_count: "0",
  symlinks_count: "0",
  skipped_count: "0",
  logical_size: "0",
  allocated_size: null,
  errors_count: "0",
  started_at_ms: "1",
  finished_at_ms: null,
  failure: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getVolumes).mockResolvedValue([
    {
      name: "Test disk",
      mount_point: "/fixture",
      filesystem: "test",
      total_bytes: "1024",
      available_bytes: "512",
    },
  ]);
  vi.mocked(getScan).mockResolvedValue(null);
});
async function start() {
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Обновить" })).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText("Абсолютный путь к каталогу"), {
    target: { value: "/fixture" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Сканировать" }));
}
describe("Scanner UI", () => {
  it("does not invoke filesystem commands in browser preview", () => {
    render(<ScanPanel enabled={false} />);
    expect(screen.getByRole("button", { name: "Сканировать" })).toBeDisabled();
    expect(getVolumes).not.toHaveBeenCalled();
    expect(getScan).not.toHaveBeenCalled();
  });
  it("keeps terminal progress that arrives before the start response", async () => {
    let resolve!: (scan: ScanSession) => void;
    vi.mocked(startScan).mockImplementation((_request, onProgress) => {
      onProgress({
        ...initial,
        state: "completed",
        files_count: "3",
        logical_size: "3072",
      });
      return new Promise((done) => {
        resolve = done;
      });
    });
    render(<ScanPanel enabled />);
    await start();
    expect(
      await screen.findByRole("heading", { name: "Сканирование завершено" }),
    ).toBeInTheDocument();
    await act(async () => {
      resolve(initial);
    });
    expect(
      screen.getByRole("heading", { name: "Сканирование завершено" }),
    ).toBeInTheDocument();
    expect(screen.getByText("3 КиБ")).toBeInTheDocument();
    expect(startScan).toHaveBeenCalledWith(
      { root_path: "/fixture" },
      expect.any(Function),
    );
  });
  it("shows indeterminate progress and cancellation waits for terminal confirmation", async () => {
    let publish!: (scan: ScanSession) => void;
    vi.mocked(startScan).mockImplementation(async (_request, onProgress) => {
      publish = onProgress;
      return { ...initial, state: "scanning" };
    });
    vi.mocked(cancelScan).mockResolvedValue({
      ...initial,
      state: "cancelling",
    });
    render(<ScanPanel enabled />);
    await start();
    const progress = await screen.findByRole("progressbar");
    expect(progress).not.toHaveAttribute("value");
    fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
    await waitFor(() => expect(cancelScan).toHaveBeenCalledWith("1"));
    expect(
      await screen.findByRole("button", { name: "Отмена…" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("heading", { name: "Сканирование отменено" }),
    ).not.toBeInTheDocument();
    act(() => publish({ ...initial, state: "cancelled" }));
    expect(
      screen.getByRole("heading", { name: "Сканирование отменено" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
  it("labels partial results and retrieves bounded error pages", async () => {
    vi.mocked(getScan).mockResolvedValue({
      ...initial,
      state: "partial",
      errors_count: "1",
    });
    vi.mocked(getScanIssues).mockResolvedValue({
      items: [
        {
          path: "/fixture/private",
          code: "permission_denied",
          operation: "read_directory",
        },
      ],
      next_cursor: null,
    });
    render(<ScanPanel enabled />);
    expect(
      await screen.findByRole("heading", {
        name: "Сканирование завершено не полностью",
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Показать ошибки" }));
    expect(await screen.findByText("Нет доступа")).toBeInTheDocument();
    expect(getScanIssues).toHaveBeenCalledWith("1", null);
    expect(
      screen.getByRole("button", { name: "Следующие ошибки" }),
    ).toBeDisabled();
  });
  it("retains entered path and provides a safe error when start fails", async () => {
    vi.mocked(startScan).mockRejectedValue({
      user_message_key: "errors.invalid_target",
    });
    render(<ScanPanel enabled />);
    await start();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Не удалось открыть каталог",
    );
    expect(screen.getByLabelText("Абсолютный путь к каталогу")).toHaveValue(
      "/fixture",
    );
    expect(screen.getByRole("button", { name: "Сканировать" })).toBeEnabled();
  });
  it("restores interrupted scans without claiming completion", async () => {
    vi.mocked(getScan).mockResolvedValue({ ...initial, state: "interrupted" });
    render(<ScanPanel enabled />);
    expect(
      await screen.findByText(
        "Предыдущий обход не был завершён. Запустите новое сканирование.",
      ),
    ).toBeInTheDocument();
  });
  it("keeps manual path entry available if volume enumeration fails", async () => {
    vi.mocked(getVolumes).mockRejectedValue("private diagnostic");
    render(<ScanPanel enabled />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Можно указать путь вручную",
    );
    expect(screen.getByLabelText("Абсолютный путь к каталогу")).toBeEnabled();
    expect(screen.queryByText("private diagnostic")).not.toBeInTheDocument();
  });
  it("formats counts above Number.MAX_SAFE_INTEGER without rounding", () => {
    expect(formatCount("9007199254740993").replace(/\s/g, "")).toBe(
      "9007199254740993",
    );
    expect(formatBytes("1024")).toBe("1 КиБ");
    expect(formatBytes("0")).toBe("0 Б");
  });
});
