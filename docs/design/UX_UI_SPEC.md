# UX/UI Specification

## Проект: Cross-Platform Disk Space Analyzer

**Целевые платформы:** macOS, Windows, Linux  
**Canonical source:** UX/UI, визуальное поведение, пользовательские сценарии и бюджеты отзывчивости интерфейса  
**Связанные документы:** `docs/requirements/SRS.md`, `docs/architecture/ARCHITECTURE.md`, `docs/implementation/IMPLEMENTATION_PLAN.md`, `docs/testing/PERFORMANCE.md`, `docs/roadmap/STAGES.md`  
**Версия:** 1.0  
**Статус:** Draft / Canonical UX/UI Specification

---

# 1. Назначение

Этот документ является единственным первичным источником для:

- структуры интерфейса;
- расположения основных областей;
- навигации;
- пользовательских сценариев;
- состояния экранов;
- визуализации дискового пространства;
- поведения Sunburst и Treemap;
- File Browser и Column Browser;
- выбора и действий с файлами;
- UX для сканирования, поиска, дубликатов, Cleaner, History и Snapshots;
- визуальных правил;
- клавиатурного и мышиного управления;
- accessibility;
- воспринимаемой производительности.

Документ не дублирует функциональные требования SRS и технические алгоритмы IMPLEMENTATION_PLAN.

## 1.1. Source of Truth

| Вопрос                                                 | Источник                                     |
| ------------------------------------------------------ | -------------------------------------------- |
| Что должна уметь система                               | `docs/requirements/SRS.md`                   |
| Как устроена система                                   | `docs/architecture/ARCHITECTURE.md`          |
| Как технически реализовать функцию                     | `docs/implementation/IMPLEMENTATION_PLAN.md` |
| Как пользователь видит функцию и взаимодействует с ней | `docs/design/UX_UI_SPEC.md`                  |
| Как измерять производительность                        | `docs/testing/PERFORMANCE.md`                |
| На каком этапе находится реализация                    | `docs/roadmap/STAGES.md`                     |

Если функциональное требование меняется — изменяется SRS.  
Если меняется только UX-поведение или визуальная структура — изменяется этот файл.

---

# 2. UX-принципы продукта

Приложение является профессиональной desktop-утилитой анализа дискового пространства.

Основные принципы:

1. Пользователь всегда понимает, что сейчас происходит.
2. Длительные операции не блокируют UI.
3. Результаты появляются постепенно, без ожидания завершения полного сканирования.
4. Опасные операции отделены от безопасных.
5. `Move to Trash / Recycle Bin` является предпочтительным действием удаления.
6. Интерфейс не требует знания внутренних терминов Rust, SQLite, FSEvents, USN Journal или inotify.
7. Функции, недоступные на текущей ОС/filesystem, не должны выглядеть доступными.
8. Цвет не должен быть единственным способом передачи значения.
9. Большие наборы данных отображаются через virtualization, pagination и aggregation.
10. Интерфейс сохраняет привычки desktop-приложений macOS, Windows и Linux.

---

# 3. Исключённые элементы

В продукте отсутствуют:

- кнопка «Купить лицензию»;
- MacCleaner Pro;
- рекламные блоки;
- upsell;
- рекламные предложения;
- искусственно зарезервированное место под коммерческие CTA.

Нижняя часть Sidebar используется для настроек, помощи, версии и состояния приложения.

---

# 4. Главный layout

Базовая структура:

```text
┌──────────────┬────────────────────────────────────────────────────────────┐
│              │                           HEADER                           │
│              ├────────────────────────────────────────────────────────────┤
│              │                                                            │
│   SIDEBAR    │                         WORKSPACE                          │
│              │                                                            │
│              │                                                            │
│              ├────────────────────────────────────────────────────────────┤
│              │                     ACTION / STATUS BAR                    │
└──────────────┴────────────────────────────────────────────────────────────┘
```

