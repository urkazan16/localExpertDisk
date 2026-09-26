# Техническое задание

**Проект:** кроссплатформенный анализатор дискового пространства  
**Целевые ОС:** macOS, Windows, Linux  
**Версия ТЗ:** 1.0  
**Статус:** базовая версия требований  
**Дата:** 24 сентября 2026 г.

---

# 1. Назначение документа

Настоящее техническое задание является основным источником продуктовых и системных требований проекта.

ТЗ определяет:

- функциональные возможности приложения;
- техническую архитектуру;
- требования к macOS, Windows и Linux;
- этапы реализации;
- критерии завершения каждого этапа;
- правила тестирования;
- требования к производительности;
- требования к безопасности;
- структуру хранения проектной документации;
- правила внесения архитектурных изменений;
- правила работы разработчиков и AI-агентов;
- правила предотвращения дублирования документации.

Главный принцип проекта:

> Одно требование, архитектурное решение, контракт или правило должно иметь только один первичный источник.

Другие документы могут ссылаться на первичный источник, но не должны копировать его содержимое.

---

# 2. Назначение продукта

Приложение предназначено для анализа использования дискового пространства на:

| Платформа |   Поддержка |
| --------- | ----------: |
| macOS     | обязательна |
| Windows   | обязательна |
| Linux     | обязательна |

Основная задача пользователя:

> определить, какие файлы, каталоги, приложения, данные и системные объекты занимают место на накопителе, и безопасно освободить дисковое пространство.

Приложение должно совмещать возможности:

- Disk Analyzer;
- File Explorer;
- Large Files Finder;
- Duplicate Finder;
- Old Files Analyzer;
- Disk History Analyzer;
- System Cleaner;
- File System Change Monitor;
- APFS/NTFS/Btrfs/ZFS Analyzer.

---

# 3. Основной технологический стек

## 3.1. Desktop Framework

Использовать:

**Tauri 2**

Tauri является кроссплатформенной оболочкой для macOS, Windows и Linux и позволяет реализовать системную часть приложения на Rust, оставляя frontend независимым.

---

## 3.2. Backend / Core

Основной язык:

**Rust**

Rust Core должен выполнять:

- обход файловой системы;
- получение metadata;
- вычисление размеров;
- построение дерева;
- анализ;
- хеширование;
- взаимодействие с SQLite;
- filesystem monitoring;
- удаление;
- работу с корзиной;
- платформенные операции;
- работу с snapshots.

Стандартная библиотека Rust предоставляет кроссплатформенные filesystem API, а платформенные особенности доступны через отдельные расширения `std::os::$platform`.

---

# 4. Frontend

Использовать:

**React + TypeScript**

Frontend отвечает исключительно за:

- представление данных;
- пользовательское взаимодействие;
- визуализацию;
- фильтрацию уже полученных данных;
- управление состоянием экранов.

Frontend не должен:

- рекурсивно обходить filesystem;
- вычислять размер директорий;
- читать миллионы filesystem entries;
- хешировать файлы;
- выполнять системную очистку;
- непосредственно обращаться к SQLite;
- содержать платформенную filesystem-логику.

---

# 5. Хранилище данных

Основная локальная БД:

**SQLite**

БД используется для:

- ScanSession;
- результатов сканирования;
- файлового индекса;
- истории;
- fingerprints;
- дубликатов;
- filesystem events;
- snapshots metadata;
- результатов сравнения;
- конфигурации очистки.

Допускается WAL mode, поскольку он позволяет чтению и записи происходить с большей конкурентностью, чем стандартный rollback journal.

БД является локальной.

Передача содержимого пользовательских файлов на внешние серверы не требуется.

---

# 6. Основной архитектурный принцип

Архитектура:

```text
┌──────────────────────────────┐
│        React / TS UI         │
└──────────────┬───────────────┘
               │
        Typed IPC Contract
               │
┌──────────────▼───────────────┐
│          Tauri Layer         │
└──────────────┬───────────────┘
               │
┌──────────────▼───────────────┐
│           Rust Core          │
│                              │
│ Scanner                      │
│ Analyzer                     │
│ Search                       │
│ Duplicate Engine             │
│ History                      │
│ Cleaner                      │
│ Snapshot Engine              │
└──────────────┬───────────────┘
               │
┌──────────────▼───────────────┐
│    Platform Abstraction      │
├──────────┬─────────┬─────────┤
│  macOS   │ Windows │ Linux   │
└──────────┴─────────┴─────────┘
```

Rust Core запрещено связывать напрямую с React.

Rust Core должен иметь возможность использоваться:

- Tauri-приложением;
- CLI;
- benchmark-программой;
- integration tests;
- потенциальным другим UI.

---

# 7. Архитектурные слои

## 7.1. Core

```text
core/
├── scanner/
├── analyzer/
├── filesystem/
├── duplicates/
├── history/
├── watcher/
├── cleaner/
├── snapshots/
├── storage/
├── model/
└── operations/
```

---

## 7.2. Platform

