"use client";

import { useEffect } from "react";
import { CheckCircle2, Info, XCircle } from "lucide-react";

export interface ToastState {
  type: "success" | "error" | "info";
  message: string;
}

export function Toast({
  toast,
  onClose,
}: {
  toast: ToastState | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onClose, 3500);
    return () => clearTimeout(timer);
  }, [toast, onClose]);

  if (!toast) return null;

  const isSuccess = toast.type === "success";
  const isInfo = toast.type === "info";

  return (
    <div className="fixed top-4 right-4 z-[100]">
      <div
        className={`flex items-center gap-2.5 rounded-xl border shadow-lg px-4 py-3 text-sm font-medium max-w-sm ${
          isSuccess
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : isInfo
            ? "bg-blue-50 border-blue-200 text-blue-800"
            : "bg-red-50 border-red-200 text-red-800"
        }`}
      >
        {isSuccess ? (
          <CheckCircle2 size={18} className="shrink-0 text-emerald-600" />
        ) : isInfo ? (
          <Info size={18} className="shrink-0 text-blue-600" />
        ) : (
          <XCircle size={18} className="shrink-0 text-red-600" />
        )}
        {toast.message}
      </div>
    </div>
  );
}