Области:

- `Sidebar` — места, диски, Favorites, инструменты;
- `Header` — навигация, поиск, режим, текущий объект;
- `Workspace` — данные и визуализация;
- `Bottom Action Bar` — выбор, статус и действия.

---

# 5. Sidebar

Пример:

```text
┌──────────────────────────┐
│ 🏠 Home                  │
│                          │
│ LOCATIONS                │
│ 💽 Macintosh HD          │
│ 💽 External SSD          │
│ 💽 Data                  │
│                          │
│ FAVORITES                │
│ Applications             │
│ Downloads                │
│ Documents                │
│                          │
│ + Choose folder...       │
│                          │
│ TOOLS                    │
│ Duplicates               │
│ Old / Rare Files         │
│ Cleaner                  │
│ History                  │
│ Snapshots                │
│                          │
│ ⚙ Settings               │
│ ? Help                   │
└──────────────────────────┘
```

## 5.1. Размер

Рекомендуемая ширина:

- normal: `260–300 px`;
- collapsed: `64–72 px`.

Collapsed mode показывает иконки и tooltip.

## 5.2. Locations

Автоматически отображаются доступные volumes.

Состояния:

- internal;
- external;
- removable;
- read-only;
- encrypted/locked;
- unavailable.

Недоступный диск может оставаться в списке, если существует сохранённая история scan, но файловые действия для него disabled.

## 5.3. Favorites

Набор адаптируется под ОС.

macOS:

- Applications;
- Downloads;
- Documents;
- Pictures;
- Movies;
- Music.

Windows:

- Downloads;
- Documents;
- Pictures;
- Videos;
- Music.

Linux:

- Home;
- Downloads;
- Documents;
- Pictures;
- Videos;
- Music.

## 5.4. Choose Folder

`+ Choose folder...` открывает системный dialog выбора каталога.

После выбора:

- папка становится текущей;
- показывается карточка;
- доступно сканирование;
- папка может попасть в Recent Locations.

---

# 6. Window Chrome и платформенное поведение

## macOS

Использовать нативные macOS window controls и системные диалоги.

## Windows

Использовать привычные Windows minimize/maximize/close и системные dialogs.

## Linux

Не имитировать macOS controls. Окно должно корректно работать с поддерживаемым desktop environment/window manager.

Контент приложения остаётся концептуально одинаковым на всех платформах.

---

# 7. Home / состояние до сканирования

После выбора папки:

```text
user

Тип:       Папка
Создан:    31 мая 2021
Изменён:   24 сентября 2026
Место:     /Users
Размер:    —

Для просмотра содержимого
запустите анализ.
```

Для volume дополнительно:

- filesystem;
- total;
- used;
- free;
- read-only;
- encrypted, если доступно.

Основная CTA:

```text
[ Начать сканирование ]
```

На одном экране должна быть одна визуально доминирующая primary action.

---

# 8. Начало сканирования

После клика UI реагирует немедленно.

Последовательность:

```text
click
  ↓
PREPARING
  ↓
SCANNING
  ↓
первые метрики
  ↓
частичные результаты
```

Primary button меняется на:

```text
[ Остановить сканирование ]
```

UI не ждёт полного завершения Scanner.

---

# 9. Progress UX

Общее число filesystem entries часто заранее неизвестно.

Поэтому UI должен поддерживать indeterminate progress.

Пример:

```text
Анализируется...

Файлов:       184 291
Папок:         21 902
Обработано:     86.4 GB
Ошибок:             12

~/Library/Application Support/...
```

Запрещено показывать выдуманный процент.

Точный процент допускается только при достоверном denominator.

## 9.1. Состояния scan

UI различает:

- READY;
- PREPARING;
- SCANNING;
- CANCELLING;
- FINALIZING;
- COMPLETED;
- COMPLETED_WITH_WARNINGS;
- CANCELLED;
- FAILED;
- PARTIAL.

