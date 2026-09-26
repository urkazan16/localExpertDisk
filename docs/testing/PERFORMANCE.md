# Методика UI performance gate

Значения из `docs/design/UX_UI_SPEC.md` — UX-targets, а не допустимое время
WebDriver-команды. Измерения выполняются внутри WebView через
`performance.now()` и завершаются на ближайшем `requestAnimationFrame`, когда
наблюдаемый DOM-результат уже появился.

## Автоматические проверки

- `benchmark-results/thresholds.json` хранит единый набор порогов backend и UI.
- Native E2E измеряет открытие уже проиндексированного каталога на малом
  синтетическом fixture. Порог — 150 мс.
- Тот же native E2E измеряет selection feedback (100 мс), focus feedback
  (50 мс), первую страницу поиска по локальному индексу (300 мс) и 10-секундный
  scroll/Sunburst interaction profile с нижней границей 30 FPS.
- Component tests прогоняют 100K, 500K и 1M indexed scenarios. Во frontend
  передаётся только bounded page из 100 entries, а виртуализированный DOM
  содержит меньше 30 строк.
- Scanner gate `npm run performance:1m` проверяет реальный 1M fixture отдельно;
  его результат не подменяет UI gate.

Selection и focus завершаются на первом кадре с наблюдаемым состоянием. Search
first page завершается после появления результата локального индексного запроса.
Native E2E может сохранить JSON-отчёт через
`LOCAL_EXPERT_DISK_UI_PERFORMANCE_REPORT`; значения сравниваются с
`benchmark-results/thresholds.json`. Hover учитывается в 10-секундном профиле.

Автоматический debug E2E является regression gate, но не заменяет release
профилирование: абсолютные результаты разных build mode нельзя сравнивать между
собой как benchmark trend.

Последний локальный native macOS debug-E2E отчёт:
`benchmark-results/ui-native-macos-x64.json` (27 сентября 2026 г.). Зафиксировано:
cached directory 8 мс, selection 39 мс, focus 5 мс, indexed search 19 мс,
first display 119 мс и 59,99 FPS за 10-секундный interaction profile. Все значения
прошли пороги из `benchmark-results/thresholds.json`.

## Условия release-профилирования

1. Release build, локальный SSD, без production-данных.
2. Окна 1100×700, 1200×800, 1440×900, широкое и minimum 640×520.
3. Три запуска после одного прогрева; фиксируется медиана и худший результат.
4. Для scroll и Sunburst hover записывается минимум 10 секунд Performance
   timeline: цель 60 FPS, устойчивый результат ниже 30 FPS считается
   регрессией.
5. В отчёте указываются ОС, архитектура, размер fixture, build mode и commit.
