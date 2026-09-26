# ADR-0001 — Foundation на Rust / Tauri 2

Статус: принято для Stage 0. Основание: предоставленный Implementation Plan §3–15, §90.

Сохраняем предложенную структуру `apps/desktop`, `crates`, `tools`. Rust core не зависит
от Tauri; React/TypeScript используют короткий IPC-запрос состояния. npm workspaces
и Vite достаточно для одного frontend; routing и глобальный store не нужны.

Rust MSRV 1.92; toolchain stable. Это позволяет использовать установленный toolchain
без downgrade зависимостей. CI проверяет актуальный stable, MSRV отдельно пока не проверяется.
Версии разрешённых зависимостей фиксируют Cargo.lock и package-lock.json.

Зависимости Foundation:

| Зависимость               | Назначение             | Лицензия / платформы                | Влияние                                             |
| ------------------------- | ---------------------- | ----------------------------------- | --------------------------------------------------- |
| Tauri 2                   | Desktop runtime и IPC  | MIT/Apache-2.0; macOS/Windows/Linux | Основной native runtime, системный WebView          |
| serde                     | Rust serialization     | MIT/Apache-2.0; все целевые ОС      | Общие DTO                                           |
| rusqlite + bundled SQLite | Единственный DB client | MIT; SQLite public domain; все ОС   | Включает SQLite в бинарник для согласованной версии |
| tracing + subscriber      | JSON structured logs   | MIT; все ОС                         | Без файлового/сетевого log backend                  |
| ts-rs                     | Генерация TS типов     | MIT; build/tooling                  | Не добавляет desktop runtime сервис                 |
| React / ReactDOM          | UI                     | MIT; WebView                        | Один экран, без UI toolkit                          |
| Tauri JS API              | IPC transport          | MIT/Apache-2.0                      | Без filesystem/shell plugins                        |

Официальные источники: [Tauri](https://v2.tauri.app/), [rusqlite](https://github.com/rusqlite/rusqlite),
[ts-rs](https://github.com/Aleph-Alpha/ts-rs), [React](https://react.dev/).
Зависимости имеют актуальные выпуски в реестрах на момент установки; это не заменяет
аудит advisories. Размер production-бинарника и полная проверка лицензий транзитивных
зависимостей относятся к release gate. Новые runtime dependencies добавляются только
по потребности. Контейнеры, серверный API, ORM и абстракции будущих features не создаются.

Следствие: можно проверять core без WebView. Сборка desktop требует системных библиотек
Tauri. Исходные правила backend/frontend применяются к фактическим путям через root AGENTS.
