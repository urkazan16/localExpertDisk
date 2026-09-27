import { useState } from "react";
import { Icon, type IconName } from "./icons";
import {
  Button,
  DialogSurface,
  EmptyState,
  IconButton,
  InlineAlert,
  PopoverSurface,
  SegmentedControl,
  SelectField,
  Skeleton,
  TextField,
} from "./primitives";
import "./preview.css";

const iconNames: IconName[] = [
  "home",
  "disk",
  "folder",
  "file",
  "applications",
  "downloads",
  "search",
  "back",
  "forward",
  "chevron-down",
  "help",
  "info",
  "delete",
  "refresh",
  "close",
];

export function UiPreview() {
  const [mode, setMode] = useState<"structure" | "large">("structure");
  const [metric, setMetric] = useState<"logical" | "allocated">("logical");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  return (
    <main className="ui-preview">
      <header className="ui-preview__header">
        <div>
          <p className="ui-preview__eyebrow">ЭТАП 1 · DEV PREVIEW</p>
          <h1>Токены и UI primitives</h1>
          <p>Внутренний стенд состояний. Не является экраном продукта.</p>
        </div>
        <IconButton
          icon="close"
          label="Закрыть preview"
          onClick={() => window.history.back()}
        />
      </header>

      <section className="ui-preview__section">
        <h2>Действия</h2>
        <div className="ui-preview__row">
          <Button icon="search">Начать сканирование</Button>
          <Button variant="secondary">Вторичное действие</Button>
          <Button variant="ghost">Тихое действие</Button>
          <Button icon="delete" variant="danger">
            Переместить
          </Button>
          <Button disabled>Недоступно</Button>
          <Button loading>Загрузка</Button>
        </div>
      </section>

      <section className="ui-preview__section ui-preview__grid">
        <div>
          <h2>Формы и режимы</h2>
          <div className="ui-preview__stack">
            <SegmentedControl
              label="Режим результата"
              onChange={setMode}
              options={[
                { label: "Структура", value: "structure" },
                { label: "Большие файлы", value: "large" },
              ]}
              value={mode}
            />
            <TextField
              hint="Укажите абсолютный путь"
              label="Каталог"
              placeholder="/Users/name/Downloads"
            />
            <TextField
              error="Каталог недоступен"
              label="Поле с ошибкой"
              value="/private"
              readOnly
            />
            <SelectField
              label="Метрика"
              onValueChange={setMetric}
              options={[
                { value: "logical", label: "Логический размер" },
                { value: "allocated", label: "На диске" },
              ]}
              value={metric}
            />
          </div>
        </div>
        <div>
          <h2>Иконки</h2>
          <div className="ui-preview__icons">
            {iconNames.map((name) => (
              <span key={name} title={name}>
                <Icon name={name} />
              </span>
            ))}
          </div>
          <h2>Transient surfaces</h2>
          <div className="ui-preview__row ui-preview__popover-anchor">
            <Button onClick={() => setDialogOpen(true)} variant="secondary">
              Открыть dialog
            </Button>
            <Button
              onClick={() => setPopoverOpen((value) => !value)}
              variant="secondary"
            >
              Popover
            </Button>
            <PopoverSurface label="Действия" open={popoverOpen}>
              <Button size="small" variant="ghost">
                Открыть
              </Button>
            </PopoverSurface>
          </div>
        </div>
      </section>

      <section className="ui-preview__section ui-preview__stack">
        <h2>Состояния</h2>
        <InlineAlert title="Информация">Индекс загружается в фоне.</InlineAlert>
        <InlineAlert title="Сканирование завершено" tone="success">
          Результат доступен для просмотра.
        </InlineAlert>
        <InlineAlert title="Часть каталогов недоступна" tone="warning">
          Результат может быть неполным.
        </InlineAlert>
        <InlineAlert title="Не удалось продолжить" tone="danger">
          Проверьте доступ и повторите действие.
        </InlineAlert>
        <div className="ui-preview__skeletons">
          <Skeleton width="78%" />
          <Skeleton width="56%" />
          <Skeleton width="68%" />
        </div>
        <EmptyState
          action={<Button variant="secondary">Выбрать папку</Button>}
          title="Папка не выбрана"
        >
          Выберите каталог или доступный диск, чтобы начать анализ.
        </EmptyState>
      </section>

      <DialogSurface
        onClose={() => setDialogOpen(false)}
        open={dialogOpen}
        title="Проверка действия"
      >
        <p>
          Dialog shell предоставляет семантику и Escape; полный focus trap
          добавляется вместе с рабочим flow.
        </p>
        <div className="ui-preview__row">
          <Button onClick={() => setDialogOpen(false)}>Готово</Button>
        </div>
      </DialogSurface>
    </main>
  );
}
