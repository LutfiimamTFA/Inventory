import { formatRupiahInput } from "@/lib/utils";

export default function CurrencyInput({
  value,
  onChange,
  placeholder = "0",
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  placeholder?: string;
}) {
  const display = value !== undefined ? formatRupiahInput(String(value)) : "";

  const handleChange = (raw: string) => {
    const digitsOnly = raw.replace(/[^0-9]/g, "");
    onChange(digitsOnly ? Number(digitsOnly) : undefined);
  };

  return (
    <div className="flex">
      <div className="flex items-center px-3 rounded-l-xl border border-r-0 border-slate-200 bg-slate-50 text-sm font-medium text-slate-500 shrink-0">
        Rp
      </div>
      <input
        type="text"
        inputMode="numeric"
        value={display}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        className="input rounded-l-none flex-1 min-w-0"
      />
    </div>
  );
}
