// Section "Halaman Utama Peminjaman Tanpa Login" — daftar divisi/karyawan di
// bawah ini SENGAJA statis dan dikelola manual di file ini, BUKAN hasil sync
// dari collection `employee_profiles`/`users` (HRP). Field `divisionName` di
// data HRP tidak konsisten antar sumber (lihat komentar di
// src/lib/hrp.ts/firestore-helpers.ts). Divisi ini sebelumnya sempat dinamai
// "CBDMS", tapi diganti ke "DTIC" karena "CBDMS" di sistem ini sudah dipakai
// sebagai kode lokasi/ruangan (lihat src/lib/import/location-match.ts dan
// legacyAliases di src/lib/types.ts) — supaya tidak rancu dengan nama lokasi.
// Jangan klaim daftar ini tersinkron dengan HRP di UI mana pun. Dipakai
// HANYA oleh fitur kios publik (pinjam/kembalikan tanpa login) di
// src/app/PublicBorrowLanding.tsx dan oleh validasi server di
// src/app/api/public/borrow|return/route.ts. Tidak ada akun Firebase Auth
// yang dibuat untuk nama-nama ini — identitas peminjam di asset_borrowings
// cuma string nama+divisi, bukan uid.
export interface PublicBorrowDivision {
  id: string;
  label: string;
  employees: string[];
}

export const PUBLIC_BORROW_DIRECTORY: PublicBorrowDivision[] = [
  {
    id: "operational",
    label: "Operational",
    employees: [
      "Yusuf Wiryawan",
      "Riyandi",
      "Unggul Prasojo",
      "Vega Prinda Cahyani",
      "Nabila Kinthen",
      "Bella Kurniawati",
      "Nadhifah Wafir Zahrah",
      "Septiano Raffi Dharmawan",
      "Ricky Surya Pratama",
      "Gina Salwa Shalihaf",
      "Kendra Isma Lutfia",
      "Bagus Budi Priyono",
      "Alifta Huda Fadillah",
      "Aditia Putra Wardani",
      "Ayu Pramesti Wedasari",
      "Nur Rizki Putri Ramadhanti",
      "Fajar Azmi Firman",
      "Kinanti Melati Putri",
      "Adinda Veronisa Surgawi",
      "Dilla Kusuma Wardhani",
      "Angkin Bikta Santara Thatya",
      "Muhammad Alfin Prastya Nugraha",
      "Kalya Dinda Az-Zahra",
      "Alifia Faza Adzkia",
      "Alya Widya Wiranda",
      "Firliandiva Anataya Putri",
      "Aulia Safitri",
      "Narindra Indah Puspita",
      "Todo Fidel Marvel",
      "Intan Ardhana",
    ],
  },
  {
    id: "marketing_development",
    label: "Marketing & Development Services",
    employees: [
      "Sari Wulandari",
      "Peny Nur Rohmah",
      "Rifqi Setya Budi",
      "Anwar Subiyanto",
      "Ahmad Kurnia",
      "Aliftia Hawa Mustika",
    ],
  },
  {
    id: "general_affair",
    label: "General Affair",
    employees: [
      "Saepul",
      "Radasmara Nakita Atmoko",
      "Laily Nafiah",
      "Rizki Fatikhati Sabila",
      "Wulan Nur Khasanah",
      "Karunia Harum Larasati Wardoyo",
    ],
  },
  {
    id: "dtic",
    label: "DTIC",
    employees: [
      "Daniel Kristian Nugroho",
      "Hibatul Azizi Aminullah",
      "Nuri Khusnaini",
      "Muhammad Reza Alamsyah",
      "Gilar Dwi Rahayu",
      "Fathin Maqbulloh Sawiji",
      "Hikmatud Diyana",
      "Lutfi Imam Tauchid Faried Akbar",
      "Doly Ilham Saputra Huta Julu",
      "Stevan Hary Laksono",
      "Ikfina Sarah",
      "Mujahidah Afifah",
      "Abdurohman saputra",
    ],
  },
];

export function getPublicBorrowDivision(divisionId: string): PublicBorrowDivision | undefined {
  return PUBLIC_BORROW_DIRECTORY.find((d) => d.id === divisionId);
}

export function searchEmployeesInDivision(divisionId: string, query: string): string[] {
  const division = getPublicBorrowDivision(divisionId);
  if (!division) return [];
  const q = query.trim().toLowerCase();
  if (!q) return division.employees;
  return division.employees.filter((name) => name.toLowerCase().includes(q));
}

// Dipakai server-side (API route) untuk memvalidasi bahwa nama+divisi yang
// dikirim client benar-benar ada di daftar referensi ini — jangan pernah
// percaya nama tampilan dari client begitu saja.
export function isKnownPublicBorrower(divisionId: string, name: string): boolean {
  const division = getPublicBorrowDivision(divisionId);
  if (!division) return false;
  const target = name.trim().toLowerCase();
  if (!target) return false;
  return division.employees.some((employee) => employee.toLowerCase() === target);
}
