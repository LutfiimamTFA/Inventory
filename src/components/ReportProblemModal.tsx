"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection, doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { AlertTriangle, Check, ChevronLeft, UploadCloud, X } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { Asset, AssetBorrowing, AssetIssueTicket, IssueImpactLevel, IssueSymptomType } from "@/lib/types";
import {
  generateTicketNumber,
  generateQueueNumber,
  IMPACT_TO_PRIORITY,
  fetchActiveUsersByRoles,
} from "@/lib/firestore-helpers";
import { getAssetNumber } from "@/lib/assets/inventory";
import { createAssetIssueTicket } from "@/lib/assets/create-asset-issue-ticket";
import { uploadToDrive } from "@/lib/drive-upload";
import { createAssetNotification } from "@/lib/notifications";
import { fetchLocationPicSnapshot } from "@/lib/locations";
import { formatDateTimeLong, hasActiveIssueTicket } from "@/lib/utils";
import { getAssetIssueReportContext, getAssetIssueSourceFields } from "@/lib/asset-issue-reporting";

// Section "Perbaiki flow Laporkan Masalah" — info yang dikembalikan ke
// pemanggil (asset-action/page.tsx) SEGERA setelah ticket sukses dibuat,
// dipakai untuk update state `asset` di parent secara OPTIMISTIS (tanpa
// menunggu refetch dari Firestore) — supaya kalau user langsung menekan
// "Laporkan Masalah" lagi, guard "sudah ada laporan aktif" di bawah SELALU
// melihat data terbaru, bukan data basi yang masih memungkinkan ticket ganda.
export interface ReportedIssueSummary {
  ticketId: string;
  ticketNumber: string;
  symptomLabel: string;
  note: string;
}

// Section 4/5 — "Laporkan Masalah": SATU entry point untuk seluruh masalah
// asset dari Scan QR (gabungan bekas "Laporkan Temuan" + "Laporkan
// Ketidaksesuaian"). Konteks asset SELALU diambil dari QR (prop `asset`),
// user tidak pernah diminta mencari asset lagi. TIDAK memakai Employee
// Directory sama sekali — nama/email pelapor cukup dari useAuth().
interface ProblemCategory {
  key: string;
  label: string;
  symptomType: IssueSymptomType;
  impactLevel: IssueImpactLevel;
}

const PROBLEM_CATEGORIES: ProblemCategory[] = [
  { key: "condition", label: "Kondisi asset / rusak", symptomType: "Rusak Fisik", impactLevel: "Tidak Bisa Dipakai" },
  { key: "data", label: "Data asset tidak sesuai", symptomType: "Data Tidak Sesuai", impactLevel: "Mengganggu Pekerjaan" },
  { key: "location", label: "Lokasi / PIC tidak sesuai", symptomType: "Lokasi Tidak Sesuai", impactLevel: "Mengganggu Pekerjaan" },
  { key: "qr", label: "QR tidak sesuai", symptomType: "QR Tidak Sesuai", impactLevel: "Mengganggu Pekerjaan" },
  { key: "photo", label: "Foto asset tidak sesuai", symptomType: "Foto Tidak Sesuai", impactLevel: "Masih Bisa Dipakai" },
  { key: "not_found", label: "Asset tidak ditemukan di lokasi", symptomType: "Aset Tidak Ditemukan", impactLevel: "Tidak Bisa Dipakai" },
  { key: "other", label: "Lainnya", symptomType: "Lainnya", impactLevel: "Mengganggu Pekerjaan" },
];

// Section 6 — logging per tahap PERSIS format yang diminta, supaya kalau
// gagal langsung ketahuan collection mana yang bermasalah (bukan cuma
// "gagal mengirim laporan Object" seperti sebelumnya).
function logStage(stage: string, action: "START" | "SUCCESS" | "FAILED") {
  console.info(`[Asset Report] stage=${stage} ${action}`);
}

function logStageError(
  stage: string,
  collectionName: string,
  error: unknown,
  context: { assetId?: string; uid?: string; role?: string }
) {
  logStage(stage, "FAILED");
  const err = error as { code?: string; message?: string };
  console.error("[Asset Report] FAILED", {
    stage,
    collection: collectionName,
    assetId: context.assetId,
    uid: context.uid,
    role: context.role,
    errorCode: err?.code,
    errorMessage: err?.message,
  });
}

