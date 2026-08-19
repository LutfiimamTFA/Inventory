"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const COLORS = ["#2563eb", "#0d9488", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2", "#64748b"];

// recharts mengetik parameter Tooltip/LabelList formatter secara generik
// (ValueType | undefined, RenderableText, dst) yang tidak cocok langsung
// dengan formatter (value: number) => string milik kita — wrapper ini
// menerima `unknown` (supertype apa pun yang dikirim recharts) lalu cast ke
// number, jadi tetap type-safe tanpa perlu `any` di titik pemakaian.
function toRechartsFormatter(fn?: (value: number) => string) {
  if (!fn) return undefined;
  return (value: unknown) => fn(Number(value));
}

// Section F — dipakai semua chart di bawah supaya margin/font/legend
// menyesuaikan lebar HP (bukan cuma ResponsiveContainer, yang cuma
// menangani lebar SVG-nya, bukan margin/label bawaan recharts).
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}

export function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="w-full max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-800 mb-3">{title}</h3>
      {children}
    </div>
  );
}

export function SimpleBarChart<D extends { name: string; value: number }>({
  data,
  dataKey = "value",
  nameKey = "name",
  horizontal = false,
  valueFormatter,
  showValueLabel = false,
  onBarClick,
  renderTooltip,
  cellColor,
}: {
  data: D[];
  dataKey?: string;
  nameKey?: string;
  horizontal?: boolean;
  // Dipakai Rekap Finance — format axis/tooltip/label rupiah ringkas
  // ("Rp150 jt") daripada angka mentah. Opsional, chart lain (mis. jumlah
  // ticket) tetap pakai angka polos kalau tidak diisi.
  valueFormatter?: (value: number) => string;
  // Tampilkan nominal langsung di ujung bar (bukan cuma di tooltip) — dipakai
  // chart "Nilai Asset per Kategori" supaya pembaca tidak perlu hover.
  showValueLabel?: boolean;
  // Klik bar untuk filter (mis. klik kategori di Rekap Finance).
  onBarClick?: (name: string) => void;
  // Tooltip custom (mis. tren bulanan Rekap Finance perlu tampilkan nama
  // bulan + Nilai Perolehan + Jumlah Asset sekaligus, bukan cuma satu
  // angka) — kalau diisi, MENGGANTIKAN valueFormatter default Tooltip.
  renderTooltip?: (row: D) => React.ReactNode;
  // Warna per-bar (mis. highlight satu-satunya bulan yang ada transaksi) —
  // kembalikan undefined untuk pakai warna default.
  cellColor?: (row: D, index: number) => string | undefined;
}) {
  const isMobile = useIsMobile();
  if (data.length === 0) {
    return (
      <div className="mt-4 rounded-xl bg-slate-50 p-6 text-center">
        <p className="text-sm font-semibold text-slate-700">Belum ada data</p>
        <p className="mt-1 text-xs text-slate-500">
          Data report akan muncul setelah aset atau ticket tersedia.
        </p>
      </div>
    );
  }
  // Bar vertikal (bukan horizontal) dengan label di atas butuh margin-top +
  // tinggi container ekstra supaya labelnya tidak kepotong oleh
  // overflow-hidden bawaan card — chart lain (tanpa label, atau label di
  // kanan bar horizontal) tetap pakai ukuran/overflow lama.
  const needsTopLabelSpace = showValueLabel && !horizontal;
  return (
    <div
      className={`w-full max-w-full min-w-0 ${
        needsTopLabelSpace
          ? "h-[260px] min-h-[260px] overflow-visible md:h-[340px] md:min-h-[340px]"
          : "h-[220px] min-h-[220px] overflow-hidden md:h-[320px] md:min-h-[320px]"
      }`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout={horizontal ? "vertical" : "horizontal"}
          margin={{
            top: needsTopLabelSpace ? 36 : 12,
            right: isMobile ? 8 : showValueLabel ? 64 : 24,
            left: isMobile ? 0 : 12,
            bottom: isMobile ? 24 : 12,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          {horizontal ? (
            <>
              <XAxis
                type="number"
                tick={{ fontSize: isMobile ? 10 : 11 }}
                tickFormatter={valueFormatter}
              />
              <YAxis
                type="category"
                dataKey={nameKey}
                width={isMobile ? 80 : 110}
                tick={{ fontSize: isMobile ? 10 : 11 }}
              />
            </>
          ) : (
            <>
              <XAxis
                dataKey={nameKey}
                tick={{ fontSize: isMobile ? 10 : 11 }}
                interval={0}
                angle={isMobile ? -30 : 0}
                textAnchor={isMobile ? "end" : "middle"}
                height={isMobile ? 40 : 24}
              />
              <YAxis tick={{ fontSize: isMobile ? 10 : 11 }} tickFormatter={valueFormatter} />
            </>
          )}
          <Tooltip
            formatter={renderTooltip ? undefined : toRechartsFormatter(valueFormatter)}
            content={
              renderTooltip
                ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ({ active, payload }: any) => {
                    if (!active || !payload?.[0]) return null;
                    return (
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-md text-xs space-y-0.5">
                        {renderTooltip(payload[0].payload as D)}
                      </div>
                    );
                  }
                : undefined
            }
          />
          <Bar
            dataKey={dataKey}
            fill="#2563eb"
            radius={[4, 4, 4, 4]}
            cursor={onBarClick ? "pointer" : undefined}
            onClick={
              onBarClick
                ? (entry) => onBarClick(String((entry as unknown as Record<string, unknown>)[nameKey]))
                : undefined
            }
          >
            {cellColor &&
              data.map((row, i) => <Cell key={i} fill={cellColor(row, i) || "#2563eb"} />)}
            {showValueLabel && (
              <LabelList
                dataKey={dataKey}
                position={horizontal ? "right" : "top"}
                formatter={toRechartsFormatter(valueFormatter)}
                style={{ fontSize: isMobile ? 9 : 10, fill: "#475569" }}
              />
            )}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SimplePieChart({
  data,
  donut = false,
  valueFormatter,
  onSliceClick,
}: {
  data: { name: string; value: number }[];
  // Dipakai Rekap Finance ("Nilai per Perusahaan"/"Status Invoice") — lubang
  // di tengah supaya benar-benar tampil sebagai donut, bukan pie penuh.
  donut?: boolean;
  valueFormatter?: (value: number) => string;
  onSliceClick?: (name: string) => void;
}) {
  const isMobile = useIsMobile();
  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return (
      <div className="mt-4 rounded-xl bg-slate-50 p-6 text-center">
        <p className="text-sm font-semibold text-slate-700">Belum ada data</p>
        <p className="mt-1 text-xs text-slate-500">
          Data report akan muncul setelah aset atau ticket tersedia.
        </p>
      </div>
    );
  }
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const legendData = data.map((d) => ({
    ...d,
    displayValue: valueFormatter ? valueFormatter(d.value) : String(d.value),
    percent: total > 0 ? Math.round((d.value / total) * 100) : 0,
  }));
  return (
    <div>
      <div className="h-[220px] min-h-[220px] w-full max-w-full min-w-0 overflow-hidden md:h-[320px] md:min-h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            {/* Label bawaan Pie ("label" prop) SENGAJA tidak dipakai di
                mobile — teksnya menonjol keluar lingkaran dan memicu
                overflow horizontal di layar sempit (section G). */}
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={donut ? (isMobile ? 42 : 50) : 0}
              outerRadius={isMobile ? 70 : 80}
              cursor={onSliceClick ? "pointer" : undefined}
              onClick={onSliceClick ? (entry) => onSliceClick(String(entry.name)) : undefined}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={toRechartsFormatter(valueFormatter)} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 space-y-1.5 text-xs">
        {legendData.map((item, i) => (
          <button
            key={item.name}
            type="button"
            onClick={() => onSliceClick?.(item.name)}
            disabled={!onSliceClick}
            className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left ${
              onSliceClick ? "cursor-pointer hover:bg-slate-50" : ""
            }`}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: COLORS[i % COLORS.length] }}
              />
              <span className="truncate text-slate-600">{item.name}</span>
            </span>
            <span className="shrink-0 font-medium text-slate-700">
              {item.displayValue} · {item.percent}%
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function SimpleLineChart({
  data,
  valueFormatter,
}: {
  data: { name: string; value: number }[];
  valueFormatter?: (value: number) => string;
}) {
  const isMobile = useIsMobile();
  if (data.length === 0) {
    return (
      <div className="mt-4 rounded-xl bg-slate-50 p-6 text-center">
        <p className="text-sm font-semibold text-slate-700">Belum ada data</p>
        <p className="mt-1 text-xs text-slate-500">
          Data report akan muncul setelah aset atau ticket tersedia.
        </p>
      </div>
    );
  }
  return (
    <div className="h-[220px] min-h-[220px] w-full max-w-full min-w-0 overflow-hidden md:h-[320px] md:min-h-[320px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{
            top: 12,
            right: isMobile ? 8 : 24,
            left: isMobile ? 0 : 12,
            bottom: isMobile ? 24 : 12,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey="name"
            tick={{ fontSize: isMobile ? 10 : 11 }}
            interval={0}
            angle={isMobile ? -30 : 0}
            textAnchor={isMobile ? "end" : "middle"}
            height={isMobile ? 40 : 24}
          />
          <YAxis tick={{ fontSize: isMobile ? 10 : 11 }} tickFormatter={valueFormatter} />
          <Tooltip formatter={toRechartsFormatter(valueFormatter)} />
          <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
