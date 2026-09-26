import { useState } from "react";
import type { IndexedEntry, Platform } from "../api/generated";
import { revealActionLabel } from "../platformLabels";
import { formatBytes } from "../ScanPanel";
import { Button, DialogSurface } from "../ui/primitives";

export function SelectionActionBar({
  busy = false,
  onClear,
  onOpen,
  onReveal,
  onTrash,
  platform = null,
  selected,
  trashAvailable = false,
}: {
  busy?: boolean;
  onClear: () => void;
  onOpen: (entry: IndexedEntry) => void;
  onReveal: (entry: IndexedEntry) => void;
  onTrash?: (
    entries: IndexedEntry[],
  ) => Promise<boolean | void> | boolean | void;
  platform?: Platform | null;
  selected: IndexedEntry[];
  trashAvailable?: boolean;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewEntries, setReviewEntries] = useState<IndexedEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const count = selected.length;
  const total = selected.reduce(
    (sum, entry) => sum + BigInt(entry.aggregate_size),
    0n,
  );
  const single = count === 1 ? selected[0] : null;
  const reviewTotal = reviewEntries.reduce(
    (sum, entry) => sum + BigInt(entry.aggregate_size),
    0n,
  );

  function openReview() {
    setReviewEntries([...selected]);
    setReviewOpen(true);
  }

  function closeReview() {
    if (!submitting) setReviewOpen(false);
  }

  async function confirmTrash() {
    if (!onTrash || reviewEntries.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const completed = await onTrash(reviewEntries);
      if (completed !== false) setReviewOpen(false);
    } finally {
      setSubmitting(false);
    }
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
            {revealActionLabel(platform)}
          </Button>
          {trashAvailable && onTrash && (
            <Button
              disabled={count === 0 || busy}
              onClick={openReview}
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
        closeDisabled={submitting}
        onClose={closeReview}
        open={reviewOpen}
        title="Проверка перед перемещением"
      >
        <p>
          В системную корзину будет перемещено: {reviewEntries.length} ·{" "}
          {formatBytes(reviewTotal.toString())}.
        </p>
        <ul className="selection-review-list">
          {reviewEntries.map((entry) => (
            <li key={entry.id}>
              <strong>{entry.name || entry.path}</strong>
              <span>{entry.path}</span>
              <span>{formatBytes(entry.aggregate_size)}</span>
            </li>
          ))}
        </ul>
        <div className="selection-review-actions">
          <Button
            disabled={busy || submitting}
            loading={submitting}
            onClick={() => void confirmTrash()}
            variant="danger"
          >
            Подтвердить перемещение
          </Button>
          <Button
            autoFocus
            disabled={submitting}
            onClick={closeReview}
            variant="secondary"
          >
            Отмена
          </Button>
        </div>
      </DialogSurface>
    </>
  );
}
