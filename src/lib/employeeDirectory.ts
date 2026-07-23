"use client";

import { useEffect, useState } from "react";
import { EmployeeOption, fetchActiveEmployeeOptions } from "@/lib/firestore-helpers";
import { getPersonDisplayName } from "@/lib/utils";

// Section I — direktori karyawan dipakai untuk resolve "nama asli" dari
// uid/email tersimpan di custodian*/currentHolder* asset lama yang masih
// keburu cuma nyimpen email. fetchActiveEmployeeOptions() SUDAH membaca
// EMPLOYEE_PROFILES_COLLECTION (sumber HRP prioritas #1 di spec) — dicache
// per sesi browser (module-level) supaya list Assets/Scan QR yang render
// banyak baris tidak masing-masing fetch ulang seluruh direktori karyawan.
let cachedPromise: Promise<EmployeeOption[]> | null = null;

function loadEmployeeOptionsCached(): Promise<EmployeeOption[]> {
  if (!cachedPromise) {
    cachedPromise = fetchActiveEmployeeOptions().catch((err) => {
      cachedPromise = null;
      throw err;
    });
  }
  return cachedPromise;
}

export interface EmployeeDirectory {
  loading: boolean;
  resolveName: (uid?: string | null, email?: string | null) => string | null;
  resolveDivision: (uid?: string | null, email?: string | null) => string | null;
}

export function useEmployeeDirectory(): EmployeeDirectory {
  const [byUid, setByUid] = useState<Map<string, EmployeeOption>>(new Map());
  const [byEmail, setByEmail] = useState<Map<string, EmployeeOption>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadEmployeeOptionsCached()
      .then((options) => {
        if (cancelled) return;
        const uidMap = new Map<string, EmployeeOption>();
        const emailMap = new Map<string, EmployeeOption>();
        options.forEach((o) => {
          uidMap.set(o.uid, o);
          if (o.email) emailMap.set(o.email.toLowerCase(), o);
        });
        setByUid(uidMap);
        setByEmail(emailMap);
      })
      .catch((err) => console.error("[Employee Directory] gagal memuat", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resolveName = (uid?: string | null, email?: string | null) => {
    const byUidMatch = uid ? byUid.get(uid) : undefined;
    if (byUidMatch?.name) return byUidMatch.name;
    const byEmailMatch = email ? byEmail.get(email.toLowerCase()) : undefined;
    return byEmailMatch?.name || null;
  };

  const resolveDivision = (uid?: string | null, email?: string | null) => {
    const byUidMatch = uid ? byUid.get(uid) : undefined;
    if (byUidMatch?.divisionName || byUidMatch?.brandName) {
      return byUidMatch.divisionName || byUidMatch.brandName;
    }
    const byEmailMatch = email ? byEmail.get(email.toLowerCase()) : undefined;
    return byEmailMatch?.divisionName || byEmailMatch?.brandName || null;
  };

  return { loading, resolveName, resolveDivision };
}

// Section H/K — dipakai render PIC/Custodian/Pemegang Saat Ini di mana pun
// (assets list, asset detail, Scan QR): name field asset diprioritaskan
// SELAMA bukan email; kalau email/kosong, coba resolve dari directory;
// fallback terakhir baru tampilkan email mentah.
export function getResolvedPersonDisplay(
  person: { name?: string | null; email?: string | null; uid?: string | null },
  directory: EmployeeDirectory
): { name: string; sub: string } {
  const resolvedFromDirectory = directory.resolveName(person.uid, person.email);
  return {
    name: getPersonDisplayName(person.name, person.email, resolvedFromDirectory),
    sub: directory.resolveDivision(person.uid, person.email) || "",
  };
}
