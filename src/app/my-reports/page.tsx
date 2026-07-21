"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { ClipboardCheck, ClipboardPlus } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { AssetIssueTicket } from "@/lib/types";
import {
  ISSUE_STATUS_COLOR,
  ISSUE_STATUS_STAFF_LABEL,
  ISSUE_REPORT_TYPE_COLOR,
  ISSUE_REPORT_TYPE_LABEL,
  formatDateTime,
} from "@/lib/utils";
import ProtectedLayout from "@/components/ProtectedLayout";
import PageHeader from "@/components/PageHeader";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import IssueTicketDetailModal from "@/components/IssueTicketDetailModal";

function reportTypeLabel(ticket: AssetIssueTicket) {
  return ticket.reportType ? ISSUE_REPORT_TYPE_LABEL[ticket.reportType] : "Kendala Asset";
}

function reportTypeColor(ticket: AssetIssueTicket) {
  return ticket.reportType ? ISSUE_REPORT_TYPE_COLOR[ticket.reportType] : "bg-amber-50 text-amber-700 border-amber-200";
}

export default function MyReportsPage() {
  const { firebaseUser, assetUser, role, loading } = useAuth();
  const authReady = !loading && !!firebaseUser && !!assetUser && !!role;
  const [tickets, setTickets] = useState<AssetIssueTicket[]>([]);
  const [detailTarget, setDetailTarget] = useState<AssetIssueTicket | null>(null);

  useEffect(() => {
    if (!authReady || !assetUser?.uid) return;
    const q = query(
      collection(db, "asset_issue_tickets"),
      where("reportedByUid", "==", assetUser.uid),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        console.log("[MyReportsPage Listener] asset_issue_tickets success:", snap.size);
        setTickets(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetIssueTicket)));
      },
      (error) => {
        console.error("[MyReportsPage Listener] asset_issue_tickets error:", error);
      }
    );
    return () => unsub();
  }, [authReady, assetUser?.uid]);

  return (
    <ProtectedLayout>
      <PageHeader
        title="Laporan Saya"
        subtitle="Laporan kendala yang pernah Anda kirim."
        actions={
          <Link
            href="/staff-reports/new"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 hover:brightness-105"
          >
            <ClipboardPlus size={16} />
            Buat Laporan
          </Link>
        }
      />

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {tickets.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="Belum ada laporan"
            description="Buat laporan dari menu Buat Laporan, atau scan QR jika laporan terkait asset tertentu."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50/60">
                  <th className="px-4 py-3 font-semibold">Nomor Ticket</th>
                  <th className="px-4 py-3 font-semibold">Jenis</th>
                  <th className="px-4 py-3 font-semibold">Laporan</th>
                  <th className="px-4 py-3 font-semibold">Asset / Lokasi</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Estimasi Selesai</th>
                  <th className="px-4 py-3 font-semibold">Tanggal Lapor</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => setDetailTarget(t)}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3 font-medium text-slate-800">{t.ticketNumber}</td>
                    <td className="px-4 py-3">
                      <Badge label={reportTypeLabel(t)} colorClass={reportTypeColor(t)} />
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <p className="font-medium text-slate-800">{t.title || t.symptomType || "-"}</p>
                      <p className="line-clamp-2 text-xs text-slate-400">{t.description}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <p>{t.assetName || "Tanpa asset"}</p>
                      <p className="text-xs text-slate-400">{t.assetCode || t.locationText || t.assetLocation || "-"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge label={t.staffStatusLabel || ISSUE_STATUS_STAFF_LABEL[t.status]} colorClass={ISSUE_STATUS_COLOR[t.status]} />
                    </td>
                    <td className="px-4 py-3 text-slate-500">{t.estimatedFinishAt || "-"}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDateTime(t.createdAt || t.reportedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detailTarget && (
        <IssueTicketDetailModal
          ticket={detailTarget}
          open={!!detailTarget}
          onClose={() => setDetailTarget(null)}
        />
      )}
    </ProtectedLayout>
  );
}
