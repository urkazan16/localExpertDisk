import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  cancelScan,
  getScan,
  getScanIssues,
  getVolumes,
  startScan,
  type ScanSession,
  type ScanState,
  type VolumeInfo,
  type ScanIssuePage,
} from "./api/generated";
import { errorMessage } from "./api/errors";

const labels: Record<ScanState, string> = {
  created: "Создано",
  preparing: "Подготовка",
  scanning: "Сканирование",
  finalizing: "Подведение итогов",
  cancelling: "Отмена…",
  cancelled: "Сканирование отменено",
  completed: "Сканирование завершено",
  partial: "Сканирование завершено не полностью",
  failed: "Сканирование остановлено с ошибкой",
  interrupted: "Сканирование прервано при закрытии приложения",
};
const phases: Record<ScanState, number> = {
  created: 0,
  preparing: 1,
  scanning: 2,
  finalizing: 3,
  cancelling: 4,
  cancelled: 5,
  completed: 5,
  partial: 5,
  failed: 5,
  interrupted: 5,
};
export function isTerminal(scan: ScanSession): boolean {
  return phases[scan.state] === 5;
}
// Stream messages can arrive before the response to start/cancel. Never regress state.
function mergeScan(
  current: ScanSession | null,
  incoming: ScanSession,
): ScanSession {
  if (!current || current.id !== incoming.id) return incoming;
  if (isTerminal(current) || phases[current.state] > phases[incoming.state])
    return current;
  if (
    current.state === incoming.state &&
    BigInt(current.files_count) +
      BigInt(current.directories_count) +
      BigInt(current.errors_count) +
      BigInt(current.skipped_count) +
      BigInt(current.symlinks_count) >
      BigInt(incoming.files_count) +
        BigInt(incoming.directories_count) +
        BigInt(incoming.errors_count) +
        BigInt(incoming.skipped_count) +
        BigInt(incoming.symlinks_count)
  )
    return current;
  return incoming;
}
export function formatCount(value: string): string {
  return BigInt(value).toLocaleString("ru-RU");
}
export function formatBytes(value: string): string {
  const bytes = BigInt(value);
  const units = ["Б", "КиБ", "МиБ", "ГиБ", "ТиБ", "ПиБ", "ЭиБ"];
  let scale = 1n;
  let unit = 0;
  while (unit < units.length - 1 && bytes >= scale * 1024n) {
    scale *= 1024n;
    unit++;
  }
  const whole = bytes / scale;
  const tenth = ((bytes % scale) * 10n) / scale;
  return `${whole.toLocaleString("ru-RU")}${unit && tenth ? "," + tenth.toString() : ""} ${units[unit]}`;
}

