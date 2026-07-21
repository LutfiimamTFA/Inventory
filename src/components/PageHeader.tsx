import { ReactNode } from "react";

export default function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap mb-6 w-full max-w-full">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight break-words">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-slate-500 mt-1 break-words max-w-full">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap min-w-0">{actions}</div>}
    </div>
  );
}
