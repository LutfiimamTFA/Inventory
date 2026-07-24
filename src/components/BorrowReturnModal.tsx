"use client";

import { useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { CheckCircle2, HelpCircle } from "lucide-react";
import { db } from "@/lib/firebase";
import { Asset, AssetBorrowing, AssetCondition, IssueImpactLevel, IssueSymptomType } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { generateTicketNumber, generateQueueNumber, IMPACT_TO_PRIORITY, fetchActiveUsersByRoles } from "@/lib/firestore-helpers";
import { uploadToDrive } from "@/lib/drive-upload";
import { createAssetNotification } from "@/lib/notifications";
import {
  getAssetIssueReportContext,
  getAssetIssueSourceFields,
  ISSUE_SYMPTOM_OPTIONS,
  isIssueEvidenceRequired,
} from "@/lib/asset-issue-reporting";
import { isActiveBorrowing } from "@/lib/assets/asset-status";
import ConfirmModal from "@/components/ConfirmModal";

// Section A — error dari Firestore (FirebaseError) atau apa pun yang
// dilempar HARUS dibongkar jadi name/message/stack yang eksplisit, supaya
// console.error tidak pernah tampil kosong "{}" lagi seperti sebelumnya.
function logReturnError(
  step: string,
  err: unknown,
  asset: Asset | null,
  firebaseUser?: { uid?: string | null; email?: string | null } | null,
  assetUser?: { uid?: string | null; email?: string | null } | null
) {
  const rawError =
    err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err;
  const code = (err as { code?: string } | null)?.code;
  const message = (err as { message?: string } | null)?.message;
  const name = (err as { name?: string } | null)?.name;

  console.error(`[My Borrowings Return Error] FAILED ${step}`, {
    assetId: asset?.id,
    assetCode: asset?.assetCode,

    firebaseUid: firebaseUser?.uid,
    firebaseEmail: firebaseUser?.email,

    assetUserUid: assetUser?.uid,
    assetUserEmail: assetUser?.email,

    currentHolderUid: asset?.currentHolderUid,
    currentHolderName: asset?.currentHolderName,
    currentUsageStatus: asset?.currentUsageStatus,

    errorCode: code,
    errorMessage: message,
    errorName: name,
    rawError,
  });
}

function returnErrorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  const message = (err as { message?: string } | null)?.message;
  if (code === "permission-denied") {
    return "Anda belum memiliki izin untuk mengembalikan aset ini.";
  }
  return message || "Gagal mengembalikan aset. Coba lagi atau hubungi admin.";
}

// Section A — sama seperti logReturnError, tapi untuk alur Pinjam Aset —
// tetap dipisah fungsinya supaya prefix log ("[Asset Action Borrow Error]")
// tidak tercampur dengan alur pengembalian.
function logBorrowError(
  step: string,
  err: unknown,
  asset: Asset | null,
  firebaseUser?: { uid?: string | null; email?: string | null } | null,
  assetUser?: { uid?: string | null; email?: string | null } | null
) {
  const rawError =
    err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err;
  const code = (err as { code?: string } | null)?.code;
  const message = (err as { message?: string } | null)?.message;
  const name = (err as { name?: string } | null)?.name;

  console.error(`[Asset Action Borrow Error] FAILED ${step}`, {
    assetId: asset?.id,
    assetCode: asset?.assetCode,
    assetName: asset?.assetName,

    firebaseUid: firebaseUser?.uid,
    firebaseEmail: firebaseUser?.email,

    assetUserUid: assetUser?.uid,
    assetUserEmail: assetUser?.email,

    currentUsageStatus: asset?.currentUsageStatus,
    currentHolderUid: asset?.currentHolderUid,
    currentHolderName: asset?.currentHolderName,

    errorCode: code,
    errorMessage: message,
    errorName: name,
    rawError,
  });
}

function borrowErrorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  const message = (err as { message?: string } | null)?.message;
  if (code === "permission-denied") {
    return "Anda belum memiliki izin untuk meminjam aset ini.";
  }
  return message || "Gagal meminjam aset. Coba lagi atau hubungi admin.";
}

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
  const [estimatedReturnDate, setEstimatedReturnDate] = useState("");
  const [estimatedReturnTime, setEstimatedReturnTime] = useState("");
  const [borrowNotes, setBorrowNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleConfirm = async () => {
    // Section B — UID dari Firebase Auth dulu (sumber kebenaran login),
    // assetUser cuma fallback kalau firebaseUser belum sempat termuat.
    const userUid = firebaseUser?.uid || assetUser?.uid;
    const userEmail = firebaseUser?.email || assetUser?.email || "";
    const currentUserName =
      assetUser?.name || firebaseUser?.displayName || firebaseUser?.email || "User";

    if (!userUid) {
      setError("Sesi login tidak ditemukan. Silakan login ulang.");
      return;
    }

    // Section C — aset yang sedang dipegang orang lain tidak boleh dipinjam
    // (dicek di sini dulu supaya pesannya spesifik, bukan permission-denied
    // generik dari rules).
    const currentStatus = String(asset?.currentUsageStatus || "").toLowerCase();
    const isAvailable = !currentStatus || currentStatus === "available" || currentStatus === "tersedia";
    if (!isAvailable && asset?.currentHolderUid && asset.currentHolderUid !== userUid) {
      setError("Aset ini sedang dipakai oleh pengguna lain.");
      return;
    }

    setSaving(true);
    setError("");

    // Section C/E — tanpa jam, simpan tanggal SAJA ("YYYY-MM-DD") supaya
    // normalizeExpectedReturnDate (lib/utils.ts) menganggapnya berlaku
    // sampai akhir hari, bukan otomatis jam 00:00 dini hari.
    const estimatedReturnAt = estimatedReturnDate
      ? estimatedReturnTime
        ? `${estimatedReturnDate}T${estimatedReturnTime}:00`
        : estimatedReturnDate
      : "";

    // Section D — payload MINIMAL, cuma field yang memang perlu berubah saat
    // meminjam (bukan seluruh object asset). assetStatus/currentBorrowerUid/
    // Name dipertahankan untuk konsumen skema lama (lihat lib/borrow-actions.ts).
    const assetBorrowPayload = {
      assetStatus: "borrowed",
      currentBorrowingId: null,
      currentBorrowerUid: userUid,
      currentBorrowerName: currentUserName,

      currentUsageStatus: "borrowed",
      currentUsageStatusLabel: "Sedang Dipinjam",

      currentHolderUid: userUid,
      currentHolderName: currentUserName,
      currentHolderEmail: userEmail || null,

      currentUsageStartedAt: serverTimestamp(),
      currentUsageExpectedReturnAt: estimatedReturnAt || null,
      currentUsageNote: borrowNotes || "",

      updatedAt: serverTimestamp(),
      updatedByUid: userUid,
      updatedByName: currentUserName,
    };

    // Section F — dua langkah dipisah try/catch masing-masing supaya kalau
    // ada yang gagal, log-nya jelas MENUNJUK ke langkah mana yang gagal,
    // bukan satu catch besar yang bisa menyamarkan error jadi kosong ({}).
    try {
      console.log("[Borrow Asset] START update asset", {
        assetId: asset.id,
        assetCode: asset.assetCode,
        userUid,
        userEmail,
        currentUsageStatus: asset.currentUsageStatus,
        payloadKeys: Object.keys(assetBorrowPayload),
      });

      await updateDoc(doc(db, "assets", asset.id), assetBorrowPayload);

      console.log("[Borrow Asset] SUCCESS update asset");
    } catch (err) {
      logBorrowError("update asset", err, asset, firebaseUser, assetUser);
      setSaving(false);
      setError(borrowErrorMessage(err));
      return;
    }

    let borrowingId: string | null = null;
    try {
      const borrowingPayload = {
        assetId: asset.id,
        assetCode: asset.assetCode,
        assetName: asset.assetName,
        locationText: asset.locationText || asset.location || "",
        borrowedByUid: userUid,
        borrowedByName: currentUserName,
        borrowedByEmail: userEmail,
        status: "borrowed",
        statusLabel: "Sedang Dipinjam",
        borrowedAt: serverTimestamp(),
        estimatedReturnAt: estimatedReturnAt || null,
        returnedAt: null,
        borrowNotes: borrowNotes || "",
      };

      console.log("[Borrow Asset] START create borrowing history", {
        assetId: asset.id,
        assetCode: asset.assetCode,
        userUid,
        payloadKeys: Object.keys(borrowingPayload),
      });

      const borrowingRef = await addDoc(collection(db, "asset_borrowings"), borrowingPayload);
      borrowingId = borrowingRef.id;

      console.log("[Borrow Asset] SUCCESS create borrowing history", {
        borrowingId: borrowingRef.id,
      });
    } catch (err) {
      logBorrowError("create borrowing history", err, asset, firebaseUser, assetUser);
      setSaving(false);
      setError(borrowErrorMessage(err));
      return;
    }

    // Section E — best-effort: kalau update currentBorrowingId gagal,
    // JANGAN gagalkan peminjaman utama (assets + asset_borrowings sudah
    // benar) — cukup log peringatan.
    if (borrowingId) {
      updateDoc(doc(db, "assets", asset.id), {
        currentBorrowingId: borrowingId,
        updatedAt: serverTimestamp(),
        updatedByUid: userUid,
        updatedByName: currentUserName,
      }).catch((err) => {
        console.warn("[Borrow Asset] gagal update currentBorrowingId (non-fatal)", asset.id, err);
      });
    }

    setSaving(false);
    onDone();
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
            value={estimatedReturnDate}
            onChange={(e) => setEstimatedReturnDate(e.target.value)}
            className="input"
          />
          <p className="mt-1 text-xs text-slate-400">
            Jika jam tidak diisi, batas kembali dihitung sampai akhir hari.
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Jam Kembali (opsional)
          </label>
          <input
            type="time"
            value={estimatedReturnTime}
            onChange={(e) => setEstimatedReturnTime(e.target.value)}
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

// SATU modal adaptif "Kembalikan Aset": kondisi utama cuma Baik/Ada
// Kendala. Detail rusak/tidak lengkap adalah jenis kendala, bukan pilihan
// kondisi utama.
type ReturnConditionChoice = "good" | "issue";

const RETURN_CONDITION_OPTIONS: {
  key: ReturnConditionChoice;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}[] = [
  {
    key: "good",
    label: "Baik",
    description: "Aset berfungsi normal dan lengkap.",
    icon: CheckCircle2,
  },
  {
    key: "issue",
    label: "Ada Kendala",
    description: "Terdapat gangguan, kerusakan, atau bagian tidak lengkap.",
    icon: HelpCircle,
  },
];

const RETURN_IMPACT_OPTIONS: IssueImpactLevel[] = [
  "Masih Bisa Dipakai",
  "Mengganggu Pekerjaan",
  "Tidak Bisa Dipakai",
  "Darurat",
];

// Section 9/10/11 — kondisi fisik AKHIR (assets.condition) HANYA "good" atau
// "reported_issue" (sementara, menunggu QHSE) — TIDAK PERNAH langsung
// "minor_damage"/"heavy_damage"/"incomplete" dari pengembalian, karena itu
// keputusan FINAL yang harus lewat review QHSE (IssueTicketDetailModal),
// persis alur yang sama dengan laporan kendala dari Scan QR.
function returnConditionToAssetCondition(choice: ReturnConditionChoice): AssetCondition {
  return choice === "good" ? "good" : "reported_issue";
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
  onDone: (message?: string) => void;
}) {
  const { assetUser, firebaseUser } = useAuth();
  const [conditionChoice, setConditionChoice] = useState<ReturnConditionChoice>("good");
  const [returnNotes, setReturnNotes] = useState("");
  const [symptomType, setSymptomType] = useState<IssueSymptomType | "">("");
  const [impactLevel, setImpactLevel] = useState<IssueImpactLevel | "">("");
  const [issueNote, setIssueNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isProblem = conditionChoice !== "good";
  const photoRequired = isProblem && isIssueEvidenceRequired(symptomType);

  const resetAndClose = () => {
    setConditionChoice("good");
    setReturnNotes("");
    setSymptomType("");
    setImpactLevel("");
    setIssueNote("");
    setFile(null);
    setError("");
    onClose();
  };

  const handleConfirm = async () => {
    if (saving) return;

    if (!asset) {
      setError("Aset tidak ditemukan.");
      return;
    }

    // Section B — UID dari Firebase Auth dulu (sumber kebenaran login),
    // assetUser cuma fallback kalau firebaseUser belum sempat termuat.
    const userUid = firebaseUser?.uid || assetUser?.uid;
    const userEmail = firebaseUser?.email || assetUser?.email || "";
    const currentUserName =
      assetUser?.name || firebaseUser?.displayName || firebaseUser?.email || "User";

    if (!userUid) {
      setError("Sesi login tidak ditemukan. Silakan login ulang.");
      return;
    }

    // Section C — dicek di sini dulu (bukan cuma diserahkan ke Firestore
    // rules) supaya pesannya spesifik "aset ini tidak sedang Anda pinjam",
    // bukan permission-denied generik.
    const isCurrentHolder =
      asset.currentHolderUid === userUid ||
      (!!userEmail && asset.currentHolderEmail === userEmail) ||
      asset.currentBorrowerUid === userUid;
    const canReturnAsManager = assetUser?.role === "asset_admin" || assetUser?.role === "super_admin";
    if (!isCurrentHolder && !canReturnAsManager) {
      setError("Aset ini tidak sedang Anda pinjam.");
      return;
    }

    if (isProblem) {
      if (!symptomType) {
        setError("Jenis kendala wajib dipilih.");
        return;
      }
      if (!impactLevel) {
        setError("Dampak wajib dipilih.");
        return;
      }
      if (!issueNote.trim()) {
        setError("Catatan kendala wajib diisi.");
        return;
      }
      if (photoRequired && !file) {
        setError("Foto/video bukti wajib diunggah untuk jenis kendala ini.");
        return;
      }
    }

    setSaving(true);
    setError("");

    // Section 7 — upload foto (kalau ada) DULU, sebelum batch — writeBatch
    // tidak bisa menunggu upload di tengah-tengah.
    let evidencePhotoUrls: string[] = [];
    if (isProblem && file) {
      try {
        const uploaded = await uploadToDrive(file, "issue_attachment", {
          assetCode: asset.assetCode,
          assetName: asset.assetName,
        });
        evidencePhotoUrls = [uploaded.url];
      } catch (err) {
        logReturnError("upload foto kendala", err, asset, firebaseUser, assetUser);
        setSaving(false);
        setError("Gagal mengunggah foto. Coba lagi.");
        return;
      }
    }

    // Section 8 — nomor tiket dibuat SEBELUM batch (butuh reference id-nya
    // untuk activeIssueTicketId/No pada payload asset). generateTicketNumber
    // query asset_issue_tickets tanpa filter kepemilikan — bisa permission-
    // denied untuk staff biasa, jangan sampai itu menggagalkan pengembalian,
    // fallback ke nomor berbasis waktu (pola yang sama dengan ReportIssueModal).
    let ticketNum = "";
    let queueNum = "";
    if (isProblem) {
      try {
        ticketNum = await generateTicketNumber();
        queueNum = await generateQueueNumber();
      } catch (err) {
        console.warn("[Return Asset] gagal generate nomor tiket, memakai fallback", err);
        const fallbackSuffix = Date.now();
        ticketNum = `TKT-${new Date().getFullYear()}-${fallbackSuffix}`;
        queueNum = `Q-${fallbackSuffix}`;
      }
    }

    // Section F — semua READS (query borrowing aktif + cek duplikat recovery)
    // dilakukan DULU, baru writeBatch (writeBatch tidak bisa baca).
    let activeBorrowingId: string | null = null;
    let activeBorrowingForSource: (AssetBorrowing & { id: string }) | null = null;
    let alreadyReturnedRecently = false;
    try {
      if (asset.currentBorrowingId) {
        const currentBorrowingSnap = await getDoc(doc(db, "asset_borrowings", asset.currentBorrowingId));
        if (currentBorrowingSnap.exists()) {
          const currentBorrowing = {
            id: currentBorrowingSnap.id,
            ...currentBorrowingSnap.data(),
          } as AssetBorrowing & { id: string };
          if (isActiveBorrowing(currentBorrowing)) {
            activeBorrowingId = currentBorrowing.id;
            activeBorrowingForSource = currentBorrowing;
          }
        }
      }

      if (!activeBorrowingId) {
        const activeBorrowingQuery = canReturnAsManager
          ? query(
              collection(db, "asset_borrowings"),
              where("assetId", "==", asset.id),
              where("status", "==", "borrowed"),
              limit(1)
            )
          : query(
              collection(db, "asset_borrowings"),
              where("assetId", "==", asset.id),
              where("borrowedByUid", "==", userUid),
              where("status", "==", "borrowed"),
              limit(1)
            );
        const activeSnap = await getDocs(activeBorrowingQuery);
        if (!activeSnap.empty) {
          activeBorrowingForSource = {
            id: activeSnap.docs[0].id,
            ...activeSnap.docs[0].data(),
          } as AssetBorrowing & { id: string };
          activeBorrowingId = activeBorrowingForSource.id;
        }
      }

      if (!activeBorrowingId) {
        const recentReturnedSnap = await getDocs(
          query(
            collection(db, "asset_borrowings"),
            where("assetId", "==", asset.id),
            where("borrowedByUid", "==", userUid),
            where("status", "==", "returned")
          )
        );
        alreadyReturnedRecently = recentReturnedSnap.docs.some((d) => {
          const data = d.data();
          const returnedDate =
            (data.returnedAt as { toDate?: () => Date })?.toDate?.() ||
            new Date((data.returnedAt as string) || 0);
          return Date.now() - returnedDate.getTime() < 5 * 60 * 1000;
        });
      }
    } catch (err) {
      logReturnError("cari borrowing aktif", err, asset, firebaseUser, assetUser);
      setSaving(false);
      setError(returnErrorMessage(err));
      return;
    }

    const assetCondition = returnConditionToAssetCondition(conditionChoice);
    const noteForBorrowing = isProblem ? issueNote.trim() : returnNotes.trim();
    const issueReportContext = isProblem
      ? getAssetIssueReportContext({
          user: {
            uid: userUid,
            name: currentUserName,
            email: userEmail,
            role: assetUser?.role || "staff",
          },
          asset,
          activeBorrowing: activeBorrowingForSource,
        })
      : null;

    if (isProblem && issueReportContext && !issueReportContext.canReport) {
      setSaving(false);
      setError(issueReportContext.reason || "Anda belum memiliki hubungan yang jelas dengan aset ini.");
      return;
    }

    const issueSourceFields =
      isProblem && issueReportContext
        ? getAssetIssueSourceFields({
            context: issueReportContext,
            asset,
            activeBorrowing: activeBorrowingForSource,
          })
        : null;

    // Section 9/10 — payload MINIMAL. "Baik" -> available/good. Bermasalah ->
    // inspection_required/reported_issue (BUKAN "available", bukan langsung
    // Rusak Ringan/Berat — itu keputusan QHSE lewat review tiket).
    const assetReturnPayload: Record<string, unknown> = {
      assetStatus: isProblem ? "inspection_required" : "available",
      condition: assetCondition,
      conditionLabel: isProblem ? "Dilaporkan Bermasalah" : "Baik",
      currentUsageStatus: isProblem ? "inspection_required" : "available",
      currentUsageStatusLabel: isProblem ? "Menunggu Pemeriksaan QHSE" : "Tersedia",

      lastHolderUid: asset.currentHolderUid || userUid,
      lastHolderName: asset.currentHolderName || currentUserName,
      lastHolderEmail: asset.currentHolderEmail || userEmail || null,
      lastHeldAt: asset.currentUsageStartedAt || null,
      lastReturnedAt: serverTimestamp(),

      currentBorrowingId: null,
      currentBorrowerUid: null,
      currentBorrowerName: null,

      currentHolderUid: null,
      currentHolderName: null,
      currentHolderEmail: null,
      currentHolderDivision: null,
      currentUsageExpectedReturnAt: null,

      returnedAt: serverTimestamp(),
      returnedByUid: userUid,
      returnedByName: currentUserName,

      updatedAt: serverTimestamp(),
      updatedByUid: userUid,
      updatedByName: currentUserName,
    };

    let ticketRef: ReturnType<typeof doc> | null = null;
    if (isProblem) {
      assetReturnPayload.hasActiveIssue = true;
      assetReturnPayload.previousCondition =
        asset.condition && asset.condition !== "reported_issue" ? asset.condition : asset.previousCondition || "good";
      assetReturnPayload.previousConditionLabel =
        asset.conditionLabel && asset.conditionLabel !== "Dilaporkan Bermasalah"
          ? asset.conditionLabel
          : asset.previousConditionLabel || "Baik";
      assetReturnPayload.issueReportedAt = serverTimestamp();
      assetReturnPayload.issueReportedByUid = userUid;
      assetReturnPayload.issueReportedByName = currentUserName;
      assetReturnPayload.lastIssueSymptomLabel = symptomType || "";
      assetReturnPayload.lastIssueNote = issueNote.trim();
      assetReturnPayload.lastIssueImpactLabel = impactLevel || "";
    }

    // Section 8 — SATU writeBatch: tutup borrowing, kosongkan holder,
    // (kalau bermasalah) buat tiket kendala + tandai hasActiveIssue —
    // semuanya sinkron atau gagal bersamaan, tidak pernah tersimpan
    // sebagian.
    try {
      const batch = writeBatch(db);
      const assetRef = doc(db, "assets", asset.id);

      // Section 8 — siapkan ticketRef DULU (kalau bermasalah) supaya
      // activeIssueTicketId/No sudah lengkap di assetReturnPayload SEBELUM
      // batch.update dipanggil — satu update per dokumen, bukan dua kali ke
      // ref yang sama.
      if (isProblem) {
        ticketRef = doc(collection(db, "asset_issue_tickets"));
        assetReturnPayload.activeIssueTicketId = ticketRef.id;
        assetReturnPayload.activeIssueTicketNo = ticketNum;
      }

      batch.update(assetRef, assetReturnPayload);

      if (activeBorrowingId) {
        batch.update(doc(db, "asset_borrowings", activeBorrowingId), {
          status: "returned",
          statusLabel: "Sudah Dikembalikan",
          returnedAt: serverTimestamp(),
          returnedByUid: userUid,
          returnedByName: currentUserName,
          returnCondition: assetCondition,
          returnNotes: noteForBorrowing,
          updatedAt: serverTimestamp(),
        });
      } else if (!alreadyReturnedRecently) {
        // Section G — tidak ada record asset_borrowings aktif sama sekali
        // (mis. aset jadi "sedang dipakai" lewat jalur custodian/PIC) — buat
        // recovery history supaya Riwayat Pengembalian tidak kosong.
        const recoveryRef = doc(collection(db, "asset_borrowings"));
        if (issueSourceFields) issueSourceFields.sourceBorrowingId = recoveryRef.id;
        batch.set(recoveryRef, {
          assetId: asset.id,
          assetCode: asset.assetCode,
          assetName: asset.assetName,
          locationText: asset.locationText || asset.location || "",
          borrowedByUid: userUid,
          borrowedByName: currentUserName,
          borrowedByEmail: userEmail,
          status: "returned",
          statusLabel: "Sudah Dikembalikan",
          borrowedAt: asset.currentUsageStartedAt || null,
          estimatedReturnAt: asset.currentUsageExpectedReturnAt || null,
          returnedAt: serverTimestamp(),
          returnedByUid: userUid,
          returnedByName: currentUserName,
          returnCondition: assetCondition,
          returnNotes: noteForBorrowing,
          source: "my_borrowings_return_recovery",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      if (isProblem && ticketRef) {
        batch.set(ticketRef, {
          ticketNumber: ticketNum,
          queueNumber: queueNum,
          reportType: "asset_issue",
          source: "return_flow",
          title: `${symptomType} - ${asset.assetName}`,
          assetId: asset.id,
          assetName: asset.assetName,
          assetCode: asset.assetCode,
          assetCategory: asset.categoryName || "",
          assetLocation: asset.locationText || asset.location || "",
          locationId: asset.locationId || asset.areaId || asset.roomId || asset.floorId || asset.buildingId || "asset-location",
          locationText: asset.locationText || asset.location || "-",
          reportedByUid: userUid,
          reportedByName: currentUserName,
          reportedByEmail: userEmail,
          reportedAt: serverTimestamp(),
          createdByUid: userUid,
          createdByName: currentUserName,
          createdByEmail: userEmail,
          symptomType,
          impactLevel,
          description: issueNote.trim(),
          attachmentUrls: evidencePhotoUrls,
          attachmentFiles: [],
          photoUrls: evidencePhotoUrls,
          priority: IMPACT_TO_PRIORITY[impactLevel as IssueImpactLevel],
          status: "reported",
          statusLabel: "Laporan Masuk",
          staffStatusLabel: "Laporan Dikirim",
          ...(issueSourceFields || {}),
          returnConditionChoice: conditionChoice,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedByUid: userUid,
          updatedByName: currentUserName,
        });

        const ticketLogRef = doc(collection(db, "asset_issue_ticket_logs"));
        batch.set(ticketLogRef, {
          ticketId: ticketRef.id,
          ticketNumber: ticketNum,
          action: "created",
          actionLabel: "Laporan Dibuat",
          fromStatus: null,
          toStatus: "reported",
          message: `${currentUserName} melaporkan kendala saat mengembalikan aset.`,
          note: "Laporan kendala dibuat dari alur Kembalikan Aset",
          createdAt: serverTimestamp(),
          createdByUid: userUid,
          createdByName: currentUserName,
          reporterUid: userUid,
        });
      }

      console.log("[Return Asset] START batch return" + (isProblem ? " + report" : ""), {
        assetId: asset.id,
        assetCode: asset.assetCode,
        userUid,
        isProblem,
        ticketId: ticketRef?.id || null,
        payloadKeys: Object.keys(assetReturnPayload),
      });

      await batch.commit();

      console.log("[Return Asset] SUCCESS batch return" + (isProblem ? " + report" : ""));
    } catch (err) {
      logReturnError("batch pengembalian", err, asset, firebaseUser, assetUser);
      setSaving(false);
      setError(returnErrorMessage(err));
      return;
    }

    // Section 8 — activity log + notifikasi QHSE: best-effort SETELAH batch
    // utama berhasil (bukan bagian atomik — notifikasi melibatkan panggilan
    // jaringan/push, bukan cuma tulis Firestore, jadi tidak bisa masuk
    // writeBatch). Kegagalan di sini TIDAK membatalkan pengembalian yang
    // sudah tersimpan.
    if (isProblem && ticketRef) {
      try {
        const qhseUsers = await fetchActiveUsersByRoles(["asset_admin", "super_admin"]);
        updateDoc(doc(db, "asset_issue_tickets", ticketRef.id), {
          unreadByUids: qhseUsers.map((u) => u.uid),
        }).catch((err) => console.warn("[Return Asset] gagal set unreadByUids (non-fatal)", err));

        await Promise.all(
          qhseUsers.map((qhse) =>
            createAssetNotification({
              recipientUid: qhse.uid,
              recipientName: qhse.name || qhse.email,
              recipientRole: qhse.role,
              title: "Laporan Kendala Baru",
              message: `${currentUserName} mengembalikan ${asset.assetName} dengan kendala.`,
              type: "ticket_created",
              priority: IMPACT_TO_PRIORITY[impactLevel as IssueImpactLevel],
              linkUrl: `/maintenance?tab=staff-reports&ticketId=${ticketRef!.id}`,
              relatedType: "ticket",
              relatedId: ticketRef!.id,
              relatedNumber: ticketNum,
              createdByUid: userUid,
              createdByName: currentUserName,
            })
          )
        );
      } catch (err) {
        console.warn("[Return Asset] gagal kirim notifikasi QHSE (non-fatal)", ticketRef.id, err);
      }
    }

    setSaving(false);
    onDone(
      isProblem
        ? "Aset berhasil dikembalikan. Laporan kendala telah dikirim dan aset menunggu pemeriksaan QHSE."
        : "Aset berhasil dikembalikan dan sekarang tersedia."
    );
  };

  const confirmLabel = saving ? "Memproses..." : isProblem ? "Konfirmasi Pengembalian & Kirim Laporan" : "Konfirmasi Pengembalian";

  return (
    <ConfirmModal
      open={open}
      title="Kembalikan Aset"
      confirmLabel={confirmLabel}
      confirmDisabled={saving}
      cancelDisabled={saving}
      panelClassName="relative flex max-h-[92vh] w-[740px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg sm:max-h-[90vh]"
      headerClassName="shrink-0 border-b border-slate-200 px-4 py-4 sm:px-6"
      bodyClassName="flex-1 overflow-y-auto px-4 py-4 sm:px-6"
      footerClassName="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white px-4 py-4 sm:flex-row sm:justify-end sm:px-6"
      onConfirm={handleConfirm}
      onCancel={resetAndClose}
    >
      <div className="space-y-5">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="mb-1.5 text-slate-500">Anda akan mengembalikan aset berikut:</p>
          <p className="font-semibold text-slate-800">{asset.assetName}</p>
          <p className="font-mono text-xs text-slate-500">{asset.assetCode}</p>
          <p className="mt-1 text-xs text-slate-500">
            Lokasi: {asset.location || asset.locationText || "-"}
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Kondisi Saat Dikembalikan</label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {RETURN_CONDITION_OPTIONS.map((option) => {
              const Icon = option.icon;
              const selected = conditionChoice === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setConditionChoice(option.key)}
                  className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition ${
                    selected
                      ? "border-blue-400 bg-blue-50 ring-2 ring-blue-100"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <span className="flex w-full items-center justify-between gap-1.5">
                    <Icon
                      size={16}
                      className={
                        option.key === "good" ? "text-emerald-600" : "text-amber-600"
                      }
                    />
                    {selected && <CheckCircle2 size={14} className="text-blue-600" />}
                  </span>
                  <span className="text-sm font-semibold text-slate-800">{option.label}</span>
                  <span className="text-xs text-slate-500">{option.description}</span>
                </button>
              );
            })}
          </div>
        </div>

        {!isProblem ? (
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Catatan Pengembalian (opsional)</label>
            <textarea
              value={returnNotes}
              onChange={(e) => setReturnNotes(e.target.value)}
              className="input"
              rows={2}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 sm:grid-cols-2">
            <p className="text-xs font-medium text-amber-800 sm:col-span-2">
              Aset akan dikembalikan dan diteruskan kepada QHSE untuk pemeriksaan.
            </p>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
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
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Dampak <span className="text-red-500">*</span>
              </label>
              <select
                value={impactLevel}
                onChange={(e) => setImpactLevel(e.target.value as IssueImpactLevel)}
                className="input cursor-pointer"
              >
                <option value="">Pilih dampak</option>
                {RETURN_IMPACT_OPTIONS.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Catatan Kendala <span className="text-red-500">*</span>
              </label>
              <textarea
                value={issueNote}
                onChange={(e) => setIssueNote(e.target.value)}
                rows={3}
                placeholder="Jelaskan kendala yang dialami..."
                className="input"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Upload Foto/Video {photoRequired && <span className="text-red-500">*</span>}
                {!photoRequired && <span className="text-slate-400">(opsional)</span>}
              </label>
              <label className="file-drop">
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
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </ConfirmModal>
  );
}
