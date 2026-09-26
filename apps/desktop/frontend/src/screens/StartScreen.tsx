import type { AppController } from "../state/useAppController";
import { errorMessage } from "../api/errors";
import { formatBytes } from "../state/scanState";
import { Button, InlineAlert } from "../ui/primitives";

function safeUsed(total: string, available: string) {
  const used = BigInt(total) - BigInt(available);
  return used < 0n ? "0" : used.toString();
}

export function StartScreen({ controller }: { controller: AppController }) {
  const target = controller.selectedTarget;
  if (!target) return null;
  const volume = target.volume;
  const matchingFailure =
    controller.scan.scan?.root_path === target.path
      ? controller.scan.scan.failure
      : null;
  const matchingState =
    controller.scan.scan?.root_path === target.path
      ? controller.scan.scan.state
      : null;

  return (
    <section className="start-screen" aria-labelledby="start-title">
      <div className="start-screen__copy">
        <p className="workspace-eyebrow">ВЫБРАНО ДЛЯ АНАЛИЗА</p>
        <h1 id="start-title">{target.label}</h1>
        <p className="start-screen__path">{target.path}</p>
        <dl className="target-metadata">
          <div>
            <dt>Тип</dt>
            <dd>{target.kind === "volume" ? "Том" : "Папка"}</dd>
          </div>
          {volume && (
            <div>
              <dt>Файловая система</dt>
              <dd>{volume.filesystem || "Не определена"}</dd>
            </div>
          )}
          {volume && (
            <div>
              <dt>Занято</dt>
              <dd>
                {formatBytes(
                  safeUsed(volume.total_bytes, volume.available_bytes),
                )}
              </dd>
            </div>
          )}
          {volume && (
            <div>
              <dt>Доступно</dt>
              <dd>{formatBytes(volume.available_bytes)}</dd>
            </div>
          )}
        </dl>
        {!volume && (
          <p className="start-screen__hint">
            Размер и содержимое папки будут определены во время сканирования.
          </p>
        )}
        {(controller.locationError ||
          controller.scan.error ||
          matchingFailure) && (
          <InlineAlert title="Не удалось выполнить действие" tone="danger">
            {controller.locationError ??
              controller.scan.error ??
              (matchingFailure ? errorMessage(matchingFailure) : null)}
          </InlineAlert>
        )}
        {!matchingFailure && matchingState === "interrupted" && (
          <InlineAlert title="Предыдущее сканирование прервано" tone="warning">
            Результат не завершён. Запустите сканирование снова, чтобы получить
            актуальные данные.
          </InlineAlert>
        )}
        {!matchingFailure && matchingState === "failed" && (
          <InlineAlert title="Сканирование не завершено" tone="danger">
            Повторите запуск. Если ошибка сохраняется, выберите более узкую
            папку и проверьте права доступа.
          </InlineAlert>
        )}
        <Button
          className="start-screen__action"
          loading={controller.scan.starting}
          onClick={() => void controller.startSelected()}
          size="large"
        >
          Начать сканирование
        </Button>
      </div>
      <div className="start-visual" aria-hidden="true">
        <div className="start-visual__ring start-visual__ring--outer" />
        <div className="start-visual__ring start-visual__ring--inner" />
        <div className="start-visual__core">
          {target.kind === "volume" ? "ТОМ" : "ПАПКА"}
        </div>
      </div>
    </section>
  );
}
