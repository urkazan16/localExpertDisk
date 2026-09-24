# Local Expert Disk

Кроссплатформенный desktop-анализатор дискового пространства. Реализованы Foundation
и первый инкремент **Stage 1 — Scanner**: выбор тома или абсолютного каталога,
однопоточный обход, прогресс, отмена и сохранение результата в SQLite.

## Запуск

Нужны Rust stable >=1.92, Node.js >=20.19, npm и системные
[зависимости Tauri 2](https://v2.tauri.app/start/prerequisites/).
На macOS нужны Xcode Command Line Tools; Windows — MSVC Build Tools и WebView2.
Linux: `libwebkit2gtk-4.1-dev build-essential libssl-dev librsvg2-dev libayatana-appindicator3-dev patchelf`.

Из корня проекта:

```sh
npm ci
cargo fetch --locked
npm run desktop:dev
```

Только браузерный предпросмотр: `npm run dev`. Он честно показывает отсутствие
настольного runtime и не подставляет демонстрационные данные вместо Rust-ответа.

Приложение создаёт только свою базу `index.db` в каталоге app-data идентификатора
`local.expertdisk.desktop`. На macOS это
`~/Library/Application Support/local.expertdisk.desktop/`. При сканировании читаются
только имена и metadata: содержимое файлов не открывается, ссылки не обходятся,
файлы не изменяются. Ошибки SQLite не раскрывают пути в IPC и логах.
При несовместимой схеме приложение сохраняет базу и показывает ошибку.

За раз выполняется одно сканирование. Отмена кооперативная: уже обработанные записи
остаются в истории со статусом `cancelled`; зависший вызов filesystem ОС нельзя
прервать принудительно. Результат `partial` означает, что часть объектов оказалась
недоступна, исчезла во время обхода или была пропущена. Логический размер — сумма
размеров файлов; физический размер и дедупликация hard links появятся в отдельных
этапах. После аварийного завершения незаконченная сессия становится `interrupted`.

## Проверки

```sh
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo fmt --all -- --check
cargo generate-contracts --check
npm test
npm run lint
npm run typecheck
npm run format:check
npm run build
npm run desktop:build -- --debug --no-bundle
```

После изменения Rust-моделей: `cargo generate-contracts`.
`apps/desktop/frontend/src/api/generated.ts` нельзя редактировать вручную.
Иконки генерируются из `apps/desktop/assets/icon.svg`: `npm run icons`.
Мобильные варианты Tauri игнорируются: проект поддерживает только desktop.
Для локальной сборки desktop без installer: `npm run desktop:build`.
Signing, installers и release pipeline пока не настроены.

Небольшой искусственный dataset (только **новый** каталог, 1–10000 файлов по 1024 байта):

```sh
cargo run -p fixture-generator -- /tmp/local-expert-disk-example 100
```

Утилита не перезаписывает существующий каталог. После ошибки записи новый каталог
может содержать частичный dataset; автоматического удаления нет.

## Документы

- Исходная спецификация реализации — файл `IMPLEMENTATION_PLAN … .md` в корне (сохранён без изменений).
- [Фактическая архитектура](docs/architecture/ARCHITECTURE.md).
- [Rust/Tauri и зависимости](docs/adr/0001-rust-tauri-foundation.md).
- [Генерация IPC](docs/adr/0002-ipc-contracts.md).
- [Первый scanner](docs/adr/0003-scanner-pipeline.md).
- [Состояние этапов и ограничения](docs/roadmap/STAGES.md).

SRS, перечисленный в исходном плане, не предоставлен. Нельзя считать требования
SCAN-* и остальные примерные ID утверждёнными. Foundation связан с IMP-0-001…012;
полная requirement traceability и release gates остаются открытыми.
