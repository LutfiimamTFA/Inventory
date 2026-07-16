"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
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

export function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <h3 className="text-sm font-semibold text-slate-800 mb-3">{title}</h3>
      {children}
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
  if (data.length === 0) {
    return <p className="text-sm text-slate-400 text-center py-10">Belum ada data.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        {horizontal ? (
          <>
            <XAxis type="number" fontSize={11} />
            <YAxis type="category" dataKey={nameKey} width={110} fontSize={11} />
          </>
        ) : (
          <>
            <XAxis dataKey={nameKey} fontSize={11} />
            <YAxis fontSize={11} />
          </>
        )}
        <Tooltip />
        <Bar dataKey={dataKey} fill="#2563eb" radius={[4, 4, 4, 4]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SimplePieChart({ data }: { data: { name: string; value: number }[] }) {
  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return <p className="text-sm text-slate-400 text-center py-10">Belum ada data.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" outerRadius={80} label>
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Legend />
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function SimpleLineChart({ data }: { data: { name: string; value: number }[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-slate-400 text-center py-10">Belum ada data.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="name" fontSize={11} />
        <YAxis fontSize={11} />
        <Tooltip />
        <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
