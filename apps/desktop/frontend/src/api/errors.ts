const messages: Record<string, string> = {
  "errors.storage_unavailable":
    "Не удалось открыть локальную базу. Проверьте доступ к папке приложения и перезапустите его.",
  "errors.unsupported_schema":
    "База создана более новой версией приложения. Обновите приложение, чтобы сохранить совместимость.",
  "errors.invalid_schema":
    "История миграций базы повреждена. Для продолжения потребуется восстановление базы.",
  "errors.internal": "Не удалось выполнить операцию. Перезапустите приложение.",
  "errors.invalid_target":
    "Не удалось открыть каталог. Укажите абсолютный путь к существующей папке и проверьте права доступа. Ссылки и папка базы приложения не подходят для сканирования.",
  "errors.scan_busy":
    "Уже выполняется сканирование или база открыта другим экземпляром приложения.",
  "errors.scan_not_found":
    "Сканирование не найдено. Обновите состояние приложения.",
  "errors.invalid_transition":
    "Состояние сканирования изменилось. Обновите состояние приложения.",
  "errors.size_overflow":
    "Размеры превысили поддерживаемый диапазон. Сканирование остановлено без округления данных.",
};
export function errorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "user_message_key" in error &&
    typeof error.user_message_key === "string" &&
    Object.hasOwn(messages, error.user_message_key)
  ) {
    return messages[error.user_message_key];
  }
  return "Не удалось связаться с приложением. Повторите проверку.";
}
