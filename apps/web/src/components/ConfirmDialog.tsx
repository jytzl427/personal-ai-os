import { useEffect, useId } from "react";

export function ConfirmDialog({
  message,
  title = "确认删除？",
  confirmLabel = "确认删除",
  onCancel,
  onConfirm
}: {
  message: string;
  title?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onCancel]);

  return (
    <div
      aria-labelledby={titleId}
      aria-describedby={messageId}
      aria-modal="true"
      className="confirm-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      role="dialog"
    >
      <div className="confirm-dialog confirm-dialog-overflow-fix">
        <div aria-hidden="true" className="confirm-dialog-mark">×</div>
        <h2 id={titleId}>{title}</h2>
        <p id={messageId}>{message}</p>
        <div className="confirm-dialog-actions">
          <button className="secondary-button" onClick={onCancel} type="button">取消</button>
          <button className="primary-button danger-confirm-button" onClick={onConfirm} type="button">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

