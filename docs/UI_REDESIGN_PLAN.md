# План реализации редизайна UI

Основание: `UI_REDESIGN_ANALYSIS.md`, `design/UI_DESIGN_SPEC.md`, `design/UX_UI_SPEC.md`, `requirements/SRS.md` и визуальные референсы в `design/reference/`.

## 1. Целевой результат

Приложение получает стабильный desktop shell:

```text
AppShell
├── Sidebar
└── Main
    ├── Header
    ├── Workspace
    └── BottomActionBar
```

Workspace отображает реальное состояние приложения:

```text
startup → target selection → ready → scanning → result/tool → review action
```

Folder Browser, Column Browser, breadcrumb, navigation history, selection и Sunburst используют одну модель состояния. Existing core-функции не удаляются и не заменяются mock-данными.

## 2. Принципы поставки

- Каждый этап должен оставлять приложение работоспособным.
- Сначала переносится/выделяется поведение, затем меняется визуальное представление.
- Generated IPC меняется только через Rust source и `contract-generator`.
- Неподдерживаемое действие скрывается или явно disabled по capability; декоративных кнопок нет.
- Для крупных UI-этапов обязательны native screenshot и сравнение с соответствующим reference.
- Виртуализация, пагинация и bounded maps сохраняются с первого рабочего варианта, а не добавляются после полной загрузки дерева.
- Новая зависимость добавляется только после проверки, что существующий стек не решает задачу.

## 3. Этапы

### Этап 0. Зафиксировать baseline и согласовать источники

Статус: выполнен локально 27 сентября 2026 г. SRS, UX, visual specification,
Implementation Plan и roadmap согласованы; Implementation Plan перенесён в
`docs/implementation/IMPLEMENTATION_PLAN.md`, а документация больше не исключена
целиком из Git. Получены browser baseline до tokens и native macOS baseline до
AppShell; Windows/Linux visual evidence остаётся cross-platform ограничением.

Задачи:

1. Обновить `docs/roadmap/STAGES.md` по фактическому наличию SRS и реализованному Analyzer UI.
2. Исправить устаревшую ссылку на Implementation Plan или переместить документ отдельным согласованным изменением.
3. Явно закрепить: SRS — функциональность, `UX_UI_SPEC.md` — поведение, `UI_DESIGN_SPEC.md` + reference — визуальная композиция.
4. Составить regression inventory существующих функций и привязать текущие тесты к нему.
5. Зафиксировать baseline screenshots текущего UI в native app только как evidence «до», не как визуальную основу.

Готово, когда:

- документация не сообщает, что существующий SRS/Analyzer отсутствует;
- перечислены все функции, которые должны пережить миграцию;
- текущие frontend tests, typecheck и build имеют зафиксированный результат.

### Этап 1. Ввести семантические tokens и каркас компонентов

Статус: выполнен локально 26 сентября 2026 г. Добавлены semantic dark tokens, единый SVG icon set, primitives, component tests и dev-only visual preview.

Задачи:

1. Определить CSS custom properties для color, spacing, radius, typography, borders, shadows, control/row heights, sidebar width и motion.
2. Поддержать semantic dark tokens; структуру подготовить для system/light без обязательной реализации light theme сейчас.
3. Создать единый согласованный набор SVG-иконок или небольшой внутренний icon layer; убрать emoji/случайные Unicode-иконки из нового shell.
4. Создать primitives: Button, IconButton, SegmentedControl, TextField, Select, EmptyState, InlineAlert, Skeleton, Dialog/Popover shell.
5. Встроить `prefers-reduced-motion`, `:focus-visible`, минимум 4.5:1 для обычного текста и достаточные hit areas.

Не делать на этом этапе:

- переносить все режимы;
- менять IPC;
- вводить универсальную дизайн-систему за пределами реально нужных компонентов.

Готово, когда:

- новый shell не содержит hardcoded цветов вне tokens;
- normal/hover/pressed/selected/disabled/focus проверены для основных controls;
- tokens визуально соответствуют navy/blue направлению reference.

### Этап 2. Перестроить AppShell и application state

Статус: выполнен локально 26 сентября 2026 г. Главный layout заменён на shell с Sidebar/Header/Workspace/нижней панелью; startup, locations и scan lifecycle собраны в application controller с явными workspace states и защитой от устаревших ответов. Старые analyzer/tools подключены как переходные workspace modes.