```text
platform/
├── macos/
│   ├── filesystem
│   ├── permissions
│   ├── trash
│   ├── fsevents
│   └── apfs
│
├── windows/
│   ├── filesystem
│   ├── permissions
│   ├── recycle_bin
│   ├── usn
│   └── ntfs
│
└── linux/
    ├── filesystem
    ├── permissions
    ├── trash
    ├── inotify
    ├── btrfs
    └── zfs
```

---

# 8. Модель файла

Минимальная доменная модель должна поддерживать:

```text
FileEntry

id
parent_id
scan_id

path
name
extension

entry_type

logical_size
allocated_size

created_at
modified_at
accessed_at

filesystem_id
inode_or_file_id

is_hidden
is_symlink
is_hardlink

link_target
link_count

permissions

category
```

Наличие значения в конкретном поле зависит от:

- операционной системы;
- filesystem;
- прав пользователя;
- возможности получения metadata.

Отсутствующее значение не должно заменяться вымышленным.

---

# 9. Logical Size и Allocated Size

Приложение обязано различать:

**Logical size**

и

**Allocated size**.

Нельзя считать эти значения взаимозаменяемыми.

Это необходимо для корректной работы со:

- sparse files;
- filesystem compression;
- APFS clones;
- Btrfs reflinks;
- ZFS;
- NTFS compression.

---

# 10. Scanner Engine

Идентификатор требований:

`SCAN-*`

## SCAN-001

Приложение должно сканировать отдельную директорию.

## SCAN-002

Приложение должно сканировать доступный пользователю volume.

## SCAN-003

Обход должен быть рекурсивным.

## SCAN-004

Scanner обязан поддерживать:

```text
file
directory
symlink
hardlink
filesystem-specific object
```

## SCAN-005

Scanner не должен попадать в бесконечный цикл при symlink.

## SCAN-006

Scanner должен обрабатывать ситуацию, когда файл:

- исчез во время сканирования;
- переименован;
- изменён;
- становится недоступным.

Такая ошибка не должна останавливать весь ScanSession.

Rust filesystem API отдельно предупреждает о возможности изменений filesystem между проверкой объекта и последующей операцией — TOCTOU. Архитектура должна исходить из того, что состояние filesystem может измениться в любой момент.

## SCAN-007

Permission denied должен регистрироваться как skipped item.

## SCAN-008

Пользователь должен иметь возможность отменить сканирование.

## SCAN-009

Scanner должен отправлять прогресс во время работы.

## SCAN-010

Сканирование миллионов объектов не должно приводить к созданию такого же количества React-компонентов или IPC-сообщений.

---

# 11. Передача результатов Scanner → UI

Запрещена модель:

```text
1 FileEntry
↓
1 IPC event
```

при массовом сканировании.

Использовать batching.

Пример:

```text
Scanner

5000 entries
↓
aggregation
↓
storage
↓
progress event
↓
UI
```

UI должен получать преимущественно:

- агрегаты;
- текущую директорию;
- количество объектов;
- текущий объём данных;
- progress;
- top-N;
- изменения отображаемой части дерева.

---

# 12. ScanSession

Каждое сканирование получает уникальный:

`scan_id`.

Минимальные данные:

```text
scan_id
volume_id
root_path

started_at
finished_at

status

files_count
directories_count

logical_size
allocated_size

skipped_items
errors_count

scanner_version
```

Статусы:

```text
created
running
cancelled
completed
failed
```

---

# 13. Информация о накопителе

Приложение должно отображать:

```text
Volume name

Mount point

Filesystem

Total space

Used space

Free space
```

Если возможно:

```text
Device identifier

Removable

SSD/HDD

Read-only

Encrypted
```

---

# 14. Анализ каталогов

Для каждой директории рассчитывать:

```text
file_count
directory_count

logical_size
allocated_size

percentage_of_parent
percentage_of_scan
```

Размер родительской директории рассчитывается на основании дочерних объектов.

---

# 15. File Categories

Минимальные категории:

| Категория        |
| ---------------- |
| Video            |
| Images           |
| Audio            |
| Documents        |
| Archives         |
| Applications     |
| Development      |
| Virtual Machines |
| Disk Images      |
| Databases        |
| Backups          |
| Other            |

Первоначальная классификация может выполняться по:

- extension;
- filesystem metadata.

В дальнейшем допускается расширение MIME/UTI-классификацией.

---

# 16. Large Files

Пользователь должен иметь возможность:

```text
показать самые большие файлы;

выбрать минимальный размер;

отсортировать по размеру;

отсортировать по времени изменения;

ограничить директорию;

ограничить категорию.
```

---

# 17. Поиск

Поддерживать поиск:

```text
по имени;

расширению;

пути;

категории.
```

Поиск должен выполняться по индексу приложения, а не запускать новый полный filesystem scan.

---

# 18. Folder Tree

Интерфейс должен поддерживать:

```text
Root
├── Folder
│   ├── Folder
│   └── File
└── Folder
```

Не загружать всё дерево в DOM одновременно.

Необходимо использовать:

- lazy loading;
- virtualization.

---

# 19. Treemap

Должна быть реализована визуальная карта занятого места.

Минимальные возможности:

```text
directory navigation;

hover;

selected item;

size;

category;

zoom;

back.
```

Количество элементов, одновременно отображаемых в Treemap, должно ограничиваться разумным порогом.

