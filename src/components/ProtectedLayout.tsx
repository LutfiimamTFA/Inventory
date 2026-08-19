"use client";

import { ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  Tags,
  ClipboardList,
  ClipboardPlus,
  FileBarChart,
  Users,
  QrCode,
  History,
  Settings,
  LogOut,
  Menu,
  X,
  Search,
  ChevronRight,
  Wrench,
  ClipboardCheck,
  MapPin,
  Columns3,
  UploadCloud,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { AppRole } from "@/lib/types";
import { getDefaultRouteForRole, ROLE_LABEL } from "@/lib/roles";
import NotificationBell from "@/components/NotificationBell";

type NavGroup = "OPERASIONAL" | "PENANGANAN" | "DATA MASTER" | "LAPORAN" | "LAINNYA";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  roles: AppRole[];
  group: NavGroup;
  // Section D — item tetap tampil untuk role di luar `roles` di atas kalau
  // user adalah PIC Lokasi (role "location_pic" ATAU staff/role lain yang
  // ditunjuk PIC di Master Lokasi — lihat isLocationPicRole di
  // auth-context). Dipakai khusus "Assets" supaya staff+PIC dapat menu ini
  // tanpa perlu diberi role "location_pic" secara literal.
  picBucketAllowed?: boolean;
}

// Section 2 — urutan grup tetap, header grup HANYA tampil kalau minimal
// satu item di dalamnya terlihat untuk role yang sedang login (lihat
// visibleNav/groupedNav di bawah) — supaya tidak ada judul grup kosong.
const NAV_GROUP_ORDER: NavGroup[] = ["OPERASIONAL", "PENANGANAN", "DATA MASTER", "LAPORAN", "LAINNYA"];

// Section — hak dasar karyawan (Scan QR, My Borrowings, Buat Laporan,
// Laporan Saya) berlaku untuk SEMUA role internal yang masih aktif —
// role khusus (it_team/asset_finance/location_pic/asset_admin/super_admin)
// MENAMBAH akses di atas ini, tidak pernah menghapusnya. Jangan pernah
// mempersempit array ini jadi cuma ["staff"] lagi — itulah akar bug
// sebelumnya (role khusus tanpa sengaja menggantikan, bukan menambah, hak
// dasar karyawan).
const BASIC_EMPLOYEE_ROLES: AppRole[] = [
  "staff",
  "it_team",
  "asset_finance",
  "location_pic",
  "asset_admin",
  "super_admin",
];

const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dasbor",
    icon: LayoutDashboard,
    group: "OPERASIONAL",
    // Section 4 — PIC Lokasi TIDAK punya Dashboard khusus (workflow
    // verifikasi/approval PIC dibatalkan) — menu PIC Lokasi cukup 5 item:
    // Aset Lokasi Saya, Scan QR, My Borrowings, Buat Laporan, Laporan Saya.
    roles: ["super_admin", "asset_admin", "asset_finance"],
  },
  {
    href: "/assets",
    label: "Aset",
    icon: Package,
    group: "OPERASIONAL",
    roles: ["super_admin", "asset_admin", "asset_finance", "location_pic"],
    picBucketAllowed: true,
  },
  {
    href: "/borrowings",
    label: "Peminjaman",
    icon: ClipboardList,
    group: "OPERASIONAL",
    roles: ["super_admin", "asset_admin"],
  },
  {
    href: "/scan",
    label: "Pindai QR",
    icon: QrCode,
    group: "OPERASIONAL",
    roles: BASIC_EMPLOYEE_ROLES,
  },
  {
    href: "/my-borrowings",
    label: "Peminjaman Saya",
    icon: History,
    group: "OPERASIONAL",
    roles: BASIC_EMPLOYEE_ROLES,
  },
  {
    href: "/maintenance",
    label: "Pemeliharaan & Kendala",
    icon: Wrench,
    group: "PENANGANAN",
    // Section 3 — PIC Lokasi tidak menangani maintenance teknis sama
    // sekali — menu ini eksklusif untuk it_team/asset_admin(QHSE)/super_admin.
    roles: ["super_admin", "asset_admin", "it_team"],
  },
  {
    href: "/workflow-board",
    label: "Alur Pekerjaan",
    icon: Columns3,
    group: "PENANGANAN",
    roles: ["super_admin", "asset_admin", "it_team"],
  },
  {
    href: "/categories",
    label: "Kategori Aset",
    icon: Tags,
    group: "DATA MASTER",
    roles: ["super_admin", "asset_admin"],
  },
  {
    href: "/locations",
    label: "Data Lokasi",
    icon: MapPin,
    group: "DATA MASTER",
    roles: ["super_admin", "asset_admin"],
  },
  {
    href: "/bulk-upload",
    label: "Import Aset",
    icon: UploadCloud,
    group: "DATA MASTER",
    // Section "Rombak permission Asset" — Asset Finance sekarang juga boleh
    // Import Aset (termasuk Sinkronkan Foto/No. Aset).
    roles: ["super_admin", "asset_admin", "asset_finance"],
  },
  {
    href: "/my-reports",
    label: "Laporan Saya",
    icon: ClipboardCheck,
    group: "LAPORAN",
    roles: BASIC_EMPLOYEE_ROLES,
  },
  {
    href: "/reports",
    label: "Rekap Laporan",
    icon: FileBarChart,
    group: "LAPORAN",
    roles: ["super_admin", "asset_admin", "asset_finance"],
  },
  {
    href: "/access",
    label: "User Access",
    icon: Users,
    group: "LAINNYA",
    roles: ["super_admin"],
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    group: "LAINNYA",
    // Section D/J — Settings HANYA untuk Super Admin. Sebelumnya semua role
    // bisa lihat menu ini padahal isinya cuma pesan "akses terbatas" untuk
    // non-super-admin — membingungkan, bukan berguna.
    roles: ["super_admin"],
  },
];

