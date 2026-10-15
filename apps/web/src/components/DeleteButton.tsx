import { useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog.js";

export function DeleteButton({ label, message, onClick }: { label: string; message?: string; onClick: () => void }) {
  const [open, setOpen] = useState(false);
  const target = label.replace(/^删除/, "").trim() || "这条数据";

  return (
    <>
      <button
        aria-label={label}
        className="delete-button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        title={label}
        type="button"
      >
        ×
      </button>
      {open ? <ConfirmDialog message={message ?? `即将删除“${target}”。此操作不可撤销，请确认是否继续。`} onCancel={() => setOpen(false)} onConfirm={() => { setOpen(false); onClick(); }} /> : null}
    </>
  );
}
