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
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <p className="text-xl font-semibold text-slate-900">{value}</p>
      <p className={`text-xs mt-1 inline-block rounded-full px-2 py-0.5 ${color}`}>{label}</p>
    </div>
  );
}