---

# 10. Progressive Results

Во время scan могут отображаться уже найденные данные:

```text
Users              311 GB
Applications        94 GB
Library             68 GB
System              37 GB
```

Sunburst/Treemap уточняются по мере поступления агрегатов.

Пользователь может изучать уже доступные результаты, если выбранный экран это поддерживает.

---

# 11. UI Update Rate

Scanner может обрабатывать тысячи объектов в секунду, но UI не обновляется на каждый объект.

Целевой refresh interval:

```text
100–250 ms
```

Ориентир:

```text
4–10 визуальных обновлений в секунду
```

При высокой нагрузке refresh rate может автоматически снижаться.

---

# 12. Основные режимы после сканирования

Основные режимы:

- Structure;
- Large Files;
- Categories;
- Duplicates;
- Old / Rare Files;
- Cleaner;
- History;
- Compare Scans;
- Snapshots.

В верхнем toolbar рекомендуется оставить:

```text
[ Структура ] [ Большие файлы ] [ Категории ] [ Ещё ▼ ]
```

History и Snapshots логично держать также в Sidebar.

---

# 13. Structure Mode

Основной экран анализа:

```text
┌────────────────────────────────────┬──────────────────────────────────┐
│                                    │                                  │
│            FILE BROWSER            │            VISUAL MAP            │
│                                    │                                  │
│                                    │                                  │
└────────────────────────────────────┴──────────────────────────────────┘
```

При достаточной ширине используется Column Browser.

---

# 14. File Browser

Базовый вид:

```text
☐ 📁 voice_intonation        2.06 GB
☐ 📁 Документы               2.04 GB
☐ 📁 Загрузки                 667 MB
☐ 📁 lazywork_bot             130 MB
☐ 📁 Музыка                   105 MB
```

Default sort:

```text
Size DESC
```

Поддерживаются сортировки:

- name;
- logical size;
- allocated size;
- modified;
- category;
- type.

Размер всегда показывается текстом.

---

# 15. Column Browser

Поведение основано на приложенном референсе.

```text
┌──────────────┬──────────────┬──────────────┬────────────────┐
│ user         │ project      │ models       │                │
│              │              │              │    SUNBURST    │
│ Documents    │ models       │ model-A      │                │
│ Downloads    │ src          │              │                │
│ project      │ report.html  │              │                │
└──────────────┴──────────────┴──────────────┴────────────────┘
```

Выбор папки создаёт следующую колонку.

Минимальная ширина одной колонки:

```text
260 px
```

Предпочтительно:

```text
280–340 px
```

При нехватке ширины применяется горизонтальная прокрутка.

---

# 16. Breadcrumb

Пример:

```text
user › voice_intonation › models › vosk-model
```

Каждый сегмент кликабелен.

Breadcrumb синхронизируется с:

- Column Browser;
- текущим directory;
- визуализацией;
- Back/Forward.

---

# 17. Back / Forward

Поддерживается history navigation:

```text
←   →
```

При возврате восстанавливаются:

- текущая папка;
- режим;
- selected item;
- scroll position;
- активные колонки;
- визуализация.

---

# 18. Hidden Items и Small Items

Для снижения визуального шума допускается группировка:

```text
▶ Маленькие элементы      315 KB
▶ Скрытые элементы       8.48 GB
```

Группы можно раскрыть.

Hidden items также могут управляться отдельной настройкой отображения.

---

# 19. Selection

Single selection обновляет:

- строку;
- Sunburst/Treemap;
- breadcrumb;
- Bottom Bar;
- доступные действия.

Пример:

```text
☑ 📁 models             783 MB
```

Multi-select поддерживается.

Bottom Bar:

```text
782.9 MB выбрано
3 элемента
```

---

# 20. Bottom Action Bar

Без выбора:

```text
[ Действия ▼ ]
```

disabled.

С выбором:

```text
Выбрано: 782.9 MB · 1 элемент

                              [ Действия ▼ ]
```

---

# 21. Actions

Минимальное меню:

```text
Открыть

Показать в Finder / Explorer / File Manager

Копировать путь

──────────────

Переместить в корзину

Удалить навсегда...
```

Permanent Delete визуально отделяется от остальных действий.

---

# 22. Delete UX

Предпочтительная операция:

```text
Move to Trash / Recycle Bin
```

Permanent Delete:

- отдельный пункт;
- подтверждение;
- число объектов;
- общий размер;
- предупреждение о невозможности восстановления.

При изменении файла между scan и delete операция должна останавливаться с понятным сообщением.

---

# 23. Sunburst Visualization

Требования SRS: `VIS-SUNBURST-001`.

Sunburst является основной визуализацией структуры.

```text
             descendants
          ┌──────────────┐
        ╱                  ╲
      ╱                      ╲
    │          children         │
    │                           │
    │        ┌─────────┐        │
    │        │ current │        │
    │        │ folder  │        │
    │        └─────────┘        │
      ╲                       ╱
        ╲___________________╱
```

## 23.1. Семантика

Центр — текущая папка.

Первое кольцо — непосредственные дочерние объекты.

Следующие кольца — последующие уровни дерева.

Угловой размер сектора пропорционален выбранной метрике:

- logical size;
- allocated size, если доступно.

## 23.2. Hover

Tooltip:

```text
Downloads

21.4 GB
17.2%

/Users/user/Downloads
```

Дополнительно могут показываться:

- allocated size;
- file count;
- category;
- type.

## 23.3. Selection

Single click:

- выбирает объект;
- синхронизирует File Browser;
- обновляет Bottom Bar.

## 23.4. Drill-down

Double click / Enter / dedicated interaction:

- выбранная папка становится центром;
- File Browser переходит на этот directory;
- breadcrumb обновляется.

## 23.5. Back navigation

Возврат через:

- breadcrumb;
- Back;
- parent action.

## 23.6. Цвет

Цвета не должны рандомно меняться при каждом UI update.

Выбранный сектор имеет независимый highlight.

---

# 24. Treemap

Требования SRS: существующий Treemap + `VIS-MODE-001`.

Переключатель:

```text
Visualization

● Sunburst
○ Treemap
```

Sunburst является default.

Treemap поддерживает:

- hover;
- selection;
- drill-down;
- back;
- category;
- logical/allocated size.

---

# 25. Ограничение сложности визуализации

Нельзя рендерить миллионы graphical nodes.

Целевой диапазон visible nodes:

```text
1 000–3 000
```

Точное значение определяется profiling.

Остальные элементы агрегируются в:

```text
Small items
Other
```

---

# 26. Large Files

Экран:

```text
Name                 Size        Modified        Location

video.mov           41.2 GB      21 Sep          ~/Movies
vm.qcow2            28.1 GB      14 Sep          ~/VM
archive.zip         12.8 GB      01 Sep          ~/Downloads
```

Фильтры:

```text
Size ≥ [ 1 GB ▼ ]
Type [ All ▼ ]
Location [ Current ▼ ]
Modified [ Any time ▼ ]
```

Поддерживаются:

- sort;
- filter;
- search;
- multi-select;
- actions.

---

# 27. Categories

Пример:

```text
Videos              141 GB
Images                82 GB
Archives              56 GB
Applications          49 GB
Documents             38 GB
Development           22 GB
Virtual Machines      18 GB
Other                  9 GB
```

Выбор категории открывает соответствующий список.

---

# 28. Search

Search доступен из Header.

Shortcut:

```text
Cmd+F / Ctrl+F
```

Поиск выполняется по локальному индексу.

Debounce:

```text
150–250 ms
```

Фильтры:

- Name;
- Extension;
- Path;
- Category;
- Type;
- Size;
- Modified.

---

# 29. Duplicates

