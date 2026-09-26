import type { ScanSession, ScanState } from "../api/generated";

export const scanLabels: Record<ScanState, string> = {
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
export function mergeScan(
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
