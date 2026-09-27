# IMPLEMENTATION PLAN

## Кроссплатформенный анализатор дискового пространства

**Целевые платформы:** macOS / Windows / Linux  
**Backend/Core:** Rust  
**Desktop:** Tauri 2  
**Frontend:** React + TypeScript  
**Хранилище:** SQLite  
**Статус документа:** Implementation Specification

---

# 1. Назначение документа

Настоящий документ определяет **способ реализации** требований, содержащихся в:

`docs/requirements/SRS.md`

Документ отвечает на вопросы:

- какие модули необходимо создать;
- в каком порядке их создавать;
- как они взаимодействуют;
- какие интерфейсы между ними используются;
- какие структуры данных передаются;
- где выполняются вычисления;
- где хранятся данные;
- какие операции выполняются параллельно;
- какие ограничения должны соблюдаться;
- какие тесты необходимо создать;
- какие документы должны обновляться;
- какой результат является доказательством завершения задачи.

Документ **не является вторым источником функциональных требований**.

Если возникает вопрос:

> Что должно делать приложение?

ответ находится в `SRS.md`.

Если вопрос:

> Как это реализуется?

ответ находится в `IMPLEMENTATION_PLAN.md`.

---

# 2. Место документа в Source of Truth

Использовать следующую ответственность документов:

```text
SRS.md
│
│ Что должно работать
│
├───────────────┐
│               │
▼               ▼
ARCHITECTURE   IMPLEMENTATION_PLAN
│               │
│ Что есть      │ Как реализовывать
│               │
└───────┬───────┘
        │
        ▼
      ADR
 Почему принято конкретное решение
```

Статус реализации:

```text
STAGES.md
```

Рабочая задача:

```text
Issue
```

История фактической реализации:

```text
Pull Request
Git commits
CI
```

Запрещено создавать:

```text
DEVLOG.md
PROGRESS.md
CURRENT_WORK.md
TASKS.md
```

если содержащаяся в них информация уже имеется в Issue, PR или `STAGES.md`.

---

# 3. Главный принцип реализации

Core приложения должен оставаться независимым от Tauri и React.

Архитектура:

```text
┌───────────────────────────────────────┐
│              React UI                 │
│                                       │
│ Explorer │ Treemap │ Cleaner │ etc.  │
└───────────────────┬───────────────────┘
                    │
             Generated IPC API
                    │
┌───────────────────▼───────────────────┐
│             Tauri Adapter              │
│                                       │
│ commands                              │
│ channels                              │
│ window lifecycle                      │
└───────────────────┬───────────────────┘
                    │
┌───────────────────▼───────────────────┐
│                Services               │
│                                       │
│ ScanService                           │
│ SearchService                         │
│ HistoryService                        │
│ DuplicateService                      │
│ CleanerService                        │
└───────────────────┬───────────────────┘
                    │
┌───────────────────▼───────────────────┐
│                Core                   │
│                                       │
│ Scanner                               │
│ Analyzer                              │
│ Index                                 │
│ Aggregator                            │
│ Watcher                               │
└───────────────────┬───────────────────┘
                    │
       ┌────────────┼─────────────┐
       ▼            ▼             ▼
     macOS        Windows        Linux
```

Tauri должен быть adapter layer.

Core запрещено импортировать:

```text
tauri
React
JavaScript runtime
browser APIs
```

---

# 4. Структура репозитория

Рекомендуемая структура:

```text
/
├── Cargo.toml
├── package.json
├── README.md
├── AGENTS.md
├── CHANGELOG.md
│
├── apps/
│   └── desktop/
│       ├── src-tauri/
│       └── frontend/
│
├── crates/
│   ├── domain/
│   ├── scanner/
│   ├── analyzer/
│   ├── storage/
│   ├── search/
│   ├── history/
│   ├── duplicates/
│   ├── watcher/
│   ├── cleaner/
│   ├── filesystem/
│   ├── snapshots/
│   ├── platform-common/
│   ├── platform-macos/
│   ├── platform-windows/
│   └── platform-linux/
│
├── tools/
│   ├── benchmark/
│   ├── fixture-generator/
│   └── db-inspector/
│
├── tests/
│   ├── integration/
│   ├── performance/
│   ├── fixtures/
│   └── platform/
│
└── docs/
    ├── requirements/
    │   └── SRS.md
    │
    ├── implementation/
    │   └── IMPLEMENTATION_PLAN.md
    │
    ├── architecture/
    │   └── ARCHITECTURE.md
    │
    ├── adr/
    │
    ├── roadmap/
    │   └── STAGES.md
    │
    ├── testing/
    │   ├── TEST_STRATEGY.md
    │   └── PERFORMANCE.md
    │
    └── security/
        └── SECURITY.md
```

---

# 5. Ответственность Rust crates

## domain

Не содержит бизнес-логики.

Хранит общие модели:

```text
FileEntry
DirectoryAggregate
VolumeInfo
ScanSession
ScanProgress
ScanError
FileCategory
DuplicateGroup
SnapshotInfo
CleanupCandidate
```

Никаких зависимостей от UI.

---

# 6. scanner

Отвечает исключительно за:

```text
обход filesystem;

получение базовой metadata;

управление очередью каталогов;

отмену;

формирование batch;

progress;

обнаружение ошибок.
```

Scanner не должен:

```text
рисовать UI;

искать дубликаты;

удалять файлы;

принимать решения Cleaner;

знать SQLite schema.
```

---

# 7. analyzer

Получает `FileEntry`.

Выполняет:

```text
category classification;

directory aggregation;

Top-N calculations;

statistics;

logical/allocated size aggregation.
```

---

# 8. storage