Очень маленькие элементы допускается агрегировать.

---

# 19A. Sunburst Visualization

Идентификаторы требований:

`VIS-SUNBURST-*`

## VIS-SUNBURST-001

Приложение должно предоставлять интерактивную радиальную визуализацию (Sunburst) использования дискового пространства.

Центральный элемент должен представлять текущую директорию, внутреннее кольцо — её непосредственных потомков, последующие кольца — более глубокие уровни иерархии.

Подробное визуальное поведение, hover, selection, drill-down, синхронизация с File Browser и ограничения на количество одновременно отображаемых graphical nodes определяются в:

`docs/design/UX_UI_SPEC.md`.

## VIS-SUNBURST-002

Размер сектора должен быть пропорционален выбранной метрике размера данных.

Если доступны `logical_size` и `allocated_size`, приложение должно позволять использовать поддерживаемую текущим экраном метрику без смешивания значений.

## VIS-SUNBURST-003

Выбор элемента в Sunburst должен синхронизироваться с текущим File Browser / Column Browser.

Выбор элемента в File Browser / Column Browser должен подсвечивать соответствующий элемент Sunburst.

## VIS-SUNBURST-004

Sunburst не должен пытаться визуализировать миллионы отдельных объектов одновременно.

Допускается агрегация мелких элементов и ограничение количества visible graphical nodes.

# 19B. Visualization Mode

## VIS-MODE-001

Пользователь должен иметь возможность переключаться между:

- Sunburst;
- Treemap.

Sunburst является визуализацией по умолчанию.

Подробное UX-поведение переключателя определяется в:

`docs/design/UX_UI_SPEC.md`.

---

# 20. Операции с файлами

Модуль:

`FileOperationService`.

Поддерживаемые операции:

| Операция               | Требование |
| ---------------------- | ---------: |
| Open                   |         да |
| Reveal in file manager |         да |
| Open directory         |         да |
| Move to Trash          |         да |
| Permanent Delete       |         да |
| Multi-select           |         да |

На macOS системный API `NSWorkspace` поддерживает открытие файла в Finder и перемещение URL в Trash.

На Windows filesystem-операции должны использовать платформенный слой; `IFileOperation` предоставляет системные операции удаления, перемещения, копирования и обработки ошибок.

---

# 21. Безопасное удаление

Операция по умолчанию:

**Move to Trash / Recycle Bin**.

Permanent Delete должно являться отдельной операцией.

Перед Permanent Delete обязательно:

```text
явное действие пользователя;

подтверждение;

отображение количества файлов;

отображение объёма данных.
```

---

# 22. Protected Paths

Необходимо иметь отдельный механизм:

`ProtectedPathPolicy`.

Он должен блокировать или ограничивать массовое удаление критических областей.

Пример:

```text
macOS

/System
/bin
/sbin
/usr


Windows

Windows
Program Files
Program Files (x86)


Linux

/bin
/boot
/etc
/lib
/sbin
/usr
```

Список не должен быть единственным механизмом безопасности.

Необходимо учитывать mount point, root filesystem и платформенные API.

---

# 23. История

Модуль:

`HistoryService`.

Хранить результаты нескольких ScanSession.

Пользователь должен иметь возможность открыть предыдущий ScanSession.

---

# 24. Сравнение сканирований

Поддержать:

```text
Scan A
vs
Scan B
```

Результат:

```text
Added

Removed

Changed

Size increased

Size decreased
```

Отображать:

```text
изменение размера диска;

изменение директорий;

крупнейшие новые файлы;

крупнейшие удалённые файлы;

категории с максимальным ростом.
```

---

# 25. Filesystem Watcher

Определить единый интерфейс:

```text
FileSystemWatcher
```

Реализации:

```text
MacOsWatcher
WindowsWatcher
LinuxWatcher
```

---

# 26. macOS Watcher

Использовать:

**FSEvents**.

FSEvents предназначен в том числе для приложений, работающих с большими иерархиями файлов, и позволяет определять изменения с момента известного event ID.

---

# 27. Windows Watcher

Основной вариант для NTFS:

**USN Change Journal**.

NTFS ведёт журнал изменений файлов и директорий, позволяющий определять изменения без повторного полного сканирования volume.

Необходимо учитывать:

- журнал может отсутствовать;
- старые records могут исчезнуть;
- journal может быть пересоздан;
- filesystem может быть не NTFS.

При невозможности корректно продолжить incremental update необходимо запускать resync.

---

# 28. Linux Watcher

Основной механизм:

**inotify**.

Необходимо учитывать фундаментальное ограничение:

> monitoring директорий через inotify не является рекурсивным автоматически.

Для дерева каталогов необходимо создавать дополнительные watches. Также приложение должно обрабатывать переполнение event queue и выполнять resync.

---

# 29. Incremental Update

После полного scan:

```text
Full Scan
↓
Index
↓
Watcher checkpoint
↓
File changes
↓
Incremental processing
↓
Database update
↓
Aggregate update
↓
UI update
```

При потере достоверности watcher:

```text
Watcher state invalid
↓
mark index stale
↓
rescan affected subtree

или

full rescan
```

Приложение не должно продолжать показывать устаревшие результаты как актуальные.

---

