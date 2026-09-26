# ADR-0003 — Однопоточный scanner

Статус: принято для первого инкремента Stage 1 (Implementation Plan §16–29, §91–92).

Scanner получает filesystem provider и sink interface, не знает SQLite/Tauri.
Один фоновый worker выполняет обход и синхронную запись batch: это обеспечивает
backpressure без промежуточного накопления. Очередь каталогов хранится в SQLite;
в памяти один directory iterator и не более 256 записей/ошибок. Значение batch —
начальная настройка, не результат benchmark. Несколько workers добавляются после gate.

Результаты содержат отдельные entries (включая ссылки), родительские связи и
агрегаты каталогов. Агрегаты финализируются после обработки дочерних каталогов.
Размер — сумма logical size обычных файлов, hard links пока считаются по путям;
allocated/unique physical size ещё не доступны и не подменяются logical size.
Следование symlinks и Windows reparse points отключено. Изменение каталога между
metadata и read_dir может дать неточный snapshot; результат не является атомарным.

В IPC все размеры, счётчики и IDs — десятичные строки. В БД значения ограничены
signed 64-bit INTEGER; переполнение считается ошибкой. Внутренние пути — native
BLOB (Unix bytes / Windows UTF-16LE); lossy display path никогда не используется
для повторного открытия вложенных файлов. Ввод корня пока абсолютный Unicode path.

sysinfo с только disk feature нужен для кроссплатформенного перечисления mount points
и ёмкости, а не чтения процессов; MIT, поддерживает три целевые ОС. Нативные детали
ФС и platform file IDs вводятся отдельно. Источник: https://docs.rs/sysinfo/latest/sysinfo/struct.Disks.html

OS file lock (std::fs::File::try_lock) защищает собственную базу от второго экземпляра
ScanService. Только владелец выполняет startup recovery, переводя активные scans в
interrupted. Отмена кооперативная; зависший системный filesystem call не прерывается.
Shutdown запрещает новые jobs, отменяет и дожидается worker. Содержимое файлов не читается.
