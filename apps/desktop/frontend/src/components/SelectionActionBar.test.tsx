import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { IndexedEntry } from "../api/generated";
import { SelectionActionBar } from "./SelectionActionBar";

const first: IndexedEntry = {
  id: "1",
  parent_id: "root",
  name: "first.bin",
  path: "/fixture/first.bin",
  kind: "file",
  logical_size: "10",
  aggregate_size: "10",
};

const second: IndexedEntry = {
  ...first,
  id: "2",
  name: "second.bin",
  path: "/fixture/second.bin",
  logical_size: "20",
  aggregate_size: "20",
};

describe("SelectionActionBar", () => {
  it("uses the reviewed snapshot and focuses the safe action first", async () => {
    const onTrash = vi.fn().mockResolvedValue(true);
    const { rerender } = render(
      <SelectionActionBar
        onClear={vi.fn()}
        onOpen={vi.fn()}
        onReveal={vi.fn()}
        onTrash={onTrash}
        selected={[first]}
        trashAvailable
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "В корзину" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Отмена" })).toHaveFocus(),
    );

    rerender(
      <SelectionActionBar
        onClear={vi.fn()}
        onOpen={vi.fn()}
        onReveal={vi.fn()}
        onTrash={onTrash}
        selected={[second]}
        trashAvailable
      />,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("first.bin");
    expect(screen.getByRole("dialog")).not.toHaveTextContent("second.bin");
    fireEvent.click(
      screen.getByRole("button", { name: "Подтвердить перемещение" }),
    );
    await waitFor(() => expect(onTrash).toHaveBeenCalledWith([first]));
  });

  it("cannot be dismissed while the destructive operation is pending", async () => {
    let finish!: (value: boolean) => void;
    const onTrash = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <SelectionActionBar
        onClear={vi.fn()}
        onOpen={vi.fn()}
        onReveal={vi.fn()}
        onTrash={onTrash}
        selected={[first]}
        trashAvailable
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "В корзину" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Подтвердить перемещение" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Закрыть" })).toBeDisabled(),
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    finish(true);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
