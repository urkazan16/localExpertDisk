# Stage status

## Stage 0 — Foundation

Status: COMPLETE LOCALLY; cross-platform CI evidence pending.

Основание: `docs/implementation/IMPLEMENTATION_PLAN.md` §90,
`docs/requirements/SRS.md`, IMP-0-001…IMP-0-012.

Реализованы workspace, desktop adapter, domain, минимальная platform boundary,
storage interface, JSON logging, error model, генерация моделей IPC, CI matrix,
транзакционные миграции и ограниченный fixture-generator skeleton.

Gate остаётся открытым: нужны подтверждённые сборки/запуски на трёх ОС, remote CI,
native IPC smoke test и полная requirement traceability. Генерация сигнатур всех
команд и расширенные documentation checks ещё не реализованы.

Локальная проверка на macOS (2026-09-24): 11 Rust-тестов и 5 frontend-тестов;
ESLint, TypeScript, Clippy с `-D warnings`, rustfmt, Prettier; актуальность generated
contracts; frontend production build и Tauri debug build с встроенными ресурсами.
Проверены обычный и минимальный (640×520) размеры браузерного предпросмотра,
ошибок в browser console не обнаружено. IPC проверен через MockRuntime Tauri с
реальным service/storage; это не подменяет запуск native WebView на трёх ОС.

## Stage 1 — Scanner

Status: IN_PROGRESS.

Реализованы: volume enumeration; ScanSession state machine; один worker;
symlink_metadata; batch size 256; directory queue и DB writer в одной SQLite transaction;
агрегаты; cancellation; Channel progress; восстановление interrupted scan; UI start/cancel
и errors pagination.

Локально проверены nested/deep/wide datasets, symlink loops, non-UTF-8 Unix path codec,
permission/disappeared errors, cancellation, busy lock, migration rollback и UI states.

Gate остаётся открытым: native platform tests на APFS/NTFS/Linux; bounded RSS benchmark;
test fault injection через реальный provider; restart во время commit; filesystem mutation
после metadata; disk disconnect; true allocated size; multi-worker design.

Следующий порядок scanner hardening: platform metadata → недостающие benchmarks →
scanner gate. Многопоточность — после успешного однопоточного gate.

## Stage 2–7 — фактически доступный product baseline

Status: IMPLEMENTED LOCALLY; stage gates и cross-platform evidence требуют отдельной проверки.

В коде уже присутствуют и покрыты локальными тестами bounded query API и frontend для:

- Folder Explorer, пагинации и виртуализации;
- Treemap и Sunburst;
- Large Files, Categories и индексного поиска;
- open/reveal, single и batch move-to-trash;
- History, Compare и retention;
- Duplicates с подтверждением содержимого;
- Old Files.

Этот baseline не означает завершение всех требований соответствующих product stages:
нет полного cross-platform evidence, permanent delete IPC, watcher UI, Cleaner и
advanced filesystem UI. Полный список сохраняемых сценариев зафиксирован в
`docs/UI_REDESIGN_REGRESSION.md`.

## UI Redesign — этапы 0–12

Status: COMPLETE LOCALLY; native macOS functional/performance evidence получен,
Windows/Linux и release-profile evidence pending.

Выполнены:

- анализ reference и текущей архитектуры;
- план перехода без удаления существующей бизнес-логики;
- сверка источников требований и regression inventory;
- baseline frontend tests/typecheck/lint/build;
- browser-preview screenshot состояния «до»;
- semantic design tokens, внутренний SVG icon set и базовые UI primitives;
- component tests и dev-only preview primitives;
- AppShell, target selection, scan workspace и общая analyzer state model;
- Column Browser, Sunburst/Treemap, selection и безопасные actions;
- Structure/Large Files/Categories/Search с независимым сохранением scroll;
- History/Compare, Duplicates и Old Files;
- native macOS E2E, четыре visual evidence-state и автоматические UI budgets.

Подробные критерии и остающиеся platform risks зафиксированы в
`docs/UI_REDESIGN_PLAN.md` и `docs/testing/PERFORMANCE.md`.

## Неразрешённые вопросы исходных материалов

- Отсутствует `.agents/skills/qa-test-design/SKILL.md`: комплексная QA-методология недоступна.
- Dataset `P10K` в плане содержит 100000 entries: название и объём нужно согласовать до benchmark.
- План перечисляет историю в базовой схеме, но вводит versioned entries на этапе 4:
  Foundation не создаёт преждевременно эти таблицы; их схема определяется при реализации этапов.
- Performance-методика зафиксирована в `docs/testing/PERFORMANCE.md`; Windows/Linux
  native measurements и release-профиль всё ещё требуют соответствующих hosts.
