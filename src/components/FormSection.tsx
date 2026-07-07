import { ReactNode } from "react";

export function FormSection({
  step,
  title,
  description,
  children,
}: {
  step?: number;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 md:p-5">
      <div className="flex items-center gap-3 mb-4">
        {step !== undefined && (
          <span className="h-7 w-7 shrink-0 rounded-lg bg-slate-900 text-white text-xs font-semibold flex items-center justify-center">
            {step}
          </span>
        )}
        <div>
          <h2 className="font-semibold text-slate-800">{title}</h2>
          {description && (
            <p className="text-xs text-slate-400">{description}</p>
          )}
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-x-5 gap-y-4">{children}</div>
    </section>
  );
}

export function Field({
  label,
  children,
  required,
  full,
  hint,
  error,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
  full?: boolean;
  hint?: string;
  error?: string;
}) {
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        {label}
        {required ? (
          <span className="text-red-500"> *</span>
        ) : (
          <span className="text-slate-400 font-normal text-xs"> (Opsional)</span>
        )}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-red-600 mt-1">{error}</p>
      ) : (
        hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>
      )}
    </div>
  );
}
