import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Icon } from "./icons";
import {
  Button,
  DialogSurface,
  IconButton,
  InlineAlert,
  SegmentedControl,
  TextField,
} from "./primitives";

describe("UI primitives", () => {
  it("exposes button state and keeps decorative icons out of the accessibility tree", () => {
    render(
      <Button icon="search" loading>
        Найти
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Найти" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.querySelector("svg")).not.toBeInTheDocument();
  });

  it("requires an accessible label for an icon-only action", () => {
    render(<IconButton icon="refresh" label="Обновить" />);
    expect(screen.getByRole("button", { name: "Обновить" })).toHaveAttribute(
      "title",
      "Обновить",
    );
  });

  it("supports a labelled standalone icon", () => {
    render(<Icon label="Каталог" name="folder" />);
    expect(screen.getByRole("img", { name: "Каталог" })).toBeInTheDocument();
  });

  it("reports segmented selection and emits the selected value", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Режим"
        onChange={onChange}
        options={[
          { label: "Структура", value: "structure" },
          { label: "Большие файлы", value: "large" },
        ]}
        value="structure"
      />,
    );
    expect(screen.getByRole("button", { name: "Структура" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Большие файлы" }));
    expect(onChange).toHaveBeenCalledWith("large");
  });

  it("connects field errors to the input", () => {
    render(<TextField error="Каталог недоступен" label="Каталог" />);
    const field = screen.getByRole("textbox", { name: "Каталог" });
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("Каталог недоступен");
  });

  it("uses an alert role only for an actionable error", () => {
    const { rerender } = render(
      <InlineAlert title="Готово" tone="success">
        Результат сохранён.
      </InlineAlert>,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    rerender(
      <InlineAlert title="Ошибка" tone="danger">
        Повторите действие.
      </InlineAlert>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("closes a dialog surface with Escape", () => {
    const onClose = vi.fn();
    render(
      <DialogSurface onClose={onClose} open title="Проверка">
        Содержимое
      </DialogSurface>,
    );
    expect(
      screen.getByRole("dialog", { name: "Проверка" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
