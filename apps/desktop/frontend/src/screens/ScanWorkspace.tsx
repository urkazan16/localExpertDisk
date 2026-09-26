import type { AppController } from "../state/useAppController";
import { formatBytes, formatCount, scanLabels } from "../state/scanState";
import { Button, InlineAlert } from "../ui/primitives";

export function ScanWorkspace({ controller }: { controller: AppController }) {
  const scan = controller.scan.scan;
  if (!scan) return null;
  const metrics = [
    ["Файлов", formatCount(scan.files_count)],
    ["Каталогов", formatCount(scan.directories_count)],
    ["Размер", formatBytes(scan.logical_size)],
    ["Ошибок доступа", formatCount(scan.errors_count)],
    ["Пропущено", formatCount(scan.skipped_count)],
    ["Ссылок", formatCount(scan.symlinks_count)],
  ];

  return (
    <section className="scan-workspace" aria-labelledby="scan-title">
      <div className="scan-workspace__header">
        <div>
          <p className="workspace-eyebrow">ИДЁТ ЛОКАЛЬНЫЙ АНАЛИЗ</p>
          <h1 id="scan-title">
            {controller.selectedTarget?.label ?? "Сканирование"}
          </h1>
          <p className="start-screen__path">{scan.root_path}</p>
        </div>
        <Button
          loading={controller.scan.cancelling}
          onClick={() => void controller.scan.cancel()}
          variant="danger"
        >
          Остановить
        </Button>
      </div>
      <div className="scan-pulse" aria-hidden="true">
        <span />
      </div>
      <p className="scan-workspace__status" role="status">
        {scanLabels[scan.state]}
      </p>
      <div className="scan-workspace__metrics">
        {metrics.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {controller.scan.error && (
        <InlineAlert title="Сканирование прервано ошибкой" tone="danger">
          {controller.scan.error}
        </InlineAlert>
      )}
    </section>
  );
}