Задачи:

1. Заменить вертикальную страницу на `AppShell + Sidebar + Header + Workspace + BottomActionBar`.
2. Вынести startup/app-info/capabilities, volumes и active scan в верхний application controller/hook.
3. Определить явные состояния workspace: booting, browser-preview, no-target, ready, scanning, result, tool, fatal-error.
4. Обеспечить защиту от late responses и cleanup подписок при смене scan/target.
5. Оставить browser preview честным: shell виден, filesystem actions недоступны, fake backend не создается.

Готово, когда:

- hero, последовательные panel-карточки и page footer больше не определяют главный layout;
- shell появляется до volumes/history;
- старые функции временно доступны через выделенные workspace routes/modes или transitional adapter, а не потеряны.

### Этап 3. Sidebar, target selection и стартовый экран

Статус: выполнен локально 26 сентября 2026 г. Sidebar использует реальные volumes и platform-resolved standard directories, подключён native Tauri folder picker с минимальным permission, сохранён ручной absolute-path fallback. Start Screen показывает только подтверждённые volume metadata либо честное отсутствие folder metadata; radial остаётся декоративным. Проведены component/integration checks; native macOS visual evidence добавляется в integration gate, Windows/Linux остаются cross-platform ограничением.

Задачи frontend:

1. Показать Home, реальные volumes, подтвержденные favorites/locations, инструменты, settings/help placeholders только там, где действие реализовано.
2. Реализовать active/hover/focus/unavailable states.
3. Показать стартовую карточку выбранной локации и одну primary CTA.
4. Использовать только декоративный empty radial placeholder до scan.
5. При ширине ниже целевой свернуть sidebar до icon rail; не создавать mobile layout.

Контрактные задачи:

1. Решить native folder picker.
2. Решить platform-resolved favorites/standard directories.
3. Решить target metadata; до этого показывать только имя/path и реальные volume fields.

Готово, когда:

- можно выбрать реальный volume или directory и запустить существующий `startScan`;
- ручной absolute path остается fallback при ошибке volume/dialog;
- стартовый screenshot композиционно соответствует первому reference без чужого branding.

### Этап 4. Scanning workspace

Статус: выполнен локально 26 сентября 2026 г. Scan lifecycle собран в общем controller/view model; channel updates буферизуются с интервалом 150 мс, а terminal state публикуется немедленно. Workspace показывает реальные counters, indeterminate progress, cancel acknowledgement, recovery/partial states и bounded issue pages. Optional current path не добавлялся: достоверного контракта пока нет.

Задачи:

1. Перенести существующую merge/progress/cancel логику в общий scan view model.
2. Показать state, counts, size, errors/skipped и indeterminate progress без выдуманного процента.
3. Сохранять быстрый visual acknowledgement cancel и ждать подтвержденного terminal state.
4. Показывать partial/warning/failure/recovery states и bounded issues detail.
5. Throttle визуальные обновления до диапазона 100–250 мс, не меняя надежность финального состояния.

Отдельный optional контракт:

- добавить current path и progressive aggregates только при наличии достоверных данных и bounded update rate.

Готово, когда:

- первое feedback после запуска появляется в пределах UX budget;
- UI остается интерактивным при scan и cancel;
- существующие regression tests scan lifecycle перенесены и дополнены.

### Этап 5. Общая модель результата и навигации

Статус: выполнен локально 26 сентября 2026 г. Analyzer переведён на reducer и controller вне JSX с раздельными domain/UI ветками, семантическими selection/activation actions, единой history для row/breadcrumb/visualization и generation guards для scan, directory, map и query responses. Добавлены reducer и race tests; несовместимые selection/filter/query state сбрасываются при смене scan.

Задачи:

1. Создать analyzer reducer/view model отдельно от JSX.
2. Разделить domain data и UI state:
   - domain: root, column pages, map, query pages;
   - UI: mode, current path, history index, selection, filters, scroll, dialogs.
3. Ввести события select и activate/drill-down как разные действия.
4. Реализовать back/forward, clickable breadcrumb и восстановление current directory.
5. Сбрасывать несовместимые selection/query state при смене scan и не позволять старому ответу затереть новый.

Готово, когда:

- одинаковая последовательность событий приводит к одному состоянию независимо от источника: row, breadcrumb, keyboard или visualization;
- unit tests покрывают reducer transitions, race/stale response и смену scan.

