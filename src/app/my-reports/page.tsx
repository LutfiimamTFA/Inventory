"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { ClipboardCheck } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { AssetIssueTicket } from "@/lib/types";
import {
  ISSUE_STATUS_COLOR,
  ISSUE_STATUS_LABEL,
  formatDateTime,
} from "@/lib/utils";
import ProtectedLayout from "@/components/ProtectedLayout";
import PageHeader from "@/components/PageHeader";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import IssueTicketDetailModal from "@/components/IssueTicketDetailModal";

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
        title="My Reports"
        subtitle="Laporan kendala asset yang pernah Anda kirim."
      />

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {tickets.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="Belum ada laporan"
            description="Scan QR asset lalu klik Laporkan Kendala untuk membuat laporan."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50/60">
                  <th className="px-4 py-3 font-semibold">Nomor Ticket</th>
                  <th className="px-4 py-3 font-semibold">Asset</th>
                  <th className="px-4 py-3 font-semibold">Gejala</th>
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
                    <td className="px-4 py-3 text-slate-600">
                      <p>{t.assetName}</p>
                      <p className="text-xs text-slate-400">{t.assetCode}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{t.symptomType}</td>
                    <td className="px-4 py-3">
                      <Badge label={ISSUE_STATUS_LABEL[t.status]} colorClass={ISSUE_STATUS_COLOR[t.status]} />
                    </td>
                    <td className="px-4 py-3 text-slate-500">{t.estimatedFinishAt || "-"}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDateTime(t.reportedAt)}</td>
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
          readOnly
        />
      )}
    </ProtectedLayout>
  );
}
