import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryDuplicatesPanel } from "./HistoryDuplicatesPanel";
import {
  confirmDuplicates,
  getConfirmedDuplicates,
  getScanHistory,
} from "./api/generated";

vi.mock("./api/generated", () => ({
  compareScans: vi.fn(),
  confirmDuplicates: vi.fn(),
  deleteScanHistory: vi.fn(),
  getConfirmedDuplicates: vi.fn(),
  getScanHistory: vi.fn(),
}));

describe("History and duplicates UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getScanHistory).mockResolvedValue({
      items: [],
      next_cursor: null,
    });
  });

  it("loads later confirmed duplicate groups without hashing everything again", async () => {
    vi.mocked(confirmDuplicates).mockResolvedValue({
      items: [{ size: "100", files_count: "2", reclaimable_size: "100" }],
      next_cursor: "50",
    });
    vi.mocked(getConfirmedDuplicates).mockResolvedValue({
      items: [{ size: "10", files_count: "3", reclaimable_size: "20" }],
      next_cursor: null,
    });
    render(<HistoryDuplicatesPanel enabled />);

    fireEvent.click(
      screen.getByRole("button", { name: "Проверить содержимое" }),
    );
    await screen.findByRole("button", {
      name: "Следующая страница дубликатов",
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Следующая страница дубликатов",
      }),
    );

    await waitFor(() =>
      expect(getConfirmedDuplicates).toHaveBeenCalledWith("50"),
    );
    expect(confirmDuplicates).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/3 файлов/)).toBeInTheDocument();
  });
});