# 30. Duplicate Finder

Модуль:

`DuplicateEngine`.

Использовать многоэтапный алгоритм.

```text
All files
↓
Group by size
↓
Candidate groups
↓
Partial fingerprint
↓
Full content hash
↓
Duplicate groups
```

Не хешировать содержимое всех файлов без предварительной фильтрации по размеру.

---

# 31. Duplicate Safety

Файлы считаются точными дубликатами только после подтверждения содержимого.

Совпадение:

```text
name
size
date
```

само по себе недостаточно.

Приложение не должно автоматически удалять найденные дубликаты без выбора пользователя.

---

# 32. Old Files Analyzer

Должна поддерживаться выборка:

```text
30 дней
90 дней
6 месяцев
1 год
2 года
custom
```

Основные показатели:

```text
modified_at

created_at

accessed_at
```

`accessed_at` считать вспомогательным показателем, поскольку достоверность и режим обновления access time отличаются между filesystem.

UI должен явно указывать используемый критерий.

---

# 33. Rarely Used Files

Категория `Rarely Used` не должна утверждать, что файл точно не использовался, если filesystem не позволяет достоверно это установить.

Допустимые формулировки UI:

```text
Not modified since...

Last filesystem access...

Not observed as changed since...
```

---

# 34. Cleaner Engine

Отдельный модуль:

`CleanerEngine`.

Cleaner должен быть rule-based.

Модель:

```text
CleanupRule

id
platform
category
description

detector
paths

risk_level

requires_privileges

supports_preview
supports_delete
```

---

# 35. Категории Cleaner

Минимально:

```text
Temporary files

Application caches

System/application logs

Crash reports

Old installers

Browser caches

Package caches

Development caches
```

---

# 36. Cleanup Risk

Каждое правило обязано иметь risk level:

```text
SAFE

REVIEW

ADVANCED
```

`SAFE`

Удаление не должно затрагивать пользовательские документы или критические данные приложения.

`REVIEW`

Пользователь должен просмотреть список.

`ADVANCED`

Действие потенциально может повлиять на систему или приложение и требует отдельного подтверждения.

---

# 37. Cleaner Preview

Перед очисткой пользователь должен видеть:

```text
что будет удалено;

откуда;

размер;

категорию;

приложение;

уровень риска.
```

---

# 38. APFS

Отдельный:

`ApfsProvider`.

Поддерживать обнаружение:

```text
APFS volumes

containers

snapshots

clones, если доступно через выбранные API

logical/physical storage information
```

Функции APFS не должны отображаться на неподдерживаемой filesystem.

---

# 39. NTFS

`NtfsProvider`.

Необходимо предусмотреть поддержку:

```text
file IDs

MFT-related information where permitted

hardlinks

reparse points

junctions

sparse files

compression

alternate data streams

USN Journal
```

Доступность функций зависит от прав и версии Windows.

---

# 40. Btrfs

`BtrfsProvider`.

Поддерживать:

```text
filesystem detection

subvolumes

snapshots

reflinks/shared extents where possible

compression metadata
```

В Btrfs snapshots являются разновидностью subvolume, поэтому модель должна разделять обычную директорию, subvolume и snapshot.

---

# 41. ZFS

`ZfsProvider`.

Поддерживать:

```text
datasets

snapshots

compression information

space usage
```

ZFS snapshots должны рассматриваться отдельно от обычных директорий. OpenZFS предоставляет собственную модель snapshot datasets.

---

# 42. Нефункциональные требования

Идентификаторы:

`NFR-*`

## NFR-PERF-001

Приложение должно сохранять отзывчивость UI во время scan.

## NFR-PERF-002

Scanner должен проектироваться для datasets минимум порядка:

```text
5 000 000 filesystem entries
```

без архитектурного ограничения, требующего загрузки всех объектов в UI.

## NFR-PERF-003

Frontend не должен содержать полный массив в несколько миллионов FileEntry, если они не требуются текущему экрану.

## NFR-PERF-004

Для больших результатов использовать:

```text
pagination

virtualization

database queries

aggregation
```

## NFR-PERF-005

Отдельно измерять:

```text
scan throughput

peak RAM

CPU

disk IO

DB write rate

IPC rate

render time
```

---

# 43. Memory Strategy

Запрещено исходить из предположения:

```text
все файлы всегда помещаются в RAM
```

Scanner должен поддерживать:

```text
batch processing

incremental aggregation

database persistence

bounded queues.
```

---

# 44. Ошибки

Ошибки должны иметь структурированный формат:

```text
ErrorCode
Component
Operation
Path optional
Platform
Recoverable
UserMessage
TechnicalMessage
```

UI не должен напрямую показывать пользователю Rust panic или системный stack trace.

---

# 45. Logging

Logging levels:

```text
ERROR
WARN
INFO
DEBUG
TRACE
```

По умолчанию не писать в лог:

- содержимое пользовательских файлов;
- секретные данные;
- полные содержательные данные документов.

Полный путь допускается там, где он необходим для диагностики, но debug logs должны рассматриваться как потенциально конфиденциальные.

---

# 46. Privacy

Все filesystem-анализы выполняются локально.

Без отдельного будущего требования запрещено:

- загружать список файлов;
- загружать имена файлов;
- загружать hashes;
- загружать содержимое документов;
- загружать историю сканирований.

---

# 47. Основные экраны

Предусмотреть:

```text
Home

Disk Overview

Folder Explorer

Treemap

Large Files

Categories

Duplicates

Old Files

Cleaner

Scan History

Compare Scans

Snapshots

Settings
```

---

# 48. Этапы реализации

Разработка выполняется последовательными Stage Gate.

Переход к следующему этапу разрешается только после выполнения критериев завершения текущего этапа.

---

# ЭТАП 0. Project Foundation

## Цель

Создать архитектурный фундамент.

## Реализовать

```text
Rust workspace

Tauri 2

React

TypeScript

SQLite abstraction

Core interfaces

Platform interfaces

logging

error model

configuration

CI skeleton
```

Создать интерфейсы:

```text
FileSystemProvider

FileSystemWatcher

TrashProvider

SnapshotProvider

ScanStore
```

## Результат

Приложение запускается на:

```text
macOS
Windows
Linux
```

и имеет минимальный вызов:

```text
React → Tauri → Rust Core → response
```

## Gate 0

Этап считается завершённым, когда:

| Проверка                  | Обязательна |
| ------------------------- | ----------: |
| сборка macOS              |          да |
| сборка Windows            |          да |
| сборка Linux              |          да |
| Core отделён от UI        |          да |
| CI работает               |          да |
| архитектура зафиксирована |          да |

---

# ЭТАП 1. Scanner Engine

Реализовать:

```text
folder scan

volume scan

recursive traversal

metadata

file sizes

directory aggregation

cancel

progress

errors

batch processing
```

Rust `std::fs::read_dir` предоставляет iterator filesystem entries, но порядок элементов не гарантируется и может различаться между вызовами и платформами. На порядок результатов Scanner полагаться запрещено.

## Gate 1

Обязательные испытания:

```text
10 000 entries
100 000
1 000 000
5 000 000
```

Проверить:

```text
отмену;

permission denied;

symlinks;

hardlinks;

deep path;

удаление файла во время scan;

отключение внешнего диска.
```

---

# ЭТАП 2. Disk Analyzer UI

Реализовать:

```text
Disk Overview

Folder Tree

Large Files

Categories

Search

Filters

Sorting

Treemap

Open

Reveal
```

## Gate 2

Все результаты UI должны соответствовать данным Scanner.

Большие деревья должны использовать virtualization.

UI не должен зависать во время scan.

---

# ЭТАП 3. File Operations

Реализовать:

```text
Trash

Permanent Delete

Multi Delete

Protected Paths

confirmation

file manager integration
```

## Gate 3

Все destructive operations проходят отдельный integration test.

Удаление системных protected paths блокируется политикой безопасности.

---

# ЭТАП 4. Persistence and History

Реализовать:

```text
ScanSession persistence

file index

history

comparison

database migrations

retention
```

## Gate 4

После перезапуска приложения пользователь может открыть предыдущий завершённый scan.

Сравнение двух scan выдаёт воспроизводимый результат.

---

# ЭТАП 5. Realtime Monitoring

Реализовать:

```text
FSEvents

USN Journal

inotify

incremental index update

checkpointing

resync
```

## Gate 5

Изменение filesystem отражается без полного scan, если watcher сохранил непрерывность.

При потере событий приложение обнаруживает рассинхронизацию и требует/запускает resync.

---

# ЭТАП 6. Duplicate Finder

Реализовать:

```text
size grouping

partial fingerprint

full hash

duplicate groups

selection

safe removal
```

## Gate 6

Ни один файл не объявляется точным дубликатом только на основании имени/даты.

---

# ЭТАП 7. Old / Rare Files

Реализовать:

```text
age filters

created

modified

accessed

custom period

size filters
```

## Gate 7

Пользователь всегда видит критерий, по которому файл был отнесён к старым или редко используемым.

---

# ЭТАП 8. Cleaner

Реализовать:

```text
CleanupRule engine

macOS rules

Windows rules

Linux rules

preview

risk classification

cleanup report
```

## Gate 8

Для каждого CleanupRule существуют:

```text
описание;

источник обнаружения;

risk;

test;

platform;

preview.
```

---

# ЭТАП 9. Advanced Filesystems

Реализовать:

```text
APFS

NTFS

Btrfs

ZFS

snapshots

filesystem-specific metrics.
```

## Gate 9

Unsupported filesystem capabilities не должны отображаться пользователю как доступные.

---

# ЭТАП 10. Performance & Stability

Выполнить:

```text
profiling

stress tests

long-running tests

filesystem mutation tests

memory profiling

DB profiling

IPC profiling
```

Обязательно протестировать:

```text
10M+ entries where test infrastructure permits;

long paths;

millions of small files;

very large files;

external drives;

filesystem errors;

drive disconnect;

event overflow;

DB corruption/recovery test.
```

---

# ЭТАП 11. Production Release

Реализовать:

```text
macOS signing

macOS notarization

Windows signing

installers

Linux packages

auto-update strategy

DB migration validation

release CI.
```

---

# 49. Управление документацией

Это обязательная часть архитектуры проекта.