Единственный слой работы с SQLite.

Запрещены SQL-запросы из:

```text
scanner
frontend
Tauri commands
duplicates
cleaner
```

Они работают через repository interfaces.

Пример:

```text
ScanRepository

EntryRepository

HistoryRepository

HashRepository

WatcherRepository
```

---

# 9. filesystem

Определяет общие интерфейсы:

```text
FileSystemProvider

VolumeProvider

FileOperationProvider

TrashProvider

WatcherProvider

SnapshotProvider
```

---

# 10. platform-common

Содержит только код, действительно общий для нескольких ОС.

Запрещено помещать сюда:

```text
if cfg!(windows) ...
if cfg!(target_os = "macos") ...
```

если это превращает модуль в набор платформенных ветвлений.

Платформенная логика должна находиться в соответствующих crates.

---

# 11. platform-macos

Реализует:

```text
APFS metadata

FSEvents

Finder integration

Trash

permissions

volume discovery

snapshots
```

---

# 12. platform-windows

Реализует:

```text
NTFS metadata

USN Journal

Explorer integration

Recycle Bin

Windows file IDs

reparse points

volume discovery
```

---

# 13. platform-linux

Реализует:

```text
POSIX metadata

inotify

desktop trash specification

mount discovery

Btrfs

ZFS
```

---

# 14. IPC Architecture

Использовать два типа взаимодействия.

## Request / Response

Для коротких операций:

```text
get_volumes
start_scan
cancel_scan
get_scan
get_children
search
move_to_trash
delete
compare_scans
```

Использовать Tauri Commands.

## Streaming

Для:

```text
scan progress;

scan batches;

duplicate progress;

cleaner progress;

comparison progress.
```

использовать IPC Channels.

Не отправлять каждый `FileEntry` отдельным глобальным event.

---

# 15. Генерация контрактов

Rust является источником данных IPC.

Например:

```text
Rust struct
     ↓
contract generator
     ↓
TypeScript interface
```

Frontend не должен вручную создавать копию:

```text
FileEntry.ts
```

если `FileEntry` уже определён в Rust.

CI должен проверять:

```text
generated contracts up-to-date
```

---

# 16. Scanner — детальная архитектура

Scanner реализуется как pipeline:

```text
              StartScan
                  │
                  ▼
          ScanCoordinator
                  │
         validate target
                  │
                  ▼
           DirectoryQueue
                  │
       ┌──────────┼──────────┐
       ▼          ▼          ▼
    Worker 1   Worker 2   Worker N
       │          │          │
       └──────────┼──────────┘
                  ▼
            EntryBatch
                  │
        ┌─────────┴────────┐
        ▼                  ▼
    Aggregator         DB Writer
        │                  │
        └────────┬─────────┘
                 ▼
              Progress
                 │
                 ▼
              Channel
                 │
                 ▼
                UI
```

---

# 17. ScanCoordinator

Один объект управляет одним `ScanSession`.

Ответственность:

```text
создание scan_id;

создание CancellationToken;

создание bounded queues;

запуск workers;

запуск aggregator;

запуск DB writer;

обработка fatal errors;

завершение;

finalization.
```

---

# 18. ScanSession State Machine

Использовать состояния:

```text
CREATED
   │
   ▼
PREPARING
   │
   ▼
SCANNING
   │
   ▼
FINALIZING
   │
   ▼
COMPLETED
```

Альтернативные переходы:

```text
SCANNING
   ├──► CANCELLING ─► CANCELLED
   │
   └──► FAILED
```

Нельзя:

```text
COMPLETED → SCANNING
```

Повторное сканирование создаёт новый `scan_id`.

---

# 19. DirectoryQueue

Очередь должна быть bounded.

Нельзя позволять scanner бесконтрольно накопить несколько миллионов объектов в памяти.

Пример логики:

```text
MAX_PENDING_DIRECTORIES

MAX_ENTRY_BATCHES

MAX_DB_BATCHES
```

Фактические значения определяются performance-тестами.

Они не должны быть разбросаны magic numbers по коду.

---

# 20. Directory Worker

Алгоритм:

```text
получить directory

↓

прочитать entries

↓

для каждого entry:

    получить file type

    получить metadata

    определить symlink

    получить platform metadata

    создать FileEntryDraft

↓

сформировать batch

↓

отправить batch

↓

поставить найденные директории
в DirectoryQueue
```

Стандартный `read_dir` не гарантирует стабильный порядок результатов, поэтому алгоритм не должен зависеть от порядка обхода.

---

# 21. Metadata strategy

Для каждого объекта сначала использовать:

```text
symlink_metadata
```

чтобы не следовать ссылке автоматически.

Затем, если политика scan позволяет:

```text
metadata
```

для target.

Rust `Metadata` предоставляет тип объекта, размер, permissions и timestamps, но часть необходимых свойств зависит от платформы.

---

# 22. Symlink Policy

По умолчанию:

```text
follow_symlinks = false
```

Symlink учитывается как отдельный entry.

Пользовательская настройка может разрешать следование.

При `follow_symlinks=true` Scanner обязан вести набор уже посещённых filesystem identities.

Нельзя использовать только canonical path как единственную защиту.

---

# 23. File identity

Внутренняя модель:

```text
EntryIdentity {
    volume_id,
    platform_file_id?,
    path_fallback
}
```

Unix:

```text
device + inode
```

Windows:

```text
volume identity + file ID
```

Если platform ID недоступен:

```text
path
```

становится fallback.

---

# 24. Ошибки отдельных файлов

Ошибка одного объекта не завершает ScanSession.

Пример:

```text
PermissionDenied
FileDisappeared
InvalidName
MetadataUnavailable
BrokenSymlink
```

