"use client";

import { ReactNode } from "react";

interface Column<T> {
  label: string;
  render: (row: T) => ReactNode;
  // Kolom pertama dianggap "judul" card di mobile (nama besar), bukan
  // baris label/value seperti kolom lain.
  primary?: boolean;
  align?: "left" | "right";
}

// Section A/H — satu komponen table generik dipakai di semua tab Reports:
// desktop tetap table biasa, mobile otomatis jadi card list per baris,
// tanpa perlu tulis ulang markup table/card di setiap tab.
export default function ResponsiveTable<T>({
  columns,
  rows,
  keyFn,
  minWidth = 800,
  emptyText = "Belum ada data.",
}: {
  columns: Column<T>[];
  rows: T[];
  keyFn: (row: T) => string;
  minWidth?: number;
  emptyText?: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-400 text-center py-10">{emptyText}</p>;
  }

  const primaryCol = columns.find((c) => c.primary) || columns[0];
  const restCols = columns.filter((c) => c !== primaryCol);

  return (
    <>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth }}>
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50/60">
              {columns.map((c) => (
                <th
                  key={c.label}
                  className={`px-4 py-3 font-semibold ${c.align === "right" ? "text-right" : ""}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={keyFn(row)} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                {columns.map((c) => (
                  <td
                    key={c.label}
                    className={`px-4 py-3 text-slate-600 ${c.align === "right" ? "text-right" : ""}`}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="block md:hidden space-y-3 p-3">
        {rows.map((row) => (
          <div
            key={keyFn(row)}
            className="w-full max-w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="text-sm font-semibold text-slate-900 break-words">
              {primaryCol.render(row)}
            </div>
            <div className="mt-3 space-y-2 text-sm">
              {restCols.map((c) => (
                <div key={c.label}>
                  <p className="text-xs text-slate-400">{c.label}</p>
                  <p className="font-medium text-slate-700 break-words">{c.render(row)}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
