"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addDoc, collection, onSnapshot, serverTimestamp } from "firebase/firestore";
import { ArrowLeft, CheckCircle2, ClipboardPlus, Send, UploadCloud } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { Asset, AssetLocationNode, IssueReportType, IssueSeverity } from "@/lib/types";
import {
  FIELD_IMPACT_LABEL,
  ISSUE_REPORT_TYPE_COLOR,
  ISSUE_REPORT_TYPE_LABEL,
  ISSUE_STATUS_STAFF_LABEL,
} from "@/lib/utils";
import {
  cleanFirestoreData,
  fetchActiveUsersByRoles,
  generateQueueNumber,
  generateTicketNumber,
} from "@/lib/firestore-helpers";
import { uploadToDrive } from "@/lib/drive-upload";
import { createAssetNotification } from "@/lib/notifications";
import ProtectedLayout from "@/components/ProtectedLayout";
import PageHeader from "@/components/PageHeader";
import Badge from "@/components/Badge";
import AssetPickerForReport from "@/components/AssetPickerForReport";
import LocationCascadeFields, {
  EMPTY_LOCATION_SELECTION,
  LocationSelection,
} from "@/components/LocationCascadeFields";
import { Toast, ToastState } from "@/components/Toast";

const REPORT_TYPES: IssueReportType[] = [
  "asset_issue",
  "facility_issue",
  "it_network",
  "safety_hazard",
  "environment_issue",
  "emergency",
  "other",
];

const SEVERITY_OPTIONS: IssueSeverity[] = ["low", "medium", "high", "critical"];

const SEVERITY_TO_PRIORITY = {
  low: "low",
  medium: "medium",
  high: "high",
  critical: "urgent",
} as const;

const SEVERITY_TO_IMPACT = {
  low: "Masih Bisa Dipakai",
  medium: "Mengganggu Pekerjaan",
  high: "Tidak Bisa Dipakai",
  critical: "Darurat",
} as const;

function assetLocationText(asset: Asset | null) {
  if (!asset) return "";
  return [asset.buildingName, asset.floor, asset.roomName, asset.areaName].filter(Boolean).join(" / ") ||
    asset.locationText ||
    asset.location ||
    "";
}

function locationText(selection: LocationSelection) {
  return [selection.buildingName, selection.floorName, selection.roomName, selection.areaName].filter(Boolean).join(
    " / "
  );
}

function locationId(selection: LocationSelection) {
  return selection.areaId || selection.roomId || selection.floorId || selection.buildingId;
}