должен приводить к:

```text
record ScanError
increment error_count
continue scan
```

Fatal error:

```text
database unavailable;

root inaccessible;

internal invariant violation.
```

может перевести scan в `FAILED`.

---

# 25. Cancellation

Cancellation проверяется:

```text
перед чтением директории;

между batches;

перед metadata-heavy operation;

перед DB transaction.
```

Нажатие Cancel не должно ждать завершения полного обхода текущего диска.

---

# 26. Scan Progress

Не предполагать, что общее число файлов известно заранее.

Основная модель:

```text
ScanProgress {
    files_scanned
    directories_scanned
    bytes_logical_seen
    bytes_allocated_seen
    errors
    elapsed
    current_path?
    phase
}
```

UI должен поддерживать:

```text
indeterminate progress
```

и не показывать фиктивные:

```text
73 %
```

если denominator неизвестен.

---

# 27. Batching

Scanner не отправляет:

```text
1 entry → DB
```

Используется:

```text
Vec<EntryDraft>
```

Например:

```text
EntryBatch
```

Размер batch является конфигурацией performance layer.

Проверяются варианты:

```text
100
500
1000
5000
10000
```

Выбирается на основании benchmark.

---

# 28. Directory Aggregator

Aggregator должен позволять вычислять размер директорий без повторного полного прохода.

Для активной директории хранить:

```text
direct_file_size
direct_allocated_size
file_count
child_count
pending_children
```

После завершения дочернего каталога его итог:

```text
child aggregate
```

передаётся родителю.

Принцип:

```text
file
 ↓
directory

child directory
 ↓
parent directory
```

После `pending_children == 0`:

```text
DirectoryAggregate finalized
```

---

# 29. Память Scanner

Нельзя держать в памяти полное дерево из миллионов объектов только для отображения.

В памяти находятся:

```text
active directories;

bounded queues;

current batch;

Top-N;

small caches;

working aggregates.
```

Остальные данные находятся в SQLite.

---

# 30. SQLite write architecture

Использовать отдельный:

```text
DbWriter
```

Scanner workers не должны одновременно напрямую выполнять SQL INSERT.

Pipeline:

```text
workers
   │
   ▼
bounded channel
   │
   ▼
DbWriter
   │
   ▼
batched transaction
```

SQLite WAL позволяет чтениям работать параллельно с записью, однако обычный WAL всё равно имеет одного writer одновременно. Поэтому единый controlled writer хорошо соответствует архитектуре приложения.

---

# 31. WAL

При запуске DB выполнить необходимые pragmas после отдельного performance/security решения.

Использование WAL должно учитывать:

```text
checkpoint;

WAL growth;

application shutdown;

DB recovery.
```

Нельзя считать WAL режимом, автоматически решающим все проблемы конкурентности.

---

# 32. Базовая схема БД

## volumes

```text
id
platform
device_id
name
mount_point
filesystem
total_bytes
created_at
last_seen_at
```

---

# 33. scan_sessions

```text
id
volume_id
root_entry
state
started_at
finished_at
scanner_version

files_count
directories_count

logical_size
allocated_size

errors_count
skipped_count
```

---

# 34. entries

Хранит файловые объекты.

```text
id
volume_id

platform_file_id

parent_id

name
path_hash

kind

created_at
modified_at
accessed_at

logical_size
allocated_size

category

flags
```

Полные paths не обязательно хранить повторно во всех производных таблицах.

---

# 35. entry_versions

Исторические изменения объекта:

```text
entry_id

scan_id_from
scan_id_to

parent_id
name

logical_size
allocated_size

modified_at
category
```

Новую version создавать только при изменении значимых данных.

Это снижает дублирование между последовательными scan.

---

# 36. directory_aggregates

```text
scan_id
entry_id

files_count
directories_count

logical_size
allocated_size
```

---

# 37. scan_errors

```text
scan_id
entry_id?
path?
code
operation
recoverable
created_at
```

---

# 38. watcher_checkpoints

```text
volume_id
provider

checkpoint_data

created_at
valid
```

`checkpoint_data` платформенный.

---

# 39. content_hashes

```text
entry_id

file_size
modified_at

algorithm
partial_hash
full_hash

verified_at
```

При изменении size/mtime fingerprint считается недействительным.

---

# 40. snapshots

```text
id
volume_id

provider
native_id
name

created_at

logical_size?
exclusive_size?
metadata
```

---

# 41. Database migrations

Использовать только versioned migrations.

При запуске:

```text
open DB
 ↓
read schema version
 ↓
run required migrations
 ↓
verify
 ↓
start application
```

Миграция должна иметь:

```text
up migration;

test;

expected resulting version.
```

---

# 42. Индексы

Минимально исследовать индексы:

```text
entries(parent_id)

entries(volume_id)

entries(platform_file_id)

entry_versions(entry_id)

directory_aggregates(scan_id, entry_id)

content_hashes(file_size)

scan_errors(scan_id)
```

Индексы добавлять на основании query plan и benchmark, а не «на всякий случай».

---

# 43. Search Engine

Поиск не должен читать filesystem.

Источник:

```text
SQLite index
```

Запрос:

```text
SearchRequest {
    text
    root?
    category?
    extension?
    min_size?
    max_size?
    sort
    page
}
```

Ответ:

```text
SearchPage {
    items
    cursor
    has_more
}
```

---

# 44. Pagination

Не использовать:

```text
SELECT * FROM entries
```

для UI.

Использовать:

```text
limit/cursor
```

или keyset pagination.

Особенно для:

```text
Large Files
Search
Folder Tree
Duplicates
Old Files
```

---

