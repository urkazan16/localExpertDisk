import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
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
  variant?: "primary" | "secondary" | "ghost" | "danger";
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

export function SelectField({
  children,
  className,
  hint,
  id: providedId,
  label,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  hint?: string;
  label: string;
}) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const descriptionId = hint ? `${id}-description` : undefined;
  return (
    <div className={classes("ui-field", className)}>
      <label className="ui-field__label" htmlFor={id}>
        {label}
      </label>
      <select
        {...props}
        aria-describedby={descriptionId}
        className="ui-select"
        id={id}
      >
        {children}
      </select>
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