### Этап 6. File Browser и Column Browser

Статус: выполнен локально 26 сентября 2026 г. Analyzer использует компактные FileRow и paginated Column Browser с кешированными уровнями, отдельными loading/empty/error состояниями, вертикальной виртуализацией и горизонтальным контейнером. Реализованы Size DESC/Name ASC, восстановление scroll и клавиатура arrows/Enter/Space/Cmd/Ctrl+A; три уровня и 100K synthetic page покрыты тестами.

Задачи:

1. Создать компактный `FileRow`: checkbox, type icon, name, size, selected/active state.
2. Реализовать первую колонку на существующем paginated `getChildren`.
3. При activation directory добавлять следующую колонку; при переходе на ancestor удалять правые колонны.
4. Для каждой колонны хранить cursor, vertical scroll, loading/empty/error.
5. Использовать вертикальную виртуализацию внутри колонн и горизонтальный scroll контейнера.
6. Сохранить default sort Size DESC; расширять сортировки только после наличия соответствующих query contracts.
7. Реализовать клавиатуру: arrows, Enter, Space, Cmd/Ctrl+A в текущем контексте.

Готово, когда:

- три уровня каталога воспроизводят структуру третьего reference;
- открытие каталога не загружает полное дерево;
- 100K synthetic page не увеличивает DOM пропорционально числу элементов;
- пустая, denied и paginated колонны имеют отдельные состояния.

### Этап 7. Sunburst/Treemap и двусторонняя синхронизация

Статус: выполнен локально 26 сентября 2026 г. Sunburst стал видом по умолчанию, Treemap сохранён. Row и visualization используют общий selection по stable entry id; single click выбирает, Enter/double click открывает каталог, включая атомарный переход по глубокой Sunburst-ветке. Добавлены реальные path/size/percentage tooltip, стабильные цвета, независимый selected highlight и нативный macOS E2E; Windows/Linux остаются cross-platform ограничением.

Задачи:

1. Сделать Sunburst default; Treemap оставить рабочим альтернативным режимом.
2. Разделить single click selection и Enter/double click drill-down.
3. Синхронизировать highlight с browser selection по stable entry id.
4. Добавить hover/focus tooltip из реальных path/size/percentage данных; не выдумывать item count.
5. Стабилизировать colors между updates и добавить независимый selected highlight.
6. Центрировать текущую папку, поддержать metric switch без смешивания logical/allocated.
7. Сохранять bounded depth/max children и remainder aggregation.
8. Масштабировать visualization в доступной правой области и учитывать reduced motion.

Готово, когда:

- row → Sunburst и Sunburst → row дают одинаковый selection;
- drill-down обновляет columns, breadcrumb, header, map и history атомарно;
- keyboard и screen reader получают доступные имена для интерактивных секторов;
- interaction profiling укладывается в budgets на agreed synthetic map.

### Этап 8. Selection, Bottom Action Bar и безопасные действия

Статус: выполнен локально 26 сентября 2026 г. Selection объединён для Structure, Large Files, Categories и Search; sticky action bar показывает точные count/size и оставляет Open/Reveal disabled без единственного выбранного объекта. Trash доступен только по capability и проходит через review-диалог с именами, paths и sizes; после batch-операции обновляются directory/map/активная выборка, failed entries остаются выбранными и показываются в partial-result details. Permanent delete не показывается. Copy path отложен до появления согласованного clipboard boundary в контракте.

Задачи:

1. Сделать selection общим для Structure и применимых result modes.
2. Показывать точные count и aggregate size в bottom bar.
3. Создать action menu: Open, Reveal, Copy path (после выбора clipboard boundary), Move to Trash.
4. Создать review UI с именами/paths/size/count и управлением focus.
5. После batch trash обновлять текущие pages/map и сохранять failed entries выбранными.
6. Показывать partial result через toast + details.
7. Permanent delete показывать только после отдельного реализованного IPC и safety tests.

Готово, когда:

- без выбора action disabled;
- случайный один click не удаляет данные;
- capability `trash=false` не оставляет работающий на вид destructive action;
- TOCTOU/core errors отображаются понятным текстом, selection можно исправить и повторить.

### Этап 9. Основные режимы Header