# 45. Folder Explorer

При раскрытии директории:

```text
UI
 ↓
get_children(directory_id)
 ↓
Storage
 ↓
page
 ↓
UI
```

Frontend не получает всё дерево при открытии scan.

---

# 46. UI Virtualization

Обязательно для:

```text
Folder Explorer

Large Files

Search results

Duplicates

Cleaner candidates
```

Количество DOM-элементов должно зависеть преимущественно от viewport, а не от количества строк в БД.

---

# 47. Frontend state

Разделить:

## UI state

```text
selected item
expanded folders
active filters
active tab
dialogs
```

## Domain data

```text
scan
children
search result
duplicates
history
```

Нельзя помещать:

```text
5M FileEntry
```

в глобальный frontend store.

---

# 48. Treemap

Treemap получает не полное дерево, а:

```text
get_treemap(directory_id, depth, max_nodes)
```

Core возвращает:

```text
TreemapNode {
    id
    name
    size
    category
    kind
}
```

Мелкие элементы агрегировать:

```text
Other
```

---

# 49. File Categories

Создать:

```text
CategoryClassifier
```

Классификация должна быть data-driven.

Пример:

```text
categories.toml
```

или compiled configuration.

Правила:

```text
extension → category
```

не должны быть размазаны по frontend.

---

# 50. File Operations

Все destructive operations проходят через:

```text
FileOperationService
```

Ни Scanner, ни UI не удаляют файлы напрямую.

---

# 51. Delete pipeline

```text
User selection
      ↓
Resolve entries
      ↓
ProtectedPathPolicy
      ↓
Re-read metadata
      ↓
Preview
      ↓
User confirmation
      ↓
FileOperationProvider
      ↓
Result
      ↓
Index update
```

---

# 52. TOCTOU protection

Перед удалением повторно проверить объект.

Например:

```text
expected identity
expected path

vs

current identity
current path
```

Если объект изменился:

```text
operation cancelled
```

и пользователь получает предупреждение.

---

# 53. Trash

Основная операция:

```text
move_to_trash()
```

Платформенные adapters:

```text
macOS
Windows
Linux
```

Permanent Delete выполняется отдельным API.

---

# 54. ProtectedPathPolicy

Решение должно использовать:

```text
canonical/normalized path;

volume root;

platform protected locations;

special filesystem objects;

mount information.
```

Не использовать простой:

```text
path.starts_with(...)
```

как единственную защиту.

---

# 55. History

`HistoryService` предоставляет:

```text
list_scans

get_scan

delete_history

compare
```

Удаление истории не удаляет пользовательские файлы.

---

# 56. Compare Engine

Алгоритм:

```text
Scan A
  +
Scan B
  ↓
identity matching
  ↓
Added
Removed
Modified
Moved/Renamed
Unchanged
```

Сопоставление:

```text
platform_file_id
```

если доступно.

Fallback:

```text
normalized path
```

---

# 57. Watcher architecture

Общий поток:

```text
Native filesystem watcher
          ↓
Platform event
          ↓
Normalize
          ↓
FsChange
          ↓
Coalescer
          ↓
IndexUpdater
          ↓
Database
          ↓
UI
```

---

# 58. Нормализованное событие

```text
FsChange {
    type

    path
    old_path?

    identity?

    timestamp

    native_sequence?
}
```

Типы:

```text
Created
Modified
Removed
Renamed
MetadataChanged
Unknown
```

---

# 59. Event Coalescing

Один файл может породить множество событий за короткое время.

Например:

```text
create
modify
modify
modify
rename
```

Необходимо coalescing окно.

Результат может стать:

```text
Created(final_path)
```

---

# 60. Watcher consistency

Watcher не считается абсолютным источником истины.

При:

```text
overflow;

lost sequence;

invalid checkpoint;

journal reset;
```

индекс получает:

```text
STALE
```

после чего выполняется:

```text
subtree rescan
```

или:

```text
full rescan.
```

---

# 61. macOS watcher

Provider:

```text
MacOsWatcher
```

Использует FSEvents.

Checkpoint:

```text
event ID
```

После запуска необходимо валидировать возможность продолжения с сохранённого checkpoint.

---

# 62. Windows watcher

Основной provider:

```text
UsnWatcher
```

Хранить:

```text
journal identity
last USN
volume identity
```

При смене journal:

```text
checkpoint invalid
```

и запускается resync.

Fallback provider определяется отдельно.

---

# 63. Linux watcher

Основной:

```text
InotifyWatcher
```

Необходимо поддерживать:

```text
watch registry;

directory added;

directory removed;

watch limit;

queue overflow.
```

Новая директория должна получать watch.

---

# 64. Duplicate Finder

Pipeline:

```text
Indexed files
      ↓
Group by logical size
      ↓
Remove unique-size groups
      ↓
Partial fingerprint
      ↓
Group candidates
      ↓
Full hash
      ↓
Group candidates
      ↓
Optional byte comparison
      ↓
Confirmed duplicates
```

---

# 65. Partial fingerprint

Читать ограниченные части файла.

Например:

```text
beginning

middle

end
```

Параметры являются частью версии алгоритма.

---

# 66. Full hash

Для оставшихся кандидатов рассчитывать полный content hash.

Hashing относится к CPU/IO-heavy работе и выполняется отдельным worker pool.

Scanner pool и Duplicate pool не должны быть одним глобальным бесконтрольным пулом.

---

# 67. Exact confirmation

Чтобы категория:

```text
Confirmed Duplicate
```

не основывалась исключительно на вероятности hash collision, последний уровень может выполнять побайтовое сравнение содержимого внутри уже крайне малого hash-group.

---

