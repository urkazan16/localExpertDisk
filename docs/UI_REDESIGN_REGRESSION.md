# Regression inventory перед редизайном UI

Дата фиксации baseline: 26 сентября 2026 г.

Документ перечисляет наблюдаемое поведение, которое нельзя потерять при переходе от legacy-страницы к новому AppShell. Это не утверждение о завершении product stage и не замена SRS.

## 1. Startup и capability model

Сохраняемое поведение:

- browser preview не имитирует Tauri/backend;
- native startup загружает app info, platform, schema version и capabilities;
- retry предлагается только для recoverable ошибки;
- внутренние transport details не показываются пользователю;
- поздний ответ после unmount не обновляет UI.

Текущее evidence:

- `App.test.tsx` — component tests startup и application-state boundary.

## 2. Volumes и scan lifecycle

Сохраняемое поведение:

- загрузка volumes и fallback на ручной абсолютный путь;
- start scan только для валидного непустого target;
- progress channel и polling не регрессируют terminal/более новое состояние;
- indeterminate progress без выдуманного процента;
- cancel ожидает подтверждённого terminal state;
- partial/interrupted/failure различаются;
- scan issues загружаются ограниченными страницами;
- большие счетчики и размеры форматируются через `BigInt` без потери точности;
- введённый путь сохраняется после ошибки запуска.

Текущее evidence:

- `ScanPanel.test.tsx` — component tests scan lifecycle;
- Rust scan/service/storage tests;
- desktop E2E scan/restart flow.

## 3. Folder Explorer и visualization

Сохраняемое поведение:

- root и children читаются bounded pages;
- default sort Size DESC и сортировка по имени;
- длинная страница виртуализируется;
- back/forward и breadcrumb используют согласованную navigation history;
- смена active/historical scan очищает stale analyzer state;
- 100K payload не создаёт 100K DOM rows;
- directory map загружается отдельно от explorer pagination;
- remainder приходит от backend и не вычисляется по неполной странице;
- logical/allocated/unique allocated не смешиваются;
- Treemap и Sunburst поддерживают directory drill-down;
- Sunburst поддерживает keyboard activation.

Текущее evidence:

- `AnalyzerPanel.test.tsx` — component и bounded performance-oriented scenarios;
- `getChildren`/`getDirectoryMap` service и desktop IPC tests.

## 4. Large Files, Categories и Search

Сохраняемое поведение:

- queries запускаются по действию пользователя, а не при каждом render;
- cursor pagination сохраняет исходные filters;
- category query и category summary используют индекс;
- unfinished scan не запрашивается;
- empty/loading/error различаются.

Текущее evidence:

- соответствующие сценарии `AnalyzerPanel.test.tsx`;
- scan service bounded query tests.

## 5. File operations

Сохраняемое поведение:

- open/reveal используют indexed entry id;
- trash виден только при capability `trash`;
- single trash требует подтверждение;
- batch trash отправляет один bounded request;
- failed entries остаются выбранными для повторной попытки;
- после успешной операции текущий browser обновляется.

Ограничение baseline:

- текущий `window.confirm` должен быть заменён review UI, но защитное подтверждение нельзя потерять;
- permanent delete capability существует, но готового IPC-действия нет.

## 6. History, Compare, Duplicates и Old Files

Сохраняемое поведение:

- история восстанавливается, активный scan выделяется и может быть открыт;
- сравниваются любые два совместимых scan;
- retention сохраняется, cleanup защищает открытый scan;
- duplicate hashing показывает progress, поддерживает cancel и сообщает failures;
- подтверждённые duplicate groups пагинируются;
- batch duplicate trash показывает результат каждого rejected entry;
- Old Files поддерживает modified/created/accessed, custom date, min size и pagination с исходными filters.

Текущее evidence:

- `HistoryDuplicatesPanel.test.tsx` — history/compare/duplicates scenarios;
- `OldFilesPanel.test.tsx` — old-files scenarios;
- desktop E2E history/compare/duplicates flow.

## 7. Baseline checks

Перед изменениями этапа 1 выполнены из корня:

| Проверка            | Результат                    |
| ------------------- | ---------------------------- |
| `npm test`          | 5 файлов, 47 тестов — passed |
| `npm run typecheck` | passed                       |
| `npm run lint`      | passed                       |
| `npm run build`     | passed                       |

Визуальный baseline browser-safe состояния сохранён в:

`docs/design/baseline/ui-before-stage-1-browser-1440x900.png`

Native macOS startup baseline перед AppShell сохранён в:

`docs/design/baseline/legacy-app-native-before-app-shell-1440x900.png`

Дополнительно сохранены browser screenshots после подключения tokens и dev preview primitives. Native scan/result baseline и screenshots Windows/Linux остаются частью следующих migration slices; browser preview не подтверждает Tauri flows.

## 8. Exit criteria последующих migration slices

Каждый UI PR должен:

1. указать затронутые пункты inventory;
2. сохранить или осознанно обновить наблюдаемое поведение по подтверждённому требованию;
3. добавить tests для нового presentation/state boundary;
4. выполнить применимые checks;
5. приложить native screenshot для изменённого крупного состояния;
6. явно перечислить непроверенные platform flows.
