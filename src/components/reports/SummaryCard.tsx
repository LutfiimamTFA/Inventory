export default function SummaryCard({
  label,
  value,
  color = "bg-blue-50 text-blue-600",
}: {
  label: string;
  value: number | string;
  color?: string;
}) {
  return (
    <div className="min-w-0 w-full max-w-full rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:p-4">
      <p className="text-xl font-bold text-slate-900 break-words">{value}</p>
      <p className={`text-[11px] mt-1 inline-flex max-w-full rounded-full px-2 py-1 font-semibold break-words ${color}`}>
        {label}
      </p>
    </div>
  );
}