# 68. Duplicate cache

Повторно не считать hash, если совпадают:

```text
file identity
size
modified_at
```

и watcher не сообщил изменение файла.

---

# 69. Duplicate deletion

Никогда автоматически не удалять все элементы duplicate group.

Минимум один экземпляр должен оставаться выбранным пользователем.

Перед удалением повторно проверяется fingerprint/metadata.

---

# 70. Old Files

Запрос выполняется через индекс.

Например:

```text
modified_at < threshold
```

Не нужен новый filesystem scan.

---

# 71. Rarely Used

Создать:

```text
UsageEvidence
```

Каждый результат должен содержать:

```text
criterion

timestamp

reliability
```

Например:

```text
criterion:
LAST_MODIFIED

reliability:
HIGH
```

или:

```text
LAST_ACCESS

reliability:
PLATFORM_DEPENDENT
```

---

# 72. Cleaner architecture

Cleaner не сканирует «что угодно».

Он запускает только зарегистрированные:

```text
CleanupRule
```

Registry:

```text
macOS rules
Windows rules
Linux rules
```

---

# 73. Cleanup rule lifecycle

```text
Detect
 ↓
Candidate
 ↓
Preview
 ↓
Validate
 ↓
Confirm
 ↓
Execute
 ↓
Report
```

Ни один rule не должен обходить preview layer.

---

# 74. CleanupCandidate

```text
id

rule_id

path

application?

estimated_size

risk

reason

selected
```

---

# 75. Cleaner safety

Rule обязан явно иметь:

```text
risk

protected patterns

required permissions

supports_trash

supports_permanent_delete
```

По умолчанию:

```text
Trash
```

если это технически допустимо.

---

# 76. Cleaner rule tests

У каждого правила:

```text
positive fixture

negative fixture

protected fixture

edge case fixture
```

Пример:

```text
BrowserCacheRule
```

должен доказать, что не захватывает browser profile documents.

---

# 77. Snapshot Provider

Единый API:

```text
list_snapshots(volume)

get_snapshot_info(id)

get_snapshot_usage(id)
```

Создание и удаление snapshots **не входит автоматически** в область задачи.

Если требуется управление snapshots, для него создаются отдельные SRS requirements.

---

# 78. APFS Provider

Первый уровень:

```text
detect APFS

containers

volumes

snapshots

available metadata
```

Второй:

```text
space relationships

clones

shared storage
```

если platform API позволяет достоверно получить данные.

---

# 79. NTFS Provider

Реализовать отдельными capability modules:

```text
File ID

Hard Links

Reparse Points

Junctions

Sparse Files

Compression

Alternate Streams

USN
```

Не делать один гигантский:

```text
ntfs.rs
```

---

# 80. Linux filesystem providers

```text
linux/
├── common/
├── ext/
├── btrfs/
└── zfs/
```

Btrfs/ZFS functionality включается только после detection соответствующей filesystem.

---

# 81. Capability Model

Frontend не должен угадывать возможности ОС.

Core возвращает:

```text
Capabilities {
    trash
    permanent_delete

    watcher

    snapshots

    filesystem_details

    allocated_size

    last_access_reliable

    duplicate_hashing
}
```

UI строится на основании capabilities.

---

# 82. Performance tooling

Создать отдельную утилиту:

```text
tools/fixture-generator
```

Она должна генерировать искусственные filesystem datasets.

Например:

```text
fixture-generator
--files 1000000
--directories 100000
--depth 20
--file-size 1024
```

---

# 83. Обязательные benchmark datasets

```text
P10K

100 000 entries

P1M

1 000 000 entries

P5M

5 000 000 entries

P10M

10 000 000 entries
```

---

# 84. Специализированные datasets

```text
DEEP

очень глубокие директории


WIDE

одна директория
с огромным количеством детей


SMALL

миллионы маленьких файлов


LARGE

несколько очень больших файлов


SYMLINK

symlink loops


ERROR

permission failures


MUTATING

filesystem изменяется
во время scan
```

---

# 85. Измерения benchmark

Каждый запуск сохраняет:

```text
version

git commit

OS

filesystem

CPU

RAM

storage

entries

duration

entries/sec

peak RSS

CPU average

DB size

DB write throughput
```

---

# 86. Performance regressions

CI не должен сравнивать random developer laptops.

Performance baseline запускается в контролируемом окружении.

Например:

```text
baseline
↓

current

↓

difference
```

Порог регрессии устанавливается после накопления baseline.

---

# 87. Логирование

Использовать structured logs.

Пример fields:

```text
timestamp

level

component

operation

scan_id?

entry_id?

error_code?

duration?
```

Не логировать содержимое файлов.

---

# 88. Correlation IDs

Длительные операции получают:

```text
operation_id
```

Например:

```text
scan_id

duplicate_job_id

cleanup_job_id

compare_job_id
```

Он используется в:

```text
logs
errors
progress
tests
```

---

# 89. Ошибки UI

Core возвращает:

```text
AppError {
    code

    user_message_key

    technical_details?

    recoverable

    action?
}
```

UI отвечает за локализованный текст.

---

# 90. ЭТАП 0 — Foundation

## Implementation tasks

### IMP-0-001

Создать Cargo workspace.

### IMP-0-002

Создать frontend workspace.

### IMP-0-003

Создать минимальное Tauri приложение.

### IMP-0-004

Создать domain crate.

### IMP-0-005

Создать platform traits.

### IMP-0-006

Создать storage interface.

### IMP-0-007

Создать structured logging.

### IMP-0-008

Создать error model.

### IMP-0-009

Создать IPC generation pipeline.

### IMP-0-010

Создать CI matrix:

```text
macOS

Windows

Linux
```

### IMP-0-011

Создать migration runner.

### IMP-0-012

Создать fixture-generator skeleton.

## Результат

```text
React
 ↓
Tauri command
 ↓
Rust service
 ↓
typed response
```

работает на трёх ОС.

## Документы

Создать:

```text
ADR — Rust/Tauri architecture

ADR — IPC contract generation

ARCHITECTURE initial version

STAGES status
```

---

# 91. ЭТАП 1 — Scanner

## Порядок

```text
1. Volume enumeration

2. ScanSession

3. DirectoryQueue

4. Single worker

5. Metadata

6. Batch

7. Aggregator

8. DbWriter

9. Cancellation

10. Progress

11. Multiple workers

12. Platform metadata

13. Benchmarks
```

Многопоточность добавлять **после корректной однопоточной реализации**.

---

# 92. Scanner Gate

Обязательно доказать:

```text
correct counts;

correct aggregate size;

no symlink loops;

bounded memory;

cancel works;

permission error doesn't stop scan;

DB remains valid;

app restart doesn't corrupt completed scans.
```

---

# 93. ЭТАП 2 — Analyzer UI

Порядок:

```text
Home

↓

Volumes

↓

Start scan

↓

Progress

↓

Overview

↓

Folder Explorer

↓

Large Files

↓

Categories

↓

Search

↓

Treemap
```

Не начинать Treemap до стабильного query API Folder Explorer.

---

# 94. ЭТАП 3 — File Operations

Порядок:

```text
Open

Reveal

Trash single file

Trash directory

Multi-select

ProtectedPathPolicy

Permanent delete

Index reconciliation
```

Permanent Delete реализуется последним.

---

# 95. ЭТАП 4 — History

Порядок:

```text
schema evolution

↓

versioned entries

↓

multiple scans

↓

history screen

↓

comparison engine

↓

retention
```

---

# 96. ЭТАП 5 — Watchers

Реализовывать отдельно:

```text
macOS branch

Windows branch

Linux branch
```

после чего нормализовать native events в общий `FsChange`.

Не пытаться сначала создать абстракцию, не протестировав особенности реальных watchers.

---

# 97. ЭТАП 6 — Duplicates

Порядок:

```text
candidate query

↓

size groups

↓

partial fingerprint

↓

full hash

↓

verification

↓

UI groups

↓

safe removal
```

---

# 98. ЭТАП 7 — Old / Rare Files

Порядок:

```text
query

↓

age model

↓

reliability model

↓

filters

↓

UI

↓

file operations integration
```

---

# 99. ЭТАП 8 — Cleaner

Начинать с **одного безопасного CleanupRule на каждую ОС**.

Не реализовывать сразу десятки heuristics.

Процесс:

```text
Rule Engine

↓

Preview API

↓

1 macOS rule
1 Windows rule
1 Linux rule

↓

security tests

↓

UI

↓

расширение catalog
```

---

# 100. ЭТАП 9 — Advanced Filesystems

Каждый provider реализовывать отдельной вертикалью.

Например:

```text
APFS detection
↓

APFS UI
↓

APFS tests
↓

APFS Gate

----------------

NTFS detection
↓

NTFS details
↓

NTFS tests
↓

NTFS Gate
```

Не объединять четыре filesystem в одну mega-task.

---

# 101. ЭТАП 10 — Hardening

До этого момента performance tests работают постоянно.

Stage 10 предназначен не для первой оптимизации, а для системного hardening:

```text
profiling;

stress;

recovery;

fault injection;

DB corruption;

filesystem mutation;

memory leaks;

long-running scan;

suspend/resume;

disk disconnect.
```

---

# 102. Fault Injection

Необходимо иметь возможность тестово симулировать:

```text
PermissionDenied

DiskFull

DatabaseBusy

ReadFailure

FileDisappeared

VolumeDisconnected

WatcherOverflow

HashReadFailure
```

Без реального повреждения машины разработчика.

---

# 103. ЭТАП 11 — Release

Отдельные release pipelines:

```text
macOS
Windows
Linux
```

Общий release orchestrator проверяет:

```text
version

migrations

tests

signatures

artifacts

checksums

changelog
```

---

# 104. Документирование каждой реализации

У каждой задачи существует цепочка:

```text
Requirement ID

↓

Implementation task ID

↓

Issue

↓

Code

↓

Test

↓

PR
```

Пример:

```text
SCAN-008

↓

IMP-1-009

↓

Issue #123

↓

scanner/cancellation.rs

↓

cancel_scan_test.rs

↓

PR #145
```

---

# 105. Issue Template

Каждый Issue:

```text
## Goal

Коротко.


## Requirements

SCAN-...


## Implementation tasks

IMP-...


## Scope

Что входит.


## Out of scope

Что не входит.


## Dependencies

...


## Acceptance evidence

Какими тестами
доказывается готовность.
```

Не вставлять полный SRS requirement.

---

# 106. Pull Request Template

```text
## Requirements

SCAN-...


## Implementation

IMP-...


## Changes

...


## Tests

...


## Documentation

Updated:
...


## Architecture

ADR required:
YES / NO


## Risks

...


## Evidence

CI / benchmark / screenshots
```

---

# 107. Что именно обновлять в документации

Если изменилось:

### Требование

```text
SRS.md
```

### Реальный компонент системы

```text
ARCHITECTURE.md
```

### Способ реализации

```text
IMPLEMENTATION_PLAN.md
```

### Причина архитектурного решения

```text
ADR
```

### Статус этапа

```text
STAGES.md
```

### Пользовательская возможность опубликованной версии

```text
CHANGELOG.md
```

---

# 108. Что не обновлять

