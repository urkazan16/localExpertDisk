import { AnalyzerPanel } from "./AnalyzerPanel";
import { HistoryDuplicatesPanel } from "./HistoryDuplicatesPanel";
import { OldFilesPanel } from "./OldFilesPanel";
import { ScanWorkspace } from "./screens/ScanWorkspace";
import { StartScreen } from "./screens/StartScreen";
import { AppHeader } from "./shell/AppHeader";
import { AppShell } from "./shell/AppShell";
import { Sidebar } from "./shell/Sidebar";
import { useAppController } from "./state/useAppController";
import { Button, EmptyState, InlineAlert, Skeleton } from "./ui/primitives";

function Workspace() {
  const controller = useAppController();
  const readyRuntime =
    controller.runtime.status === "ready" ? controller.runtime : null;
  const enabled = Boolean(readyRuntime);
  const trash = readyRuntime?.info.capabilities.trash ?? false;
  let content;

  switch (controller.workspace) {
    case "booting":
      content = (
        <section className="workspace-state" aria-label="Загрузка приложения">
          <Skeleton width="9rem" />
          <Skeleton className="workspace-skeleton-title" width="26rem" />
          <Skeleton width="34rem" />
        </section>
      );
      break;
    case "browser-preview":
      content = (
        <section className="workspace-state">
          <InlineAlert title="Открыт браузерный предпросмотр" tone="info">
            Доступ к дискам и выбору папок появляется только в настольном
            приложении. Здесь интерфейс показан без вымышленных данных.
          </InlineAlert>
          <EmptyState icon="disk" title="Локальные диски недоступны">
            Запустите desktop-сборку, чтобы выбрать реальный том или папку.
          </EmptyState>
        </section>
      );
      break;
    case "fatal-error":
      content =
        controller.runtime.status === "error" ? (
          <section className="workspace-state">
            <InlineAlert
              title="Не удалось подключить локальное приложение"
              tone="danger"
            >
              {controller.runtime.message}
            </InlineAlert>
            {controller.runtime.retryable && (
              <Button
                icon="refresh"
                onClick={controller.retry}
                variant="secondary"
              >
                Повторить проверку
              </Button>
            )}
          </section>
        ) : null;
      break;
    case "no-target":
      content = (
        <section className="workspace-state">
          {(controller.locationError || controller.scan.volumeError) && (
            <InlineAlert title="Не все расположения доступны" tone="warning">
              {controller.locationError ?? controller.scan.volumeError}
            </InlineAlert>
          )}
          <EmptyState
            action={
              <Button
                icon="folder"
                loading={controller.pickerLoading}
                onClick={() => void controller.chooseFolder()}
              >
                Выбрать папку
              </Button>
            }
            title="Выберите том или папку"
          >
            Выберите реальное расположение в боковой панели. Файлы анализируются
            локально и никуда не отправляются.
          </EmptyState>
        </section>
      );
      break;
    case "ready":
      content = <StartScreen controller={controller} />;
      break;
    case "scanning":
      content = <ScanWorkspace controller={controller} />;
      break;
    case "result":
      content = (
        <div className="result-workspace">
          {controller.scan.scan?.state === "partial" && (
            <InlineAlert
              className="scan-partial-notice"
              title="Часть объектов недоступна"
              tone="warning"
            >
              Результат можно изучать, но итоговые размеры и количество объектов
              могут быть неполными.
            </InlineAlert>
          )}
          {controller.scan.scan?.state === "cancelled" && (
            <InlineAlert title="Сканирование отменено" tone="info">
              Сохранены только данные, обработанные до отмены.
            </InlineAlert>
          )}
          {controller.scan.scan &&
            BigInt(controller.scan.scan.errors_count) > 0n && (
              <div className="result-issues">
                <Button
                  disabled={Boolean(
                    controller.scan.issuePage &&
                    !controller.scan.issuePage.next_cursor,
                  )}
                  loading={controller.scan.issueLoading}
                  onClick={() => void controller.scan.loadIssues()}
                  size="small"
                  variant="secondary"
                >
                  {controller.scan.issuePage
                    ? "Следующие ошибки"
                    : "Показать ошибки доступа"}
                </Button>
                {controller.scan.issuePage && (
                  <ul className="issues">
                    {controller.scan.issuePage.items.map((issue, index) => (
                      <li key={`${issue.path}-${index}`}>
                        <span className="scan-path">{issue.path}</span>
                        <span>{issue.operation}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          <AnalyzerPanel
            enabled={enabled}
            scan={controller.scan.scan}
            trash={trash}
          />
        </div>
      );
      break;
    case "tool":
      content =
        controller.view === "old-files" ? (
          <OldFilesPanel enabled={enabled} scan={controller.scan.scan} />
        ) : (
          <HistoryDuplicatesPanel
            activeScanId={controller.scan.scan?.id}
            enabled={enabled}
            onOpenScan={controller.openHistoricalScan}
            trash={trash}
          />
        );
      break;
  }

  return (
    <AppShell
      collapsed={controller.sidebarCollapsed}
      header={<AppHeader controller={controller} />}
      runtime={controller.runtime}
      sidebar={<Sidebar controller={controller} />}
    >
      {content}
    </AppShell>
  );
}

export function App() {
  return <Workspace />;
}
