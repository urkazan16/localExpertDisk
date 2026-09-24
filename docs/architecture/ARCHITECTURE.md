# Фактическая архитектура

## Foundation

```text
apps/desktop/frontend (React)
  → generated getAppInfo() / Tauri invoke
  → apps/desktop/src-tauri::get_app_info
  → services::get_app_info
  → storage::StorageStatus + filesystem::PlatformProvider
  → AppInfo (domain) → generated TypeScript
```

- `crates/domain`: сериализуемые модели состояния, платформы, capabilities и ошибок.
- `crates/filesystem`: минимальная platform boundary и определение ОС. Все capabilities
  выключены до появления реальных реализаций. Volume/FileSystem providers появятся со scanner.
- `crates/storage`: единственное место SQL; SQLite bundled, forward-only migration runner.
- `crates/services`: независимая от Tauri проверка состояния хранилища и платформы.
- `apps/desktop/src-tauri`: жизненный цикл, app-data, JSON-логи, одна read-only команда.
- `tools/contract-generator`: Rust → TS, проверка актуальности без Git и без перезаписи.
- `tools/fixture-generator`: ограниченный детерминированный dataset для следующих этапов.

## Данные

Миграция 0001 создаёт только журнал миграций. Таблицы сканирования вводятся вместе
с потребляющими их сервисами на этапе 1. `PRAGMA user_version` сверяется с журналом;
чтение версии и миграции происходят в одной IMMEDIATE-транзакции. Более новая версия
отклоняется до изменения схемы. Ошибка SQL откатывает DDL, журнал и версию вместе.
WAL пока не включён: конкурентного сканера ещё нет, решение требует измерений.

SQLite хранится за Mutex в состоянии Tauri. Единственная короткая команда читает
версию схемы; будущие длительные операции должны выполняться вне UI thread через
workers и IPC Channels. Ошибка инициализации сохраняется в AppState и показывается
в UI; для повторного открытия базы нужен перезапуск приложения.

## Безопасность и ограничения

Нет filesystem/shell plugins, сетевых API, загрузки remote content, чтения содержимого
пользовательских файлов и удаления. CSP разрешает только локальные ресурсы и IPC.
Интерфейс не отображает technical details из ошибок. Разрешения отдельных commands
и native providers должны уточняться с добавлением реальных операций.

Сквозные native UI-тесты, scanner, recovery незавершённых scans, shutdown фоновых
операций и performance baseline ещё не реализованы. На текущем этапе фоновых jobs нет.
