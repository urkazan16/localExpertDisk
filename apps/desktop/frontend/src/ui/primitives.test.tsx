import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Icon } from "./icons";
import {
  Button,
  Checkbox,
  DialogSurface,
  IconButton,
  InlineAlert,
  SearchField,
  SegmentedControl,
  SelectControl,
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

  it("renders branded search, select, and checkbox controls with accessible names", () => {
    const onValueChange = vi.fn();
    const onClear = vi.fn();
    render(
      <>
        <SearchField
          label="Поиск по имени"
          onClear={onClear}
          placeholder="Поиск"
          readOnly
          value="report"
        />
        <SelectControl
          aria-label="Сортировка"
          onValueChange={onValueChange}
          options={[
            { value: "size", label: "Размер" },
            { value: "name", label: "Имя" },
          ]}
          value="size"
        />
        <Checkbox aria-label="Выбрать файл" />
      </>,
    );

    expect(
      screen.getByRole("searchbox", { name: "Поиск по имени" }),
    ).toHaveClass("ui-search__input");
    fireEvent.click(screen.getByRole("button", { name: "Очистить поиск" }));
    expect(onClear).toHaveBeenCalledOnce();
    const select = screen.getByRole("combobox", { name: "Сортировка" });
    expect(select).toHaveClass("ui-select__trigger");
    expect(select).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(select);
    expect(select).toHaveAttribute("aria-expanded", "true");
    fireEvent.mouseDown(screen.getByRole("option", { name: "Имя" }));
    expect(onValueChange).toHaveBeenCalledWith("name");
    expect(screen.getByRole("checkbox", { name: "Выбрать файл" })).toHaveClass(
      "ui-checkbox",
    );
  });

  it("supports complete keyboard navigation for the custom select", async () => {
    const onValueChange = vi.fn();
    render(
      <>
        <button>До списка</button>
        <SelectControl
          aria-label="Метрика"
          onValueChange={onValueChange}
          options={[
            { value: "logical", label: "Логический" },
            { value: "allocated", label: "На диске", disabled: true },
            { value: "unique", label: "Уникальный" },
          ]}
          value="logical"
        />
        <button>После списка</button>
      </>,
    );
    const trigger = screen.getByRole("combobox", { name: "Метрика" });
    fireEvent.keyDown(trigger, { key: "End" });
    const listbox = screen.getByRole("listbox", { name: "Метрика" });
    expect(listbox).toHaveAttribute(
      "aria-activedescendant",
      expect.stringContaining("option-2"),
    );
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    expect(listbox).toHaveAttribute(
      "aria-activedescendant",
      expect.stringContaining("option-0"),
    );
    fireEvent.keyDown(listbox, { key: "Home" });
    fireEvent.keyDown(listbox, { key: "ArrowUp" });
    fireEvent.keyDown(listbox, { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledWith("unique");
    fireEvent.keyDown(trigger, { key: " " });
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Tab" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "После списка" }),
      ).toHaveFocus(),
    );
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

  it("keeps a busy dialog open until its operation can be interrupted safely", () => {
    const onClose = vi.fn();
    render(
      <DialogSurface closeDisabled onClose={onClose} open title="Проверка">
        Содержимое
      </DialogSurface>,
    );
    expect(screen.getByRole("button", { name: "Закрыть" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("traps keyboard focus and returns it to the opener", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <>
        <button>Открыть проверку</button>
        <DialogSurface onClose={onClose} open={false} title="Проверка">
          <button>Первое действие</button>
          <button>Последнее действие</button>
        </DialogSurface>
      </>,
    );
    const opener = screen.getByRole("button", { name: "Открыть проверку" });
    opener.focus();
    rerender(
      <>
        <button>Открыть проверку</button>
        <DialogSurface onClose={onClose} open title="Проверка">
          <button>Первое действие</button>
          <button>Последнее действие</button>
        </DialogSurface>
      </>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Закрыть" })).toHaveFocus(),
    );
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(
      screen.getByRole("button", { name: "Последнее действие" }),
    ).toHaveFocus();
    rerender(
      <>
        <button>Открыть проверку</button>
        <DialogSurface onClose={onClose} open={false} title="Проверка">
          <button>Первое действие</button>
        </DialogSurface>
      </>,
    );
    expect(opener).toHaveFocus();
  });
});
