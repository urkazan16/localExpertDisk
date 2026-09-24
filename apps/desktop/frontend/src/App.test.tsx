import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { App } from "./App";
import type { AppInfo } from "./api/generated";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
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
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
});
describe("Foundation connection", () => {
  it("does not invent a backend in the browser", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    render(<App />);
    expect(
      await screen.findByText("Открыт браузерный предпросмотр"),
    ).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("shows loading until the actual IPC response arrives", async () => {
    let resolve!: (value: AppInfo) => void;
    vi.mocked(invoke).mockReturnValue(
      new Promise<AppInfo>((done) => {
        resolve = done;
      }),
    );
    render(<App />);
    expect(screen.getByRole("status")).toHaveTextContent("Проверяем");
    resolve(info);
    expect(
      await screen.findByText("Приложение подключено · локальная база готова"),
    ).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("get_app_info");
    expect(screen.getByText("0.1.0")).toBeInTheDocument();
  });
  it("handles storage errors safely and allows another check", async () => {
    vi.mocked(invoke)
      .mockRejectedValueOnce({
        user_message_key: "errors.storage_unavailable",
        recoverable: true,
        technical_details: "/private/user/secret",
      })
      .mockResolvedValueOnce(info);
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Не удалось открыть локальную базу",
    );
    expect(screen.queryByText("/private/user/secret")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Повторить проверку" }));
    expect(
      await screen.findByText("Приложение подключено · локальная база готова"),
    ).toBeInTheDocument();
  });

  it("does not offer a retry for an incompatible schema", async () => {
    vi.mocked(invoke).mockRejectedValue({
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
  it("uses safe text for an unknown transport error", async () => {
    vi.mocked(invoke).mockRejectedValue("sensitive path or diagnostic");
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Не удалось связаться",
    );
    expect(
      screen.queryByText("sensitive path or diagnostic"),
    ).not.toBeInTheDocument();
  });
});
