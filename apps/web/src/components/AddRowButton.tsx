export function AddRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="add-row" onClick={onClick} type="button">
      <span aria-hidden="true">+</span>
      {label}
    </button>
  );
}
