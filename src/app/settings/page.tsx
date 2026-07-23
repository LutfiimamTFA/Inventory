"use client";

import { Settings as SettingsIcon } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import ProtectedLayout from "@/components/ProtectedLayout";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";

export default function SettingsPage() {
  const { role } = useAuth();

  return (
    <ProtectedLayout>
      <PageHeader
        title="Settings"
        subtitle="Pengaturan sistem QHSE Care."
      />
      <div className="space-y-5">
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
              description="Pengaturan sistem hanya tersedia untuk Super Admin."
            />
          </div>
        )}
      </div>
    </ProtectedLayout>
  );
}
