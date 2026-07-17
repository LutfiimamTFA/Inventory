"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";

export interface SearchableSelectItem {
  id: string;
  label: string;
  sublabel?: string;
  searchText: string;
}

export default function SearchableSelect({
  items,
  value,
  onChange,
  placeholder = "Pilih...",
  searchPlaceholder = "Cari...",
  emptyText = "Tidak ada data yang cocok.",
  disabled = false,
  disabledHint,
}: {
  items: SearchableSelectItem[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  disabledHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = items.find((i) => i.id === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.searchText.toLowerCase().includes(q));
  }, [items, query]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="input flex items-center justify-between text-left disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
      >
        <span className={`truncate ${selected ? "text-slate-800" : "text-slate-400"}`}>
          {selected ? selected.label : disabled ? disabledHint || placeholder : placeholder}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {selected && !disabled && (
            <X
              size={14}
              className="text-slate-400 hover:text-slate-600"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
            />
          )}
          <ChevronDown size={15} className="text-slate-400" />
        </div>
      </button>

      {open && !disabled && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
          <div className="relative border-b border-slate-100 p-2">
            <Search
              size={14}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full rounded-lg border border-slate-200 pl-8 pr-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div className="max-h-[280px] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-400">{emptyText}</p>
            ) : (
              filtered.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => {
                    onChange(item.id);
                    setQuery("");
                    setOpen(false);
                  }}
                  className={`w-full text-left px-4 py-2 hover:bg-slate-50 ${
                    item.id === value ? "bg-blue-50/60" : ""
                  }`}
                >
                  <p className="text-sm font-medium text-slate-800 truncate" title={item.label}>
                    {item.label}
                  </p>
                  {item.sublabel && (
                    <p className="text-xs text-slate-400 truncate" title={item.sublabel}>
                      {item.sublabel}
                    </p>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