Если изменился только внутренний код и:

```text
requirements unchanged;

architecture unchanged;

implementation strategy unchanged;
```

создавать изменение документации только ради изменения документации не требуется.

История уже находится в:

```text
Git + PR.
```

---

# 109. Stage status

В `STAGES.md` хранить только уровень этапа.

Например:

```text
Stage 1 — Scanner

Status: IN_PROGRESS

Requirements:
SCAN-001...SCAN-010

Completed gates:
6 / 10

Blockers:
SCAN-ALLOCATED-SIZE-WINDOWS
```

Не перечислять там все commits и файлы.

---

# 110. Автоматическая проверка документации

CI должен проверять минимум:

```text
broken internal links;

duplicate requirement IDs;

unknown requirement references;

unknown ADR references;

generated contracts changed;

migration numbering;

format.
```

---

# 111. Requirement traceability checker

Желательно создать:

```text
tools/traceability
```

Он читает metadata Issue/тестов или локальные manifest-файлы и проверяет:

```text
существует ли Requirement ID;

существует ли test reference;

нет ли orphan requirement.
```

---

# 112. Никакого ручного дублирования API

Если Rust API изменился:

```text
cargo generate-contracts
```

или аналогичная команда должна пересоздать frontend contract.

CI запускает генератор повторно.

Если появляется diff:

```text
FAIL
```

То есть разработчик не сможет забыть обновить TypeScript API.

---

# 113. Тестовая пирамида

Для каждого модуля:

```text
           UI E2E
             ▲
       Platform tests
             ▲
      Integration tests
             ▲
          Unit tests
```

Большинство проверок должно находиться ниже UI.

---

# 114. Scanner Unit Tests

Проверить:

```text
state transitions;

batch handling;

aggregation;

cancellation;

error classification;

category classification.
```

---

# 115. Scanner Integration Tests

Fixture:

```text
root/
├── a/
│   ├── 1.bin
│   └── b/
│       └── 2.bin
└── link
```

Проверить:

```text
counts;

sizes;

parent relations;

symlink handling;

errors.
```

---

# 116. Platform Tests

Проводятся на реальных:

```text
APFS

NTFS

Linux filesystems
```

Mock не заменяет platform test.

---

# 117. Destructive Test Isolation

Cleaner/Delete tests запрещено выполнять на произвольных user paths.

Каждый тест получает:

```text
temporary isolated test root
```

FileOperationService в test mode запрещает работать за пределами test root.

---

# 118. Database Recovery Tests

Проверить:

```text
cancel during batch;

process terminated during scan;

unfinished ScanSession;

WAL recovery;

migration interrupted;

unsupported future schema.
```

---

# 119. Application startup recovery

При запуске:

```text
find RUNNING scans
```

оставшиеся после abnormal shutdown.

Они не должны автоматически считаться завершёнными.

Статус переводится:

```text
INTERRUPTED
```

или эквивалентное состояние.

---

# 120. Clean shutdown

Порядок:

```text
stop accepting jobs

↓

cancel/flush operations

↓

flush DB writer

↓

save watcher checkpoints

↓

checkpoint DB if needed

↓

shutdown Tauri
```

---

# 121. Definition of Done — Implementation Task

`IMP-*` считается DONE, когда:

```text
implementation completed;

unit tests passed;

integration tests passed if applicable;

platform test passed if applicable;

no new compiler/lint warnings;

documentation owner updated if needed;

generated contracts updated;

CI green;

Requirement trace exists.
```

---

# 122. Definition of Done — Stage

Stage считается DONE только если:

```text
все обязательные IMP tasks DONE;

все связанные requirements validated;

Gate tests green;

performance baseline created;

known limitations documented;

STAGES.md updated;

Architecture matches actual code.
```

---

# 123. Запрет на архитектуру «на будущее»

Не создавать абстракции без существующей потребности.

Например, запрещено заранее создавать:

```text
CloudScanner

RemoteScanner

AIAnalyzer
```

если их нет в SRS.

Но точки расширения должны сохранять separation of concerns.

---

# 124. Зависимости

Добавление новой runtime dependency требует проверки:

```text
зачем она нужна;

license;

maintenance status;

platform support;

binary size impact;

security;
```

Критические зависимости фиксируются ADR.

---

# 125. Безопасность данных пользователя

Core никогда не читает содержимое файла, если операция этого не требует.

Обычный scan читает только:

```text
directory entries;

metadata.
```

Содержимое читается только для:

```text
duplicate hashing;

explicit analysis requiring content.
```

Cleaner не должен анализировать содержимое пользовательских документов.

---

# 126. Привилегии

Приложение должно работать с минимально необходимыми правами.

Повышение privileges:

```text
только для конкретной операции;

только после действия пользователя;

не сохранять постоянно без необходимости.
```

Недоступный каталог не является причиной требовать admin/root для всего приложения.

---

# 127. Capability degradation

Если приложение не может прочитать часть диска:

```text
Scan result
```

помечается:

```text
PARTIAL
```

и отображаются:

```text
unreadable directories count;

errors;

permission guidance.
```

Нельзя показывать результат как полный.

---

# 128. Итоговый технический поток

Полный стандартный пользовательский сценарий:

```text
Application Start
        │
        ▼
Load Config
        │
        ▼
Run DB Migration
        │
        ▼
Detect Platform
        │
        ▼
Create Capabilities
        │
        ▼
Enumerate Volumes
        │
        ▼
      HOME
        │
        ▼
User chooses volume
        │
        ▼
Create ScanSession
        │
        ▼
Scanner Pipeline
        │
        ├────► DB Writer
        │
        ├────► Aggregator
        │
        └────► Progress Channel
                      │
                      ▼
                     UI
                      │
                      ▼
                Scan Complete
                      │
          ┌───────────┼────────────┐
          ▼           ▼            ▼
       Explorer     Treemap      Search
          │
          ▼
     File actions
          │
          ▼
      Index update
```

