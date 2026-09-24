# ADR-0002 — Rust является источником IPC-моделей

Статус: принято для IMP-0-009.

Модели `domain` выводят serde и ts-rs TS. Утилита `contract-generator` генерирует
TypeScript types и обёртку одной команды `get_app_info`. Результат коммитится вместе
с источником, исключён из ручного форматирования и проверяется `--check` в CI.

Не выбран параллельный JSON/OpenAPI контракт: API локальный Tauri, HTTP отсутствует.
Имя команды в Rust adapter и generator пока связано контрактом и frontend-тестом;
при расширении команд потребуется общий реестр или генератор из сигнатур, чтобы
автоматически проверять argument/result types каждой команды. Для текущей команды
нет аргументов, единственный ответ — AppInfo; ошибки — AppError.

DTO не содержат u64/bigint и filesystem paths на этапе 0. До scan API необходимо
отдельно определить lossless представление размеров/ID и non-UTF-8 paths. Эти вопросы
нельзя молча решить преобразованием всех u64 в JavaScript number.

Справка: [ts-rs TS API](https://docs.rs/ts-rs/latest/ts_rs/trait.TS.html).
