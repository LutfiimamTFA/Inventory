"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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

// Section G — legend custom berbentuk chip yang wrap, menggantikan
// <Legend/> bawaan recharts yang suka memaksa satu baris dan keluar card.
function ChipLegend({ data }: { data: { name: string; value: number }[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2 text-xs">
      {data.map((item, i) => (
        <div
          key={item.name}
          className="flex max-w-full items-center gap-1.5 rounded-full bg-slate-50 px-2 py-1"
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: COLORS[i % COLORS.length] }}
          />
          <span className="break-words text-slate-600">
            {item.name} ({item.value})
          </span>
        </div>
      ))}
    </div>
  );
}

export function SimpleBarChart({
  data,
  dataKey = "value",
  nameKey = "name",
  horizontal = false,
}: {
  data: { name: string; value: number }[];
  dataKey?: string;
  nameKey?: string;
  horizontal?: boolean;
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
        <BarChart
          data={data}
          layout={horizontal ? "vertical" : "horizontal"}
          margin={{
            top: 12,
            right: isMobile ? 8 : 24,
            left: isMobile ? 0 : 12,
            bottom: isMobile ? 24 : 12,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          {horizontal ? (
            <>
              <XAxis type="number" tick={{ fontSize: isMobile ? 10 : 11 }} />
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
              <YAxis tick={{ fontSize: isMobile ? 10 : 11 }} />
            </>
          )}
          <Tooltip />
          <Bar dataKey={dataKey} fill="#2563eb" radius={[4, 4, 4, 4]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SimplePieChart({ data }: { data: { name: string; value: number }[] }) {
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
  return (
    <div>
      <div className="h-[220px] min-h-[220px] w-full max-w-full min-w-0 overflow-hidden md:h-[320px] md:min-h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            {/* Label bawaan Pie ("label" prop) SENGAJA tidak dipakai di
                mobile — teksnya menonjol keluar lingkaran dan memicu
                overflow horizontal di layar sempit (section G). */}
            <Pie data={data} dataKey="value" nameKey="name" outerRadius={isMobile ? 70 : 80}>
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ChipLegend data={data} />
    </div>
  );
}

export function SimpleLineChart({ data }: { data: { name: string; value: number }[] }) {
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
          <YAxis tick={{ fontSize: isMobile ? 10 : 11 }} />
          <Tooltip />
          <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