export function ScanPanel({
  enabled,
  onScanChange,
}: {
  enabled: boolean;
  onScanChange?: (scan: ScanSession | null) => void;
}) {
  const [root, setRoot] = useState("");
  const [volumes, setVolumes] = useState<VolumeInfo[]>([]);
  const [volumeError, setVolumeError] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanSession | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [issuePage, setIssuePage] = useState<ScanIssuePage | null>(null);
  const [issueLoading, setIssueLoading] = useState(false);
  const generation = useRef(0);
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    onScanChange?.(scan);
  }, [onScanChange, scan]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const current = generation.current;
    setLoading(true);
    setVolumeError(null);
    getVolumes().then(
      (items) => {
        if (active) setVolumes(items);
      },
      (reason: unknown) => {
        if (active) setVolumeError(errorMessage(reason));
      },
    );
    getScan()
      .then(
        (item) => {
          if (active && current === generation.current) {
            setScan((previous) =>
              item ? mergeScan(previous, item) : previous,
            );
            setError(null);
          }
        },
        (reason: unknown) => {
          if (active) setError(errorMessage(reason));
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [enabled, refresh]);

  const activeScan = scan && !isTerminal(scan) ? scan.id : null;
  useEffect(() => {
    if (!enabled || !activeScan) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const current = generation.current;
    const poll = async () => {
      try {
        const update = await getScan(activeScan);
        if (active && current === generation.current && update)
          setScan((previous) => mergeScan(previous, update));
      } catch (reason: unknown) {
        if (active) setError(errorMessage(reason));
      }
      if (active)
        timer = setTimeout(() => {
          void poll();
        }, 1000);
    };
    timer = setTimeout(() => {
      void poll();
    }, 1000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [enabled, activeScan]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || activeScan || !root || !enabled) return;
    submitting.current = true;
    setStarting(true);
    setError(null);
    setIssuePage(null);
    const current = ++generation.current;
    try {
      const result = await startScan({ root_path: root }, (update) => {
        if (mounted.current && current === generation.current)
          setScan((previous) => mergeScan(previous, update));
      });
      if (mounted.current && current === generation.current)
        setScan((previous) => mergeScan(previous, result));
    } catch (reason: unknown) {
      if (mounted.current) setError(errorMessage(reason));
    } finally {
      submitting.current = false;
      if (mounted.current) setStarting(false);
    }
  }
  async function cancel() {
    if (!scan || cancelling) return;
    const current = generation.current;
    setCancelling(true);
    setError(null);
    try {
      const result = await cancelScan(scan.id);
      if (mounted.current && current === generation.current)
        setScan((previous) => mergeScan(previous, result));
    } catch (reason: unknown) {
      if (mounted.current) setError(errorMessage(reason));
    } finally {
      if (mounted.current) setCancelling(false);
    }
  }
  async function loadIssues() {
    if (!scan || issueLoading) return;
    const current = generation.current;
    setIssueLoading(true);
    setError(null);
    try {
      const page = await getScanIssues(scan.id, issuePage?.next_cursor ?? null);
      if (mounted.current && current === generation.current) setIssuePage(page);
    } catch (reason: unknown) {
      if (mounted.current) setError(errorMessage(reason));
    } finally {
      if (mounted.current) setIssueLoading(false);
    }
  }
  const busy = starting || Boolean(activeScan);
  return (
    <section className="panel scanner" aria-labelledby="scan-title">
      <div className="panel-heading">
        <h2 id="scan-title">Сканирование диска</h2>
        <button
          className="secondary"
          disabled={!enabled || loading || busy}
          onClick={() => {
            setIssuePage(null);
            setRefresh((value) => value + 1);
          }}
        >
          Обновить
        </button>
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
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <label htmlFor="volume">Том</label>
        <select
          id="volume"
          value={volumes.some((v) => v.mount_point === root) ? root : ""}
          disabled={!enabled || busy || volumes.length === 0}
          onChange={(event) => setRoot(event.target.value)}
        >
          <option value="">Выберите том или укажите каталог ниже</option>
          {volumes.map((volume, index) => (
            <option
              key={`${volume.mount_point}-${index}`}
              value={volume.mount_point ?? ""}
              disabled={!volume.mount_point}
            >
              {volume.name || volume.mount_point} · {volume.filesystem} ·{" "}
              {formatBytes(volume.total_bytes)}
            </option>
          ))}
        </select>
        <label htmlFor="scan-root">Абсолютный путь к каталогу</label>
        <div className="path-row">
          <input
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
          <button
            type="submit"
            disabled={!enabled || loading || busy || root.length === 0}
          >
            {starting ? "Запуск…" : "Сканировать"}
          </button>
        </div>
        <p id="scan-help" className="hint">
          Читаем только метаданные. Ссылки не обходим, файлы не изменяем. Папка
          собственной базы исключается.
        </p>
      </form>
      {error && <p role="alert">{error}</p>}
      {scan && (
        <div className="scan-result">
          <div className="panel-heading">
            <h3 aria-live="polite">{labels[scan.state]}</h3>
            {!isTerminal(scan) && (
              <button
                className="secondary"
                onClick={() => {
                  void cancel();
                }}
                disabled={cancelling || scan.state === "cancelling"}
              >
                {cancelling || scan.state === "cancelling"
                  ? "Отмена…"
                  : "Отменить"}
              </button>
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
            Жёсткие ссылки считаются по каждому пути.
          </p>
          {isTerminal(scan) && BigInt(scan.errors_count) > 0n && (
            <button
              className="secondary"
              disabled={
                issueLoading || Boolean(issuePage && !issuePage.next_cursor)
              }
              onClick={() => {
                void loadIssues();
              }}
            >
              {issueLoading
                ? "Загрузка…"
                : issuePage
                  ? "Следующие ошибки"
                  : "Показать ошибки"}
            </button>
          )}
          {issuePage && (
            <ul className="issues">
              {issuePage.items.map((issue, index) => (
                <li key={index}>
                  <span className="scan-path">{issue.path}</span>
                  <span>
                    {issue.code === "permission_denied"
                      ? "Нет доступа"
                      : issue.code === "file_disappeared"
                        ? "Объект исчез или изменился"
                        : "Не удалось прочитать метаданные"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
