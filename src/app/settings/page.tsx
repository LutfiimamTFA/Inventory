"use client";

import { Settings as SettingsIcon } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import ProtectedLayout from "@/components/ProtectedLayout";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import PasskeySecurityPanel from "@/components/PasskeySecurityPanel";

export default function SettingsPage() {
  const { role } = useAuth();

  return (
    <ProtectedLayout>
      <PageHeader
        title="Settings"
        subtitle="Pengaturan sistem QHSE Care."
      />
      <div className="space-y-5">
        <PasskeySecurityPanel />
        {role === "super_admin" ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
            <EmptyState
              icon={SettingsIcon}
              title="Belum ada pengaturan sistem"
              description="Fitur pengaturan sistem akan tersedia di sini pada tahap berikutnya."
            />
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
            <EmptyState
              icon={SettingsIcon}
              title="Pengaturan sistem terbatas"
              description="Bagian pengaturan sistem hanya dapat diakses oleh Super Admin."
            />
          </div>
        )}
      </div>
    </ProtectedLayout>
  );
}
