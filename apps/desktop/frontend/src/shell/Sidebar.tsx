import { useState, type FormEvent } from "react";
import type { AppController, AppView } from "../state/useAppController";
import { Icon, type IconName } from "../ui/icons";
import { Button, IconButton, TextField } from "../ui/primitives";

function SidebarButton({
  active = false,
  disabled = false,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className="sidebar-item"
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon name={icon} />
      <span className="sidebar-item__label">{label}</span>
    </button>
  );
}

function ToolButton({
  controller,
  icon,
  label,
  view,
}: {
  controller: AppController;
  icon: IconName;
  label: string;
  view: AppView;
}) {
  return (
    <SidebarButton
      active={controller.view === view}
      disabled={controller.runtime.status !== "ready" || controller.scan.busy}
      icon={icon}
      label={label}
      onClick={() => controller.setView(view)}
    />
  );
}

export function Sidebar({ controller }: { controller: AppController }) {
  const [manualPath, setManualPath] = useState("");
  const [manualError, setManualError] = useState<string | undefined>();
  const desktopReady = controller.runtime.status === "ready";
  const selectionDisabled = !desktopReady || controller.scan.busy;

  function submitManualPath(event: FormEvent) {
    event.preventDefault();
    const value = manualPath.trim();
    const absolute =
      controller.platform === "windows"
        ? /^(?:[a-zA-Z]:[\\/]|\\\\)/.test(value)
        : value.startsWith("/");
    if (!absolute) {
      setManualError("Укажите абсолютный путь.");
      return;
    }
    setManualError(undefined);
    controller.selectFolderPath(manualPath);
  }

  return (
    <div className="sidebar-content">
      <div className="sidebar-brand">
        <span className="sidebar-brand__mark" aria-hidden="true">
          ◉
        </span>
        <strong className="sidebar-item__label">Local Expert Disk</strong>
        <IconButton
          className="sidebar-collapse"
          icon={controller.sidebarCollapsed ? "forward" : "back"}
          label={
            controller.sidebarCollapsed
              ? "Развернуть боковую панель"
              : "Свернуть боковую панель"
          }
          onClick={() =>
            controller.setSidebarCollapsed(!controller.sidebarCollapsed)
          }
        />
      </div>

      <nav aria-label="Основная навигация">
        <div className="sidebar-section">
          <span className="sidebar-section__title">Обзор</span>
          <SidebarButton
            active={Boolean(
              controller.homePath &&
              controller.selectedTarget?.path === controller.homePath,
            )}
            disabled={selectionDisabled || !controller.homePath}
            icon="home"
            label="Домой"
            onClick={controller.selectHome}
          />
        </div>

        <div className="sidebar-section">
          <span className="sidebar-section__title">Тома</span>
          {controller.scan.volumes.map((volume) => (
            <SidebarButton
              active={controller.selectedTarget?.path === volume.mount_point}
              disabled={selectionDisabled || !volume.mount_point}
              icon="disk"
              key={`${volume.name}-${volume.mount_point}`}
              label={volume.name || volume.mount_point || "Том"}
              onClick={() => controller.selectVolume(volume)}
            />
          ))}
          {desktopReady &&
            !controller.scan.loading &&
            controller.scan.volumes.length === 0 && (
              <span className="sidebar-note">Доступные тома не найдены</span>
            )}
        </div>

        <div className="sidebar-section">
          <span className="sidebar-section__title">Избранное</span>
          {controller.favorites.map((favorite) => (
            <SidebarButton
              active={controller.selectedTarget?.path === favorite.path}
              disabled={selectionDisabled}
              icon={favorite.icon}
              key={favorite.key}
              label={favorite.label}
              onClick={() => controller.selectTarget(favorite)}
            />
          ))}
          {controller.favoritesLoading && (
            <span className="sidebar-note">Загрузка…</span>
          )}
          <Button
            className="sidebar-picker"
            disabled={selectionDisabled}
            icon="folder"
            loading={controller.pickerLoading}
            onClick={() => void controller.chooseFolder()}
            size="small"
            variant="ghost"
          >
            Выбрать папку…
          </Button>
          <details className="sidebar-manual">
            <summary>Указать путь вручную</summary>
            <form onSubmit={submitManualPath}>
              <TextField
                disabled={selectionDisabled}
                error={manualError}
                id="manual-target-path"
                label="Абсолютный путь"
                maxLength={32768}
                onChange={(event) => setManualPath(event.target.value)}
                placeholder="/Users/name/Documents"
                value={manualPath}
              />
              <Button
                disabled={selectionDisabled || !manualPath.trim()}
                size="small"
                type="submit"
              >
                Использовать путь
              </Button>
            </form>
          </details>
        </div>

        <div className="sidebar-section sidebar-section--tools">
          <span className="sidebar-section__title">Инструменты</span>
          <ToolButton
            controller={controller}
            icon="info"
            label="Старые файлы"
            view="old-files"
          />
          <ToolButton
            controller={controller}
            icon="search"
            label="Дубликаты"
            view="duplicates"
          />
          <ToolButton
            controller={controller}
            icon="refresh"
            label="История"
            view="history"
          />
        </div>
      </nav>
    </div>
  );
}
