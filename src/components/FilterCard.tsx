import { ReactNode } from "react";

export default function FilterCard({ children }: { children: ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 mb-5">
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">{children}</div>
    </div>
  );
}
