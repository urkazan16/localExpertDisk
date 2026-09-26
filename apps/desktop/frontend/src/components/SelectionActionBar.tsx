import { useState } from "react";
import type { IndexedEntry } from "../api/generated";
import { formatBytes } from "../ScanPanel";
import { Button, DialogSurface } from "../ui/primitives";

export function SelectionActionBar({
  busy = false,
  onClear,
  onOpen,
  onReveal,
  onTrash,
  selected,
  trashAvailable = false,
}: {
  busy?: boolean;
  onClear: () => void;
  onOpen: (entry: IndexedEntry) => void;
  onReveal: (entry: IndexedEntry) => void;
  onTrash?: (entries: IndexedEntry[]) => Promise<void> | void;
  selected: IndexedEntry[];
  trashAvailable?: boolean;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const count = selected.length;
  const total = selected.reduce(
    (sum, entry) => sum + BigInt(entry.aggregate_size),
    0n,
  );
  const single = count === 1 ? selected[0] : null;

  async function confirmTrash() {
    if (!onTrash || count === 0) return;
    await onTrash(selected);
    setReviewOpen(false);
  }

  return (
    <>
      <div className="selection-action-bar" aria-label="Действия с выбором">
        <div className="selection-action-bar__summary" aria-live="polite">
          <strong>{count ? `Выбрано: ${count}` : "Объекты не выбраны"}</strong>
          <span>{formatBytes(total.toString())}</span>
        </div>
        <div className="selection-action-bar__actions">
          <Button
            disabled={!single || busy}
            onClick={() => single && onOpen(single)}
            size="small"
            variant="secondary"
          >
            Открыть
          </Button>
          <Button
            disabled={!single || busy}
            onClick={() => single && onReveal(single)}
            size="small"
            variant="secondary"
          >
            Показать в системе
          </Button>
          {trashAvailable && onTrash && (
            <Button
              disabled={count === 0 || busy}
              onClick={() => setReviewOpen(true)}
              size="small"
              variant="danger"
            >
              В корзину
            </Button>
          )}
          <Button
            disabled={count === 0 || busy}
            onClick={onClear}
            size="small"
            variant="ghost"
          >
            Снять выбор
          </Button>
        </div>
      </div>
      <DialogSurface
        onClose={() => setReviewOpen(false)}
        open={reviewOpen}
        title="Проверка перед перемещением"
      >
        <p>
          В системную корзину будет перемещено: {count} ·{" "}
          {formatBytes(total.toString())}.
        </p>
        <ul className="selection-review-list">
          {selected.map((entry) => (
            <li key={entry.id}>
              <strong>{entry.name || entry.path}</strong>
              <span>{entry.path}</span>
              <span>{formatBytes(entry.aggregate_size)}</span>
            </li>
          ))}
        </ul>
        <div className="selection-review-actions">
          <Button
            autoFocus
            disabled={busy}
            onClick={() => void confirmTrash()}
            variant="danger"
          >
            Подтвердить перемещение
          </Button>
          <Button onClick={() => setReviewOpen(false)} variant="secondary">
            Отмена
          </Button>
        </div>
      </DialogSurface>
    </>
  );
}
