"use client";

import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { Plus, Pencil, Power, Tags } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { AssetCategory } from "@/lib/types";
import ProtectedLayout from "@/components/ProtectedLayout";
import PageHeader from "@/components/PageHeader";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import ConfirmModal from "@/components/ConfirmModal";

export default function CategoriesPage() {
  const { firebaseUser, assetUser, role, loading } = useAuth();
  const authReady = !loading && !!firebaseUser && !!assetUser && !!role;
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AssetCategory | null>(null);
  const [toggleTarget, setToggleTarget] = useState<AssetCategory | null>(null);

  const [categoryName, setCategoryName] = useState("");
  const [categoryCode, setCategoryCode] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const canManage = role === "super_admin" || role === "asset_admin";

  useEffect(() => {
    if (!authReady) return;
    const q = query(collection(db, "asset_categories"), orderBy("categoryName"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        console.log("[CategoriesPage Listener] asset_categories success:", snap.size);
        setCategories(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetCategory))
        );
      },
      (error) => {
        console.error("[CategoriesPage Listener] asset_categories error:", error);
      }
    );
    return () => unsub();
  }, [authReady]);

  const openCreate = () => {
    setEditing(null);
    setCategoryName("");
    setCategoryCode("");
    setDescription("");
    setError("");
    setModalOpen(true);
  };

  const openEdit = (cat: AssetCategory) => {
    setEditing(cat);
    setCategoryName(cat.categoryName);
    setCategoryCode(cat.categoryCode);
    setDescription(cat.description || "");
    setError("");
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!categoryName.trim() || !categoryCode.trim()) {
      setError("Nama dan kode kategori wajib diisi.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (editing) {
        await updateDoc(doc(db, "asset_categories", editing.id), {
          categoryName: categoryName.trim(),
          categoryCode: categoryCode.trim().toUpperCase(),
          description: description.trim(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, "asset_categories"), {
          categoryName: categoryName.trim(),
          categoryCode: categoryCode.trim().toUpperCase(),
          description: description.trim(),
          status: "active",
          createdByUid: assetUser?.uid,
          createdByName: assetUser?.name,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setModalOpen(false);
    } catch {
      setError("Gagal menyimpan kategori.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!toggleTarget) return;
    await updateDoc(doc(db, "asset_categories", toggleTarget.id), {
      status: toggleTarget.status === "active" ? "inactive" : "active",
      updatedAt: serverTimestamp(),
    });
    setToggleTarget(null);
  };

  return (
    <ProtectedLayout>
      <PageHeader
        title="Categories"
        subtitle="Kelompokkan aset berdasarkan jenisnya agar lebih mudah dikelola."
        actions={
          canManage && (
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2.5 text-sm font-medium hover:brightness-105 shadow-md shadow-blue-900/20"
            >
              <Plus size={16} />
              Tambah Kategori
            </button>
          )
        }
      />

      {categories.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
          <EmptyState
            icon={Tags}
            title="Belum ada kategori"
            description="Tambahkan kategori pertama untuk mulai mengelompokkan aset."
            action={
              canManage && (
                <button
                  onClick={openCreate}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-800"
                >
                  <Plus size={16} />
                  Tambah Kategori
                </button>
              )
            }
          />
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.map((cat) => (
            <div
              key={cat.id}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Tags size={19} />
                </div>
                <Badge
                  label={cat.status === "active" ? "Aktif" : "Nonaktif"}
                  colorClass={
                    cat.status === "active"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-slate-100 text-slate-500 border-slate-200"
                  }
                />
              </div>
              <h3 className="font-semibold text-slate-800">{cat.categoryName}</h3>
              <p className="text-xs text-slate-400 mb-2">Kode: {cat.categoryCode}</p>
              <p className="text-sm text-slate-500 line-clamp-2 min-h-[2.5rem]">
                {cat.description || "Tidak ada deskripsi."}
              </p>
              {canManage && (
                <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
                  <button
                    onClick={() => openEdit(cat)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
                  >
                    <Pencil size={13} />
                    Edit
                  </button>
                  <button
                    onClick={() => setToggleTarget(cat)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-red-600"
                  >
                    <Power size={13} />
                    {cat.status === "active" ? "Nonaktifkan" : "Aktifkan"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={modalOpen}
        title={editing ? "Edit Kategori" : "Tambah Kategori"}
        confirmLabel={saving ? "Menyimpan..." : "Simpan"}
        onConfirm={handleSave}
        onCancel={() => setModalOpen(false)}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Nama Kategori
            </label>
            <input
              value={categoryName}
              onChange={(e) => setCategoryName(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Kode Kategori
            </label>
            <input
              value={categoryCode}
              onChange={(e) => setCategoryCode(e.target.value)}
              className="input"
              placeholder="mis. LAP, HP, AC"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Deskripsi
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input"
              rows={2}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </ConfirmModal>

      <ConfirmModal
        open={!!toggleTarget}
        title={
          toggleTarget?.status === "active"
            ? "Nonaktifkan Kategori"
            : "Aktifkan Kategori"
        }
        description={`Kategori "${toggleTarget?.categoryName}" akan diubah statusnya.`}
        confirmLabel="Ya, Lanjutkan"
        onConfirm={handleToggleStatus}
        onCancel={() => setToggleTarget(null)}
      />
    </ProtectedLayout>
  );
}