Основной принцип:

> Документы не должны повторять друг друга.

Каждый тип информации имеет только один canonical owner.

---

# 50. Структура документации

```text
/
├── README.md
├── AGENTS.md
├── CHANGELOG.md
│
├── docs/
│   ├── requirements/
│   │   └── SRS.md
│   │
│   ├── architecture/
│   │   └── ARCHITECTURE.md
│   │
│   ├── adr/
│   │   ├── ADR-0001-...
│   │   └── ADR-0002-...
│   │
│   ├── design/
│   │   └── UX_UI_SPEC.md
│   │
│   ├── roadmap/
│   │   └── STAGES.md
│   │
│   ├── testing/
│   │   ├── TEST_STRATEGY.md
│   │   └── PERFORMANCE.md
│   │
│   ├── security/
│   │   └── SECURITY.md
│   │
│   └── development/
│       └── CONTRIBUTING.md
│
├── core/
├── frontend/
├── src-tauri/
└── tests/
```

---

# 51. Матрица владельцев информации

| Информация                        | Единственный первичный источник     |
| --------------------------------- | ----------------------------------- |
| функциональные требования         | `docs/requirements/SRS.md`          |
| нефункциональные требования       | `docs/requirements/SRS.md`          |
| архитектура                       | `docs/architecture/ARCHITECTURE.md` |
| UX/UI behavior                    | `docs/design/UX_UI_SPEC.md`         |
| visual design                     | `docs/design/UX_UI_SPEC.md`         |
| interaction performance budgets   | `docs/design/UX_UI_SPEC.md`         |
| архитектурное решение и причина   | `docs/adr/ADR-*`                    |
| порядок этапов                    | `docs/roadmap/STAGES.md`            |
| текущее состояние этапов          | `docs/roadmap/STAGES.md`            |
| общая стратегия тестирования      | `docs/testing/TEST_STRATEGY.md`     |
| performance methodology           | `docs/testing/PERFORMANCE.md`       |
| security policy                   | `docs/security/SECURITY.md`         |
| правила разработки                | `docs/development/CONTRIBUTING.md`  |
| правила для AI-агентов            | `AGENTS.md`                         |
| пользовательское описание проекта | `README.md`                         |
| изменения опубликованных версий   | `CHANGELOG.md`                      |
| API/IPC структура                 | исходный код / generated contracts  |

---

# 52. README.md

README не должен превращаться в копию ТЗ.

README содержит только:

```text
что это за проект;

основные возможности;

поддерживаемые ОС;

как запустить;

как собрать;

ссылки на документацию.
```

Например:

```text
Requirements → docs/requirements/SRS.md

Architecture → docs/architecture/ARCHITECTURE.md

Development → docs/development/CONTRIBUTING.md
```

---

# 53. AGENTS.md

`AGENTS.md` содержит:

```text
правила работы AI-агентов;

обязательные проверки;

запрещённые действия;

пути к authoritative документации;

правила изменения кода;

правила тестирования.
```

AGENTS.md не должен повторять:

- архитектуру;
- полное ТЗ;
- функциональные требования;
- API;
- roadmap.

Пример:

```text
Before implementation read:

docs/requirements/SRS.md
docs/architecture/ARCHITECTURE.md
docs/design/UX_UI_SPEC.md
docs/roadmap/STAGES.md

Do not duplicate these rules in AGENTS.md.
```

---

# 54. Architecture Document

`ARCHITECTURE.md` описывает текущее состояние системы:

```text
components;

dependencies;

data flow;

platform abstraction;

storage;

IPC;

boundaries.
```

Он не должен объяснять историю принятия решения.

История решения хранится в ADR.

---

# 55. ADR

Architecture Decision Record используется, если принимается решение, которое:

- существенно влияет на архитектуру;
- меняет dependency;
- меняет data model;
- меняет storage;
- меняет API/IPC;
- меняет платформенный подход.

Формат:

```text
ADR-XXXX

Title

Status

Context

Decision

Consequences

Related requirements
```

Пример:

```text
ADR-0001
Use Rust as Scanner Core

Status:
Accepted
```

После принятия ADR актуальное состояние отражается в `ARCHITECTURE.md`.

Сам ADR не редактируется под новую реальность.

Новое решение создаёт новый ADR, который supersedes старый.

---

# 56. Roadmap

`STAGES.md` не должен содержать копию ТЗ.

Использовать:

```text
Stage 1
Status: In Progress

Requirements:
SCAN-001
SCAN-002
SCAN-003

Blocked:
none
```

Допустимые статусы:

```text
PLANNED

READY

IN_PROGRESS

BLOCKED

VALIDATION

DONE
```

---

# 57. Требования должны иметь ID

Каждое требование должно иметь стабильный идентификатор.

Примеры:

```text
SCAN-001

UI-TREE-001

FILE-DELETE-001

WATCH-MAC-001

WATCH-WIN-001

DUP-001

CLEAN-001

APFS-001

NTFS-001

NFR-PERF-001
```

Issue, Pull Request, test и commit могут ссылаться на эти ID.

Необходимо избегать копирования полного текста требования.

---

# 58. Traceability

Должна существовать связь:

