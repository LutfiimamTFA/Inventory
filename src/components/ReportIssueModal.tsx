"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { AlertTriangle, X, UploadCloud, Check } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { Asset, AssetBorrowing, IssueImpactLevel, IssueSymptomType } from "@/lib/types";
import {
  generateTicketNumber,
  generateQueueNumber,
  IMPACT_TO_PRIORITY,
  writeAssetIssueLog,
  fetchActiveUsersByRoles,
} from "@/lib/firestore-helpers";
import { createAssetIssueTicket } from "@/lib/assets/create-asset-issue-ticket";
import { uploadToDrive } from "@/lib/drive-upload";
import { createAssetNotification } from "@/lib/notifications";
import { fetchLocationPicSnapshot } from "@/lib/locations";
import { hasActiveIssueTicket, isIssueTicketActive } from "@/lib/utils";
import {
  canOverrideActiveIssueTicket,
  getAssetIssueReportContext,
  getAssetIssueSourceFields,
  ISSUE_SYMPTOM_OPTIONS,
  isIssueEvidenceRequired,
} from "@/lib/asset-issue-reporting";

const IMPACT_OPTIONS: IssueImpactLevel[] = [
  "Masih Bisa Dipakai",
  "Mengganggu Pekerjaan",
  "Tidak Bisa Dipakai",
  "Darurat",
];