Статус: выполнен локально 27 сентября 2026 г. В Analyzer header добавлены отдельные
Structure, Large Files, Categories и Search modes. Существующие bounded IPC queries,
filters, pagination, virtualization, clear/empty/loading/error states и общая
selection сохранены; поиск выполняется явно по submit без неподтверждённого debounce.
Large Files, Categories и Search хранят независимые scroll offsets в analyzer reducer
и восстанавливают виртуализированное окно после переключения режима. Отсутствующие
typed filters и дополнительные DTO-поля не имитируются.

Порядок переноса:

1. Structure.
2. Large Files.
3. Categories.
4. Search overlay/result mode.

Задачи:

- вынести mode switcher и search в header;
- сохранять mode-specific filters и scroll;
- подключить существующие paginated queries и virtualization;
- сделать multi-select/actions общими;
- добавить clear/no-results/loading/error states;
- реализовать debounce 150–250 мс только после принятого поведения запроса и отмены stale results.

Контрактные задачи:

- typed search filters;
- Large Files DTO для modified/location/category и directory scope;
- query-side сортировки, которых нет в текущем контракте.

Готово, когда:

- существующие возможности large files/categories/search сохранены;
- таблицы соответствуют доступным данным, а отсутствующие колонки не имитируются;
- поиск не блокирует UI и не запускает filesystem scan.

### Этап 10. Перенести расширенные инструменты

Статус: выполнен локально 26 сентября 2026 г. Old Files, Duplicates и History/Compare открываются как отдельные workspace modes. Old Files использует общий selection/action review, History сохраняет retention/compare/pagination, Duplicates — hashing progress/cancel, group/file pagination, обязательное раскрытие preview и запрет выбора всех копий. Cleaner/Snapshots/Watcher не показываются как реализованные.

Порядок:

1. Old Files.
2. Duplicates.
3. History/Compare.
4. Остальные инструменты — только по реализованным backend capabilities.

Задачи:

- открыть каждый инструмент в отдельном workspace mode;
- сохранить текущие filters, pagination, hashing progress/cancel, retention и compare flows;
- применить общие shell, rows, selection, actions, empty/error states;
- для Duplicates гарантировать, что нельзя удалить все копии, и сохранить обязательный preview.

Готово, когда:

- ни одна существующая функция не осталась скрытой в удаленном legacy layout;
- отсутствующие Cleaner/Snapshots/Watcher screens не выглядят реализованными;
- каждый инструмент имеет regression tests для своего ключевого сценария.

### Этап 11. Responsive desktop, accessibility и platform polish

Статус: выполнен локально 26 сентября 2026 г. Layout проверяется на целевых desktop-размерах и minimum 640×520; узкий shell сворачивает sidebar в icon rail, а на minimum скрывает его, сохраняя горизонтальный Column Browser и масштабируемую карту. Добавлены Finder/Проводник/файловый менеджер labels, focus trap и focus return для dialog, защита long paths/overflow и полное отключение scan animation при reduced motion. Browser-preview и runtime/volume errors остаются честными unavailable states; Windows/Linux native visual pass остаётся cross-platform ограничением.

Задачи:

1. Проверить 1100×700, 1200×800, 1440×900, широкое окно и поддерживаемый minimum window size.
2. Проверить sidebar collapse, horizontal columns scroll, map scaling и bottom bar overflow.
3. Реализовать platform-appropriate labels Finder/Explorer/File Manager и не имитировать macOS chrome на других ОС.
4. Провести keyboard-only проход и focus return после dialog/popover.
5. Проверить text zoom, long Unicode names/paths, contrast, screen-reader names, reduced motion.
6. Проверить disconnected/unavailable states после появления подтвержденного volume contract.

Готово, когда:

- основные flows доступны мышью и клавиатурой;
- long paths и локализованные строки не ломают layout;
- интерфейс сохраняет desktop composition на всех целевых размерах.

### Этап 12. Performance gate и визуальная приемка

Статус: выполнен локально 27 сентября 2026 г. Добавлены bounded component scenarios
100K/500K/1M, единые UI performance thresholds и воспроизводимая методика в
`docs/testing/PERFORMANCE.md`. Native macOS E2E автоматически измеряет cached
directory, selection, focus, indexed search, first display и 10-секундный
scroll/Sunburst profile. Результат сохранён в
`benchmark-results/ui-native-macos-x64.json`: все шесть gate-метрик прошли.
E2E сохраняет три reference-состояния и отдельный review-dialog screenshot и покрывает
scan/partial/restart/history/compare/duplicates/trash. Windows/Linux screenshots,
APFS/NTFS/Linux-specific trash и release-profile остаются platform risks.

