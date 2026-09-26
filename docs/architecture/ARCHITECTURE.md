# Фактическая архитектура

## Foundation и Scanner

```text
apps/desktop/frontend (React)
  → generated Tauri invoke / scan progress Channel
  → apps/desktop/src-tauri commands
  → services::ScanService (one background worker)
  → scanner::scan → storage::SqliteStorage + filesystem::NativeFileSystem
  → typed DTOs (domain) → generated TypeScript
```

- `crates/domain`: сериализуемые модели состояния, платформы, capabilities и ошибок.
- `crates/filesystem`: native metadata/read_dir without following symlinks; volumes from
  sysinfo disk-only API; path bytes remain native in SQLite.
- `crates/scanner`: single worker, 256-entry batch limit, cancellation checks and no SQL.
- `crates/analyzer`: checked counts/size aggregation.
- `crates/storage`: единственное место SQL; SQLite bundled, forward-only migration runner,
  durable directory queue, entries, aggregates and error pages.
- `crates/services`: ScanSession lifecycle, process lock, worker, startup recovery and shutdown.
- `apps/desktop/src-tauri`: app-data, JSON logs, commands and progress Channel.
- `tools/contract-generator`: Rust → TS, проверка актуальности без Git и без перезаписи.
- `tools/fixture-generator`: ограниченный детерминированный dataset для следующих этапов.

## Данные

Миграция 0001 создаёт журнал миграций; 0002 — сессии, записи, очередь каталогов,
агрегаты и ошибки scanner. `PRAGMA user_version` сверяется с журналом;
чтение версии и миграции происходят в одной IMMEDIATE-транзакции. Более новая версия
отклоняется до изменения схемы. Ошибка SQL откатывает DDL, журнал и версию вместе.
WAL пока не включён: конкурентного сканера ещё нет, решение требует измерений.

SQLite хранится за Mutex в ScanService. Один worker выполняет обход; его directory
queue находится в SQLite, поэтому дерево не накапливается в памяти. Каждая запись
batch и progress counters фиксируется атомарно. При старте владелец OS lock переводит
незавершённые scan в interrupted. Один активный scan на базу. Tauri запускает короткие
команды в blocking pool, а обновления приходят через Channel.

## Безопасность и ограничения

Нет filesystem/shell plugins, сетевых API, загрузки remote content, чтения содержимого
пользовательских файлов и удаления. Scanner использует только read_dir и symlink_metadata;
symlink/reparse points не обходятся. CSP разрешает только локальные ресурсы и IPC.
Интерфейс не отображает technical details из ошибок. Разрешения отдельных commands
и native providers должны уточняться с добавлением реальных операций.

Сквозные native UI-тесты, platform tests на APFS/NTFS/Linux FS, performance baseline,
allocated size, hard-link de-duplication и multi-worker scanner ещё не реализованы.