Экран:

```text
Duplicates

Potentially recoverable: 34.8 GB

Group 1                        8.2 GB × 3

☐ ~/Downloads/video.mov
☑ ~/Backup/video.mov
☑ ~/Old/video.mov
```

Группы сортируются по потенциально освобождаемому месту.

## 29.1. Safety

Нельзя автоматически выбирать для удаления все копии.

При попытке выбрать все:

```text
Необходимо оставить минимум одну копию.
```

Перед удалением обязательна preview.

---

# 30. Old Files

Режим:

```text
Old Files
```

Фильтры:

- > 30 days;
- > 90 days;
- > 6 months;
- > 1 year;
- > 2 years;
- Custom.

Дополнительно:

- size;
- category;
- location.

---

# 31. Rarely Used

UI обязан показывать критерий и достоверность.

Примеры:

```text
Not modified since: 12 Jan 2024
```

или:

```text
Last filesystem access: 14 Feb 2024
Reliability: platform dependent
```

Нельзя формулировать вывод как точное «не использовался», если filesystem этого не подтверждает.

---

# 32. Cleaner

Главный экран:

```text
Cleaner

Safe                     4.8 GB
Review                   13.2 GB
Advanced                  3.1 GB
```

Risk level обозначается и текстом, и иконкой.

## 32.1. Cleaner Cards

```text
Application caches

Chrome            1.8 GB
VS Code           1.2 GB
npm               2.4 GB

[ Review ]
```

## 32.2. Preview

```text
Будет очищено

842 файла
5.4 GB

Risk: Safe

[ Отмена ] [ Переместить в корзину ]
```

Advanced операции получают дополнительное предупреждение.

---

# 33. History

Экран:

```text
Scan History

24 Sep 2026        724 GB
20 Sep 2026        701 GB
15 Sep 2026        683 GB
```

Для каждого scan:

- дата;
- root/volume;
- total analyzed size;
- status;
- warnings;
- scanner version при необходимости.

---

# 34. Compare Scans

Пользователь выбирает Scan A и Scan B.

Пример результата:

```text
+23 GB total

Added               +31 GB
Removed               -8 GB
```

Далее:

```text
Downloads             +14 GB
Docker                +11 GB
Movies                 +8 GB
Projects               -4 GB
```

Режимы:

- Added;
- Removed;
- Increased;
- Decreased;
- Moved/Renamed, если определяется достоверно.

---

# 35. Watcher / Live State

После полного scan приложение может показывать:

```text
● Live
```

или:

```text
Monitoring changes
```

При утрате достоверности:

```text
Data may be outdated

[ Rescan ]
```

Нельзя продолжать отображать `Live`, если watcher checkpoint больше не надёжен.

---

# 36. Snapshots

Раздел отображается только при соответствующей capability.

Пример APFS:

```text
Snapshots

Time Machine snapshot       24 Sep 14:21
System snapshot             23 Sep 10:01
```

Для Btrfs/ZFS отображается terminology соответствующей filesystem.

Если capability отсутствует:

- раздел скрывается для текущего volume;
- либо показывается explanatory empty state.

---

# 37. Capabilities

Frontend не определяет возможности только по имени ОС.

Core передаёт capabilities.

UI на их основании включает/скрывает:

- snapshots;
- advanced filesystem info;
- watcher status;
- allocated size;
- trash;
- permanent delete;
- access-time reliability.

---

# 38. Empty States

Каждый экран должен иметь осмысленный empty state.

Пример Duplicates:

```text
Дубликаты не найдены

После анализа здесь появятся
файлы с подтверждённым совпадением содержимого.
```

Не допускается пустая таблица без пояснения.

---

# 39. Loading States

Предпочтительно:

- skeleton;
- partial content;
- incremental rendering.

Не блокировать весь экран глобальным spinner, если часть информации уже доступна.

---

# 40. Permission Errors

Пример:

```text
Часть каталогов недоступна

127 каталогов не удалось проанализировать.

Результат может быть неполным.

[ Подробнее ]
```

Scan получает состояние:

```text
COMPLETED_WITH_WARNINGS
```

или:

```text
PARTIAL
```

в зависимости от результата Core.

---

# 41. External Drive Disconnect

При отключении диска:

```text
External SSD is unavailable.

Сохранённый scan можно просматривать,
но файловые операции недоступны.
```

При активном scan:

- операция корректно завершается/прерывается;
- пользователь получает объяснение;
- приложение не зависает.

---

# 42. Responsive Desktop Layout

Целевая минимальная рабочая область:

```text
1100 × 700
```

При меньшей ширине:

- Sidebar collapses;
- Visual Map уменьшается;
- Column Browser получает горизонтальный scroll;
- таблицы сохраняют virtualization.

Интерфейс не превращается в mobile layout.

---

# 43. Visual Design

Референс задаёт общую атмосферу:

- dark navy background;
- синий selected state;
- яркий primary blue;
- muted secondary text;
- плотная desktop-компоновка.

Не копировать branding и коммерческие элементы референса.

---

# 44. Design Tokens

Компоненты не должны содержать произвольные hardcoded colors.

Использовать tokens:

```text
background.base
background.sidebar
background.surface
background.elevated

border.default
border.focus

text.primary
text.secondary
text.muted
text.inverse

accent.primary
accent.hover
accent.selected

status.success
status.warning
status.danger
status.info
```

Дополнительно:

```text
spacing.*
radius.*
shadow.*
font.*
```

---

# 45. Theme

Default reference:

```text
Dark
```

Архитектура должна допускать:

- System;
- Dark;
- Light.

Компоненты используют semantic tokens.

---

# 46. Typography

Использовать системный sans-serif stack.

Не требовать установки отдельного пользовательского шрифта.

Основные уровни:

- window title;
- section title;
- body;
- table;
- caption;
- metadata;
- numeric size.

---

# 47. Visual Density

Продукт — desktop utility.

Требования:

- не использовать oversized mobile-style cards;
- поддерживать высокую информационную плотность;
- строки File Browser должны оставаться компактными;
- важные числовые значения выравнивать для быстрого сравнения.

Допустимы режимы:

```text
Comfortable
Compact
```

---

# 48. Motion

Переходы:

```text
100–200 ms
```

Не использовать длительные декоративные animations.

Sunburst/Treemap могут плавно перестраиваться, но animation:

- не блокирует interaction;
- отключается при Reduced Motion.

---

# 49. Keyboard

Минимально:

```text
↑ ↓
перемещение выбора

← →
навигация по колонкам / назад-вперёд где уместно

Enter
открыть / перейти внутрь

Space
выбрать

Cmd+F / Ctrl+F
поиск

Cmd+A / Ctrl+A
выбрать всё в текущем контексте

Esc
закрыть transient UI / dialog
```

Destructive shortcuts должны соответствовать ожиданиям платформы и иметь защиту.

---

# 50. Mouse / Trackpad

Поддержать:

- single click;
- double click;
- context menu;
- vertical scroll;
- horizontal scroll;
- trackpad gestures там, где они не конфликтуют с navigation.

---

# 51. Context Menu

Для файла:

```text
Open

Reveal

Copy path

─────────

Move to Trash

Delete permanently...
```

Для directory дополнительно:

```text
Analyze here

Set as scan root
```

если эти действия поддерживаются текущим контекстом.

---

# 52. Accessibility

Обязательные требования:

- keyboard navigation;
- visible focus;
- screen reader labels;
- понятные accessible names;
- отсутствие color-only states;
- sufficient contrast;
- reduced motion;
- масштабирование текста без разрушения layout.

Ориентир для обычного текста:

```text
contrast >= 4.5:1
```

где применимо.

---

# 53. Notifications

