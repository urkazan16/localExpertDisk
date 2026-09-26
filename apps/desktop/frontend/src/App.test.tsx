import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { App } from "./App";
import {
  getAppInfo,
  getScan,
  getVolumes,
  startScan,
  type AppInfo,
  type ScanSession,
  type VolumeInfo,
} from "./api/generated";

vi.mock("./AnalyzerPanel", () => ({
  AnalyzerPanel: () => <div>Analyzer</div>,
}));
vi.mock("./OldFilesPanel", () => ({
  OldFilesPanel: () => <div>Old files</div>,
}));
vi.mock("./HistoryDuplicatesPanel", () => ({
  HistoryDuplicatesPanel: ({ mode }: { mode: string }) => (
    <div>Tool mode: {mode}</div>
  ),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({
  audioDir: vi.fn().mockResolvedValue("/Users/test/Music"),
  documentDir: vi.fn().mockResolvedValue("/Users/test/Documents"),
  downloadDir: vi.fn().mockResolvedValue("/Users/test/Downloads"),
  homeDir: vi.fn().mockResolvedValue("/Users/test"),
  pictureDir: vi.fn().mockResolvedValue("/Users/test/Pictures"),
  videoDir: vi.fn().mockResolvedValue("/Users/test/Movies"),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("./api/generated", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api/generated")>();
  return {
    ...actual,
    cancelScan: vi.fn(),
    getAppInfo: vi.fn(),
    getScan: vi.fn(),
    getScanIssues: vi.fn(),
    getVolumes: vi.fn(),
    startScan: vi.fn(),
  };
});

const info: AppInfo = {
  version: "0.1.0",
  platform: "macos",
  schema_version: 1,
  capabilities: {
    trash: false,
    permanent_delete: false,
    watcher: false,
    snapshots: false,
    filesystem_details: false,
    allocated_size: false,
    last_access_reliable: false,
    duplicate_hashing: false,
  },
};
const volume: VolumeInfo = {
  name: "Macintosh HD",
  mount_point: "/",
  filesystem: "apfs",
  total_bytes: "1000000000",
  available_bytes: "400000000",
};
const activeScan: ScanSession = {
  id: "scan-1",
  root_path: "/",
  state: "scanning",
  files_count: "12",
  directories_count: "4",
  symlinks_count: "0",
  skipped_count: "0",
  logical_size: "4096",
  allocated_size: null,
  unique_allocated_size: null,
  errors_count: "0",
  started_at_ms: "1",
  finished_at_ms: null,
  failure: null,
};
const partialScan: ScanSession = {
  ...activeScan,
  state: "partial",
  finished_at_ms: "2",
  errors_count: "1",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(getAppInfo).mockResolvedValue(info);
  vi.mocked(getVolumes).mockResolvedValue([volume]);
  vi.mocked(getScan).mockResolvedValue(null);
  vi.mocked(open).mockResolvedValue(null);
});

describe("application shell", () => {
  it("keeps the browser preview honest", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    render(<App />);
    expect(
      await screen.findByText("Открыт браузерный предпросмотр"),
    ).toBeInTheDocument();
    expect(screen.getByText("Локальные диски недоступны")).toBeInTheDocument();
    expect(getAppInfo).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Выбрать папку…" }),
    ).toBeDisabled();
  });

  it("shows the shell while IPC starts, then only real locations", async () => {
    let resolve!: (value: AppInfo) => void;
    vi.mocked(getAppInfo).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<App />);
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(screen.getByLabelText("Загрузка приложения")).toBeInTheDocument();
    resolve(info);
    expect(
      await screen.findByText("Выберите том или папку"),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Macintosh HD" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Документы" }),
    ).toBeInTheDocument();
    expect(screen.getByText("macOS · 0.1.0")).toBeInTheDocument();
  });

  it("selects a real volume and starts its scan", async () => {
    vi.mocked(startScan).mockResolvedValue(activeScan);
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Macintosh HD" }),
    );
    expect(
      screen.getByRole("heading", { name: "Macintosh HD" }),
    ).toBeInTheDocument();
    expect(screen.getByText("apfs")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Начать сканирование" }),
    );
    await waitFor(() =>
      expect(startScan).toHaveBeenCalledWith(
        { root_path: "/" },
        expect.any(Function),
      ),
    );
    expect(
      await screen.findByText("ИДЁТ ЛОКАЛЬНЫЙ АНАЛИЗ"),
    ).toBeInTheDocument();
  });

  it("acknowledges scan start before the native command resolves", async () => {
    let resolve!: (scan: ScanSession) => void;
    vi.mocked(startScan).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Macintosh HD" }),
    );
    const startButton = screen.getByRole("button", {
      name: "Начать сканирование",
    });
    fireEvent.click(startButton);
    expect(startButton).toBeDisabled();
    expect(startButton).toHaveAttribute("aria-busy", "true");
    expect(startButton).toHaveAccessibleName("Запуск…");

    await act(async () => resolve(activeScan));
    expect(
      await screen.findByText("ИДЁТ ЛОКАЛЬНЫЙ АНАЛИЗ"),
    ).toBeInTheDocument();
  });

  it("uses the native picker result without inventing folder metadata", async () => {
    vi.mocked(open).mockResolvedValue("/Users/test/Work");
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Выбрать папку…" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Work" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Размер и содержимое папки будут определены во время сканирования.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps a partial-result warning visible in the result workspace", async () => {
    vi.mocked(getScan).mockResolvedValue(partialScan);
    render(<App />);
    expect(
      await screen.findByText("Часть объектов недоступна"),
    ).toBeInTheDocument();
    expect(screen.getByText("Analyzer")).toBeInTheDocument();
  });

  it("opens history and duplicates as separate workspace modes", async () => {
    vi.mocked(getScan).mockResolvedValue(partialScan);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "История" }));
    expect(screen.getByText("Tool mode: history")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Дубликаты" }));
    expect(screen.getByText("Tool mode: duplicates")).toBeInTheDocument();
  });

  it("accepts an absolute path as a fallback selection", async () => {
    render(<App />);
    const summary = await screen.findByText("Указать путь вручную");
    fireEvent.click(summary);
    fireEvent.change(screen.getByLabelText("Абсолютный путь"), {
      target: { value: "/tmp/fixture" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Использовать путь" }));
    expect(
      await screen.findByRole("heading", { name: "fixture" }),
    ).toBeInTheDocument();
  });

  it("rejects a relative manual path before calling the backend", async () => {
    render(<App />);
    fireEvent.click(await screen.findByText("Указать путь вручную"));
    fireEvent.change(screen.getByLabelText("Абсолютный путь"), {
      target: { value: "relative/folder" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Использовать путь" }));
    expect(screen.getByText("Укажите абсолютный путь.")).toBeInTheDocument();
    expect(startScan).not.toHaveBeenCalled();
  });

  it("surfaces a restored terminal scan failure on its target", async () => {
    vi.mocked(getScan).mockResolvedValue({
      ...partialScan,
      state: "failed",
      failure: {
        code: "permission_denied",
        recoverable: true,
        user_message_key: "errors.permission_denied",
      },
    });
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Нет доступа к выбранному каталогу",
    );
  });

  it("recovers from a retryable local storage error", async () => {
    vi.mocked(getAppInfo)
      .mockRejectedValueOnce({
        user_message_key: "errors.storage_unavailable",
        recoverable: true,
      })
      .mockResolvedValueOnce(info);
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Не удалось открыть локальную базу",
    );
    fireEvent.click(screen.getByRole("button", { name: "Повторить проверку" }));
    expect(
      await screen.findByText("Выберите том или папку"),
    ).toBeInTheDocument();
  });

  it("does not offer retry for an incompatible schema", async () => {
    vi.mocked(getAppInfo).mockRejectedValue({
      user_message_key: "errors.unsupported_schema",
      recoverable: false,
    });
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "База создана более новой версией",
    );
    expect(
      screen.queryByRole("button", { name: "Повторить проверку" }),
    ).not.toBeInTheDocument();
  });
});