export default function ReportIssueModal({
  asset,
  open,
  activeBorrowing = null,
  allowQrPhysicalObservation = false,
  sourceQrScanLogId = null,
  onClose,
}: {
  asset: Asset;
  open: boolean;
  activeBorrowing?: AssetBorrowing | null;
  allowQrPhysicalObservation?: boolean;
  sourceQrScanLogId?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { assetUser, firebaseUser, role } = useAuth();
  const [symptomType, setSymptomType] = useState<IssueSymptomType | "">("");
  const [impactLevel, setImpactLevel] = useState<IssueImpactLevel | "">("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [ticketNumber, setTicketNumber] = useState<string | null>(null);
  // Section — Asset Admin/QHSE bisa membuat laporan KEDUA pada aset yang
  // sudah punya tiket aktif, TAPI hanya lewat konfirmasi eksplisit di sini
  // (bukan default) bahwa masalahnya memang berbeda.
  const [duplicateOverrideConfirmed, setDuplicateOverrideConfirmed] = useState(false);
  const evidenceRequiredBySymptom = isIssueEvidenceRequired(symptomType);
  const currentUidForUi = firebaseUser?.uid || assetUser?.uid || "";
  const currentEmailForUi = firebaseUser?.email || assetUser?.email || "";
  const currentNameForUi = assetUser?.name || firebaseUser?.displayName || firebaseUser?.email || "User";
  const canOverride = canOverrideActiveIssueTicket(role || assetUser?.role);
  const assetHasActiveIssue = hasActiveIssueTicket(asset);
  const blockedByActiveIssue = assetHasActiveIssue && !(duplicateOverrideConfirmed && canOverride);
  const reportContextForUi = getAssetIssueReportContext({
    user: currentUidForUi
      ? {
          uid: currentUidForUi,
          name: currentNameForUi,
          email: currentEmailForUi,
          role: assetUser?.role || "staff",
        }
      : null,
    asset,
    activeBorrowing,
    allowQrPhysicalObservation,
    sourceQrScanLogId,
    allowDuplicateOverride: duplicateOverrideConfirmed,
  });
  const photoRequired = evidenceRequiredBySymptom || reportContextForUi.requiresEvidence;
  const isActiveIssueReporter = !!currentUidForUi && asset.issueReportedByUid === currentUidForUi;

  if (!open) return null;

  const resetAndClose = () => {
    setSymptomType("");
    setImpactLevel("");
    setDescription("");
    setFile(null);
    setError("");
    setTicketNumber(null);
    setDuplicateOverrideConfirmed(false);
    onClose();
  };

  const activeTicketLink = asset.activeIssueTicketId
    ? canOverride
      ? `/maintenance?tab=staff-reports&ticketId=${asset.activeIssueTicketId}`
      : `/my-reports?ticketId=${asset.activeIssueTicketId}`
    : null;

  const handleSubmit = async () => {
    if (submitting) return;

    setError("");
    if (!symptomType) {
      setError("Jenis kendala wajib dipilih.");
      return;
    }
    if (!impactLevel) {
      setError("Dampak wajib dipilih.");
      return;
    }
    if (!description.trim()) {
      setError("Catatan kendala wajib diisi.");
      return;
    }
    if (photoRequired && !file) {
      setError("Foto/video bukti wajib diunggah untuk laporan ini.");
      return;
    }

    // Section B — UID dari Firebase Auth dulu (SELALU sama dengan
    // request.auth.uid yang dipakai rules), assetUser cuma pelengkap
    // nama/email. Sebelumnya reportedByUid/createdByUid pakai assetUser?.uid
    // saja — kalau assetUser belum sempat termuat saat submit, field itu
    // jadi "" (!= request.auth.uid) dan create DITOLAK rules (permission-
    // denied), padahal user sudah login sah.
    const userUid = firebaseUser?.uid || assetUser?.uid;
    const userEmail = firebaseUser?.email || assetUser?.email || "";
    const currentUserName = assetUser?.name || firebaseUser?.displayName || firebaseUser?.email || "User";

    if (!userUid) {
      setError("Sesi login tidak ditemukan. Silakan login ulang.");
      return;
    }

    const reportContext = getAssetIssueReportContext({
      user: {
        uid: userUid,
        name: currentUserName,
        email: userEmail,
        role: assetUser?.role || "staff",
      },
      asset,
      activeBorrowing,
      allowQrPhysicalObservation,
      sourceQrScanLogId,
      allowDuplicateOverride: duplicateOverrideConfirmed,
    });

    if (!reportContext.canReport) {
      setError(reportContext.reason || "Anda belum memiliki hubungan yang jelas dengan aset ini.");
      return;
    }

    // Section — validasi ULANG di submit (bukan cuma di tampilan): baca
    // ulang dokumen asset TERBARU dari Firestore (prop `asset` bisa basi
    // kalau modal sudah lama terbuka), lalu — sebagai jaring pengaman kedua
    // — coba query tiket aktif berdasarkan assetId. Query collection ini
    // bisa permission-denied untuk staff biasa (rules asset_issue_tickets
    // membatasi baca ke tiket miliknya sendiri) — itu SENGAJA ditangkap dan
    // diabaikan (non-fatal), karena field hasActiveIssue/activeIssueTicketId
    // pada dokumen asset (yang semua orang boleh baca) sudah jadi sumber
    // kebenaran utama.
    if (asset.id && !duplicateOverrideConfirmed) {
      try {
        const freshAssetSnap = await getDoc(doc(db, "assets", asset.id));
        const freshAsset = freshAssetSnap.exists() ? (freshAssetSnap.data() as Record<string, unknown>) : {};
        const freshHasActiveIssue =
          freshAsset.hasActiveIssue === true ||
          freshAsset.condition === "reported_issue" ||
          freshAsset.assetStatus === "inspection_required" ||
          Boolean(freshAsset.activeIssueTicketId);

        let hasActiveTicketInCollection = false;
        if (!freshHasActiveIssue) {
          try {
            const ticketsSnap = await getDocs(
              query(collection(db, "asset_issue_tickets"), where("assetId", "==", asset.id))
            );
            hasActiveTicketInCollection = ticketsSnap.docs.some((d) => isIssueTicketActive(d.data().status));
          } catch (queryErr) {
            console.warn(
              "[Asset Issue Report] gagal query tiket aktif berdasarkan assetId (non-fatal, dilewati)",
              queryErr
            );
          }
        }

        if (freshHasActiveIssue || hasActiveTicketInCollection) {
          setError(
            "Aset ini sudah memiliki laporan aktif. Silakan buka laporan tersebut untuk menambahkan informasi atau bukti."
          );
          return;
        }
      } catch (err) {
        console.warn("[Asset Issue Report] gagal validasi ulang status aset (non-fatal, lanjut submit)", err);
      }
    }

    const issueSourceFields = getAssetIssueSourceFields({
      context: reportContext,
      asset,
      activeBorrowing,
    });

    setSubmitting(true);
    setError("");

    let attachmentUrls: string[] = [];
    let attachmentFiles: string[] = [];
    try {
      console.log("[Asset Issue Report] START prepare attachment", { hasFile: !!file });
      if (file) {
        const uploaded = await uploadToDrive(file, "issue_attachment", {
          assetCode: asset.assetCode,
          assetName: asset.assetName,
        });
        attachmentUrls = [uploaded.url];
        attachmentFiles = [uploaded.fileName];
      }
      console.log("[Asset Issue Report] SUCCESS prepare attachment");
    } catch (error) {
      console.error("[Asset Issue Report Submit Error] FAILED prepare attachment", {
        assetId: asset?.id,
        assetCode: asset?.assetCode,
        errorCode: (error as { code?: string })?.code,
        errorMessage: (error as { message?: string })?.message,
        errorName: (error as { name?: string })?.name,
      });
      setError("Gagal mengunggah lampiran. Coba lagi atau kirim tanpa lampiran.");
      setSubmitting(false);
      return;
    }

    // Section C — generateTicketNumber/generateQueueNumber query COLLECTION
    // asset_issue_tickets tanpa filter kepemilikan untuk hitung nomor urut.
    // Untuk staff biasa ini BISA permission-denied (rules asset_issue_tickets
    // membatasi baca ke tiket sendiri) — jangan sampai itu menggagalkan
    // seluruh laporan, fallback ke nomor berbasis waktu.
    let ticketNum = "";
    let queueNum = "";
    try {
      ticketNum = await generateTicketNumber();
      queueNum = await generateQueueNumber();
    } catch (error) {
      console.warn("[Asset Issue Report] gagal generate nomor tiket, memakai fallback", {
        errorCode: (error as { code?: string })?.code,
        errorMessage: (error as { message?: string })?.message,
      });
      const fallbackSuffix = Date.now();
      ticketNum = `TKT-${new Date().getFullYear()}-${fallbackSuffix}`;
      queueNum = `Q-${fallbackSuffix}`;
    }

    const priority = IMPACT_TO_PRIORITY[impactLevel];
    const locationText =
      asset.locationText ||
      asset.location ||
      [asset.buildingName, asset.floor, asset.roomName, asset.areaName].filter(Boolean).join(" / ") ||
      "-";
    const locationId =
      asset.locationId || asset.areaId || asset.roomId || asset.floorId || asset.buildingId || "asset-location";

    // Section 1 — PIC LOKASI (penanggung jawab AREA) diambil dari master
    // asset_locations/{locationId}, BUKAN dari asset.picUid/operationalPicUid/
    // currentHolderUid/currentBorrowerUid/borrowedByUid — lihat
    // lib/locations.ts fetchLocationPicSnapshot. Kegagalan fetch tidak boleh
    // menggagalkan laporan, cukup fallback ke "belum ditentukan".
    const locationPicSnapshot = await fetchLocationPicSnapshot(locationId).catch((err) => {
      console.warn("[Asset Issue Report] gagal mengambil PIC lokasi (non-fatal)", { locationId, err });
      return { locationId, locationExists: false, locationPicUid: null, locationPicName: null, locationPicEmail: null };
    });

    const ticketPayload = {
      ticketNumber: ticketNum,
      queueNumber: queueNum,
      reportType: "asset_issue",
      source: "staff_report" as const,
      title: `${symptomType} - ${asset.assetName}`,
      assetId: asset.id,
      assetName: asset.assetName,
      assetCode: asset.assetCode,
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
      reportedByName: currentUserName,
      reportedByEmail: userEmail,
      reportedAt: serverTimestamp(),
      createdByUid: userUid,
      createdByName: currentUserName,
      createdByEmail: userEmail,
      symptomType,
      impactLevel,
      description: description.trim(),
      attachmentUrls,
      attachmentFiles,
      photoUrls: attachmentUrls,
      priority,
      status: "reported" as const,
      statusLabel: "Laporan Masuk",
      staffStatusLabel: "Laporan Dikirim",
      ...issueSourceFields,
      // Section 8 — locationPicUid/Name/Email disimpan HANYA untuk info dan
      // notifikasi (lihat blok notifikasi di bawah) — TIDAK ADA field
      // approval/verifikasi PIC Lokasi apa pun di sini.
      locationPicUid: locationPicSnapshot.locationPicUid,
      locationPicName: locationPicSnapshot.locationPicName,
      locationPicEmail: locationPicSnapshot.locationPicEmail,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedByUid: userUid,
      updatedByName: currentUserName,
    };

    // Section A/B/E/2 — INI SATU-SATUNYA langkah yang boleh menggagalkan
    // submit, lewat service bersama createAssetIssueTicket (dipakai juga
    // oleh Buat Laporan tanpa QR) supaya ticket + kondisi sementara aset
    // ("Dilaporkan Bermasalah") SELALU ditulis dalam satu writeBatch, tidak
    // ada kondisi aset yang "nyangkut" tanpa tiket atau sebaliknya.
    // Log/notifikasi di bawah bersifat best-effort (try/catch masing-
    // masing) supaya kegagalannya TIDAK membuat laporan yang sudah
    // tersimpan malah dilaporkan gagal.
    let ticketRef: { id: string };
    try {
      console.log("[Asset Issue Report] START create ticket + update asset condition", {
        assetId: asset.id,
        assetCode: asset.assetCode,
        userUid,
        payloadKeys: Object.keys(ticketPayload),
      });
      const result = await createAssetIssueTicket({
        ticketPayload,
        ticketNumber: ticketNum,
        asset,
        userUid,
        userName: currentUserName,
        symptomLabel: symptomType || "",
        note: description.trim(),
        impactLabel: impactLevel || "Sedang",
      });
      ticketRef = { id: result.ticketId };
      console.log("[Asset Issue Report] SUCCESS create ticket + update asset condition", ticketRef.id);

      // Section B — verifikasi TERBACA (bukan cuma "commit tidak error"),
      // supaya kalau ada rules/cache aneh, langsung ketahuan dari log.
      const updatedAssetSnap = await getDoc(doc(db, "assets", asset.id));
      console.log("[Asset Issue Submit] VERIFY asset condition", {
        assetId: asset.id,
        assetCode: asset.assetCode,
        hasActiveIssue: updatedAssetSnap.data()?.hasActiveIssue,
        condition: updatedAssetSnap.data()?.condition,
        conditionLabel: updatedAssetSnap.data()?.conditionLabel,
        activeIssueTicketId: updatedAssetSnap.data()?.activeIssueTicketId,
        activeIssueTicketNo: updatedAssetSnap.data()?.activeIssueTicketNo,
      });
    } catch (error) {
      console.error("[Asset Issue Report Submit Error]", {
        assetId: asset?.id,
        assetCode: asset?.assetCode,
        assetName: asset?.assetName,

        userUid,
        userEmail,

        payloadKeys: Object.keys(ticketPayload || {}),
        requiredFields: {
          createdByUid: ticketPayload.createdByUid,
          reportType: ticketPayload.reportType,
          title: ticketPayload.title,
          description: ticketPayload.description,
          locationId: ticketPayload.locationId,
          locationText: ticketPayload.locationText,
          status: ticketPayload.status,
        },

        errorCode: (error as { code?: string })?.code,
        errorMessage: (error as { message?: string })?.message,
        errorName: (error as { name?: string })?.name,
        rawError:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : error,
      });
      setError(
        (error as { code?: string })?.code === "permission-denied"
          ? "Laporan belum bisa dikirim karena izin data belum sesuai. Cek field laporan atau rules."
          : "Gagal mengirim laporan. Coba lagi."
      );
      setSubmitting(false);
      return;
    }

    try {
      await writeAssetIssueLog({
        ticketId: ticketRef.id,
        ticketNumber: ticketNum,
        action: "create_ticket",
        newStatus: "reported",
        note: "Laporan kendala dibuat dari Scan QR",
        performedByUid: userUid,
        performedByName: currentUserName,
      });
    } catch (err) {
      console.warn("[Asset Issue Report] gagal membuat log tiket (non-fatal)", ticketRef.id, err);
    }

    // Section D — laporan masuk ke QHSE/Admin dulu (BUKAN Tim IT): badge
    // unread + notifikasi cuma untuk asset_admin/super_admin.
    try {
      const qhseUsers = await fetchActiveUsersByRoles(["asset_admin", "super_admin"]);

      updateDoc(doc(db, "asset_issue_tickets", ticketRef.id), {
        unreadByUids: qhseUsers.map((u) => u.uid),
      }).catch((err) => console.warn("[Report Issue] gagal set unreadByUids (non-fatal)", err));

      await Promise.all(
        qhseUsers.map((qhse) =>
          createAssetNotification({
            recipientUid: qhse.uid,
            recipientName: qhse.name || qhse.email,
            recipientRole: qhse.role,
            title: "Laporan Kendala Baru",
            message: `${currentUserName} melaporkan kendala pada ${asset.assetName}.`,
            type: "ticket_created",
            priority,
            linkUrl: `/maintenance?tab=staff-reports&ticketId=${ticketRef.id}`,
            relatedType: "ticket",
            relatedId: ticketRef.id,
            relatedNumber: ticketNum,
            createdByUid: userUid,
            createdByName: currentUserName,
          })
        )
      );
    } catch (err) {
      console.warn("[Asset Issue Report] gagal kirim notifikasi QHSE (non-fatal)", ticketRef.id, err);
    }

    // Section 6/8 — notifikasi PIC Lokasi bersifat INFORMASI SAJA (tanpa
    // tombol konfirmasi, tidak menghambat workflow QHSE) — TERPISAH dari
    // notifikasi QHSE di atas. Tidak dikirim kalau pelapor adalah PIC
    // Lokasi itu sendiri (sudah tahu, karena mereka sendiri yang melapor).
    if (locationPicSnapshot.locationPicUid && locationPicSnapshot.locationPicUid !== userUid) {
      try {
        await createAssetNotification({
          recipientUid: locationPicSnapshot.locationPicUid,
          recipientName: locationPicSnapshot.locationPicName || locationPicSnapshot.locationPicEmail || "",
          recipientRole: "location_pic",
          title: "Laporan baru terdapat di lokasi tanggung jawab Anda.",
          message: `Laporan ${ticketNum} (${ticketPayload.title}) pada ${asset.assetName} di ${locationText}, dilaporkan oleh ${currentUserName}. Status: ${ticketPayload.statusLabel}.`,
          type: "location_pic_coordination",
          priority,
          linkUrl: `/assets/${asset.id}`,
          relatedType: "ticket",
          relatedId: ticketRef.id,
          relatedNumber: ticketNum,
          createdByUid: userUid,
          createdByName: currentUserName,
        });
      } catch (err) {
        console.warn("[Asset Issue Report] gagal kirim notifikasi PIC Lokasi (non-fatal)", ticketRef.id, err);
      }
    }

    setTicketNumber(ticketNum);
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={resetAndClose} />
      <div className="relative bg-white rounded-2xl shadow-lg border border-slate-200 w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Laporkan Kendala</h2>
          <button
            type="button"
            onClick={resetAndClose}
            className="text-slate-400 hover:text-slate-700 cursor-pointer rounded-lg p-1 hover:bg-slate-100"
          >
            <X size={18} />
          </button>
        </div>

        {ticketNumber ? (
          <div className="text-center py-8">
            <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Check size={26} />
            </div>
            <p className="text-slate-800 font-medium mb-1">
              Laporan berhasil dikirim. Nomor ticket Anda:
            </p>
            <p className="text-xl font-bold text-slate-900 mb-6">{ticketNumber}</p>
            <button
              type="button"
              onClick={resetAndClose}
              className="rounded-xl bg-slate-900 text-white px-5 py-2.5 text-sm font-medium cursor-pointer hover:bg-slate-800"
            >
              Tutup
            </button>
          </div>
        ) : blockedByActiveIssue ? (
          // Section — cegah laporan ganda: kalau aset sudah punya tiket
          // aktif, tampilkan info tiket itu + "Lihat Laporan Aktif" (dan
          // "Tambahkan Bukti" kalau user adalah pelapornya) alih-alih form
          // laporan baru. Hanya Asset Admin/QHSE yang bisa membuka form
          // lewat konfirmasi eksplisit di bawah.
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
              <p className="text-sm font-medium text-slate-800">{asset.assetName}</p>
              <p className="text-xs text-slate-400">{asset.assetCode}</p>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="font-semibold text-sm">{asset.conditionLabel || "Dilaporkan Bermasalah"}</p>
                  {asset.lastIssueSymptomLabel && <p className="text-sm mt-1">{asset.lastIssueSymptomLabel}</p>}
                  {asset.activeIssueTicketNo && (
                    <p className="font-mono text-xs mt-1">{asset.activeIssueTicketNo}</p>
                  )}
                  {asset.lastIssueNote && (
                    <p className="text-xs mt-2 text-amber-700">Catatan: &ldquo;{asset.lastIssueNote}&rdquo;</p>
                  )}
                </div>
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
                {activeTicketLink && isActiveIssueReporter && (
                  <button
                    type="button"
                    onClick={() => {
                      resetAndClose();
                      router.push(activeTicketLink);
                    }}
                    className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                  >
                    Tambahkan Bukti
                  </button>
                )}
              </div>
            </div>

            {canOverride && (
              <button
                type="button"
                onClick={() => setDuplicateOverrideConfirmed(true)}
                className="text-xs font-medium text-slate-400 hover:text-slate-600 underline"
              >
                Laporkan sebagai masalah berbeda (khusus Asset Admin/QHSE)
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
              <p className="text-sm font-medium text-slate-800">{asset.assetName}</p>
              <p className="text-xs text-slate-400">{asset.assetCode}</p>
            </div>

            {duplicateOverrideConfirmed && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                Anda melaporkan ini sebagai masalah <strong>berbeda</strong> dari tiket aktif yang sudah ada. Jelaskan
                perbedaannya di catatan kendala di bawah.
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                Jenis Kendala <span className="text-red-500">*</span>
              </label>
              <select
                value={symptomType}
                onChange={(e) => setSymptomType(e.target.value as IssueSymptomType)}
                className="input cursor-pointer"
              >
                <option value="">Pilih jenis kendala</option>
                {ISSUE_SYMPTOM_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                Dampak <span className="text-red-500">*</span>
              </label>
              <select
                value={impactLevel}
                onChange={(e) => setImpactLevel(e.target.value as IssueImpactLevel)}
                className="input cursor-pointer"
              >
                <option value="">Pilih dampak</option>
                {IMPACT_OPTIONS.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                Catatan Kendala <span className="text-red-500">*</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Jelaskan kendala yang dialami..."
                className="input"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                Upload Foto/Video {photoRequired ? <span className="text-red-500">*</span> : <span className="text-slate-400">(opsional)</span>}
              </label>
              <label className="file-drop">
                <UploadCloud size={20} className="text-slate-400" />
                <span className="text-xs text-slate-500 text-center">
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
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2.5 text-sm font-medium cursor-pointer hover:brightness-105 shadow-md shadow-blue-900/20 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? "Mengirim..." : "Kirim Laporan"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