Неблокирующие результаты показывать через toast.

Пример:

```text
Moved 3 items to Trash
```

Частичный failure:

```text
2 of 5 items could not be moved
[ Details ]
```

Не показывать modal dialog на каждую отдельную ошибку одного файла.

---

# 54. Confirmation Dialogs

Не подтверждать:

- navigation;
- search;
- sort;
- filter;
- opening files.

Подтверждать:

- Permanent Delete;
- Advanced Cleaner;
- массовые потенциально опасные операции.

---

# 55. Settings

Разделы:

```text
General
Scanning
Appearance
Storage / History
File Operations
Advanced
```

## 55.1. Scanning

Пример:

```text
Follow symbolic links        OFF
Show hidden files            ON
Include mounted volumes      OFF
```

Системные/опасные параметры скрывать в Advanced.

## 55.2. Appearance

```text
Theme
System / Dark / Light

Visualization
Sunburst / Treemap

Density
Comfortable / Compact
```

## 55.3. Storage / History

Настройки retention отображаются только если такая политика предусмотрена SRS.

---

# 56. Help / About

Вместо рекламного блока Sidebar:

```text
? Help
⚙ Settings
```

Help может содержать:

- documentation;
- keyboard shortcuts;
- report a problem;
- About.

About:

- application name;
- version;
- build;
- platform;
- architecture;
- DB schema version при необходимости.

---

# 57. UX Performance Budgets

Эти значения являются UX-targets. Методика измерений хранится в `docs/testing/PERFORMANCE.md`.

## 57.1. Interaction latency

| Действие                             |   Target |
| ------------------------------------ | -------: |
| hover/focus response                 |  ≤ 50 ms |
| selection feedback                   | ≤ 100 ms |
| cached tab switch                    | ≤ 100 ms |
| cached folder expansion              | ≤ 100 ms |
| first scan visual feedback           | ≤ 100 ms |
| first progress update                | ≤ 500 ms |
| cancel button visual acknowledgement | ≤ 100 ms |

## 57.2. Indexed data operations

P95 target в типичном локальном сценарии:

| Операция               |   Target |
| ---------------------- | -------: |
| открыть каталог        | ≤ 150 ms |
| следующая страница     | ≤ 200 ms |
| сортировка             | ≤ 300 ms |
| первая страница search | ≤ 300 ms |
| изменение фильтра      | ≤ 300 ms |

Если операция занимает дольше, UI показывает loading state.

---

# 58. Frame Rate

Цель:

```text
60 FPS
```

для:

- scroll;
- selection;
- Sunburst hover;
- Treemap hover;
- обычной навигации.

Интерфейс не должен устойчиво падать ниже:

```text
30 FPS
```

во время обычных действий.

---

# 59. DOM / Rendering Budget

Запрещено рендерить полный список из миллионов entries.

Обязательны:

- virtualization;
- pagination;
- lazy loading;
- aggregation.

Количество DOM-элементов должно зависеть от viewport и небольшого buffer.

---

# 60. Perceived Performance

Во время длительной операции пользователь всегда должен понимать:

- что происходит;
- что уже обработано;
- продолжается ли процесс;
- можно ли отменить;
- есть ли warning;
- можно ли продолжать работать с интерфейсом.

---

# 61. Startup UX

Тяжёлые background operations не должны задерживать появление окна.

Предпочтительный порядок:

```text
Application shell
       ↓
UI ready
       ↓
Volumes loading
       ↓
History loading
       ↓
Background checks
```

Нельзя держать окно скрытым до завершения полного фонового анализа.

---

# 62. Основной пользовательский сценарий

```text
Launch
   ↓
Choose disk/folder
   ↓
Start scan
   ↓
Observe progressive result
   ↓
Scan complete
   ↓
Browse folders / visualization
   ↓
Select large item
   ↓
Review
   ↓
Move to Trash
   ↓
Index updates
```