export default function NewStaffReportPage() {
  const router = useRouter();
  const { assetUser, role, loading, firebaseUser } = useAuth();
  const authReady = !loading && !!firebaseUser && !!assetUser && !!role;

  const [assets, setAssets] = useState<Asset[]>([]);
  const [locations, setLocations] = useState<AssetLocationNode[]>([]);
  const [reportType, setReportType] = useState<IssueReportType>("asset_issue");
  const [selection, setSelection] = useState<LocationSelection>(EMPTY_LOCATION_SELECTION);
  const [detailArea, setDetailArea] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<IssueSeverity>("medium");
  const [relatedToAsset, setRelatedToAsset] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [missingAssetSelected, setMissingAssetSelected] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);

  const showAssetPicker = reportType === "asset_issue" || relatedToAsset;
  const selectedLocationText = locationText(selection);
  const selectedLocationId = locationId(selection);

  useEffect(() => {
    if (!authReady) return;
    const unsub = onSnapshot(
      collection(db, "assets"),
      (snap) => {
        setAssets(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as Asset)));
      },
      (err) => console.error("[NewStaffReportPage Listener] assets error:", err)
    );
    return () => unsub();
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return;
    const unsub = onSnapshot(
      collection(db, "asset_locations"),
      (snap) => {
        console.log("[NewStaffReportPage Listener] asset_locations success:", snap.size);
        setLocations(
          snap.docs
            .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as AssetLocationNode))
            .filter((location) => location.status === "active")
        );
      },
      (err) => console.error("[NewStaffReportPage Listener] asset_locations error:", err)
    );
    return () => unsub();
  }, [authReady]);

  const sortedAssets = useMemo(() => [...assets].sort((a, b) => a.assetName.localeCompare(b.assetName)), [assets]);

  const validate = () => {
    if (!reportType) return "Jenis laporan wajib dipilih.";
    if (!selectedLocationId || !selectedLocationText) return "Lokasi laporan wajib dipilih.";
    if (!title.trim()) return "Judul laporan wajib diisi.";
    if (!description.trim()) return "Deskripsi laporan wajib diisi.";
    if (showAssetPicker && !selectedAsset && !missingAssetSelected) {
      return "Pilih asset terkait atau pilih opsi asset tidak ditemukan.";
    }
    return "";
  };

  const handleSubmit = async () => {
    setError("");
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);

    const reportAsset = showAssetPicker ? selectedAsset : null;
    const reporterUid = assetUser?.uid || firebaseUser?.uid || "";
    const reporterName = assetUser?.name || firebaseUser?.email || "";
    const reporterEmail = assetUser?.email || firebaseUser?.email || "";
    const priority = SEVERITY_TO_PRIORITY[severity];
    const impactLevel = SEVERITY_TO_IMPACT[severity];

    // Upload lampiran dan nomor laporan dulu — kalau ini gagal, belum ada
    // dokumen ticket yang dibuat sama sekali, jadi aman ditampilkan sebagai
    // "gagal submit" biasa.
    let ticketNumber = "";
    let queueNumber = "";
    let attachmentUrls: string[] = [];
    let attachmentFiles: string[] = [];
    try {
      const uploadedFiles = await Promise.all(
        files.map((file) =>
          uploadToDrive(file, "issue_attachment", {
            assetCode: reportAsset?.assetCode || "manual-report",
            assetName: reportAsset?.assetName || title.trim(),
          })
        )
      );
      attachmentUrls = uploadedFiles.map((file) => file.url);
      attachmentFiles = uploadedFiles.map((file) => file.fileName);
      ticketNumber = await generateTicketNumber();
      queueNumber = await generateQueueNumber();
    } catch (prepError) {
      console.error("[NewStaffReportPage] gagal menyiapkan lampiran/nomor laporan", prepError);
      setError("Gagal mengirim laporan. Coba lagi.");
      setSubmitting(false);
      return;
    }

    const ticketPayload = cleanFirestoreData({
      ticketNumber,
      queueNumber,
      reportType,
      source: "manual_web",
      assetId: reportAsset?.id || null,
      assetCode: reportAsset?.assetCode || null,
      assetName: reportAsset?.assetName || null,
      assetCategory: reportAsset?.categoryName || null,
      assetLocation: assetLocationText(reportAsset) || null,
      locationId: selectedLocationId,
      buildingId: selection.buildingId || null,
      floorId: selection.floorId || null,
      roomId: selection.roomId || null,
      areaId: selection.areaId || null,
      buildingName: selection.buildingName || null,
      floorName: selection.floorName || null,
      roomName: selection.roomName || null,
      areaName: selection.areaName || null,
      locationText: selectedLocationText,
      detailArea: detailArea.trim() || null,
      title: title.trim(),
      symptomType: title.trim(),
      description: description.trim(),
      severity,
      // "Tingkat Dampak dari Pelapor" — dinilai staff sendiri berdasarkan
      // kondisi di lapangan, TERPISAH dari "Prioritas Penanganan QHSE"
      // (handlingPriority, diisi QHSE lewat modal detail setelah review).
      fieldImpact: severity,
      fieldImpactLabel: FIELD_IMPACT_LABEL[severity],
      impactDescription: impactLevel,
      priority,
      impactLevel,
      status: "reported",
      statusLabel: "Laporan Masuk",
      staffStatusLabel: ISSUE_STATUS_STAFF_LABEL.reported,
      assignedTeam: null,
      assignedToUid: null,
      assignedToName: null,
      photoUrls: attachmentUrls,
      attachmentUrls,
      attachmentFiles,
      reportedByUid: reporterUid,
      reportedByName: reporterName,
      reportedByEmail: reporterEmail,
      reportedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      createdByUid: reporterUid,
      createdByName: reporterName,
      createdByEmail: reporterEmail,
      updatedAt: serverTimestamp(),
      updatedByUid: reporterUid,
      updatedByName: reporterName,
    }) as Record<string, unknown>;

    // 1) Buat ticket-nya — INI SATU-SATUNYA langkah yang boleh membuat
    // submit dianggap gagal. Log dan notifikasi di bawah ini best-effort:
    // kalau gagal (mis. staff HRP fallback belum punya dokumen asset_users
    // sehingga sebagian rule lain menolak), laporan yang sudah tersimpan
    // TETAP dianggap berhasil.
    let ticketRef;
    try {
      console.log("[NewStaffReportPage Submit Debug] START create ticket", {
        uid: firebaseUser?.uid,
        email: firebaseUser?.email,
        role,
        payloadKeys: Object.keys(ticketPayload),
      });
      ticketRef = await addDoc(collection(db, "asset_issue_tickets"), ticketPayload);
      console.log("[NewStaffReportPage Submit Debug] SUCCESS create ticket", ticketRef.id);
    } catch (ticketError) {
      console.error("[NewStaffReportPage] gagal create asset_issue_tickets", ticketError);
      setError("Gagal mengirim laporan. Coba lagi.");
      setSubmitting(false);
      return;
    }

    try {
      await addDoc(collection(db, "asset_issue_ticket_logs"), {
        ticketId: ticketRef.id,
        ticketNumber,
        action: "created",
        actionLabel: "Laporan dibuat",
        fromStatus: null,
        toStatus: "reported",
        message: `${reporterName} membuat laporan "${title.trim()}"`,
        note: "Laporan staff dibuat dari web tanpa QR",
        createdAt: serverTimestamp(),
        createdByUid: reporterUid,
        createdByName: reporterName,
        reporterUid,
      });
      console.log("[NewStaffReportPage Submit Debug] SUCCESS create ticket log");
    } catch (logError) {
      console.warn("[NewStaffReportPage] gagal membuat log laporan, laporan tetap berhasil", logError);
    }

    try {
      // Section B — penerima notifikasi laporan staff HANYA asset_admin dan
      // super_admin (QHSE). Jangan asset_finance, jangan staff lain.
      const qhseUsers = await fetchActiveUsersByRoles(["asset_admin", "super_admin"]);

      console.log("[Issue Ticket Notification Debug]", {
        ticketId: ticketRef.id,
        title: title.trim(),
        createdByUid: reporterUid,
        qhseRecipientsCount: qhseUsers.length,
        qhseRecipients: qhseUsers.map((r) => ({ uid: r.uid, email: r.email, role: r.role })),
      });

      await Promise.all(
        qhseUsers.map((user) =>
          createAssetNotification({
            recipientUid: user.uid,
            recipientName: user.name,
            recipientRole: user.role,
            title: "Keluhan Baru Masuk",
            message: `${reporterName} membuat laporan: ${title.trim()}`,
            type: "ticket_created",
            priority,
            linkUrl: `/maintenance?tab=staff-reports&ticketId=${ticketRef.id}`,
            relatedType: "ticket",
            relatedId: ticketRef.id,
            relatedNumber: ticketNumber,
            createdByUid: reporterUid,
            createdByName: reporterName,
          })
        )
      );
      console.log("[NewStaffReportPage Submit Debug] SUCCESS create QHSE notifications");
    } catch (notificationError) {
      console.warn("[NewStaffReportPage] gagal membuat notifikasi QHSE, laporan tetap berhasil", notificationError);
    }

    setSubmitting(false);
    setToast({ type: "success", message: `Laporan ${ticketNumber} berhasil dikirim.` });
    window.setTimeout(() => router.push("/my-reports"), 650);
  };

  return (
    <ProtectedLayout>
      <div className="staff-report-page w-full max-w-full min-w-0 overflow-hidden pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-0">
        <PageHeader
          title="Buat Laporan"
          subtitle="Laporan kendala staff tanpa perlu membuat atau scan QR baru."
          actions={
            <Link
              href="/my-reports"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeft size={16} />
              Laporan Saya
            </Link>
          }
        />

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <ClipboardPlus size={18} />
                </div>
                <h2 className="font-semibold text-slate-900">Jenis Laporan</h2>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {REPORT_TYPES.map((type) => {
                  const selected = reportType === type;
                  return (
                    <button
                      type="button"
                      key={type}
                      onClick={() => {
                        setReportType(type);
                        if (type !== "asset_issue") {
                          setRelatedToAsset(false);
                          setSelectedAsset(null);
                          setMissingAssetSelected(false);
                        }
                      }}
                      className={`min-h-[72px] rounded-xl border p-3 text-left transition ${
                        selected
                          ? "border-blue-300 bg-blue-50 ring-2 ring-blue-100"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-800">{ISSUE_REPORT_TYPE_LABEL[type]}</span>
                        {selected && <CheckCircle2 size={17} className="shrink-0 text-blue-600" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
              <h2 className="mb-4 font-semibold text-slate-900">Detail Lokasi & Laporan</h2>
              <div className="space-y-4">
                <LocationCascadeFields locations={locations} value={selection} onChange={setSelection} columns={2} />

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-500">Detail Area</label>
                  <input
                    value={detailArea}
                    onChange={(event) => setDetailArea(event.target.value)}
                    placeholder="mis. dekat pantry, sisi kanan lift, meja resepsionis"
                    className="input"
                  />
                </div>

                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-500">
                      Judul <span className="text-red-500">*</span>
                    </label>
                    <input
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="Ringkas kendala yang terjadi"
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-500">
                      Tingkat Dampak dari Pelapor <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={severity}
                      onChange={(event) => setSeverity(event.target.value as IssueSeverity)}
                      className="input cursor-pointer"
                    >
                      {SEVERITY_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {FIELD_IMPACT_LABEL[option]}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-slate-400">
                      Diisi berdasarkan kondisi yang Anda lihat di lapangan.
                    </p>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-500">
                    Deskripsi <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={5}
                    placeholder="Jelaskan kronologi, dampak, dan kondisi terakhir."
                    className="input min-h-[132px]"
                  />
                </div>

                {reportType !== "asset_issue" && (
                  <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={relatedToAsset}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setRelatedToAsset(checked);
                        if (!checked) {
                          setSelectedAsset(null);
                          setMissingAssetSelected(false);
                        }
                      }}
                      className="h-4 w-4"
                    />
                    Laporan ini terkait asset tertentu
                  </label>
                )}

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-500">Foto / Video</label>
                  <label className="file-drop">
                    <UploadCloud size={22} className="text-slate-400" />
                    <span className="text-center text-xs text-slate-500">
                      {files.length > 0 ? `${files.length} file dipilih` : "Klik untuk upload lampiran opsional"}
                    </span>
                    <input
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      className="hidden"
                      onChange={(event) => setFiles(Array.from(event.target.files || []).slice(0, 4))}
                    />
                  </label>
                  {files.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {files.map((file) => (
                        <span
                          key={`${file.name}-${file.size}`}
                          className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600"
                        >
                          {file.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {error && (
                  <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
                )}

                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-blue-900/20 hover:brightness-105 disabled:opacity-60 md:w-auto"
                >
                  <Send size={16} />
                  {submitting ? "Mengirim..." : "Kirim Laporan"}
                </button>
              </div>
            </section>

            {showAssetPicker && (
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
                <h2 className="mb-4 font-semibold text-slate-900">Asset Terkait</h2>
                <AssetPickerForReport
                  assets={sortedAssets}
                  selectedAssetId={selectedAsset?.id || null}
                  missingAssetSelected={missingAssetSelected}
                  onSelectAsset={(asset) => {
                    setSelectedAsset(asset);
                    setMissingAssetSelected(false);
                  }}
                  onSelectMissingAsset={() => {
                    setSelectedAsset(null);
                    setMissingAssetSelected(true);
                  }}
                />
              </section>
            )}
          </div>

          <aside className="space-y-3 xl:sticky xl:top-20 xl:self-start">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 font-semibold text-slate-900">Ringkasan</h2>
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge label={ISSUE_REPORT_TYPE_LABEL[reportType]} colorClass={ISSUE_REPORT_TYPE_COLOR[reportType]} />
                  <Badge label={`Dampak: ${FIELD_IMPACT_LABEL[severity]}`} colorClass="bg-slate-100 text-slate-600 border-slate-200" />
                </div>
                <div>
                  <p className="text-xs text-slate-400">Lokasi</p>
                  <p className="font-medium text-slate-800">{selectedLocationText || "-"}</p>
                  {detailArea && <p className="text-xs text-slate-500">{detailArea}</p>}
                </div>
                <div>
                  <p className="text-xs text-slate-400">Asset</p>
                  <p className="font-medium text-slate-800">
                    {showAssetPicker && selectedAsset
                      ? `${selectedAsset.assetName} (${selectedAsset.assetCode})`
                      : showAssetPicker && missingAssetSelected
                        ? "Asset belum terdata"
                        : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Judul</p>
                  <p className="font-medium text-slate-800">{title || "-"}</p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </ProtectedLayout>
  );
}
