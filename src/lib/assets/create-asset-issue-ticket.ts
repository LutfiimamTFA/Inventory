import { collection, doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Asset } from "@/lib/types";

// Section 2 — SATU service dipakai oleh SEMUA jalur pembuatan laporan
// kendala aset (Scan QR, Buat Laporan tanpa QR, dan jalur lain di masa
// depan) supaya strukturnya SELALU sama: ticket dan kondisi sementara aset
// ("Dilaporkan Bermasalah") ditulis dalam SATU writeBatch — kalau salah
// satu gagal, keduanya gagal (tidak ada ticket "menggantung" tanpa aset
// ter-update, atau sebaliknya).
export interface CreateAssetIssueTicketParams {
  // Payload ticket LENGKAP (semua field asset_issue_tickets kecuali id) —
  // pemanggil yang menentukan reportType/title/description/dst. sesuai
  // konteks form masing-masing.
  ticketPayload: Record<string, unknown>;
  ticketNumber: string;
  // null/undefined = laporan umum TANPA aset (fasilitas/kebersihan/K3/dst.)
  // — ticket tetap dibuat, TAPI tidak ada update ke collection assets sama
  // sekali (sesuai target: jangan update asset untuk laporan non-aset).
  asset: Pick<
    Asset,
    "id" | "condition" | "conditionLabel" | "previousCondition" | "previousConditionLabel"
  > | null;
  userUid: string;
  userName: string;
  symptomLabel: string;
  note: string;
  impactLabel: string;
}

export interface CreateAssetIssueTicketResult {
  ticketId: string;
  ticketNumber: string;
}

export async function createAssetIssueTicket(
  params: CreateAssetIssueTicketParams
): Promise<CreateAssetIssueTicketResult> {
  const { ticketPayload, ticketNumber, asset, userUid, userName, symptomLabel, note, impactLabel } = params;

  const ticketRef = doc(collection(db, "asset_issue_tickets"));
  const batch = writeBatch(db);
  batch.set(ticketRef, ticketPayload);

  if (asset?.id) {
    // Section A — kalau asset KEBETULAN sudah "reported_issue" (laporan
    // kedua sebelum yang pertama selesai direview), jangan snapshot
    // "reported_issue" itu sendiri sebagai previousCondition — pertahankan
    // yang sudah tersimpan supaya kondisi asli tetap bisa dikembalikan nanti.
    const previousCondition =
      asset.condition && asset.condition !== "reported_issue" ? asset.condition : asset.previousCondition || "good";
    const previousConditionLabel =
      asset.conditionLabel && asset.conditionLabel !== "Dilaporkan Bermasalah"
        ? asset.conditionLabel
        : asset.previousConditionLabel || "Baik";

    batch.update(doc(db, "assets", asset.id), {
      hasActiveIssue: true,
      activeIssueTicketId: ticketRef.id,
      activeIssueTicketNo: ticketNumber,

      condition: "reported_issue",
      conditionLabel: "Dilaporkan Bermasalah",

      previousCondition,
      previousConditionLabel,

      issueReportedAt: serverTimestamp(),
      issueReportedByUid: userUid,
      issueReportedByName: userName,

      lastIssueSymptomLabel: symptomLabel || "",
      lastIssueNote: note || "",
      lastIssueImpactLabel: impactLabel || "",

      updatedAt: serverTimestamp(),
      updatedByUid: userUid,
      updatedByName: userName,
    });
  }

  await batch.commit();

  return { ticketId: ticketRef.id, ticketNumber };
}