После включения watcher:

```text
Native FS
   │
   ▼
Watcher
   │
   ▼
FsChange
   │
   ▼
IndexUpdater
   │
   ▼
SQLite
   │
   ▼
UI refresh
```

---

# 129. Принцип готовности проекта 1.0

Версия 1.0 считается реализованной не потому, что:

```text
кнопки существуют
```

а потому, что существует доказуемая цепочка:

```text
Requirement

↓

Implementation task

↓

Code

↓

Automated Test / documented validation

↓

CI Evidence

↓

Release Artifact
```

для каждого обязательного требования.

---

# 130. Главное правило реализации

При начале любой работы разработчик или AI-agent обязан выполнить:

```text
1. Найти Requirement ID.

2. Найти Stage.

3. Найти/создать IMP task.

4. Проверить ARCHITECTURE.

5. Проверить ADR.

6. Определить затрагиваемые modules.

7. Реализовать минимальное изменение.

8. Создать или обновить tests.

9. Выполнить validation.

10. Обновить только canonical documentation.

11. Создать PR с traceability.

12. После CI обновить Stage status.
```

Ни код, ни документ не должны становиться вторым независимым источником тех же требований.

---

# 131. Visual Fidelity Pass — аудит UI-контролов

Проверка от 2026-09-27 относится только к визуальной доводке существующего
desktop-интерфейса. AppShell, навигация, scanner, модель файловой системы,
Column Browser, Sunburst и Treemap не перепроектировались.

| Область | Результат аудита и реализация |
| --- | --- |
| Design tokens | Размеры, радиусы, отступы, цвета, состояния, focus ring, motion и checkbox собраны в `apps/desktop/frontend/src/ui/tokens.css`. Compact/default/search/primary имеют высоты 32/38/44/56 px. |
| Input и Path Input | Общие `TextField` и `.ui-input`; hover, focus, disabled, invalid и placeholder используют semantic tokens. Поле пути и соседняя кнопка имеют согласованную default-высоту. |
| Search | `SearchField` объединяет search semantics, собственные search/clear icons и theme surface. Сохраняется styled submit-кнопка, потому что поиск выполняется явным IPC-запросом; `Cmd+F`/`Ctrl+F` и focus сохраняются. |
| Select и Popover | Native `<select>` удалён из продуктовых экранов. Controlled `SelectControl` состоит из combobox trigger и общего popover/listbox surface; options имеют selected/active/disabled states. Поддерживаются Enter, Space, Arrow Up/Down, Home, End, Esc и Tab, `aria-expanded`, `aria-controls`, `aria-activedescendant`, `role=listbox/option`. |
| Checkbox | Все экранные checkbox проходят через `Checkbox`; размер 18 px, собственные checked/hover/focus/disabled states. |
| Buttons | Обычные действия используют общие primary/secondary/ghost/danger/disclosure variants и semantic states. `Breadcrumb`/`BreadcrumbItem` вынесены в UI layer. Специализированные sidebar, treemap и sunburst buttons сохраняют нативную button-семантику и собственную геометрию, но используют те же tokens и видимый focus. |
| Segmented controls | Режимы результатов и Treemap/Sunburst используют один `SegmentedControl` с `aria-pressed`; полная высота — 36 px. |
| Typography и numbers | Системный sans-serif сохранён; control text — 14 px. Двоичные размеры округляются до одной десятичной цифры, используют `КиБ/МиБ/ГиБ` с неразрывным пробелом, tabular numerals и правое выравнивание в строках. |
| Sidebar volumes | Тома используют rich row высотой 64 px: имя, доступный и общий объём, индикатор заполнения. Одноимённые системные тома различаются компактным mount point (`/`, `Data`); полный путь остаётся в accessible name и tooltip. |
| File rows и scrollbars | Column Browser использует колонки 256 px, строки 50 px и file/folder icons 20 px; hover, selected, active и keyboard focus различимы. Scrollbars получают неброскую tokenized стилизацию там, где её поддерживает WebView. |
| Bottom Action Bar | `SelectionActionBar` имеет минимальную высоту 64 px, использует общие button variants, tokenized surface/border и стабильные disabled states. |

Автоматические ограничения находятся в `ui/tokens.test.ts` и
`ui/primitives.test.tsx`: они запрещают raw colors вне token source, проверяют
контраст и состояния, не допускают raw select/checkbox/input
в рабочих экранах, а также проверяют доступные имена и семантику primitives.

Screenshot evidence:

```text
docs/evidence/ui-form-controls-polish/01-selected-target.png
docs/evidence/ui-form-controls-polish/02-structure-result.png
docs/evidence/ui-form-controls-polish/03-nested-directory.png
docs/evidence/ui-form-controls-polish/04-selection-review.png
docs/evidence/ui-form-controls-polish/05-large-files-controls.png
docs/evidence/ui-form-controls-polish/06-search-controls.png
docs/evidence/ui-form-controls-polish/07-custom-select-popup.png
docs/evidence/ui-form-controls-polish/08-volumes-sidebar.png
```

Осознанно сохранённые различия с reference: продуктовые названия и состав
действий Local Expert Disk, отсутствие коммерческого блока MacCleaner,
структура уже принятого AppShell и иная геометрия собственных визуализаций.
Scanner, storage, filesystem, IPC, scan lifecycle и модели Sunburst/Treemap
этим этапом не изменяются.
