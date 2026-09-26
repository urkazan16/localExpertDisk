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

Искусственный dataset создаётся только в **новом** каталоге. Сохранён короткий
совместимый вызов для набора файлов по 1024 байта:

```sh
cargo run -p fixture-generator -- /tmp/local-expert-disk-example 100
```

Профиль для Scanner Gate задаёт число файлов, каталогов, глубину и размер файла:

```sh
cargo run -p fixture-generator -- /tmp/local-expert-disk-p1m \
  --files 1000000 --directories 100000 --depth 20 --file-size 0
```

Генератор ограничен 10 млн entries, глубиной 1024 и суммарным записываемым payload
50 ГиБ. Нулевой размер удобен для metadata/queue benchmark без заполнения диска.

Утилита не перезаписывает существующий каталог. После ошибки записи новый каталог
может содержать частичный dataset; автоматического удаления нет.

## Документы

- [Спецификация реализации](docs/implementation/IMPLEMENTATION_PLAN.md).
- [Функциональные требования](docs/requirements/SRS.md).
- [Фактическая архитектура](docs/architecture/ARCHITECTURE.md).
- [Rust/Tauri и зависимости](docs/adr/0001-rust-tauri-foundation.md).
- [Генерация IPC](docs/adr/0002-ipc-contracts.md).
- [Первый scanner](docs/adr/0003-scanner-pipeline.md).
- [Состояние этапов и ограничения](docs/roadmap/STAGES.md).

SRS определяет функциональные требования, Implementation Plan — способ реализации,
а `docs/roadmap/STAGES.md` — фактический статус. Полная requirement traceability и
кроссплатформенные release gates остаются отдельными задачами.
