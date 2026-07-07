"use client";

import { useState } from "react";
import { Asset, AssetCondition } from "@/lib/types";
import { borrowAsset, returnAsset } from "@/lib/borrow-actions";
import { useAuth } from "@/lib/auth-context";
import ConfirmModal from "@/components/ConfirmModal";

export function BorrowModal({
  asset,
  open,
  onClose,
  onDone,
}: {
  asset: Asset;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { assetUser, firebaseUser } = useAuth();
  const [estimatedReturnAt, setEstimatedReturnAt] = useState("");
  const [borrowNotes, setBorrowNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleConfirm = async () => {
    if (!assetUser || !firebaseUser) return;
    setSaving(true);
    setError("");
    try {
      await borrowAsset({
        asset,
        userUid: assetUser.uid,
        userName: assetUser.name,
        userEmail: assetUser.email || firebaseUser.email || "",
        estimatedReturnAt,
        borrowNotes,
      });
      onDone();
    } catch {
      setError("Gagal memproses peminjaman.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConfirmModal
      open={open}
      title={`Pinjam ${asset.assetName}`}
      confirmLabel={saving ? "Memproses..." : "Pinjam Aset"}
      onConfirm={handleConfirm}
      onCancel={onClose}
    >
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Estimasi Tanggal Kembali
          </label>
          <input
            type="date"
            value={estimatedReturnAt}
            onChange={(e) => setEstimatedReturnAt(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Catatan
          </label>
          <textarea
            value={borrowNotes}
            onChange={(e) => setBorrowNotes(e.target.value)}
            className="input"
            rows={2}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </ConfirmModal>
  );
}

export function ReturnModal({
  asset,
  open,
  onClose,
  onDone,
}: {
  asset: Asset;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { assetUser } = useAuth();
  const [returnCondition, setReturnCondition] =
    useState<AssetCondition>("good");
  const [returnNotes, setReturnNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleConfirm = async () => {
    if (!assetUser) return;
    setSaving(true);
    setError("");
    try {
      await returnAsset({
        asset,
        userUid: assetUser.uid,
        userName: assetUser.name,
        returnCondition,
        returnNotes,
      });
      onDone();
    } catch {
      setError("Gagal memproses pengembalian.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConfirmModal
      open={open}
      title={`Kembalikan ${asset.assetName}`}
      confirmLabel={saving ? "Memproses..." : "Kembalikan Aset"}
      onConfirm={handleConfirm}
      onCancel={onClose}
    >
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Kondisi Saat Dikembalikan
          </label>
          <select
            value={returnCondition}
            onChange={(e) =>
              setReturnCondition(e.target.value as AssetCondition)
            }
            className="input"
          >
            <option value="new">Baru</option>
            <option value="good">Baik</option>
            <option value="fair">Cukup</option>
            <option value="minor_damage">Rusak Ringan</option>
            <option value="heavy_damage">Rusak Berat</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Catatan
          </label>
          <textarea
            value={returnNotes}
            onChange={(e) => setReturnNotes(e.target.value)}
            className="input"
            rows={2}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </ConfirmModal>
  );
}
