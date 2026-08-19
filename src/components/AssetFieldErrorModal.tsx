import { AlertTriangle } from "lucide-react";

// Section "Validasi Create/Edit Asset" — modal ringkasan error dipanggil
// SETELAH validasi gagal (baik submit maupun real-time), menampilkan semua
// pesan error field yang sudah dikumpulkan di objek `errors` (key -> pesan
// manusiawi, SUDAH dipakai juga sebagai teks di bawah masing-masing field).
// "Perbaiki Data" menutup modal lalu scroll+focus ke error PERTAMA
// berdasarkan urutan fieldOrder (urutan tampil form, bukan urutan objek).
export default function AssetFieldErrorModal({
  open,
  errors,
  fieldOrder,
  onClose,
}: {
  open: boolean;
  errors: Record<string, string>;
  fieldOrder: string[];
  onClose: () => void;
}) {
  if (!open) return null;

  const messages = fieldOrder.filter((key) => errors[key]).map((key) => errors[key]);
  // Jaring pengaman — field error yang key-nya tidak ada di fieldOrder tetap
  // ditampilkan (di akhir daftar) supaya tidak ada error yang "hilang" dari
  // ringkasan hanya karena lupa didaftarkan di fieldOrder.
  Object.keys(errors).forEach((key) => {
    if (!fieldOrder.includes(key) && errors[key]) messages.push(errors[key]);
  });

  const handleFix = () => {
    const firstKey = fieldOrder.find((key) => errors[key]) || Object.keys(errors).find((key) => errors[key]);
    onClose();
    if (!firstKey) return;
    // Beri waktu modal benar-benar tertutup dulu sebelum scroll, supaya
    // posisi scroll dihitung dari layout yang sudah stabil.
    requestAnimationFrame(() => {
      const el = document.getElementById(`field-${firstKey}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      (el as HTMLElement).focus?.();
    });
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-lg border border-slate-200 w-full max-w-md p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="h-10 w-10 shrink-0 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center">
            <AlertTriangle size={18} className="text-red-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Periksa Data Aset</h2>
            <p className="text-sm text-slate-500">
              {messages.length} bagian perlu diperbaiki sebelum data bisa disimpan.
            </p>
          </div>
        </div>
        <ul className="space-y-1.5 mb-5 max-h-64 overflow-y-auto">
          {messages.map((msg, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
              {msg}
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Tutup
          </button>
          <button
            type="button"
            onClick={handleFix}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800"
          >
            Perbaiki Data
          </button>
        </div>
      </div>
    </div>
  );
}