Функциональные проверки:

- first launch/no target/selected target;
- scan start/progress/cancel/completed/partial/failed;
- empty directory, permission errors, disappeared files;
- navigation, breadcrumb, back/forward, selection, multi-selection;
- Structure/Large Files/Categories/Search;
- trash success/partial failure/cancel review;
- History/Duplicates/Old Files;
- смена active/historical scan без stale data.

Performance checks:

- DOM зависит от viewport + buffer;
- открыть cached directory ≤ 150 мс target;
- selection feedback ≤ 100 мс;
- hover/focus ≤ 50 мс;
- search first page ≤ 300 мс target;
- scroll/Sunburst hover стремятся к 60 FPS и не держатся ниже 30 FPS;
- UI остается отзывчивым на synthetic 100K/500K/1M indexed scenarios, не загружая их целиком во frontend.

Visual loop для каждого из трех reference states:

1. Запустить native app на синтетическом каталоге.
2. Открыть нужное состояние.
3. Сделать screenshot в согласованном viewport.
4. Сравнить composition, sidebar, header, columns/list, Sunburst, breadcrumb и bottom bar.
5. Исправить отклонения.
6. Повторить и сохранить финальное evidence.

Готово, когда:

- новый UI с первого взгляда ближе к reference, чем к legacy странице;
- все применимые CI-проверки проходят;
- нет fake data, dead controls, debug output и legacy primary layout;
- риски и непроверенные platform flows явно перечислены.

## 4. Рекомендуемая нарезка pull requests

Чтобы снизить регрессионный риск, этапы следует поставлять небольшими вертикальными срезами:

1. Documentation baseline.
2. Tokens + primitives.
3. AppShell + state controller.
4. Sidebar + Start Screen + target selection.
5. Scan workspace.
6. Analyzer state model + single-column Structure.
7. Multi-column navigation.
8. Sunburst synchronization.
9. Selection + action review + trash.
10. Large Files/Categories/Search.
11. Old Files/Duplicates/History.
12. Accessibility/performance/visual evidence.

Каждый PR должен содержать только связанный migration slice, tests и screenshot/evidence для затронутого состояния. Массовую одновременную замену всего frontend следует избегать: она затруднит проверку сохранности функций и поиск регрессий.

## 5. Матрица обязательных проверок по этапам

| Изменение          | Unit/component                           | Contract/integration                             | Visual/native                  |
| ------------------ | ---------------------------------------- | ------------------------------------------------ | ------------------------------ |
| Tokens/primitives  | states, keyboard, accessible name        | не требуется                                     | token page / shell screenshot  |
| App state/scan     | reducer, stale responses, cancel         | mocked generated client + desktop IPC tests      | ready/scanning/error           |
| Columns/navigation | pagination, virtualization, history      | real temporary SQLite query tests                | root + nested reference states |
| Sunburst           | geometry, selection, keyboard, remainder | `getDirectoryMap` contract tests                 | hover/select/drill-down        |
| Delete flow        | review, focus, partial failure           | real temp files + platform trash test where safe | review/result states           |
| Search/modes       | debounce, filters, cursor, empty/error   | indexed query tests                              | mode switching/table overflow  |
| Tool migration     | existing business scenarios              | current service/storage tests                    | each tool workspace            |
| Final gate         | regression suite                         | generated-contract check + Tauri build           | three reference comparisons    |

Проектные команды проверки:

```text
npm test
npm run lint
npm run typecheck
npm run format:check
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo fmt --all -- --check
cargo run -p contract-generator -- --check
npm run desktop:build -- --debug --no-bundle
```

Для этапа, затрагивающего только frontend, Rust suite может быть отложен до integration gate только при явном указании ограничения; contract generation check обязателен при любых IPC-изменениях.

## 6. Решения, которые нельзя принимать молча

До зависимой реализации нужно отдельно подтвердить:

1. native folder picker и стандартные locations на трех ОС;
2. доступность progressive query во время scan;
3. DTO для richer Large Files/Search/Sunburst metadata;
4. clipboard boundary;
5. permanent delete policy и контракт;
6. stable volume identity/disconnect model;
7. место хранения visual baselines и допустимость screenshot tests в CI.

Пока решение не принято, этап продолжается с честной деградацией и существующим подтвержденным контрактом.
