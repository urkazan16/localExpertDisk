import type { AppController } from "../state/useAppController";

const titles = {
  home: "Обзор",
  structure: "Структура диска",
  "old-files": "Старые файлы",
  duplicates: "Дубликаты",
  history: "История сканирований",
} as const;

export function AppHeader({ controller }: { controller: AppController }) {
  const status = controller.scan.activeScan
    ? "Сканирование"
    : controller.runtime.status === "ready"
      ? "Готово к работе"
      : controller.runtime.status === "browser"
        ? "Предпросмотр"
        : "Подключение";

  return (
    <>
      <div className="app-header__title">
        <span>{titles[controller.view]}</span>
        {controller.selectedTarget && (
          <span
            className="app-header__path"
            title={controller.selectedTarget.path}
          >
            {controller.selectedTarget.path}
          </span>
        )}
      </div>
      <span className="app-header__status">{status}</span>
    </>
  );
}