---

# 63. Расширенный UX lifecycle

```text
                         HOME
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
          Volume                      Folder
             │                           │
             └─────────────┬─────────────┘
                           ▼
                          SCAN
                           │
                           ▼
                        RESULT
                           │
       ┌───────────────────┼────────────────────────┐
       ▼                   ▼                        ▼
   Structure           Large Files              Categories
       │
       ├────────► Duplicates
       ├────────► Old / Rare
       ├────────► Cleaner
       ├────────► History / Compare
       └────────► Snapshots
```

---

# 64. UX Definition of Done

Пользовательская функция не считается завершённой, если реализован только backend.

Для каждого нового UX flow проверяются применимые состояния:

- normal;
- loading;
- empty;
- partial;
- error;
- permission denied;
- disconnected/offline volume;
- keyboard;
- mouse/context menu;
- accessible labels;
- performance;
- destructive-action safety.

---

# 65. Связь с SRS

SRS содержит краткое функциональное требование.

Пример:

```text
VIS-SUNBURST-001
Приложение должно предоставлять интерактивную радиальную
визуализацию использования дискового пространства.
```

Детальное визуальное поведение хранится только здесь.

---

# 66. Связь с IMPLEMENTATION_PLAN

Пример:

```text
UX:
Column Browser
        ↓
Implementation:
get_children(directory_id)
        ↓
Storage:
EntryRepository
```

Этот документ не определяет SQL, Rust worker pools или Tauri IPC internals.

IMPLEMENTATION_PLAN не должен дублировать размеры Sidebar, hover-поведение и visual states.

---

# 67. Правило для AI-агентов

Перед изменением пользовательского интерфейса агент обязан проверить:

1. соответствующее требование в `SRS.md`;
2. этот `UX_UI_SPEC.md`;
3. `IMPLEMENTATION_PLAN.md`;
4. актуальную архитектуру;
5. существующие компоненты и design tokens.

AI-agent не должен самостоятельно создавать альтернативную UX-концепцию, если это противоречит этому файлу.

Если необходим новый UX-pattern, он сначала фиксируется в этом документе или соответствующем ADR, если изменение архитектурное.

---

# 68. Изменения этого документа

Документ изменяется, если меняются:

- расположение основных областей;
- screen flow;
- navigation;
- interaction;
- visual state;
- Sunburst/Treemap UX;
- keyboard behavior;
- accessibility;
- UI responsiveness budget.

Документ не изменяется при чистом внутреннем refactoring, не затрагивающем поведение пользователя.

---

# 69. Итоговая концепция

Основной экран после сканирования:

```text
┌──────────────┬──────────────────────────────────────────────────────────────┐
│              │ 🔍  [Структура] [Большие файлы] [Категории]  user · 13 GB │
│              ├───────────────────────────────┬──────────────────────────────┤
│ Home         │                               │                              │
│              │ Documents             2 GB    │                              │
│ LOCATIONS    │ Downloads           667 MB    │           SUNBURST           │
│ C: / Mac HD  │ Projects            130 MB    │                              │
│ Data         │ Music               105 MB    │                              │
│ External SSD │ ...                           │                              │
│              │                               │                              │
│ FAVORITES    ├───────────────────────────────┴──────────────────────────────┤
│ Downloads    │ user › projects › models                                    │
│ Documents    ├──────────────────────────────────────────────────────────────┤
│              │ 782.9 MB · 1 selected                     [ Действия ▼ ]   │
│ TOOLS        │                                                              │
│ Duplicates   │                                                              │
│ Old / Rare   │                                                              │
│ Cleaner      │                                                              │
│ History      │                                                              │
│ Snapshots    │                                                              │
│              │                                                              │
│ ⚙ Settings   │                                                              │
└──────────────┴──────────────────────────────────────────────────────────────┘
```

Это является базовой UX-концепцией проекта для macOS, Windows и Linux.