const SIDEBAR_COLLAPSED_KEY = "assetview_sidebar_collapsed";
const SIDEBAR_EXPANDED_WIDTH = 260;
const SIDEBAR_COLLAPSED_WIDTH = 76;

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  const { firebaseUser, assetUser, role, loading, accessDenied, isLocationPicRole, logout } =
    useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (stored === "true") {
      queueMicrotask(() => setCollapsed(true));
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      return next;
    });
  };

  useEffect(() => {
    if (loading) return;
    if (!firebaseUser || accessDenied) {
      router.replace("/login");
    }
  }, [loading, firebaseUser, accessDenied, router]);

  // Section C/I — PIC Lokasi lewat Master Lokasi (assignedPicLocations)
  // dianggap sama seperti role "location_pic" literal untuk keperluan
  // sidebar/route guard, TANPA mengubah role backend user (tetap "staff").
  const isLocationPicScoped = role === "location_pic" || isLocationPicRole;

  useEffect(() => {
    if (loading || !role) return;
    // /notifications diakses lewat lonceng topbar, bukan lewat sidebar, tapi
    // tetap harus lolos guard untuk semua role yang sudah login.
    if (pathname.startsWith("/notifications")) return;
    // Section 1/7/8 — "Buat Laporan" sengaja TIDAK punya menu sidebar
    // sendiri lagi (dihapus supaya tidak duplikat dengan "Laporan Saya"),
    // tapi rute-nya TETAP harus bisa diakses oleh semua karyawan aktif
    // lewat tombol "Buat Laporan" di halaman /my-reports — jadi harus
    // lolos guard ini juga, sama seperti /notifications.
    if (pathname.startsWith("/staff-reports/new")) return;
    const allowed = NAV_ITEMS.some(
      (item) =>
        (item.roles.includes(role) || (item.picBucketAllowed && isLocationPicScoped)) &&
        pathname.startsWith(item.href)
    );
    if (!allowed) {
      router.replace(getDefaultRouteForRole(role));
    }
  }, [loading, role, pathname, router, isLocationPicScoped]);

  if (loading || !firebaseUser || !assetUser || !role) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-screen bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-9 w-9 rounded-full border-2 border-slate-200 border-t-slate-900 animate-spin" />
          <p className="text-slate-400 text-sm">Memuat QHSE Care...</p>
        </div>
      </div>
    );
  }

  const PIC_LABEL_OVERRIDE: Record<string, string> = {
    "/assets": "Aset Lokasi Saya",
  };
  const visibleNav = NAV_ITEMS.filter(
    (item) => item.roles.includes(role) || (item.picBucketAllowed && isLocationPicScoped)
  ).map((item) =>
    // Section 5 — PIC Lokasi cuma melihat aset di lokasi tanggung jawabnya
    // (lihat isAssetInMyPicLocation di halaman /assets), jadi label menu ini
    // disesuaikan supaya tidak terkesan menampilkan seluruh aset perusahaan.
    isLocationPicScoped && PIC_LABEL_OVERRIDE[item.href] ? { ...item, label: PIC_LABEL_OVERRIDE[item.href] } : item
  );
  const currentNav = visibleNav.find((item) => pathname.startsWith(item.href));
  const isStaff = role === "staff";
  // Section 2 — kelompokkan menu yang terlihat per grup, urutan grup tetap
  // (NAV_GROUP_ORDER), header grup dilewati kalau tidak ada item di
  // dalamnya untuk role ini (jangan tampilkan judul grup kosong).
  const groupedNav = NAV_GROUP_ORDER.map((group) => ({
    group,
    items: visibleNav.filter((item) => item.group === group),
  })).filter((g) => g.items.length > 0);

  function renderSidebar(isCollapsed: boolean) {
    return (
      <div className="flex flex-col h-full">
        <div
          className={`flex items-center h-16 border-b border-slate-200 transition-all duration-300 ease-in-out ${
            isCollapsed ? "justify-center px-2" : "gap-2.5 px-5"
          }`}
        >
          <img
            src="/qhse-care-icon.png"
            alt="QHSE Care"
            className="h-9 w-9 shrink-0 rounded-xl object-cover shadow-md shadow-blue-500/20"
          />
          {!isCollapsed && (
            <div className="min-w-0 overflow-hidden">
              <p className="text-slate-900 font-semibold leading-tight truncate">QHSE Care</p>
              <p className="text-[11px] text-slate-400 leading-tight truncate">
                Safety & Maintenance
              </p>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-4">
          {groupedNav.map(({ group, items }) => (
            <div key={group} className="space-y-1">
              {!isCollapsed && (
                <p className="px-3 text-[10px] font-semibold tracking-wider text-slate-400 uppercase mb-2">
                  {group}
                </p>
              )}
              {items.map((item) => {
                const active = pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    title={isCollapsed ? item.label : undefined}
                    className={`group flex items-center rounded-xl py-2.5 text-sm font-medium transition-all cursor-pointer ${
                      isCollapsed ? "justify-center px-0" : "gap-3 px-3"
                    } ${
                      active
                        ? "bg-gradient-to-r from-blue-50 to-teal-50 text-blue-700 shadow-sm"
                        : "text-slate-700 hover:bg-slate-100 active:bg-slate-200"
                    }`}
                  >
                    <Icon
                      size={18}
                      className={`shrink-0 ${active ? "text-blue-600" : "text-slate-500 group-hover:text-slate-700"}`}
                    />
                    {!isCollapsed && (
                      <>
                        <span className="flex-1 truncate">{item.label}</span>
                        {active && <ChevronRight size={15} className="text-blue-600 shrink-0" />}
                      </>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-3">
          <div
            className={`flex items-center rounded-xl bg-slate-50 mb-2 ${
              isCollapsed ? "justify-center p-2" : "gap-2.5 px-3 py-2.5"
            }`}
          >
            <div
              className="h-9 w-9 shrink-0 rounded-full bg-gradient-to-br from-blue-500 to-teal-400 flex items-center justify-center text-xs font-semibold text-white"
              title={isCollapsed ? assetUser!.name : undefined}
            >
              {initials(assetUser!.name) || "?"}
            </div>
            {!isCollapsed && (
              <div className="min-w-0">
                <p className="text-sm text-slate-800 font-medium truncate">
                  {assetUser!.name}
                </p>
                <p className="text-[11px] text-slate-400 truncate">
                  {ROLE_LABEL[role!]}
                </p>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => logout()}
            title={isCollapsed ? "Keluar" : undefined}
            className={`flex w-full items-center rounded-xl py-2 text-sm font-medium text-slate-600 cursor-pointer hover:bg-slate-100 active:bg-slate-200 transition-colors ${
              isCollapsed ? "justify-center px-0" : "gap-2 px-3"
            }`}
          >
            <LogOut size={16} className="shrink-0" />
            {!isCollapsed && "Keluar"}
          </button>
        </div>
      </div>
    );
  }

  const desktopSidebarWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH;

  return (
    <div className="flex flex-1 min-h-screen bg-slate-50">
      <aside
        style={{ width: desktopSidebarWidth }}
        className="hidden md:flex md:flex-col bg-white border-r border-slate-200 fixed inset-y-0 transition-all duration-300 ease-in-out overflow-hidden"
      >
        {renderSidebar(collapsed)}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-64 bg-white border-r border-slate-200">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 text-slate-400 cursor-pointer hover:text-slate-700 z-10"
            >
              <X size={20} />
            </button>
            {renderSidebar(false)}
          </aside>
        </div>
      )}

      <div
        style={{ "--sidebar-w": `${desktopSidebarWidth}px` } as React.CSSProperties}
        className="flex-1 min-w-0 max-w-full flex flex-col min-h-screen transition-all duration-300 ease-in-out md:ml-[var(--sidebar-w)]"
      >
        <TopbarAndMain
          currentNav={currentNav}
          isStaff={isStaff}
          assetUser={assetUser}
          role={role}
          onOpenMobileMenu={() => setMobileOpen(true)}
          onToggleSidebar={toggleCollapsed}
        >
          {children}
        </TopbarAndMain>
      </div>

      {isStaff && (
        <nav className="fixed bottom-0 inset-x-0 z-30 md:hidden bg-white border-t border-slate-200 flex items-stretch">
          <Link
            href="/scan"
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 text-xs font-medium cursor-pointer active:bg-slate-100 ${
              pathname.startsWith("/scan") ? "text-blue-600" : "text-slate-500"
            }`}
          >
            <QrCode size={20} />
            Scan
          </Link>
          <Link
            href="/staff-reports/new"
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 text-xs font-medium cursor-pointer active:bg-slate-100 ${
              pathname.startsWith("/staff-reports/new") ? "text-blue-600" : "text-slate-500"
            }`}
          >
            <ClipboardPlus size={20} />
            Buat
          </Link>
          <Link
            href="/my-reports"
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 text-xs font-medium cursor-pointer active:bg-slate-100 ${
              pathname.startsWith("/my-reports") ? "text-blue-600" : "text-slate-500"
            }`}
          >
            <ClipboardCheck size={20} />
            Laporan
          </Link>
          <button
            type="button"
            onClick={() => logout()}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 text-xs font-medium text-slate-500 cursor-pointer active:bg-slate-100"
          >
            <LogOut size={20} />
            Logout
          </button>
        </nav>
      )}
    </div>
  );
}

function TopbarAndMain({
  children,
  currentNav,
  isStaff,
  assetUser,
  role,
  onOpenMobileMenu,
  onToggleSidebar,
}: {
  children: ReactNode;
  currentNav?: NavItem;
  isStaff: boolean;
  assetUser: { name: string };
  role: AppRole;
  onOpenMobileMenu: () => void;
  onToggleSidebar: () => void;
}) {
  return (
    <div className="flex min-w-0 max-w-full flex-col min-h-screen">
      <header className="h-16 border-b border-slate-200 bg-white/80 backdrop-blur-sm flex items-center px-4 md:px-6 gap-3 sticky top-0 z-30">
        <button
          type="button"
          className="md:hidden flex items-center justify-center h-9 w-9 rounded-full text-slate-600 cursor-pointer hover:bg-slate-100"
          onClick={onOpenMobileMenu}
          title="Menu"
        >
          <Menu size={22} />
        </button>

        <button
          type="button"
          className="hidden md:flex items-center justify-center h-9 w-9 rounded-full text-slate-600 cursor-pointer hover:bg-slate-100 active:bg-slate-200"
          onClick={onToggleSidebar}
          title="Menu"
        >
          <Menu size={20} />
        </button>

        <div className="hidden sm:flex items-center gap-1.5 text-sm text-slate-400">
          <span>QHSE Care</span>
          {currentNav && (
            <>
              <ChevronRight size={14} />
              <span className="text-slate-700 font-medium">{currentNav.label}</span>
            </>
          )}
        </div>

        {!isStaff && (
          <div className="flex-1 hidden md:flex justify-center px-6">
            <div className="relative w-full max-w-sm">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                placeholder="Cari aset, kode, atau lokasi..."
                className="w-full rounded-full border border-slate-200 bg-slate-50 pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
              />
            </div>
          </div>
        )}

        <div className="ml-auto flex items-center gap-3">
          <NotificationBell />
          <div className="hidden sm:flex flex-col items-end leading-tight">
            <span className="text-sm font-medium text-slate-800">{assetUser.name}</span>
            <span className="text-[11px] text-slate-400">{ROLE_LABEL[role]}</span>
          </div>
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-blue-500 to-teal-400 flex items-center justify-center text-xs font-semibold text-white shrink-0">
            {initials(assetUser.name) || "?"}
          </div>
        </div>
      </header>
      <main className="flex-1 min-w-0 w-full max-w-full p-4 md:p-6 pb-20 md:pb-6">{children}</main>
    </div>
  );
}
