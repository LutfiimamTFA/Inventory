export default function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Konfirmasi",
  danger,
  confirmDisabled,
  cancelDisabled,
  panelClassName,
  headerClassName,
  bodyClassName,
  footerClassName,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
  panelClassName?: string;
  headerClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={cancelDisabled ? undefined : onCancel} />
      <div
        className={
          panelClassName ||
          "relative bg-white rounded-2xl shadow-lg border border-slate-200 w-full max-w-md p-6"
        }
      >
        <div className={headerClassName}>
          <h2 className="text-lg font-semibold mb-1">{title}</h2>
          {description && <p className="text-sm text-slate-500 mb-4">{description}</p>}
        </div>
        {children && <div className={bodyClassName || "mb-4"}>{children}</div>}
        <div className={footerClassName || "flex justify-end gap-2 mt-2"}>
          <button
            onClick={onCancel}
            disabled={cancelDisabled}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Batal
          </button>
          <button
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${
              danger
                ? "bg-red-600 hover:bg-red-700"
                : "bg-slate-900 hover:bg-slate-800"
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
