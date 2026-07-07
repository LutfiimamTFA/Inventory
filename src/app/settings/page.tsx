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
        subtitle="Pengaturan sistem AssetView."
      />
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
        {role === "super_admin" ? (
          <EmptyState
            icon={SettingsIcon}
            title="Belum ada pengaturan"
            description="Fitur pengaturan sistem akan tersedia di sini pada tahap berikutnya."
          />
        ) : (
          <EmptyState
            icon={SettingsIcon}
            title="Akses terbatas"
            description="Halaman ini hanya dapat diakses oleh Super Admin."
          />
        )}
      </div>
    </ProtectedLayout>
  );
}
