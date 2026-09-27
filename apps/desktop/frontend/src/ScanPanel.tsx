import type { FormEvent } from "react";
import type { ScanSession } from "./api/generated";
import { errorMessage } from "./api/errors";
import {
  formatBytes,
  formatCount,
  isTerminal,
  scanIssueLabel,
  scanLabels,
} from "./state/scanState";
import { useScanController } from "./state/useScanController";
import { Button, SelectControl } from "./ui/primitives";

export { formatBytes, formatCount, isTerminal } from "./state/scanState";

export function ScanPanel({
  enabled,
  onScanChange,
}: {
  enabled: boolean;
  onScanChange?: (scan: ScanSession | null) => void;
}) {
  const controller = useScanController({ enabled, onScanChange });
  const {
    busy,
    cancel,
    cancelling,
    error,
    issueLoading,
    issuePage,
    loadIssues,
    loading,
    reload,
    root,
    scan,
    setRoot,
    start,
    starting,
    volumeError,
    volumes,
  } = controller;

  function submit(event: FormEvent) {
    event.preventDefault();
    void start();
  }

  return (
    <section className="panel scanner" aria-labelledby="scan-title">
      <div className="panel-heading">
        <h2 id="scan-title">Сканирование диска</h2>
        <Button
          disabled={!enabled || loading || busy}
          onClick={reload}
          variant="secondary"
        >
          Обновить
        </Button>
      </div>
      {!enabled && (
        <p className="hint">Для сканирования откройте настольное приложение.</p>
      )}
      {loading && <p role="status">Загружаем состояние…</p>}
      {volumeError && (
        <p role="alert">
          Не удалось получить список томов. {volumeError} Можно указать путь
          вручную.
        </p>
      )}
      {enabled && !loading && !volumeError && volumes.length === 0 && (
        <p className="hint">
          Тома не найдены. Укажите путь к каталогу вручную.
        </p>
      )}
      <form onSubmit={submit}>
        <label htmlFor="volume">Том</label>
        <SelectControl
          aria-label="Том"
          id="volume"
          value={
            volumes.some((volume) => volume.mount_point === root) ? root : ""
          }
          disabled={!enabled || busy || volumes.length === 0}
          onValueChange={setRoot}
          options={[
            {
              value: "",
              label: "Выберите том или укажите каталог ниже",
            },
            ...volumes.map((volume) => ({
              disabled: !volume.mount_point,
              label: `${volume.name || volume.mount_point} · ${volume.filesystem} · ${formatBytes(volume.total_bytes)}`,
              value: volume.mount_point ?? "",
            })),
          ]}
        />
        <label htmlFor="scan-root">Абсолютный путь к каталогу</label>
        <div className="path-row">
          <input
            className="ui-input"
            id="scan-root"
            value={root}
            onChange={(event) => setRoot(event.target.value)}
            disabled={!enabled || busy}
            required
            maxLength={32768}
            placeholder="/Users/имя/Downloads"
            aria-describedby="scan-help"
            spellCheck={false}
          />
          <Button
            type="submit"
            disabled={!enabled || loading || busy || root.length === 0}
          >
            {starting ? "Запуск…" : "Сканировать"}
          </Button>
        </div>
        <p id="scan-help" className="hint">
          Читаем только метаданные. Ссылки не обходим, файлы не изменяем. Папка
          собственной базы исключается.
        </p>
      </form>
      {error && <p role="alert">{error}</p>}
      {scan && (
        <div className="scan-result" data-scan-id={scan.id}>
          <div className="panel-heading">
            <h3 aria-live="polite">{scanLabels[scan.state]}</h3>
            {!isTerminal(scan) && (
              <Button
                onClick={() => void cancel()}
                disabled={cancelling || scan.state === "cancelling"}
                variant="secondary"
              >
                {cancelling || scan.state === "cancelling"
                  ? "Отмена…"
                  : "Отменить"}
              </Button>
            )}
          </div>
          <p className="scan-path" title={scan.root_path}>
            {scan.root_path}
          </p>
          {!isTerminal(scan) && <progress aria-label="Сканирование каталога" />}
          {scan.failure && <p role="alert">{errorMessage(scan.failure)}</p>}
          {scan.state === "partial" && (
            <p className="warning">
              Часть объектов недоступна или пропущена. Показанные размеры не
              отражают полный объём каталога.
            </p>
          )}
          {scan.state === "cancelled" && (
            <p className="hint">
              Сохранены только данные, обработанные до отмены.
            </p>
          )}
          {scan.state === "interrupted" && (
            <p className="warning">
              Предыдущий обход не был завершён. Запустите новое сканирование.
            </p>
          )}
          <ScanMetrics scan={scan} />
          {isTerminal(scan) && BigInt(scan.errors_count) > 0n && (
            <Button
              disabled={
                issueLoading || Boolean(issuePage && !issuePage.next_cursor)
              }
              onClick={() => void loadIssues()}
              variant="secondary"
            >
              {issueLoading
                ? "Загрузка…"
                : issuePage
                  ? "Следующие ошибки"
                  : "Показать ошибки"}
            </Button>
          )}
          {issuePage && (
            <ul className="issues">
              {issuePage.items.map((issue, index) => (
                <li key={index}>
                  <span className="scan-path">{issue.path}</span>
                  <span>{scanIssueLabel(issue.code)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export function ScanMetrics({ scan }: { scan: ScanSession }) {
  return (
    <>
      <dl className="scan-metrics">
        <div>
          <dt>Файлы</dt>
          <dd>{formatCount(scan.files_count)}</dd>
        </div>
        <div>
          <dt>Каталоги, включая корень</dt>
          <dd>{formatCount(scan.directories_count)}</dd>
        </div>
        <div>
          <dt>Логический размер файлов</dt>
          <dd title={`${formatCount(scan.logical_size)} байт`}>
            {formatBytes(scan.logical_size)}
          </dd>
        </div>
        {scan.allocated_size !== null && (
          <div>
            <dt>Физический размер на диске</dt>
            <dd title={`${formatCount(scan.allocated_size)} байт`}>
              {formatBytes(scan.allocated_size)}
            </dd>
          </div>
        )}
        {scan.unique_allocated_size !== null && (
          <div>
            <dt>Уникально занято на диске</dt>
            <dd title={`${formatCount(scan.unique_allocated_size)} байт`}>
              {formatBytes(scan.unique_allocated_size)}
            </dd>
          </div>
        )}
        <div>
          <dt>Ссылки</dt>
          <dd>{formatCount(scan.symlinks_count)}</dd>
        </div>
        <div>
          <dt>Ошибки</dt>
          <dd>{formatCount(scan.errors_count)}</dd>
        </div>
        <div>
          <dt>Пропущено</dt>
          <dd>{formatCount(scan.skipped_count)}</dd>
        </div>
      </dl>
      <p className="hint">
        {scan.allocated_size === null
          ? "Физический размер на диске недоступен на этой платформе."
          : "Физический размер подсчитан по блокам файловой системы."}{" "}
        Общий размер считает жёсткие ссылки по каждому пути, уникальный — один
        раз.
      </p>
    </>
  );
}
