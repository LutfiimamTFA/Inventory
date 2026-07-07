export type StatTone = "slate" | "emerald" | "amber" | "purple" | "red" | "blue";

const TONE_CLASSES: Record<StatTone, string> = {
  slate: "bg-slate-100 text-slate-700",
  emerald: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-700",
  purple: "bg-purple-100 text-purple-700",
  red: "bg-red-100 text-red-700",
  blue: "bg-blue-100 text-blue-700",
};

export default function StatCard({
  icon: Icon,
  label,
  value,
  tone = "slate",
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string | number;
  tone?: StatTone;
}) {
  return (
    <div className="group bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
      <div
        className={`h-12 w-12 shrink-0 rounded-xl flex items-center justify-center ${TONE_CLASSES[tone]}`}
      >
        <Icon size={22} />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500 truncate">{label}</p>
        <p className="text-xl font-semibold text-slate-900 truncate">{value}</p>
      </div>
    </div>
  );
}
