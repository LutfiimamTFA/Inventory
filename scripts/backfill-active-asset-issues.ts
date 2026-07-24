/*
 * Section 8 — backfill SATU KALI untuk data lama: tiket asset_issue_tickets
 * yang dibuat SEBELUM sinkronisasi assets/asset_issue_tickets ada, jadi
 * dokumen assets-nya belum pernah ditandai hasActiveIssue.
 *
 * Firebase Admin SDK (server-side, bypass rules) — TIDAK dijalankan
 * otomatis saat aplikasi start, harus dipanggil manual lewat:
 *   npm run backfill:asset-issues -- --dry-run
 *   npm run backfill:asset-issues
 */
import { getAdminFirestore } from "../src/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

const ACTIVE_ISSUE_TICKET_STATUSES = [
  "reported",
  "laporan_masuk",
  "assigned",
  "accepted",
  "in_progress",
  "need_more_info",
  "under_review",
  "waiting_qhse_review",
  "waiting_reporter_confirmation",
  "reporter_confirmed",
  "needs_follow_up",
  "revision_requested",
  "external_coordination",
];

const BATCH_LIMIT = 400; // aman di bawah limit 500 write/batch Firestore.

function toMillis(value: unknown): number {
  if (!value) return 0;
  const withToMillis = value as { toMillis?: () => number; _seconds?: number };
  if (typeof withToMillis.toMillis === "function") return withToMillis.toMillis();
  if (typeof withToMillis._seconds === "number") return withToMillis._seconds * 1000;
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = getAdminFirestore();
  if (!db) {
    console.error(
      "[backfill-active-asset-issues] Firebase Admin belum terkonfigurasi. " +
        "Set FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY di env sebelum menjalankan script ini."
    );
    process.exit(1);
  }

  console.log(`[backfill-active-asset-issues] START (${dryRun ? "DRY RUN" : "LIVE"})`);

  // 1) Baca semua asset_issue_tickets, pilih yang punya assetId + status aktif.
  const ticketsSnap = await db.collection("asset_issue_tickets").get();
  const activeTicketsByAsset = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();

  ticketsSnap.docs.forEach((docSnap) => {
    const data = docSnap.data();
    const assetId = data.assetId as string | undefined;
    const status = String(data.status || "");
    if (!assetId || !ACTIVE_ISSUE_TICKET_STATUSES.includes(status)) return;

    // 3/4 — kelompokkan per assetId, simpan yang PALING BARU saja.
    const existing = activeTicketsByAsset.get(assetId);
    if (!existing) {
      activeTicketsByAsset.set(assetId, docSnap);
      return;
    }
    const existingTime = toMillis(existing.data().createdAt || existing.data().reportedAt);
    const candidateTime = toMillis(data.createdAt || data.reportedAt);
    if (candidateTime > existingTime) activeTicketsByAsset.set(assetId, docSnap);
  });

  console.log(
    `[backfill-active-asset-issues] Ditemukan ${activeTicketsByAsset.size} aset dengan tiket aktif dari ${ticketsSnap.size} total tiket.`
  );

  // 2) Untuk tiap aset, cek dokumen assets — skip kalau sudah hasActiveIssue
  // true (sudah sinkron) ATAU kondisinya sudah kondisi rusak FINAL (bukan
  // "reported_issue") supaya tidak menimpa keputusan QHSE yang sudah ada.
  let plannedCount = 0;
  let skippedAlreadySynced = 0;
  let skippedFinalCondition = 0;
  let skippedMissingAsset = 0;
  const plannedUpdates: { assetId: string; ticketId: string; ticketNumber: string }[] = [];

  for (const [assetId, ticketDoc] of activeTicketsByAsset.entries()) {
    const assetRef = db.collection("assets").doc(assetId);
    const assetSnap = await assetRef.get();
    if (!assetSnap.exists) {
      skippedMissingAsset += 1;
      continue;
    }
    const assetData = assetSnap.data() || {};

    if (assetData.hasActiveIssue === true) {
      skippedAlreadySynced += 1;
      continue;
    }

    const currentCondition = String(assetData.condition || "").toLowerCase();
    const FINAL_DAMAGED_CONDITIONS = ["minor_damage", "heavy_damage", "damaged", "broken", "lost", "incomplete"];
    if (FINAL_DAMAGED_CONDITIONS.includes(currentCondition)) {
      // Section 8 — "Jangan menimpa kondisi rusak final tanpa pengecekan":
      // asset ini sudah punya keputusan kondisi eksplisit (bukan cuma
      // default "good") — jangan timpa jadi "reported_issue" begitu saja.
      skippedFinalCondition += 1;
      continue;
    }

    const ticketData = ticketDoc.data();
    plannedUpdates.push({
      assetId,
      ticketId: ticketDoc.id,
      ticketNumber: ticketData.ticketNumber || ticketData.ticketNo || ticketDoc.id,
    });
    plannedCount += 1;

    console.log(
      `[backfill-active-asset-issues] PLAN assetId=${assetId} ticketId=${ticketDoc.id} ticketNumber=${
        ticketData.ticketNumber || ticketData.ticketNo || "-"
      }`
    );

    if (dryRun) continue;

    // 5) Batch write, jangan timpa previousCondition kalau sudah ada.
    const batchList: FirebaseFirestore.WriteBatch[] = [];
    let currentBatch = db.batch();
    let opsInBatch = 0;

    const previousCondition =
      assetData.previousCondition ||
      (currentCondition && currentCondition !== "reported_issue" ? assetData.condition : "good");
    const previousConditionLabel =
      assetData.previousConditionLabel ||
      (assetData.conditionLabel && assetData.conditionLabel !== "Dilaporkan Bermasalah"
        ? assetData.conditionLabel
        : "Baik");

    currentBatch.update(assetRef, {
      hasActiveIssue: true,
      activeIssueTicketId: ticketDoc.id,
      activeIssueTicketNo: ticketData.ticketNumber || ticketData.ticketNo || null,
      condition: "reported_issue",
      conditionLabel: "Dilaporkan Bermasalah",
      previousCondition,
      previousConditionLabel,
      lastIssueSymptomLabel: ticketData.symptomLabel || ticketData.symptomType || ticketData.title || "",
      lastIssueNote: ticketData.description || ticketData.note || "",
      lastIssueImpactLabel: ticketData.impactLabel || ticketData.impactLevel || "",
      issueReportedAt: ticketData.createdAt || ticketData.reportedAt || FieldValue.serverTimestamp(),
      issueReportedByUid: ticketData.createdByUid || ticketData.reporterUid || "",
      issueReportedByName: ticketData.createdByName || ticketData.reporterName || "",
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: "system_backfill",
      updatedByName: "System Backfill",
    });
    opsInBatch += 1;
    batchList.push(currentBatch);

    if (opsInBatch >= BATCH_LIMIT) {
      currentBatch = db.batch();
      opsInBatch = 0;
    }

    for (const batch of batchList) {
      await batch.commit();
    }
  }

  console.log("[backfill-active-asset-issues] SUMMARY", {
    totalTickets: ticketsSnap.size,
    assetsWithActiveTicket: activeTicketsByAsset.size,
    planned: plannedCount,
    skippedAlreadySynced,
    skippedFinalCondition,
    skippedMissingAsset,
    mode: dryRun ? "DRY RUN (tidak ada perubahan ditulis)" : "LIVE (perubahan sudah ditulis)",
  });

  if (dryRun) {
    console.log(
      `[backfill-active-asset-issues] Dry run selesai. ${plannedCount} aset AKAN diubah. Jalankan tanpa --dry-run untuk menerapkan.`
    );
  } else {
    console.log(`[backfill-active-asset-issues] Selesai. ${plannedCount} aset berhasil diperbaiki.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[backfill-active-asset-issues] FAILED", error);
    process.exit(1);
  });