export default function ReportProblemModal({
  asset,
  open,
  activeBorrowing = null,
  onClose,
  onSubmitted,
}: {
  asset: Asset;
  open: boolean;
  activeBorrowing?: AssetBorrowing | null;
  onClose: () => void;
  onSubmitted?: (info: ReportedIssueSummary) => void;
}) {
  const router = useRouter();
  const { assetUser, firebaseUser, role } = useAuth();
  const [category, setCategory] = useState<ProblemCategory | null>(null);
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [ticketNumber, setTicketNumber] = useState<string | null>(null);
  const [activeTicketStatusLabel, setActiveTicketStatusLabel] = useState<string | null>(null);

  const userUid = firebaseUser?.uid || assetUser?.uid || "";
  const userEmail = firebaseUser?.email || assetUser?.email || "";
  const userName = assetUser?.name || firebaseUser?.displayName || firebaseUser?.email || "User";
  const currentUserRole = role || assetUser?.role || "staff";

  const assetHasActiveIssue = hasActiveIssueTicket(asset);
  const isQhseRole = role === "super_admin" || role === "asset_admin";
  const activeTicketLink = asset.activeIssueTicketId
    ? isQhseRole
      ? `/maintenance?tab=staff-reports&ticketId=${asset.activeIssueTicketId}`
      : `/my-reports?ticketId=${asset.activeIssueTicketId}`
    : null;

  // Section 1/2 — cek laporan aktif SETIAP KALI modal dibuka (bukan cuma
  // dipercaya sekali di render sebelumnya). No. Laporan/Jenis Masalah/
  // Tanggal Lapor/Pelapor SELALU tersedia langsung dari `asset` (field-field
  // ini didenormalisasi ke dokumen asset saat ticket dibuat, dan dokumen
  // asset boleh dibaca siapa pun yang aktif) — getDoc ke ticket aslinya di
  // bawah HANYA best-effort untuk melengkapi Status asli; kalau ticket itu
  // milik pelapor lain dan rules menolak baca (staff biasa bukan QHSE),
  // kegagalan itu non-fatal, layar tetap menampilkan info dari `asset`.
  useEffect(() => {
    if (!open) return;
    logStage("check_active_ticket", "START");
    queueMicrotask(() => setActiveTicketStatusLabel(null));
    if (!hasActiveIssueTicket(asset) || !asset.activeIssueTicketId) {
      logStage("check_active_ticket", "SUCCESS");
      return;
    }
    let cancelled = false;
    getDoc(doc(db, "asset_issue_tickets", asset.activeIssueTicketId))
      .then((snap) => {
        if (cancelled) return;
        if (snap.exists()) {
          const data = snap.data() as AssetIssueTicket;
          setActiveTicketStatusLabel(data.statusLabel || data.status || null);
        }
        logStage("check_active_ticket", "SUCCESS");
      })
      .catch((err) => {
        console.warn("[Asset Report] gagal mengambil detail ticket aktif (non-fatal)", {
          ticketId: asset.activeIssueTicketId,
          errorCode: (err as { code?: string })?.code,
        });
        logStage("check_active_ticket", "SUCCESS");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, asset.id, asset.activeIssueTicketId, asset.hasActiveIssue]);

  if (!open) return null;

  const resetAndClose = () => {
    setCategory(null);
    setDescription("");
    setFile(null);
    setError("");
    setSubmitting(false);
    setTicketNumber(null);
    onClose();
  };

  const handleSubmit = async () => {
    if (submitting || !category) return;
    setError("");

    if (!description.trim()) {
      setError("Deskripsi wajib diisi.");
      return;
    }
    if (!userUid) {
      setError("Sesi login tidak ditemukan. Silakan login ulang.");
      return;
    }

    // Section 1/2 — jaring pengaman KEDUA persis sebelum create: walau UI
    // sudah menutup form dan menampilkan layar "sudah ada laporan aktif"
    // saat assetHasActiveIssue true, cek ULANG di sini supaya race (mis. dua
    // tab/perangkat dibuka bersamaan pada asset yang sama) tidak pernah
    // menghasilkan ticket ganda.
    if (hasActiveIssueTicket(asset)) {
      setError("Aset ini sudah memiliki laporan aktif. Tutup lalu buka ulang untuk melihat laporan tersebut.");
      return;
    }

    const reportContext = getAssetIssueReportContext({
      user: { uid: userUid, name: userName, email: userEmail, role: currentUserRole },
      asset,
      activeBorrowing,
      allowQrPhysicalObservation: true,
    });
    if (!reportContext.canReport) {
      setError(reportContext.reason || "Anda belum memiliki hubungan yang jelas dengan aset ini.");
      return;
    }

    const issueSourceFields = getAssetIssueSourceFields({ context: reportContext, asset, activeBorrowing });
    const logContext = { assetId: asset.id, uid: userUid, role: currentUserRole };

    setSubmitting(true);

    let attachmentUrls: string[] = [];
    let attachmentFiles: string[] = [];
    if (file) {
      try {
        logStage("upload_attachment", "START");
        const uploaded = await uploadToDrive(file, "issue_attachment", {
          assetCode: asset.assetCode,
          assetName: asset.assetName,
        });
        attachmentUrls = [uploaded.url];
        attachmentFiles = [uploaded.fileName];
        logStage("upload_attachment", "SUCCESS");
      } catch (err) {
        logStageError("upload_attachment", "google_drive", err, logContext);
        setError("Gagal mengunggah foto bukti. Coba lagi atau kirim tanpa foto.");
        setSubmitting(false);
        return;
      }
    }

    let ticketNum = "";
    let queueNum = "";
    try {
      ticketNum = await generateTicketNumber();
      queueNum = await generateQueueNumber();
    } catch (err) {
      console.warn("[Asset Report] gagal generate nomor tiket, memakai fallback", err);
      const fallbackSuffix = Date.now();
      ticketNum = `TKT-${new Date().getFullYear()}-${fallbackSuffix}`;
      queueNum = `Q-${fallbackSuffix}`;
    }

    const priority = IMPACT_TO_PRIORITY[category.impactLevel];
    const locationText =
      asset.locationText ||
      asset.location ||
      [asset.buildingName, asset.floor, asset.roomName, asset.areaName].filter(Boolean).join(" / ") ||
      "-";
    const locationId =
      asset.locationId || asset.areaId || asset.roomId || asset.floorId || asset.buildingId || "asset-location";

    const locationPicSnapshot = await fetchLocationPicSnapshot(locationId).catch((err) => {
      console.warn("[Asset Report] gagal mengambil PIC lokasi (non-fatal)", { locationId, err });
      return { locationId, locationExists: false, locationPicUid: null, locationPicName: null, locationPicEmail: null };
    });

    const ticketPayload = {
      ticketNumber: ticketNum,
      queueNumber: queueNum,
      reportType: "asset_issue" as const,
      source: "staff_report" as const,
      title: `${category.label} - ${asset.assetName}`,
      assetId: asset.id,
      assetName: asset.assetName,
      assetCode: asset.assetCode,
      assetNumber: getAssetNumber(asset),
      assetCategory: asset.categoryName || "",
      assetLocation: locationText,
      locationId,
      buildingId: asset.buildingId || null,
      floorId: asset.floorId || null,
      roomId: asset.roomId || null,
      areaId: asset.areaId || null,
      buildingName: asset.buildingName || "",
      floorName: asset.floor || "",
      roomName: asset.roomName || "",
      areaName: asset.areaName || "",
      locationText,
      reportedByUid: userUid,
      reportedByName: userName,
      reportedByEmail: userEmail,
      reporterUid: userUid,
      reportedAt: serverTimestamp(),
      createdByUid: userUid,
      createdByName: userName,
      createdByEmail: userEmail,
      symptomType: category.symptomType,
      impactLevel: category.impactLevel,
      description: description.trim(),
      attachmentUrls,
      attachmentFiles,
      photoUrls: attachmentUrls,
      priority,
      status: "reported" as const,
      statusLabel: "Laporan Masuk",
      staffStatusLabel: "Laporan Dikirim",
      ...issueSourceFields,
      locationPicUid: locationPicSnapshot.locationPicUid,
      locationPicName: locationPicSnapshot.locationPicName,
      locationPicEmail: locationPicSnapshot.locationPicEmail,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedByUid: userUid,
      updatedByName: userName,
    };

    let ticketRef: { id: string };
    try {
      logStage("create_ticket", "START");
      const result = await createAssetIssueTicket({
        ticketPayload,
        ticketNumber: ticketNum,
        asset,
        userUid,
        userName,
        symptomLabel: category.symptomType,
        note: description.trim(),
        impactLabel: category.impactLevel,
      });
      ticketRef = { id: result.ticketId };
      logStage("create_ticket", "SUCCESS");
      // Section 4 — update assets/{assetId} (hasActiveIssue/activeIssueTicketId/
      // condition="reported_issue") terjadi dalam batch ATOMIK yang SAMA dengan
      // create_ticket di atas (lihat createAssetIssueTicket) — log stage
      // terpisah di sini murni supaya observability-nya cocok dengan tahap yang
      // diminta, bukan berarti ini write kedua yang bisa gagal sendiri.
      logStage("update_asset", "SUCCESS");
    } catch (err) {
      logStageError("create_ticket", "asset_issue_tickets", err, logContext);
      setError(
        (err as { code?: string })?.code === "permission-denied"
          ? "Laporan belum bisa dikirim karena izin data belum sesuai. Hubungi Asset Admin."
          : "Gagal mengirim laporan. Coba lagi."
      );
      setSubmitting(false);
      return;
    }

    // Section 5 — asset_verification_logs SEKARANG hanya audit trail
    // TAMBAHAN setelah ticket utama + update asset berhasil, TIDAK PERNAH
    // jadi syarat toast sukses. Kegagalannya non-fatal (lihat logStageError).
    try {
      logStage("verification_log", "START");
      await addDoc(collection(db, "asset_verification_logs"), {
        assetId: asset.id,
        assetCode: asset.assetCode,
        ticketId: ticketRef.id,
        ticketNo: ticketNum,
        type: "issue_reported",
        action: "issue_reported",
        source: "asset_qr",
        reportedByUid: userUid,
        reportedByName: userName,
        performedByUid: userUid,
        performedByName: userName,
        performedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      logStage("verification_log", "SUCCESS");
    } catch (err) {
      logStageError("verification_log", "asset_verification_logs", err, logContext);
    }

    try {
      logStage("activity_log", "START");
      await addDoc(collection(db, "asset_issue_ticket_logs"), {
        ticketId: ticketRef.id,
        ticketNumber: ticketNum,
        action: "created",
        actionLabel: "Laporan dibuat",
        fromStatus: null,
        toStatus: "reported",
        message: `${userName} melaporkan "${category.label}" pada ${asset.assetName}`,
        note: "Laporan dibuat dari Scan QR (Laporkan Masalah)",
        createdAt: serverTimestamp(),
        createdByUid: userUid,
        createdByName: userName,
        reporterUid: userUid,
      });
      logStage("activity_log", "SUCCESS");
    } catch (err) {
      logStageError("activity_log", "asset_issue_ticket_logs", err, logContext);
    }

    try {
      logStage("notification", "START");
      const qhseUsers = await fetchActiveUsersByRoles(["asset_admin", "super_admin"]);

      updateDoc(doc(db, "asset_issue_tickets", ticketRef.id), {
        unreadByUids: qhseUsers.map((u) => u.uid),
      }).catch((err) => logStageError("notification_unread_flag", "asset_issue_tickets", err, logContext));

      await Promise.all(
        qhseUsers.map((qhse) =>
          createAssetNotification({
            recipientUid: qhse.uid,
            recipientName: qhse.name || qhse.email,
            recipientRole: qhse.role,
            title: "Laporan Asset Baru",
            message: `${userName} melaporkan masalah pada ${asset.assetName} (${asset.assetCode}).`,
            type: "asset_issue_reported",
            priority,
            linkUrl: `/maintenance?tab=staff-reports&ticketId=${ticketRef.id}`,
            relatedType: "ticket",
            relatedId: ticketRef.id,
            relatedNumber: ticketNum,
            createdByUid: userUid,
            createdByName: userName,
            assetId: asset.id,
            ticketId: ticketRef.id,
            ticketNumber: ticketNum,
          })
        )
      );
      logStage("notification", "SUCCESS");
    } catch (err) {
      logStageError("notification", "asset_notifications", err, logContext);
    }

    if (locationPicSnapshot.locationPicUid && locationPicSnapshot.locationPicUid !== userUid) {
      try {
        logStage("notification_location_pic", "START");
        await createAssetNotification({
          recipientUid: locationPicSnapshot.locationPicUid,
          recipientName: locationPicSnapshot.locationPicName || locationPicSnapshot.locationPicEmail || "",
          recipientRole: "location_pic",
          title: "Laporan baru terdapat di lokasi tanggung jawab Anda.",
          message: `Laporan ${ticketNum} (${ticketPayload.title}) pada ${asset.assetName} di ${locationText}, dilaporkan oleh ${userName}.`,
          type: "location_pic_coordination",
          priority,
          linkUrl: `/assets/${asset.id}`,
          relatedType: "ticket",
          relatedId: ticketRef.id,
          relatedNumber: ticketNum,
          createdByUid: userUid,
          createdByName: userName,
        });
        logStage("notification_location_pic", "SUCCESS");
      } catch (err) {
        logStageError("notification_location_pic", "asset_notifications", err, logContext);
      }
    }

    // Section 6 — toast/layar sukses HANYA sampai titik ini, setelah
    // create_ticket + update_asset (batch atomik) benar-benar berhasil di
    // atas — verification_log/activity_log/notification di atas semuanya
    // best-effort dan TIDAK pernah membatalkan status sukses ini.
    setTicketNumber(ticketNum);
    setSubmitting(false);
    onSubmitted?.({
      ticketId: ticketRef.id,
      ticketNumber: ticketNum,
      symptomLabel: category.symptomType,
      note: description.trim(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">Laporkan Masalah</h3>
          <button type="button" onClick={resetAndClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        {ticketNumber ? (
          <div className="py-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <Check size={26} />
            </div>
            <p className="mb-1 font-medium text-slate-800">Laporan berhasil dikirim. Nomor tiket Anda:</p>
            <p className="mb-6 text-xl font-bold text-slate-900">{ticketNumber}</p>
            <button
              type="button"
              onClick={resetAndClose}
              className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              Tutup
            </button>
          </div>
        ) : assetHasActiveIssue ? (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-sm font-medium text-slate-800">{asset.assetName}</p>
              <p className="text-xs text-slate-400">{asset.assetCode}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Masih Ada Laporan Aktif</p>
                  <p className="mt-1 text-xs">
                    Asset ini sedang memiliki laporan yang masih dalam proses penanganan QHSE. Untuk menghindari
                    laporan ganda, laporan baru dapat dibuat setelah laporan sebelumnya selesai.
                  </p>
                </div>
              </div>

              <div className="mt-3 space-y-1.5 rounded-lg bg-white/70 px-3 py-2.5 text-xs">
                <InfoRow label="No. Laporan" value={asset.activeIssueTicketNo || "-"} />
                <InfoRow label="Jenis Masalah" value={asset.lastIssueSymptomLabel || "-"} />
                <InfoRow label="Status" value={activeTicketStatusLabel || "Sedang diproses"} />
                <InfoRow label="Tanggal Lapor" value={asset.issueReportedAt ? formatDateTimeLong(asset.issueReportedAt) : "-"} />
                <InfoRow label="Pelapor" value={asset.issueReportedByName || "-"} />
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {activeTicketLink && (
                  <button
                    type="button"
                    onClick={() => {
                      resetAndClose();
                      router.push(activeTicketLink);
                    }}
                    className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                  >
                    Lihat Laporan Aktif
                  </button>
                )}
                <button
                  type="button"
                  onClick={resetAndClose}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        ) : !category ? (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-sm font-medium text-slate-800">{asset.assetName}</p>
              <p className="text-xs text-slate-400">{asset.assetCode}</p>
            </div>
            <p className="text-xs font-medium text-slate-500">Pilih jenis masalah:</p>
            <div className="space-y-2">
              {PROBLEM_CATEGORIES.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCategory(c)}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-3.5 py-3 text-left text-sm font-medium text-slate-700 hover:border-blue-300 hover:bg-blue-50"
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <button
              type="button"
              onClick={() => setCategory(null)}
              className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-600"
            >
              <ChevronLeft size={14} />
              Ganti jenis masalah
            </button>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">Jenis Masalah</label>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-800">
                {category.label}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">
                Deskripsi <span className="text-red-500">*</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Jelaskan masalah yang Anda temukan..."
                className="input"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">
                Foto Bukti <span className="text-slate-400">(Optional)</span>
              </label>
              <label className="file-drop">
                <UploadCloud size={20} className="text-slate-400" />
                <span className="text-center text-xs text-slate-500">
                  {file ? file.name : "Klik atau drag & drop file di sini"}
                </span>
                <input
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </label>
            </div>

            {error && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 px-4 py-2.5 text-sm font-medium text-white shadow-md shadow-blue-900/20 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Mengirim..." : "Kirim Laporan"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-amber-700/70">{label}</span>
      <span className="truncate font-medium text-amber-900">{value}</span>
    </div>
  );
}
