import { useState, type FormEvent } from "react";
import type { VolumeInfo } from "../api/generated";
import { formatBytes } from "../state/scanState";
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

function usedPercent(volume: VolumeInfo): number {
  const total = BigInt(volume.total_bytes);
  if (total <= 0n) return 0;
  const available = BigInt(volume.available_bytes);
  const used = available >= total ? 0n : total - available;
  return Number((used * 1000n) / total) / 10;
}

function compactMountPoint(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).at(-1) || path;
}

function VolumeButton({
  active,
  disabled,
  onClick,
  showMountPoint,
  volume,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  showMountPoint: boolean;
  volume: VolumeInfo;
}) {
  const name = volume.name || volume.mount_point || "Том";
  const mountPoint = volume.mount_point || "точка монтирования недоступна";
  const available = formatBytes(volume.available_bytes);
  const total = formatBytes(volume.total_bytes);

  return (
    <button
      aria-current={active ? "page" : undefined}
      aria-label={`${name}, ${mountPoint}, ${available} свободно из ${total}`}
      className="sidebar-item sidebar-volume"
      disabled={disabled}
      onClick={onClick}
      title={`${name} — ${mountPoint}\n${available} свободно из ${total}`}
      type="button"
    >
      <Icon name="disk" />
      <span className="sidebar-volume__content">
        <span className="sidebar-volume__heading">
          <span className="sidebar-item__label">{name}</span>
          {showMountPoint && (
            <span className="sidebar-volume__mount">
              {compactMountPoint(mountPoint)}
            </span>
          )}
        </span>
        <span className="sidebar-volume__stats">
          <span>{available} свободно</span>
          <span>{total}</span>
        </span>
        <span className="sidebar-volume__meter" aria-hidden="true">
          <span style={{ width: `${usedPercent(volume)}%` }} />
        </span>
      </span>
    </button>
  );
}

export function Sidebar({ controller }: { controller: AppController }) {
  const [manualPath, setManualPath] = useState("");
  const [manualError, setManualError] = useState<string | undefined>();
  const desktopReady = controller.runtime.status === "ready";
  const selectionDisabled = !desktopReady || controller.scan.busy;
  const volumeNameCounts = controller.scan.volumes.reduce((counts, volume) => {
    const name = volume.name || volume.mount_point || "Том";
    counts.set(name, (counts.get(name) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());

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
            <VolumeButton
              active={controller.selectedTarget?.path === volume.mount_point}
              disabled={selectionDisabled || !volume.mount_point}
              key={`${volume.name}-${volume.mount_point}`}
              onClick={() => controller.selectVolume(volume)}
              showMountPoint={
                (volumeNameCounts.get(
                  volume.name || volume.mount_point || "Том",
                ) ?? 0) > 1
              }
              volume={volume}
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
