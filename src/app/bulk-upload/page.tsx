"use client";

import { useEffect, useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  collection,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  doc,
} from "firebase/firestore";
import { UploadCloud, CheckCircle2, AlertCircle } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { AssetCategory } from "@/lib/types";
import { generateAssetCode } from "@/lib/firestore-helpers";
import ProtectedLayout from "@/components/ProtectedLayout";
import PageHeader from "@/components/PageHeader";

interface Row {
  assetName?: string;
  categoryName?: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  location?: string;
  companyOwnerName?: string;
  divisionOwnerName?: string;
  ownershipStatus?: string;
  purchasePrice?: string;
  condition?: string;
  isBorrowable?: string;
  _valid?: boolean;
  _error?: string;
}

const REQUIRED_COLUMNS = ["assetName", "categoryName"];

export default function BulkUploadPage() {
  const { assetUser } = useAuth();
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "asset_categories"), (snap) => {
      setCategories(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetCategory))
      );
    });
    return () => unsub();
  }, []);

  const validateRows = (parsed: Row[]) =>
    parsed.map((r) => {
      const missing = REQUIRED_COLUMNS.filter(
        (c) => !r[c as keyof Row] || String(r[c as keyof Row]).trim() === ""
      );
      const categoryExists = categories.some(
        (c) => c.categoryName.toLowerCase() === (r.categoryName || "").toLowerCase()
      );
      if (missing.length > 0) {
        return { ...r, _valid: false, _error: `Kolom wajib kosong: ${missing.join(", ")}` };
      }
      if (!categoryExists) {
        return { ...r, _valid: false, _error: `Kategori "${r.categoryName}" tidak ditemukan` };
      }
      return { ...r, _valid: true, _error: "" };
    });

  const handleFile = (file: File) => {
    setFileName(file.name);
    setDone(false);
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "csv") {
      Papa.parse<Row>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => setRows(validateRows(res.data)),
      });
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const wb = XLSX.read(e.target?.result, { type: "binary" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Row>(sheet);
        setRows(validateRows(json));
      };
      reader.readAsBinaryString(file);
    }
  };

  const validRows = rows.filter((r) => r._valid);

  const MAX_OPS_PER_BATCH = 450;
  const isImportingRef = useRef(false);

  const handleImport = async () => {
    if (validRows.length === 0) return;
    if (isImportingRef.current) {
      console.debug("[Bulk Upload] import skipped because already running");
      return;
    }
    isImportingRef.current = true;
    setImporting(true);
    try {
      // generateAssetCode menghitung berdasarkan data yang sudah tersimpan di
      // Firestore, jadi untuk baris-baris dalam kategori yang sama pada satu
      // proses import ini, urutan nomor berikutnya di-increment secara lokal
      // agar tidak saling bentrok sebelum batch di-commit.
      const nextSequence: Record<string, number> = {};
      const docs: { ref: ReturnType<typeof doc>; data: Record<string, unknown> }[] = [];

      for (const r of validRows) {
        const category = categories.find(
          (c) => c.categoryName.toLowerCase() === (r.categoryName || "").toLowerCase()
        );
        const categoryCode = category?.categoryCode || "GEN";
        let assetCode = await generateAssetCode(categoryCode);
        const prefix = assetCode.slice(0, assetCode.lastIndexOf("-") + 1);
        if (nextSequence[prefix] !== undefined) {
          assetCode = `${prefix}${String(nextSequence[prefix]).padStart(4, "0")}`;
          nextSequence[prefix] += 1;
        } else {
          const seq = Number(assetCode.slice(prefix.length));
          nextSequence[prefix] = seq + 1;
        }
        docs.push({
          ref: doc(collection(db, "assets")),
          data: {
            assetName: r.assetName,
            assetCode,
            categoryId: category?.id || "",
            categoryName: category?.categoryName || r.categoryName,
            brand: r.brand || "",
            model: r.model || "",
            serialNumber: r.serialNumber || "",
            location: r.location || "",
            companyOwnerName: r.companyOwnerName || "",
            divisionOwnerName: r.divisionOwnerName || "",
            ownershipStatus: r.ownershipStatus || "Aset Perusahaan",
            purchasePrice: r.purchasePrice ? Number(r.purchasePrice) : null,
            assetStatus: "available",
            condition: r.condition || "good",
            isBorrowable: String(r.isBorrowable).toLowerCase() !== "false",
            requiresApproval: false,
            qrCodeValue: assetCode,
            currentBorrowingId: null,
            currentBorrowerUid: null,
            currentBorrowerName: null,
            createdByUid: assetUser?.uid,
            createdByName: assetUser?.name,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
        });
      }

      // Firestore membatasi maksimal ~500 operasi per batch. Pecah jadi
      // beberapa batch dan commit berurutan (bukan Promise.all) supaya tidak
      // ada beberapa write batch berjalan bersamaan.
      for (let i = 0; i < docs.length; i += MAX_OPS_PER_BATCH) {
        const chunk = docs.slice(i, i + MAX_OPS_PER_BATCH);
        const batch = writeBatch(db);
        chunk.forEach(({ ref, data }) => batch.set(ref, data));
        await batch.commit();
      }

      setDone(true);
      setRows([]);
    } finally {
      setImporting(false);
      isImportingRef.current = false;
    }
  };

  return (
    <ProtectedLayout>
      <PageHeader
        title="Bulk Upload Aset"
        subtitle="Import banyak aset sekaligus dari file CSV atau Excel."
      />

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-5">
        <label className="file-drop py-12">
          <UploadCloud className="text-slate-400" size={30} />
          <span className="text-sm font-medium text-slate-600">
            Klik untuk upload file CSV atau Excel (.xlsx)
          </span>
          <span className="text-xs text-slate-400">
            Kolom minimal: assetName, categoryName
          </span>
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </label>
        {fileName && (
          <p className="text-xs text-slate-400 mt-3">File terpilih: {fileName}</p>
        )}
        {done && (
          <p className="text-sm text-emerald-600 mt-2 inline-flex items-center gap-1.5 font-medium">
            <CheckCircle2 size={15} /> Import berhasil.
          </p>
        )}
      </div>

      {rows.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="font-semibold text-slate-800">
              Preview{" "}
              <span className="text-slate-400 font-normal text-sm">
                ({validRows.length}/{rows.length} valid)
              </span>
            </h2>
            <button
              onClick={handleImport}
              disabled={importing || validRows.length === 0}
              className="rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2.5 text-sm font-medium hover:brightness-105 disabled:opacity-50 shadow-md shadow-blue-900/20"
            >
              {importing ? "Mengimpor..." : `Import ${validRows.length} Aset`}
            </button>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto rounded-xl border border-slate-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200 sticky top-0 bg-slate-50">
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Nama Aset</th>
                  <th className="px-3 py-2 font-semibold">Kategori</th>
                  <th className="px-3 py-2 font-semibold">Lokasi</th>
                  <th className="px-3 py-2 font-semibold">Catatan</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2">
                      {r._valid ? (
                        <CheckCircle2 size={16} className="text-emerald-500" />
                      ) : (
                        <AlertCircle size={16} className="text-red-500" />
                      )}
                    </td>
                    <td className="px-3 py-2">{r.assetName || "-"}</td>
                    <td className="px-3 py-2">{r.categoryName || "-"}</td>
                    <td className="px-3 py-2">{r.location || "-"}</td>
                    <td className="px-3 py-2 text-red-500 text-xs">{r._error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </ProtectedLayout>
  );
}
