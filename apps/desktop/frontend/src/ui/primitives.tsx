import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ComponentPropsWithRef,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "./icons";

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function Button({
  children,
  className,
  icon,
  loading = false,
  size = "medium",
  variant = "primary",
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: IconName;
  loading?: boolean;
  size?: "small" | "medium" | "large";
  variant?: "primary" | "secondary" | "ghost" | "danger" | "disclosure";
}) {
  return (
    <button
      {...props}
      aria-busy={loading || undefined}
      className={classes(
        "ui-button",
        `ui-button--${variant}`,
        `ui-button--${size}`,
        className,
      )}
      disabled={disabled || loading}
    >
      {loading ? (
        <span aria-hidden="true" className="ui-spinner" />
      ) : icon ? (
        <Icon name={icon} />
      ) : null}
      <span>{children}</span>
    </button>
  );
}

export function IconButton({
  label,
  icon,
  className,
  variant = "ghost",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> & {
  icon: IconName;
  label: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button
      {...props}
      aria-label={label}
      className={classes("ui-icon-button", `ui-button--${variant}`, className)}
      title={props.title ?? label}
    >
      <Icon name={icon} />
    </button>
  );
}

export function SegmentedControl<T extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ label: string; value: T }>;
  value: T;
}) {
  return (
    <div aria-label={label} className="ui-segmented" role="group">
      {options.map((option) => (
        <button
          aria-pressed={option.value === value}
          className="ui-segmented__item"
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Breadcrumb({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <nav aria-label={label} className="ui-breadcrumb">
      <ol>{children}</ol>
    </nav>
  );
}

export function BreadcrumbItem({
  children,
  current = false,
  onClick,
}: {
  children: ReactNode;
  current?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        aria-current={current ? "page" : undefined}
        className="ui-breadcrumb__item"
        disabled={current}
        onClick={onClick}
        type="button"
      >
        {children}
      </button>
    </li>
  );
}

export function TextField({
  className,
  error,
  hint,
  id: providedId,
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  error?: string;
  hint?: string;
  label: string;
}) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const descriptionId = hint || error ? `${id}-description` : undefined;
  return (
    <div className={classes("ui-field", className)}>
      <label className="ui-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        {...props}
        aria-describedby={descriptionId}
        aria-invalid={Boolean(error) || undefined}
        className="ui-input"
        id={id}
      />
      {(error || hint) && (
        <span
          className={classes(
            "ui-field__description",
            error && "ui-field__description--error",
          )}
          id={descriptionId}
        >
          {error ?? hint}
        </span>
      )}
    </div>
  );
}

export function SearchField({
  className,
  id: providedId,
  label,
  onClear,
  ref,
  ...props
}: ComponentPropsWithRef<"input"> & {
  label: string;
  onClear?: () => void;
}) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const hasValue = String(props.value ?? props.defaultValue ?? "").length > 0;
  return (
    <div className={classes("ui-search", className)}>
      <label className="ui-visually-hidden" htmlFor={id}>
        {label}
      </label>
      <Icon aria-hidden="true" name="search" />
      <input
        {...props}
        className="ui-search__input"
        id={id}
        ref={ref}
        type="search"
      />
      {onClear && hasValue && (
        <IconButton
          className="ui-search__clear"
          icon="close"
          label="Очистить поиск"
          onClick={onClear}
          onMouseDown={(event) => event.preventDefault()}
          type="button"
        />
      )}
    </div>
  );
}

export type SelectValue = string | number;

export type SelectOption<T extends SelectValue> = {
  disabled?: boolean;
  label: string;
  value: T;
};

export function SelectControl<T extends SelectValue>({
  "aria-describedby": ariaDescribedBy,
  "aria-label": ariaLabel,
  className,
  disabled = false,
  id: providedId,
  onValueChange,
  options,
  value,
}: {
  "aria-describedby"?: string;
  "aria-label": string;
  className?: string;
  disabled?: boolean;
  id?: string;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<SelectOption<T>>;
  value: T;
}) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const listboxId = `${id}-listbox`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [activeIndex, setActiveIndex] = useState(
    selectedIndex >= 0 ? selectedIndex : 0,
  );
  const enabledIndexes = options
    .map((option, index) => (option.disabled ? -1 : index))
    .filter((index) => index >= 0);
  const selected = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => listboxRef.current?.focus());
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  function openAt(index: number) {
    if (disabled || enabledIndexes.length === 0) return;
    setActiveIndex(index);
    setOpen(true);
  }

  function moveActive(delta: number) {
    if (enabledIndexes.length === 0) return;
    const current = enabledIndexes.indexOf(activeIndex);
    const next =
      current < 0
        ? 0
        : (current + delta + enabledIndexes.length) % enabledIndexes.length;
    setActiveIndex(enabledIndexes[next]);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onValueChange(option.value);
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function continueTabNavigation(backward: boolean) {
    const focusable = Array.from(
      document.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])",
      ),
    );
    const triggerIndex = triggerRef.current
      ? focusable.indexOf(triggerRef.current)
      : -1;
    const next =
      triggerIndex < 0
        ? null
        : (focusable[triggerIndex + (backward ? -1 : 1)] ?? null);
    setOpen(false);
    requestAnimationFrame(() => next?.focus());
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent) {
    if (disabled) return;
    if (
      ["Enter", " ", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
    )
      event.preventDefault();
    if (event.key === "ArrowDown")
      openAt(
        enabledIndexes[
          Math.max(0, enabledIndexes.indexOf(selectedIndex) + 1)
        ] ?? enabledIndexes[0],
      );
    else if (event.key === "ArrowUp") {
      const current = enabledIndexes.indexOf(selectedIndex);
      openAt(
        enabledIndexes[current > 0 ? current - 1 : enabledIndexes.length - 1],
      );
    } else if (event.key === "Home") openAt(enabledIndexes[0]);
    else if (event.key === "End") openAt(enabledIndexes.at(-1) ?? 0);
    else if (event.key === "Enter" || event.key === " ")
      openAt(selectedIndex >= 0 ? selectedIndex : (enabledIndexes[0] ?? 0));
  }

  function handleListboxKeyDown(event: ReactKeyboardEvent) {
    if (event.key === "Tab") {
      event.preventDefault();
      continueTabNavigation(event.shiftKey);
      return;
    }
    if (
      ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Escape"].includes(
        event.key,
      )
    )
      event.preventDefault();
    if (event.key === "ArrowDown") moveActive(1);
    else if (event.key === "ArrowUp") moveActive(-1);
    else if (event.key === "Home") setActiveIndex(enabledIndexes[0] ?? 0);
    else if (event.key === "End") setActiveIndex(enabledIndexes.at(-1) ?? 0);
    else if (event.key === "Enter" || event.key === " ") choose(activeIndex);
    else if (event.key === "Escape") {
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  return (
    <div className={classes("ui-select", className)} ref={rootRef}>
      <button
        aria-controls={listboxId}
        aria-describedby={ariaDescribedBy}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="ui-select__trigger"
        disabled={disabled}
        id={id}
        onClick={() =>
          open
            ? setOpen(false)
            : openAt(
                selectedIndex >= 0 ? selectedIndex : (enabledIndexes[0] ?? 0),
              )
        }
        onKeyDown={handleTriggerKeyDown}
        ref={triggerRef}
        role="combobox"
        type="button"
      >
        <span className="ui-select__value">{selected?.label ?? "—"}</span>
        <Icon aria-hidden="true" name="chevron-down" size={14} />
      </button>
      {open && (
        <div
          aria-activedescendant={`${listboxId}-option-${activeIndex}`}
          aria-label={ariaLabel}
          className="ui-popover ui-select__listbox"
          id={listboxId}
          onKeyDown={handleListboxKeyDown}
          ref={listboxRef}
          role="listbox"
          tabIndex={-1}
        >
          {options.map((option, index) => (
            <div
              aria-disabled={option.disabled || undefined}
              aria-selected={option.value === value}
              className={classes(
                "ui-select__option",
                index === activeIndex && "is-active",
              )}
              id={`${listboxId}-option-${index}`}
              key={`${String(option.value)}-${index}`}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(index);
              }}
              onMouseEnter={() => !option.disabled && setActiveIndex(index)}
              role="option"
            >
              <span>{option.label}</span>
              {option.value === value && (
                <span aria-hidden="true" className="ui-select__check">
                  ✓
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Checkbox({
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <input
      {...props}
      className={classes("ui-checkbox", className)}
      type="checkbox"
    />
  );
}

export function SelectField<T extends SelectValue>({
  className,
  hint,
  id: providedId,
  label,
  onValueChange,
  options,
  value,
}: {
  className?: string;
  hint?: string;
  id?: string;
  label: string;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<SelectOption<T>>;
  value: T;
}) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const descriptionId = hint ? `${id}-description` : undefined;
  return (
    <div className={classes("ui-field", className)}>
      <label className="ui-field__label" htmlFor={id}>
        {label}
      </label>
      <SelectControl
        aria-describedby={descriptionId}
        aria-label={label}
        id={id}
        onValueChange={onValueChange}
        options={options}
        value={value}
      />
      {hint && (
        <span className="ui-field__description" id={descriptionId}>
          {hint}
        </span>
      )}
    </div>
  );
}

export function InlineAlert({
  children,
  className,
  title,
  tone = "info",
}: HTMLAttributes<HTMLDivElement> & {
  title: string;
  tone?: "info" | "success" | "warning" | "danger";
}) {
  return (
    <div
      className={classes("ui-alert", `ui-alert--${tone}`, className)}
      role={tone === "danger" ? "alert" : "status"}
    >
      <Icon name="info" />
      <div>
        <strong>{title}</strong>
        <div>{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({
  action,
  children,
  icon = "folder",
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  icon?: IconName;
  title: string;
}) {
  return (
    <div className="ui-empty-state">
      <span aria-hidden="true" className="ui-empty-state__icon">
        <Icon name={icon} size={28} />
      </span>
      <strong>{title}</strong>
      <div className="ui-empty-state__body">{children}</div>
      {action && <div className="ui-empty-state__action">{action}</div>}
    </div>
  );
}

export function Skeleton({
  className,
  width,
}: {
  className?: string;
  width?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={classes("ui-skeleton", className)}
      style={{ width }}
    />
  );
}

export function DialogSurface({
  children,
  closeDisabled = false,
  onClose,
  open,
  title,
}: {
  children: ReactNode;
  closeDisabled?: boolean;
  onClose: () => void;
  open: boolean;
  title: string;
}) {
  const titleId = useId();
  const surfaceRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  closeRef.current = onClose;
  closeDisabledRef.current = closeDisabled;
  useEffect(() => {
    if (!open) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = requestAnimationFrame(() => {
      const target = surfaceRef.current?.querySelector<HTMLElement>(
        "[autofocus], button, input, select, textarea, [tabindex]:not([tabindex='-1'])",
      );
      target?.focus();
    });
    const handleDialogKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !closeDisabledRef.current) {
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        surfaceRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])",
        ) ?? [],
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const current = focusable.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey
        ? current <= 0
          ? focusable.at(-1)
          : focusable[current - 1]
        : current < 0 || current === focusable.length - 1
          ? focusable[0]
          : focusable[current + 1];
      event.preventDefault();
      next?.focus();
    };
    window.addEventListener("keydown", handleDialogKeyboard);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleDialogKeyboard);
      previousFocus?.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="ui-dialog-backdrop">
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="ui-dialog"
        ref={surfaceRef}
        role="dialog"
      >
        <header className="ui-dialog__header">
          <h2 id={titleId}>{title}</h2>
          <IconButton
            disabled={closeDisabled}
            icon="close"
            label="Закрыть"
            onClick={onClose}
          />
        </header>
        <div className="ui-dialog__body">{children}</div>
      </section>
    </div>
  );
}

export function PopoverSurface({
  children,
  label,
  open,
}: {
  children: ReactNode;
  label: string;
  open: boolean;
}) {
  if (!open) return null;
  return (
    <div aria-label={label} className="ui-popover" role="menu">
      {children}
    </div>
  );
}
