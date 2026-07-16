"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { QRCodeSVG } from "qrcode.react";
import { Pencil, Download, ArrowLeft, Image as ImageIcon, History as HistoryIcon, Power, FileBarChart, FileDown } from "lucide-react";
import { db } from "@/lib/firebase";
import { writeAssetLog } from "@/lib/firestore-helpers";
import {
  computeHealthScore,
  exportToExcel,
  healthScoreLabel,
  isMaintenanceOverdue,
  todayStamp,
} from "@/lib/reports";
import ConfirmModal from "@/components/ConfirmModal";
import { useAuth } from "@/lib/auth-context";
import { Asset, AssetBorrowing, AssetIssueTicket, AssetLog } from "@/lib/types";
import {
  ASSET_STATUS_COLOR,
  ASSET_STATUS_LABEL,
  BORROWING_STATUS_COLOR,
  BORROWING_STATUS_LABEL,
  CONDITION_LABEL,
  formatCurrency,
  formatDate,
  getQrImageSettings,
} from "@/lib/utils";
import ProtectedLayout from "@/components/ProtectedLayout";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import Link from "next/link";

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { assetUser, role } = useAuth();
  const [asset, setAsset] = useState<Asset | null>(null);
  const [photoImgError, setPhotoImgError] = useState(false);
  const [borrowings, setBorrowings] = useState<AssetBorrowing[]>([]);
  const [logs, setLogs] = useState<AssetLog[]>([]);
  const [tickets, setTickets] = useState<AssetIssueTicket[]>([]);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  const canManage = role === "super_admin" || role === "asset_admin";

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "assets", id), (snap) => {
      if (snap.exists()) {
        const data = { id: snap.id, ...snap.data() } as Asset;
        console.debug("[Asset Detail] loaded photo fields:", {
          photoUrl: data.photoUrl,
          photoThumbnailUrl: data.photoThumbnailUrl,
          photoFileName: data.photoFileName,
          photoDriveFileId: data.photoDriveFileId,
        });
        setAsset(data);
      } else {
        setAsset(null);
      }
    });
    return () => unsub();
  }, [id]);

  useEffect(() => {
    const q = query(
      collection(db, "asset_borrowings"),
      where("assetId", "==", id),
      orderBy("borrowedAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setBorrowings(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetBorrowing))
      );
    });
    return () => unsub();
  }, [id]);

  useEffect(() => {
    const q = query(
      collection(db, "asset_logs"),
      where("assetId", "==", id),
      orderBy("timestamp", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetLog)));
    });
    return () => unsub();
  }, [id]);

  useEffect(() => {
    const q = query(collection(db, "asset_issue_tickets"), where("assetId", "==", id));
    const unsub = onSnapshot(q, (snap) => {
      setTickets(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetIssueTicket)));
    });
    return () => unsub();
  }, [id]);

  if (!asset) {
    return (
      <ProtectedLayout>
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 rounded-full border-2 border-slate-200 border-t-slate-900 animate-spin" />
        </div>
      </ProtectedLayout>
    );
  }

  console.debug("[Asset Photo] drive file id:", asset.photoDriveFileId);
  const photoImageSrc = asset.photoDriveFileId
    ? `/api/drive-image?fileId=${asset.photoDriveFileId}`
    : null;
  console.debug("[Asset Photo] image src:", photoImageSrc);

  const handleDeactivate = async () => {
    setDeactivating(true);
    try {
      await updateDoc(doc(db, "assets", asset.id), {
        assetStatus: "inactive",
        updatedAt: serverTimestamp(),
      });
      await writeAssetLog({
        assetId: asset.id,
        assetName: asset.assetName,
        assetCode: asset.assetCode,
        action: "deactivate",
        userUid: assetUser?.uid || "",
        userName: assetUser?.name || "",
        detail: "Aset dinonaktifkan",
      });
      setDeactivateOpen(false);
    } finally {
      setDeactivating(false);
    }
  };

  const unresolvedTicketCount = tickets.filter(
    (t) => !["resolved", "closed", "rejected"].includes(t.status)
  ).length;
  const healthScore = computeHealthScore({
    asset,
    unresolvedTicketCount,
    resolvedLast30dCount: 0,
    hasOverdueMaintenance: isMaintenanceOverdue(asset),
  });

  const downloadQr = () => {
    const svg = document.getElementById("asset-qr-svg");
    if (!svg) return;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svg);
    const blob = new Blob([source], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${asset.assetCode}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ProtectedLayout>
      <button
        onClick={() => router.push("/assets")}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-3"
      >
        <ArrowLeft size={15} />
        Kembali ke Assets
      </button>

      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
                {asset.assetName}
              </h1>
              <Badge
                label={ASSET_STATUS_LABEL[asset.assetStatus]}
                colorClass={ASSET_STATUS_COLOR[asset.assetStatus]}
              />
            </div>
            <p className="text-sm text-slate-500 mt-0.5">{asset.assetCode}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {canManage && (
            <button
              onClick={() => router.push(`/assets/${asset.id}/edit`)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium hover:bg-slate-50 shadow-sm"
            >
              <Pencil size={15} />
              Edit
            </button>
          )}
          {role === "super_admin" && (
            <button
              onClick={() => setDeactivateOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 shadow-sm"
            >
              <Power size={15} />
              Nonaktifkan
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-400 -mt-4 mb-6">
        Peminjaman asset hanya dapat dilakukan melalui scan QR.
      </p>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Section title="Informasi Aset">
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Info label="Kategori" value={asset.categoryName} />
              <Info label="Subkategori" value={asset.subCategory} />
              <Info label="Merk" value={asset.brand} />
              <Info label="Model" value={asset.model} />
              <Info label="Serial Number" value={asset.serialNumber} />
              <Info label="IMEI" value={asset.imei} />
              <Info label="Deskripsi" value={asset.description} full />
            </div>
          </Section>

          <Section title="Kepemilikan & Lokasi">
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Info label="Perusahaan Pemilik" value={asset.companyOwnerName} />
              <Info label="Divisi Pengguna" value={asset.divisionOwnerName} />
              <Info label="Lokasi" value={asset.location} />
              <Info label="Penanggung Jawab" value={asset.responsiblePersonName} />
              <Info label="Status Kepemilikan" value={asset.ownershipStatus} />
            </div>
          </Section>

          {canManage && (
            <Section title="Finance / Bukti Pembelian">
              <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Info label="Tanggal Pembelian" value={formatDate(asset.purchaseDate)} />
                <Info label="Harga Beli" value={formatCurrency(asset.purchasePrice)} />
                <Info label="Vendor" value={asset.vendorName} />
                <Info label="Nomor Invoice" value={asset.invoiceNumber} />
                <Info label="Sumber Dana" value={asset.fundingSource} />
                <Info label="Metode Pembelian" value={asset.purchaseMethod} />
                <Info label="Estimasi Umur" value={asset.estimatedUsefulLife} />
                <Info label="Catatan Finance" value={asset.financeNotes} full />
                {asset.invoiceFileUrl && (
                  <div className="sm:col-span-2">
                    <a
                      href={asset.invoiceFileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline"
                    >
                      Lihat file invoice
                    </a>
                  </div>
                )}
              </div>
            </Section>
          )}

          <Section title="Histori Peminjaman">
            {borrowings.length === 0 ? (
              <EmptyState
                icon={HistoryIcon}
                title="Belum ada riwayat peminjaman"
              />
            ) : (
              <div className="divide-y divide-slate-100">
                {borrowings.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between text-sm py-3 first:pt-0 last:pb-0"
                  >
                    <div>
                      <p className="font-medium text-slate-800">{b.borrowedByName}</p>
                      <p className="text-xs text-slate-400">
                        {formatDate(b.borrowedAt)} — {b.returnedAt ? formatDate(b.returnedAt) : "sekarang"}
                      </p>
                    </div>
                    <Badge
                      label={BORROWING_STATUS_LABEL[b.status]}
                      colorClass={BORROWING_STATUS_COLOR[b.status]}
                    />
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Log Aktivitas">
            {logs.length === 0 ? (
              <EmptyState icon={HistoryIcon} title="Belum ada log aktivitas" />
            ) : (
              <div className="divide-y divide-slate-100">
                {logs.map((l) => (
                  <div key={l.id} className="text-sm py-3 first:pt-0 last:pb-0">
                    <p className="text-slate-800">
                      <span className="font-medium">{l.userName}</span> — {l.action}
                    </p>
                    <p className="text-xs text-slate-400">
                      {formatDate(l.timestamp)} {l.detail && `· ${l.detail}`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        <div className="space-y-5">
          <Section title="Status">
            <div className="flex flex-col gap-2.5">
              <div>
                <Badge
                  label={ASSET_STATUS_LABEL[asset.assetStatus]}
                  colorClass={ASSET_STATUS_COLOR[asset.assetStatus]}
                />
              </div>
              <p className="text-sm text-slate-500">
                Kondisi: <span className="text-slate-800 font-medium">{CONDITION_LABEL[asset.condition]}</span>
              </p>
              {asset.currentBorrowerName && (
                <p className="text-sm text-slate-500">
                  Dipinjam oleh: <span className="text-slate-800 font-medium">{asset.currentBorrowerName}</span>
                </p>
              )}
              <p className="text-xs text-slate-400">
                {asset.isBorrowable ? "Bisa dipinjam" : "Tidak bisa dipinjam"}
                {asset.requiresApproval ? " · Butuh approval" : ""}
              </p>
              {asset.accessories && (
                <p className="text-xs text-slate-400">Aksesoris: {asset.accessories}</p>
              )}
              {asset.operationalNotes && (
                <p className="text-xs text-slate-400">{asset.operationalNotes}</p>
              )}
            </div>
          </Section>

          <Section title="Foto Aset">
            {photoImageSrc && !photoImgError ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoImageSrc}
                alt={asset.photoFileName || "Foto asset"}
                className="w-full rounded-xl object-cover"
                onError={() => {
                  console.debug("[Asset Photo] image load failed:", photoImageSrc);
                  setPhotoImgError(true);
                }}
              />
            ) : (
              <EmptyState
                icon={ImageIcon}
                title={photoImgError ? "Foto belum dapat ditampilkan" : "Belum ada foto"}
                description={asset.photoFileName}
              />
            )}
          </Section>

          <Section title="QR Code" anchorId="qr">
            <div className="flex flex-col items-center gap-4">
              {asset.qrCodeValue ? (
                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                  <QRCodeSVG
                    id="asset-qr-svg"
                    value={asset.qrCodeValue}
                    size={160}
                    level="H"
                    includeMargin
                    imageSettings={getQrImageSettings(160)}
                  />
                </div>
              ) : (
                <p className="text-xs text-slate-400 text-center py-8">
                  QR belum tersedia untuk aset ini.
                </p>
              )}
              <button
                onClick={downloadQr}
                disabled={!asset.qrCodeValue}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 w-full justify-center disabled:opacity-50"
              >
                <Download size={14} />
                Download QR
              </button>
            </div>
          </Section>

          {canManage && (
            <Section title="Asset Report Summary">
              <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                <Info label="Health Score" value={String(healthScore)} />
                <Info label="Label" value={healthScoreLabel(healthScore)} />
                <Info label="Total Ticket" value={String(tickets.length)} />
                <Info
                  label="Ticket Belum Selesai"
                  value={String(
                    tickets.filter((t) => !["resolved", "closed", "rejected"].includes(t.status)).length
                  )}
                />
                <Info label="Total Peminjaman" value={String(borrowings.length)} />
                <Info label="Last Maintenance" value={formatDate(asset.lastMaintenanceAt)} />
                <Info label="Next Maintenance" value={formatDate(asset.nextMaintenanceAt)} />
                <Info label="Total Nilai Beli" value={formatCurrency(asset.purchasePrice)} />
              </div>
              <div className="flex gap-2">
                <Link
                  href={`/reports/assets/${asset.id}`}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-3 py-2 text-sm font-medium hover:brightness-105"
                >
                  <FileBarChart size={14} />
                  Lihat Full Report
                </Link>
                <button
                  onClick={() =>
                    exportToExcel(
                      `AssetView-Asset-Report-${asset.assetCode}-${todayStamp()}.xlsx`,
                      "Asset Report",
                      [
                        {
                          Asset: asset.assetName,
                          "Kode Asset": asset.assetCode,
                          "Health Score": healthScore,
                          Label: healthScoreLabel(healthScore),
                          "Total Ticket": tickets.length,
                          "Total Peminjaman": borrowings.length,
                          "Last Maintenance": formatDate(asset.lastMaintenanceAt),
                          "Next Maintenance": formatDate(asset.nextMaintenanceAt),
                        },
                      ]
                    )
                  }
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <FileDown size={14} />
                  Export
                </button>
              </div>
            </Section>
          )}
        </div>
      </div>

      <ConfirmModal
        open={deactivateOpen}
        title="Nonaktifkan Asset"
        description={`Asset "${asset.assetName}" akan ditandai nonaktif.`}
        confirmLabel={deactivating ? "Memproses..." : "Nonaktifkan"}
        danger
        onConfirm={handleDeactivate}
        onCancel={() => setDeactivateOpen(false)}
      />
    </ProtectedLayout>
  );
}

function Section({
  title,
  children,
  anchorId,
}: {
  title: string;
  children: React.ReactNode;
  anchorId?: string;
}) {
  return (
    <div
      id={anchorId}
      className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 scroll-mt-20"
    >
      <h2 className="font-semibold mb-4 text-slate-800">{title}</h2>
      {children}
    </div>
  );
}

function Info({ label, value, full }: { label: string; value?: string; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <p className="text-xs text-slate-400 mb-0.5">{label}</p>
      <p className="text-slate-800 font-medium">{value || "-"}</p>
    </div>
  );
}