```text
Requirement
    ↓
Issue
    ↓
Implementation
    ↓
Test
    ↓
Pull Request
    ↓
Release
```

Пример:

```text
Requirement:
SCAN-008

Issue:
#142

Code:
core/scanner/cancellation.rs

Tests:
scanner_cancel.rs

PR:
#185

Release:
v1.0
```

---

# 59. Issue

Issue должен содержать:

```text
Goal

Requirement IDs

Scope

Dependencies

Acceptance evidence
```

Не копировать несколько страниц из SRS.

Вместо:

```text
Scanner должен...
Scanner должен...
Scanner должен...
```

использовать:

```text
Implements:

SCAN-001
SCAN-002
SCAN-006
```

---

# 60. Pull Request

PR фиксирует:

```text
что изменено;

почему;

какие requirements реализованы;

какие tests добавлены;

какие ADR затронуты;

какие риски.
```

PR не является новым источником требований.

---

# 61. Definition of Ready

Задача может переходить в разработку, если:

| Проверка                               | Требование |
| -------------------------------------- | ---------: |
| существует requirement ID              |         да |
| понятен scope                          |         да |
| понятны зависимости                    |         да |
| определён acceptance criterion         |         да |
| нет нерешённого архитектурного вопроса |         да |
| если вопрос есть — существует ADR      |         да |

---

# 62. Definition of Done

Requirement считается реализованным только когда:

| Проверка                                       | Обязательна |
| ---------------------------------------------- | ----------: |
| код реализован                                 |          да |
| code review выполнен                           |          да |
| unit tests                                     |          да |
| integration tests где применимо                |          да |
| platform tests где применимо                   |          да |
| acceptance criteria пройдены                   |          да |
| документация обновлена                         |          да |
| отсутствует ненужное дублирование документации |          да |
| CI green                                       |          да |

---

# 63. Документирование во время реализации

Документация обновляется в том же PR, что и код.

Запрещено:

```text
сначала реализуем,
когда-нибудь потом поправим документацию.
```

Если изменение затрагивает архитектуру:

```text
ADR
+
Architecture update
+
Code
```

должны находиться в одном logical change.

---

# 64. Generated Contracts

Модели, используемые одновременно Rust и TypeScript, не должны вручную поддерживаться в двух независимых копиях.

Предпочтительно:

```text
Rust type
↓
code generation
↓
TypeScript type
```

или другой утверждённый механизм генерации.

Запрещён вариант:

```text
Rust FileEntry

и вручную

TypeScript FileEntry
```

если отсутствует автоматическая проверка соответствия.

---

# 65. Database Schema

Database schema должен управляться migrations.

Запрещено:

```text
ручное изменение production DB;

неверсионированные изменения schema.
```

Каждая migration имеет номер.

Например:

```text
001_initial.sql

002_scan_history.sql

003_duplicates.sql
```

---

# 66. Testing Strategy

Использовать несколько уровней.

```text
Unit

Integration

Platform integration

UI

Performance

Stress

Regression
```

---

# 67. Unit Tests

Проверять:

```text
aggregation;

classification;

hash logic;

comparison;

cleanup rules;

path policies;

data transformations.
```

---

# 68. Integration Tests

Проверять работу:

```text
Scanner + filesystem

Scanner + SQLite

Watcher + index

Cleaner + filesystem

FileOperation + platform.
```

Для filesystem tests создавать временную тестовую структуру.

---

# 69. Platform Tests

Отдельные CI/jobs:

```text
macOS

Windows

Linux
```

Платформенный код не считается протестированным только потому, что успешно скомпилирован на другой ОС.

---

# 70. Performance Tests

Performance baseline сохраняется документально.

Для каждого benchmark фиксировать:

```text
application version;

OS;

CPU;

RAM;

storage;

filesystem;

file count;

directory count;

duration;

peak RAM;

CPU;

DB size.
```

Без указания окружения запрещено делать вывод:

> Scanner стал быстрее на 20%.

---

# 71. Regression

При обнаружении дефекта:

```text
bug
↓
reproduction
↓
regression test
↓
fix
↓
test remains permanently
```

Если автоматический regression test технически невозможен, причина фиксируется в PR.

---

# 72. CI Pipeline

Минимально:

```text
format

lint

Rust tests

TypeScript tests

build macOS

build Windows

build Linux

integration tests
```

Дополнительно:

```text
dependency audit

security scan

performance regression
```

---

# 73. Release Gates

Release запрещён при:

```text
failed CI;

failed migration test;

known critical destructive-operation bug;

database corruption bug;

scanner crash on supported platform;

unresolved security blocker.
```

---

# 74. Git

Основная ветка:

`main`

`main` должна оставаться собираемой.

Изменения попадают через Pull Request.

Прямое изменение критичных компонентов без проверки не допускается.

---

# 75. Версионирование

Использовать Semantic Versioning:

```text
MAJOR.MINOR.PATCH
```

Пример:

```text
1.0.0
1.1.0
1.1.1
2.0.0
```

---

# 76. CHANGELOG

CHANGELOG содержит только изменения, значимые для версии продукта.

Например:

```text
Added
Duplicate Finder

Fixed
Incorrect NTFS allocated size calculation
```

Не использовать CHANGELOG как журнал ежедневной разработки.

---

# 77. Управление изменением требований

Изменение существующего требования должно происходить через Change Request.

Процесс:

```text
Change proposed
↓
affected requirements determined
↓
architecture impact determined
↓
ADR if necessary
↓
SRS changed
↓
implementation tasks changed
↓
tests updated
```

Источником актуального требования после изменения остаётся только SRS.

---

# 78. Запрет дублирования

При Code Review необходимо проверять не только код, но и документацию.

PR должен быть отклонён, если он создаёт:

```text
вторую копию requirements;

вторую копию architecture description;

ручную копию generated API;

повтор roadmap внутри README;

повтор ТЗ внутри AGENTS.
```

---

# 79. Документ считается ссылкой, а не копией

Правильно:

```text
Scanner requirements:
see SCAN-001–SCAN-010.
```

Неправильно:

```text
SCAN-001 ...
SCAN-002 ...
SCAN-003 ...

[полный повтор требований]
```

---

# 80. Definition of Source of Truth

В случае противоречия документов действует следующий порядок:

```text
SRS
↓
Accepted ADR
↓
Architecture
↓
Generated Contracts / Code Schema
↓
Stage Plan
↓
Issue
↓
PR description
↓
README
```

При обнаружении противоречия документы должны быть синхронизированы.

Нельзя молча выбирать удобную версию требования.

---

# 81. Риски проекта

| Риск                        | Меры                        |
| --------------------------- | --------------------------- |
| миллионы файлов             | streaming, batching, SQLite |
| огромный RAM usage          | bounded memory              |
| UI freeze                   | Core separation             |
| symlink loops               | link policy                 |
| изменение файлов при scan   | error tolerant scanner      |
| permission denied           | skip/report                 |
| watcher lost events         | resync                      |
| NTFS/APFS/Btrfs различия    | platform providers          |
| опасная очистка             | CleanupRule + risk          |
| ошибочное удаление          | Trash by default            |
| несовпадение Rust/TS models | code generation             |
| устаревшая документация     | docs in same PR             |
| дублирование требований     | source ownership matrix     |

---

# 82. Итоговая функциональность версии 1.0

Релиз 1.0 должен включать:

| Функция                         | 1.0 |
| ------------------------------- | --: |
| macOS                           |  ✅ |
| Windows                         |  ✅ |
| Linux                           |  ✅ |
| выбор диска                     |  ✅ |
| выбор папки                     |  ✅ |
| recursive scan                  |  ✅ |
| progress                        |  ✅ |
| cancel                          |  ✅ |
| file size                       |  ✅ |
| directory size                  |  ✅ |
| sort                            |  ✅ |
| large files                     |  ✅ |
| folder tree                     |  ✅ |
| Treemap                         |  ✅ |
| Sunburst                        |  ✅ |
| переключение Sunburst / Treemap |  ✅ |
| categories                      |  ✅ |
| search                          |  ✅ |
| open/reveal                     |  ✅ |
| volume information              |  ✅ |
| millions of files               |  ✅ |
| realtime UI                     |  ✅ |
| delete                          |  ✅ |
| Trash                           |  ✅ |
| duplicates                      |  ✅ |
| history                         |  ✅ |
| scan comparison                 |  ✅ |
| realtime monitoring             |  ✅ |
| FSEvents                        |  ✅ |
| USN Journal                     |  ✅ |
| inotify                         |  ✅ |
| system junk                     |  ✅ |
| caches                          |  ✅ |
| old files                       |  ✅ |
| rarely used analysis            |  ✅ |
| APFS snapshots                  |  ✅ |
| advanced NTFS                   |  ✅ |
| Btrfs snapshots                 |  ✅ |
| ZFS snapshots                   |  ✅ |

---

# 83. Финальный Acceptance Gate

Версия 1.0 считается готовой только при одновременном выполнении условий:

```text
все обязательные requirements имеют DONE;

каждое требование связано с тестом или documented validation;

нет Critical bugs;

нет известных destructive-operation defects;

миграции БД протестированы;

macOS build проходит;

Windows build проходит;

Linux build проходит;

performance baseline зафиксирован;

documentation актуальна;

нет противоречий SRS ↔ Architecture;

нет дублированных canonical requirements;

Release build подписан/упакован согласно платформенным требованиям.
```

---

# 84. Основное правило разработки

При любой новой задаче порядок действий следующий:

```text
1. Найти Requirement ID.

2. Проверить Architecture.

3. Проверить существующие ADR.

4. Если решение архитектурно новое —
   создать ADR.

5. Реализовать код.

6. Добавить тест.

7. Обновить только authoritative document,
   если это действительно необходимо.

8. Не копировать информацию
   в другие документы.

9. В PR указать Requirement IDs
   и evidence.

10. После CI перевести requirement/stage
    в соответствующий статус.
```

Таким образом каждый факт проекта имеет один первичный источник, а вся цепочка разработки остаётся прослеживаемой:

```text
Requirement
   ↓
Architecture / ADR
   ↓
Issue
   ↓
Code
   ↓
Test
   ↓
PR
   ↓
Release
```

Это правило обязательно для разработчиков и AI-агентов.
