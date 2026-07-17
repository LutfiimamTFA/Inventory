"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { X } from "lucide-react";
import Link from "next/link";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import {
  Asset,
  AssetCategory,
  AssetLocationNode,
  AssetSelectionMode,
  AssetUser,
  MaintenanceWorkOrder,
  WorkOrderPriority,
} from "@/lib/types";
import { getAssignedMaintenanceRole } from "@/lib/roles";
import { generateWorkOrderNumber, writeWorkOrderLog } from "@/lib/firestore-helpers";
import { buildChangeMessage, buildChangeSummary, createAssetNotification } from "@/lib/notifications";
import {
  ASSET_SELECTION_MODE_LABEL,
  computeNextDueDate,
  formatDate,
  frequencyMonthsLabel,
  monthYearLabel,
  WORK_ORDER_PRIORITY_LABEL,
} from "@/lib/utils";
import AssetPickerTable, {
  AssetPickerFilters,
  DEFAULT_ASSET_PICKER_FILTERS,
} from "@/components/AssetPickerTable";
import LocationCascadeFields, {
  EMPTY_LOCATION_SELECTION,
  LocationSelection,
} from "@/components/LocationCascadeFields";
import SearchableSelect, { SearchableSelectItem } from "@/components/SearchableSelect";

const PRIORITIES: WorkOrderPriority[] = ["low", "medium", "high", "urgent"];
const SELECTION_MODES: AssetSelectionMode[] = ["all_assets", "filtered_assets"];
const FREQUENCY_PRESETS = [1, 3, 6, 12] as const;

const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

export default function CreateMaintenanceScheduleModal({
  open,
  onClose,
  onCreated,
  editWorkOrder,
  duplicateFrom,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
  // Kalau diisi, modal ini jadi mode Edit Jadwal Maintenance Rutin —
  // form yang sama, tapi data sudah terisi dan submit meng-update dokumen
  // ini alih-alih membuat work order baru.
  editWorkOrder?: MaintenanceWorkOrder | null;
  // Kalau diisi (dan editWorkOrder kosong), modal tetap mode Buat Jadwal
  // biasa (addDoc jadwal baru) tapi form-nya diprefill dari jadwal lama —
  // dipakai tombol "Duplikat / Jadwalkan Ulang".
  duplicateFrom?: MaintenanceWorkOrder | null;
}) {
  const { firebaseUser, assetUser, role, loading } = useAuth();
  const authReady = !loading && !!firebaseUser && !!assetUser && !!role;
  const isEditMode = !!editWorkOrder;
  const prefillSource = editWorkOrder || duplicateFrom || null;
  const [assets, setAssets] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [technicians, setTechnicians] = useState<AssetUser[]>([]);
  const [locations, setLocations] = useState<AssetLocationNode[]>([]);

  const now = new Date();
  const [title, setTitle] = useState("");
  const [frequencyPreset, setFrequencyPreset] = useState<number | "custom">(1);
  const [frequencyCustomMonths, setFrequencyCustomMonths] = useState(1);
  const [startMonthIndex, setStartMonthIndex] = useState(now.getMonth());
  const [startYear, setStartYear] = useState(now.getFullYear());
  const [scheduledDayOfMonth, setScheduledDayOfMonth] = useState(now.getDate());
  const [addressSelection, setAddressSelection] = useState<LocationSelection>(
    EMPTY_LOCATION_SELECTION
  );
  const [assetSelectionMode, setAssetSelectionMode] = useState<AssetSelectionMode>("all_assets");
  const [filters, setFilters] = useState<AssetPickerFilters>(DEFAULT_ASSET_PICKER_FILTERS);
  const [filteredAssets, setFilteredAssets] = useState<Asset[]>([]);
  const [manualSelectedIds, setManualSelectedIds] = useState<Set<string>>(new Set());
  const [assignedToUid, setAssignedToUid] = useState("");
  const [priority, setPriority] = useState<WorkOrderPriority>("medium");
  const [qhseNote, setQhseNote] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [addressFilterInfo, setAddressFilterInfo] = useState("");

  // Edit-mode only state
  const [applyTo, setApplyTo] = useState<"current" | "next">("current");
  const [changeReason, setChangeReason] = useState("");

  useEffect(() => {
    if (!open || !authReady) return;
    const unsub1 = onSnapshot(
      collection(db, "assets"),
      (snap) => {
        console.log("[Listener] create maintenance assets success:", snap.size);
        setAssets(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Asset)));
      },
      (error) => {
        console.error("[Listener] create maintenance assets error:", error);
      }
    );
    const unsub2 = onSnapshot(
      collection(db, "asset_categories"),
      (snap) => {
        console.log("[Listener] create maintenance asset_categories success:", snap.size);
        setCategories(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetCategory)));
      },
      (error) => {
        console.error("[Listener] create maintenance asset_categories error:", error);
      }
    );
    const unsub3 = onSnapshot(
      collection(db, "asset_users"),
      (snap) => {
        console.log("[Listener] create maintenance asset_users success:", snap.size);
        setTechnicians(
          snap.docs
            .map((d) => ({ uid: d.id, ...d.data() } as AssetUser))
            .filter((u) => u.role === "it_team" && u.status === "active")
        );
      },
      (error) => {
        console.error("[Listener] create maintenance asset_users error:", error);
      }
    );
    const unsub4 = onSnapshot(
      collection(db, "asset_locations"),
      (snap) => {
        console.log("[Listener] create maintenance asset_locations success:", snap.size);
        setLocations(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() } as AssetLocationNode))
            .filter((n) => n.status === "active")
        );
      },
      (error) => {
        console.error("[Listener] create maintenance asset_locations error:", error);
      }
    );
    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
    };
  }, [open, authReady]);

  // Prefill form saat mode Edit ATAU Duplikat/Jadwalkan Ulang — jangan ubah
  // logic Buat Jadwal (addDoc) yang sudah jalan, ini cuma mengisi state yang
  // sama dari data existing.
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      if (!prefillSource) return;
      setTitle(prefillSource.title || "");
      const freq = prefillSource.frequencyMonths;
      if ([1, 3, 6, 12].includes(freq)) {
        setFrequencyPreset(freq as 1 | 3 | 6 | 12);
      } else {
        setFrequencyPreset("custom");
        setFrequencyCustomMonths(freq || 1);
      }
      setStartMonthIndex((prefillSource.startMonth || 1) - 1);
      setStartYear(prefillSource.startYear || new Date().getFullYear());
      setScheduledDayOfMonth(prefillSource.scheduledDayOfMonth || 1);
      setAddressSelection({
        buildingId: prefillSource.maintenanceBuildingId || "",
        buildingName: prefillSource.maintenanceBuildingName || "",
        floorId: prefillSource.maintenanceFloorId || "",
        floorName: prefillSource.maintenanceFloorName || "",
        roomId: prefillSource.maintenanceRoomId || "",
        roomName: prefillSource.maintenanceRoomName || "",
        areaId: prefillSource.maintenanceAreaId || "",
        areaName: prefillSource.maintenanceAreaName || "",
      });
      setAssetSelectionMode(prefillSource.assetSelectionMode || "all_assets");
      setFilters(
        prefillSource.assetSelectionMode === "filtered_assets" && prefillSource.filtersSnapshot
          ? {
              search: prefillSource.filtersSnapshot.searchText || "",
              buildingName: prefillSource.filtersSnapshot.assetBuildingName || "",
              floor: prefillSource.filtersSnapshot.assetFloor || "",
              roomName: prefillSource.filtersSnapshot.assetRoomName || "",
              areaName: prefillSource.filtersSnapshot.assetAreaName || "",
              category: prefillSource.filtersSnapshot.categoryText || "",
              status: prefillSource.filtersSnapshot.statusText || "",
              condition: prefillSource.filtersSnapshot.conditionText || "",
            }
          : DEFAULT_ASSET_PICKER_FILTERS
      );
      setManualSelectedIds(new Set(prefillSource.assetIds || []));
      setAssignedToUid(prefillSource.assignedToUid || "");
      setPriority(prefillSource.priority || "medium");
      setQhseNote(prefillSource.qhseNote || prefillSource.notes || "");
      if (editWorkOrder) {
        setApplyTo(
          editWorkOrder.status === "completed" || editWorkOrder.status === "cancelled"
            ? "next"
            : "current"
        );
      }
      setChangeReason("");
      setError("");
    });
  }, [open, editWorkOrder, duplicateFrom, prefillSource]);

  const technicianItems: SearchableSelectItem[] = useMemo(
    () =>
      technicians.map((t) => ({
        id: t.uid,
        label: `${t.name} - Tim IT`,
        searchText: `${t.name} ${t.email}`,
      })),
    [technicians]
  );

  const frequencyMonths = frequencyPreset === "custom" ? frequencyCustomMonths : frequencyPreset;

  // Mode "Semua Asset" harus benar-benar mengabaikan filter apa pun (termasuk
  // sisa filter yang pernah diisi saat mode "Asset Berdasarkan Filter") —
  // picker table diberi filter kosong secara paksa di bawah.
  const pickerFilters = assetSelectionMode === "all_assets" ? DEFAULT_ASSET_PICKER_FILTERS : filters;

  const effectiveSelectedIds = useMemo(() => {
    if (assetSelectionMode === "all_assets") {
      return new Set(filteredAssets.map((a) => a.id));
    }
    return manualSelectedIds;
  }, [assetSelectionMode, filteredAssets, manualSelectedIds]);

  if (!open) return null;

  // Rules edit per status (lihat spesifikasi "Rules edit"):
  // - created/accepted/scheduled_by_it: semua field boleh diedit.
  // - in_progress: hanya catatan, prioritas, dan asset tambahan.
  // - report_submitted: tidak boleh edit sama sekali (arahkan ke Minta Revisi).
  // - completed: boleh edit tapi wajib untuk "Periode Berikutnya".
  // - cancelled: tidak boleh edit sama sekali.
  const editStatus = editWorkOrder?.status;
  // report_submitted: laporan sudah dikirim, jadwal utama dikunci total —
  // satu-satunya status yang benar-benar memblokir edit. Status lain
  // (termasuk completed/cancelled) tetap bisa diedit, tombol Edit selalu
  // tampil di semua status.
  const editBlocked = isEditMode && editStatus === "report_submitted";
  const editRestrictedToNoteAndAssets = isEditMode && editStatus === "in_progress";
  // completed/cancelled: perubahan dianggap sebagai pembaruan jadwal
  // berikutnya/jadwal ulang, bukan mengubah histori yang sudah lewat —
  // dipaksa ke "Periode Berikutnya Saja".
  const editForcedNextPeriod = isEditMode && (editStatus === "completed" || editStatus === "cancelled");
  // Field jadwal utama (judul/frekuensi/tanggal/lokasi/teknisi) dikunci saat
  // status in_progress — hanya catatan, prioritas, dan daftar asset yang
  // boleh disentuh.
  const lockScheduleFields = editRestrictedToNoteAndAssets;
  const selectedTechnician = technicians.find((t) => t.uid === assignedToUid);
  const hasLegacySuperAdminAssignment =
    isEditMode &&
    !!editWorkOrder?.assignedToUid &&
    (editWorkOrder.assignedToRole === "super_admin" || !selectedTechnician);
  const needsNewItTeamAssignee = hasLegacySuperAdminAssignment && !selectedTechnician;

  const resetForm = () => {
    setTitle("");
    setFrequencyPreset(1);
    setFrequencyCustomMonths(1);
    setStartMonthIndex(now.getMonth());
    setStartYear(now.getFullYear());
    setScheduledDayOfMonth(now.getDate());
    setAddressSelection(EMPTY_LOCATION_SELECTION);
    setAssetSelectionMode("all_assets");
    setFilters(DEFAULT_ASSET_PICKER_FILTERS);
    setManualSelectedIds(new Set());
    setAssignedToUid("");
    setPriority("medium");
    setQhseNote("");
    setError("");
    setAddressFilterInfo("");
    setApplyTo("current");
    setChangeReason("");
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleUseAddressAsFilter = () => {
    const anyFieldFilled = !!(
      addressSelection.buildingId ||
      addressSelection.floorId ||
      addressSelection.roomId ||
      addressSelection.areaId
    );
    const anyMatched = assets.some((a) => {
      if (addressSelection.areaId) return a.areaId === addressSelection.areaId;
      if (addressSelection.roomId) return a.roomId === addressSelection.roomId;
      if (addressSelection.floorId) return a.floorId === addressSelection.floorId;
      if (addressSelection.buildingId) return a.buildingId === addressSelection.buildingId;
      return false;
    });

    setFilters({
      ...filters,
      buildingName: addressSelection.buildingName,
      floor: addressSelection.floorName,
      roomName: addressSelection.roomName,
      areaName: addressSelection.areaName,
    });
    setAssetSelectionMode("filtered_assets");
    setAddressFilterInfo(
      anyFieldFilled && !anyMatched ? "Alamat maintenance belum ditemukan di data asset." : ""
    );
  };

  const validate = (requireAssignment: boolean) => {
    if (!title.trim()) return "Judul maintenance wajib diisi.";
    if (frequencyPreset === "custom" && (frequencyCustomMonths < 1 || frequencyCustomMonths > 24))
      return "Frekuensi custom harus antara 1-24 bulan.";
    if (scheduledDayOfMonth < 1 || scheduledDayOfMonth > 31) return "Setiap Tanggal harus antara 1-31.";
    if (!addressSelection.buildingId) return "Gedung pada Alamat Maintenance wajib dipilih.";
    if (!addressSelection.floorId) return "Lantai pada Alamat Maintenance wajib dipilih.";
    if (!addressSelection.roomId) return "Ruangan pada Alamat Maintenance wajib dipilih.";
    if (effectiveSelectedIds.size === 0) return "Tidak ada asset yang cocok / terpilih.";
    if (requireAssignment && !assignedToUid) return "Ditugaskan ke wajib dipilih.";
    if (requireAssignment && !technicians.some((t) => t.uid === assignedToUid)) {
      return "Ditugaskan ke wajib memilih user aktif dengan role Tim IT.";
    }
    return "";
  };

  const handleSubmit = async (asDraft: boolean) => {
    const validationError = validate(!asDraft);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const technician = technicians.find((t) => t.uid === assignedToUid);
      const workOrderNumber = await generateWorkOrderNumber();
      const periodLabel = monthYearLabel(startMonthIndex, startYear);
      const nextDueAt = computeNextDueDate(startMonthIndex, startYear, scheduledDayOfMonth);
      const locationText = [
        addressSelection.buildingName,
        addressSelection.floorName,
        addressSelection.roomName,
        addressSelection.areaName,
      ]
        .filter(Boolean)
        .join(" / ");
      const selectedAssets = assets.filter((a) => effectiveSelectedIds.has(a.id));

      const woRef = await addDoc(collection(db, "asset_maintenance_work_orders"), {
        workOrderNumber,
        title: title.trim(),
        maintenanceType: "routine",
        taskCategory: "routine",
        maintenanceSource: "routine_schedule",
        frequencyMonths,
        frequencyLabel: frequencyMonthsLabel(frequencyMonths),
        startMonth: startMonthIndex + 1,
        startYear,
        periodLabel,
        scheduledDayOfMonth,
        nextDueAt,
        dueDateKey: nextDueAt,
        assetSelectionMode,
        filtersSnapshot:
          assetSelectionMode === "filtered_assets"
            ? {
                searchText: filters.search,
                assetBuildingName: filters.buildingName,
                assetFloor: filters.floor,
                assetRoomName: filters.roomName,
                assetAreaName: filters.areaName,
                categoryText: filters.category,
                statusText: filters.status,
                conditionText: filters.condition,
              }
            : {},
        buildingName: addressSelection.buildingName,
        floor: addressSelection.floorName,
        roomName: addressSelection.roomName,
        areaName: addressSelection.areaName,
        locationText,
        maintenanceBuildingId: addressSelection.buildingId || null,
        maintenanceBuildingName: addressSelection.buildingName,
        maintenanceFloorId: addressSelection.floorId || null,
        maintenanceFloorName: addressSelection.floorName,
        maintenanceRoomId: addressSelection.roomId || null,
        maintenanceRoomName: addressSelection.roomName,
        maintenanceAreaId: addressSelection.areaId || null,
        maintenanceAreaName: addressSelection.areaName,
        maintenanceLocationText: locationText,
        assetIds: Array.from(effectiveSelectedIds),
        assetSnapshots: selectedAssets.map((a) => ({
          assetId: a.id,
          assetName: a.assetName,
          assetCode: a.assetCode,
          assetCategory: a.categoryName,
          assetLocation:
            [a.buildingName, a.floor, a.roomName].filter(Boolean).join(" - ") || a.location || "",
          condition: a.condition,
          assetStatus: a.assetStatus,
        })),
        priority,
        status: asDraft ? "draft" : "created",
        qhseNote: qhseNote.trim(),
        requestedByUid: assetUser?.uid || "",
        requestedByName: assetUser?.name || "",
        requestedByRole: role,
        assignedToUid: asDraft ? "" : assignedToUid,
        assignedToName: asDraft ? "" : technician?.name || technician?.email || "",
        assignedToEmail: asDraft ? "" : technician?.email || "",
        assignedToRole: asDraft ? null : "it_team",
        // Alias uid/name/email yang sama — dipertahankan karena beberapa
        // tempat lain (filter Tim IT, backfill data lama) mengecek nama
        // field ini juga, bukan cuma assignedToUid.
        technicianUid: asDraft ? "" : assignedToUid,
        technicianName: asDraft ? "" : technician?.name || technician?.email || "",
        technicianEmail: asDraft ? "" : technician?.email || "",
        assignedTechnicianUid: asDraft ? "" : assignedToUid,
        assignedTechnicianName: asDraft ? "" : technician?.name || technician?.email || "",
        assignedTechnicianEmail: asDraft ? "" : technician?.email || "",
        assignedAt: asDraft ? null : serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const batch = writeBatch(db);
      selectedAssets.forEach((a) => {
        const itemRef = doc(collection(db, "asset_maintenance_work_orders", woRef.id, "items"));
        batch.set(itemRef, {
          workOrderId: woRef.id,
          assetId: a.id,
          assetName: a.assetName,
          assetCode: a.assetCode,
          assetCategory: a.categoryName,
          assetLocation:
            [a.buildingName, a.floor, a.roomName].filter(Boolean).join(" - ") || a.location || "",
          status: "pending",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();

      await writeWorkOrderLog({
        workOrderId: woRef.id,
        workOrderNumber,
        action: "create_work_order",
        newStatus: asDraft ? "draft" : "created",
        note: asDraft ? "Disimpan sebagai draft" : "Jadwal maintenance dibuat dan ditugaskan",
        performedByUid: assetUser?.uid || "",
        performedByName: assetUser?.name || "",
      });

      if (!asDraft) {
        await writeWorkOrderLog({
          workOrderId: woRef.id,
          workOrderNumber,
          action: "assign_work_order",
          newStatus: "created",
          note: `Ditugaskan ke ${technician?.name || ""}`,
          performedByUid: assetUser?.uid || "",
          performedByName: assetUser?.name || "",
        });
        await createAssetNotification({
          recipientUid: assignedToUid,
          recipientName: technician?.name || "",
          recipientRole: "it_team",
          title: "Tugas Maintenance Baru",
          message: `Anda ditugaskan maintenance ${selectedAssets.length} aset${locationText ? ` di ${locationText}` : ""}.`,
          type: "work_order_assigned",
          priority,
          linkUrl: `/maintenance?tab=routine&workOrderId=${woRef.id}`,
          relatedType: "work_order",
          relatedId: woRef.id,
          relatedNumber: workOrderNumber,
          createdByUid: assetUser?.uid,
          createdByName: assetUser?.name,
        });
      }

      resetForm();
      onCreated?.();
      onClose();
    } catch (err) {
      console.error("[Maintenance Schedule] gagal membuat jadwal", err);
      setError("Gagal membuat jadwal maintenance. Coba lagi.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitEdit = async () => {
    if (!editWorkOrder) return;
    if (editBlocked) {
      setError("Laporan sudah dikirim — jadwal tidak bisa diedit, gunakan Minta Revisi di detail work order.");
      return;
    }
    if (!lockScheduleFields) {
      const validationError = validate(true);
      if (validationError) {
        setError(validationError);
        return;
      }
    } else if (effectiveSelectedIds.size === 0) {
      setError("Tidak ada asset yang cocok / terpilih.");
      return;
    }
    if (!changeReason.trim()) {
      setError('Alasan perubahan wajib diisi, contoh: "Frekuensi dipercepat karena asset sering dipakai."');
      return;
    }

    setError("");
    setSubmitting(true);
    try {
      const technician = technicians.find((t) => t.uid === assignedToUid);
      const periodLabel = monthYearLabel(startMonthIndex, startYear);
      const nextDueAt = computeNextDueDate(startMonthIndex, startYear, scheduledDayOfMonth);
      const locationText = [
        addressSelection.buildingName,
        addressSelection.floorName,
        addressSelection.roomName,
        addressSelection.areaName,
      ]
        .filter(Boolean)
        .join(" / ");
      const selectedAssets = assets.filter((a) => effectiveSelectedIds.has(a.id));

      // Hanya field yang boleh diedit di status ini yang masuk payload —
      // field jadwal utama TIDAK disentuh sama sekali saat lockScheduleFields.
      const scheduleFields: Record<string, unknown> = lockScheduleFields
        ? {}
        : {
            title: title.trim(),
            frequencyMonths,
            frequencyLabel: frequencyMonthsLabel(frequencyMonths),
            startMonth: startMonthIndex + 1,
            startYear,
            periodLabel,
            scheduledDayOfMonth,
            nextDueAt,
            dueDateKey: nextDueAt,
            buildingName: addressSelection.buildingName,
            floor: addressSelection.floorName,
            roomName: addressSelection.roomName,
            areaName: addressSelection.areaName,
            locationText,
            maintenanceBuildingId: addressSelection.buildingId || null,
            maintenanceBuildingName: addressSelection.buildingName,
            maintenanceFloorId: addressSelection.floorId || null,
            maintenanceFloorName: addressSelection.floorName,
            maintenanceRoomId: addressSelection.roomId || null,
            maintenanceRoomName: addressSelection.roomName,
            maintenanceAreaId: addressSelection.areaId || null,
            maintenanceAreaName: addressSelection.areaName,
            maintenanceLocationText: locationText,
            assignedToUid,
            assignedToName: technician?.name || technician?.email || "",
            assignedToEmail: technician?.email || "",
            assignedToRole: assignedToUid ? "it_team" : null,
            technicianUid: assignedToUid,
            technicianName: technician?.name || technician?.email || "",
            technicianEmail: technician?.email || "",
            assignedTechnicianUid: assignedToUid,
            assignedTechnicianName: technician?.name || technician?.email || "",
            assignedTechnicianEmail: technician?.email || "",
          };

      const newFields: Record<string, unknown> = {
        ...scheduleFields,
        priority,
        qhseNote: qhseNote.trim(),
        assetSelectionMode,
        assetIds: Array.from(effectiveSelectedIds),
      };

      const oldAssignedToUid = editWorkOrder.assignedToUid || "";
      const oldFields: Record<string, unknown> = {
        title: editWorkOrder.title,
        frequencyMonths: editWorkOrder.frequencyMonths,
        startMonth: editWorkOrder.startMonth,
        startYear: editWorkOrder.startYear,
        scheduledDayOfMonth: editWorkOrder.scheduledDayOfMonth,
        dueDateKey: editWorkOrder.dueDateKey,
        maintenanceLocationText: editWorkOrder.maintenanceLocationText,
        assignedToUid: oldAssignedToUid,
        assignedToName: editWorkOrder.assignedToName,
        assignedToRole: editWorkOrder.assignedToRole,
        priority: editWorkOrder.priority,
        qhseNote: editWorkOrder.qhseNote,
        assetIds: editWorkOrder.assetIds,
      };

      const changedFields = Object.keys(newFields).filter(
        (key) => JSON.stringify(oldFields[key]) !== JSON.stringify(newFields[key])
      );
      const technicianChanged =
        !lockScheduleFields && assignedToUid && assignedToUid !== oldAssignedToUid;
      const scheduleChanged =
        !lockScheduleFields &&
        (editWorkOrder.frequencyMonths !== frequencyMonths ||
          editWorkOrder.scheduledDayOfMonth !== scheduledDayOfMonth ||
          editWorkOrder.startMonth !== startMonthIndex + 1 ||
          editWorkOrder.startYear !== startYear);
      const oldAssetIds = new Set(editWorkOrder.assetIds || []);
      const newAssetIds = effectiveSelectedIds;
      const addedAssets = selectedAssets.filter((a) => !oldAssetIds.has(a.id));
      const removedAssetIds = Array.from(oldAssetIds).filter((id) => !newAssetIds.has(id));
      const assetsChanged = addedAssets.length > 0 || removedAssetIds.length > 0;

      if (applyTo === "next") {
        // Jangan sentuh jadwal aktif sama sekali — simpan sebagai draft yang
        // baru dipakai setelah periode berjalan ini selesai/di-generate ulang.
        await updateDoc(doc(db, "asset_maintenance_work_orders", editWorkOrder.id), {
          nextConfig: newFields,
          lastEditedAt: serverTimestamp(),
          lastEditedByUid: assetUser?.uid || "",
          lastEditedByName: assetUser?.name || "",
          lastEditReason: changeReason.trim(),
          updatedByUid: assetUser?.uid || "",
          updatedByName: assetUser?.name || "",
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(doc(db, "asset_maintenance_work_orders", editWorkOrder.id), {
          ...scheduleFields,
          priority,
          qhseNote: qhseNote.trim(),
          assetSelectionMode,
          filtersSnapshot:
            assetSelectionMode === "filtered_assets"
              ? {
                  searchText: filters.search,
                  assetBuildingName: filters.buildingName,
                  assetFloor: filters.floor,
                  assetRoomName: filters.roomName,
                  assetAreaName: filters.areaName,
                  categoryText: filters.category,
                  statusText: filters.status,
                  conditionText: filters.condition,
                }
              : {},
          assetIds: Array.from(effectiveSelectedIds),
          assetSnapshots: selectedAssets.map((a) => ({
            assetId: a.id,
            assetName: a.assetName,
            assetCode: a.assetCode,
            assetCategory: a.categoryName,
            assetLocation:
              [a.buildingName, a.floor, a.roomName].filter(Boolean).join(" - ") || a.location || "",
            condition: a.condition,
            assetStatus: a.assetStatus,
          })),
          lastEditedAt: serverTimestamp(),
          lastEditedByUid: assetUser?.uid || "",
          lastEditedByName: assetUser?.name || "",
          lastEditReason: changeReason.trim(),
          updatedByUid: assetUser?.uid || "",
          updatedByName: assetUser?.name || "",
          updatedAt: serverTimestamp(),
        });

        // Asset ditambah -> buat item baru (pending). Asset dikurangi -> TIDAK
        // dihapus dari subcollection items (history tetap ada), cukup keluar
        // dari assetIds/assetSnapshots di atas.
        if (addedAssets.length > 0) {
          const batch = writeBatch(db);
          addedAssets.forEach((a) => {
            const itemRef = doc(
              collection(db, "asset_maintenance_work_orders", editWorkOrder.id, "items")
            );
            batch.set(itemRef, {
              workOrderId: editWorkOrder.id,
              assetId: a.id,
              assetName: a.assetName,
              assetCode: a.assetCode,
              assetCategory: a.categoryName,
              assetLocation:
                [a.buildingName, a.floor, a.roomName].filter(Boolean).join(" - ") || a.location || "",
              status: "pending",
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          });
          await batch.commit();
        }
      }

      await writeWorkOrderLog({
        workOrderId: editWorkOrder.id,
        workOrderNumber: editWorkOrder.workOrderNumber,
        action: "maintenance_schedule_updated",
        oldStatus: editWorkOrder.status,
        newStatus: editWorkOrder.status,
        note: `[${applyTo === "next" ? "Periode Berikutnya" : "Periode Saat Ini"}] ${changeReason.trim()}`,
        oldData: oldFields,
        newData: newFields,
        changedFields,
        performedByUid: assetUser?.uid || "",
        performedByName: assetUser?.name || "",
      });

      if (applyTo === "current") {
        // Ringkasan human-readable ("Label: lama → baru") dipakai di semua
        // pesan notifikasi di bawah supaya penerima langsung tahu APA yang
        // berubah, bukan cuma "jadwal diperbarui".
        const changes = buildChangeSummary(oldFields, newFields);
        const locationChanges = changes.filter((c) => c.startsWith("Lokasi:"));
        const noteChanges = changes.filter((c) => c.startsWith("Catatan QHSE:"));
        const onlyLocationChanged =
          !technicianChanged &&
          !scheduleChanged &&
          !assetsChanged &&
          locationChanges.length > 0 &&
          locationChanges.length === changes.length;
        const onlyNoteChanged =
          !technicianChanged &&
          !scheduleChanged &&
          !assetsChanged &&
          noteChanges.length > 0 &&
          noteChanges.length === changes.length;

        if (technicianChanged) {
          if (oldAssignedToUid) {
            await createAssetNotification({
              recipientUid: oldAssignedToUid,
              recipientName: editWorkOrder.assignedToName || "",
              recipientRole: getAssignedMaintenanceRole(editWorkOrder.assignedToRole),
              title: "Jadwal Maintenance Dipindahkan",
              message: `Anda tidak lagi ditugaskan untuk ${editWorkOrder.title} — dialihkan ke ${technician?.name || "teknisi lain"}.`,
              type: "work_order_assigned",
              priority,
              linkUrl: `/maintenance?tab=routine&workOrderId=${editWorkOrder.id}`,
              relatedType: "work_order",
              relatedId: editWorkOrder.id,
              relatedNumber: editWorkOrder.workOrderNumber,
              createdByUid: assetUser?.uid,
              createdByName: assetUser?.name,
            });
          }
          const technicianMessage = buildChangeMessage(
            `QHSE memperbarui jadwal "${editWorkOrder.title}".`,
            changes
          );
          await createAssetNotification({
            recipientUid: assignedToUid,
            recipientName: technician?.name || "",
            recipientRole: "it_team",
            title: "Jadwal Maintenance Diperbarui",
            message: technicianMessage,
            type: "work_order_assigned",
            priority,
            linkUrl: `/maintenance?tab=routine&workOrderId=${editWorkOrder.id}`,
            relatedType: "work_order",
            relatedId: editWorkOrder.id,
            relatedNumber: editWorkOrder.workOrderNumber,
            oldData: oldFields,
            newData: newFields,
            changeSummary: changes,
            createdByUid: assetUser?.uid,
            createdByName: assetUser?.name,
          });
          if (editWorkOrder.requestedByUid && editWorkOrder.requestedByUid !== assetUser?.uid) {
            await createAssetNotification({
              recipientUid: editWorkOrder.requestedByUid,
              recipientName: editWorkOrder.requestedByName,
              recipientRole: "asset_admin",
              title: "Teknisi Maintenance Diperbarui",
              message: `Teknisi maintenance ${editWorkOrder.title} diganti menjadi ${technician?.name || "-"}.`,
              type: "work_order_assigned",
              priority,
              linkUrl: `/maintenance?tab=routine&workOrderId=${editWorkOrder.id}`,
              relatedType: "work_order",
              relatedId: editWorkOrder.id,
              relatedNumber: editWorkOrder.workOrderNumber,
              createdByUid: assetUser?.uid,
              createdByName: assetUser?.name,
            });
          }
        } else if (scheduleChanged) {
          const recipients = [
            assignedToUid ? { uid: assignedToUid, name: technician?.name || "", role: "it_team" as const } : null,
            editWorkOrder.requestedByUid
              ? { uid: editWorkOrder.requestedByUid, name: editWorkOrder.requestedByName, role: "asset_admin" as const }
              : null,
          ].filter((r): r is { uid: string; name: string; role: "it_team" | "asset_admin" } => !!r);
          const scheduleMessage = buildChangeMessage(
            `QHSE memperbarui jadwal "${editWorkOrder.title}".`,
            changes
          );
          await Promise.all(
            recipients.map((r) =>
              createAssetNotification({
                recipientUid: r.uid,
                recipientName: r.name,
                recipientRole: r.role,
                title: "Jadwal Maintenance Diperbarui",
                message: scheduleMessage,
                type: "work_order_assigned",
                priority,
                linkUrl: `/maintenance?tab=routine&workOrderId=${editWorkOrder.id}`,
                relatedType: "work_order",
                relatedId: editWorkOrder.id,
                relatedNumber: editWorkOrder.workOrderNumber,
                oldData: oldFields,
                newData: newFields,
                changeSummary: changes,
                createdByUid: assetUser?.uid,
                createdByName: assetUser?.name,
              })
            )
          );
        } else if (onlyLocationChanged && assignedToUid) {
          await createAssetNotification({
            recipientUid: assignedToUid,
            recipientName: technician?.name || "",
            recipientRole: "it_team",
            title: "Lokasi Maintenance Diperbarui",
            message: buildChangeMessage(
              `Lokasi maintenance "${editWorkOrder.title}" diubah.`,
              locationChanges
            ),
            type: "work_order_assigned",
            priority,
            linkUrl: `/maintenance?tab=routine&workOrderId=${editWorkOrder.id}`,
            relatedType: "work_order",
            relatedId: editWorkOrder.id,
            relatedNumber: editWorkOrder.workOrderNumber,
            oldData: oldFields,
            newData: newFields,
            changeSummary: locationChanges,
            createdByUid: assetUser?.uid,
            createdByName: assetUser?.name,
          });
        } else if (onlyNoteChanged && assignedToUid) {
          await createAssetNotification({
            recipientUid: assignedToUid,
            recipientName: technician?.name || "",
            recipientRole: "it_team",
            title: "Catatan Maintenance Diperbarui",
            message: buildChangeMessage(
              `QHSE memperbarui catatan pada maintenance "${editWorkOrder.title}".`,
              noteChanges
            ),
            type: "work_order_assigned",
            priority,
            linkUrl: `/maintenance?tab=routine&workOrderId=${editWorkOrder.id}`,
            relatedType: "work_order",
            relatedId: editWorkOrder.id,
            relatedNumber: editWorkOrder.workOrderNumber,
            oldData: oldFields,
            newData: newFields,
            changeSummary: noteChanges,
            createdByUid: assetUser?.uid,
            createdByName: assetUser?.name,
          });
        }

        if (assetsChanged && assignedToUid) {
          await createAssetNotification({
            recipientUid: assignedToUid,
            recipientName: technician?.name || "",
            recipientRole: "it_team",
            title: "Daftar Asset Maintenance Diperbarui",
            message: `Daftar asset maintenance ${editWorkOrder.title} diperbarui (${addedAssets.length} ditambah, ${removedAssetIds.length} dikurangi).`,
            type: "work_order_assigned",
            priority,
            linkUrl: `/maintenance?tab=routine&workOrderId=${editWorkOrder.id}`,
            relatedType: "work_order",
            relatedId: editWorkOrder.id,
            relatedNumber: editWorkOrder.workOrderNumber,
            createdByUid: assetUser?.uid,
            createdByName: assetUser?.name,
          });
        }

        // Perubahan lain (prioritas, dst) yang tidak masuk kategori spesifik
        // di atas — tetap kabari Tim IT supaya "QHSE edit jadwal" selalu
        // menghasilkan notifikasi yang menjelaskan APA yang berubah.
        if (
          !technicianChanged &&
          !scheduleChanged &&
          !assetsChanged &&
          !onlyLocationChanged &&
          !onlyNoteChanged &&
          assignedToUid &&
          changes.length > 0
        ) {
          await createAssetNotification({
            recipientUid: assignedToUid,
            recipientName: technician?.name || "",
            recipientRole: "it_team",
            title: "Jadwal Maintenance Diperbarui",
            message: buildChangeMessage(
              `QHSE memperbarui jadwal "${editWorkOrder.title}".`,
              changes
            ),
            type: "work_order_assigned",
            priority,
            linkUrl: `/maintenance?tab=routine&workOrderId=${editWorkOrder.id}`,
            relatedType: "work_order",
            relatedId: editWorkOrder.id,
            relatedNumber: editWorkOrder.workOrderNumber,
            oldData: oldFields,
            newData: newFields,
            changeSummary: changes,
            createdByUid: assetUser?.uid,
            createdByName: assetUser?.name,
          });
        }
      }

      resetForm();
      onCreated?.();
      onClose();
    } catch (err) {
      console.error("[Maintenance Schedule] gagal mengedit jadwal", err);
      setError("Gagal menyimpan perubahan jadwal. Coba lagi.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />
      <div className="relative bg-white rounded-none sm:rounded-2xl shadow-lg border-0 sm:border border-slate-200 w-screen h-screen sm:h-[90vh] sm:w-[95vw] sm:max-w-[1400px] sm:max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header sticky */}
        <div className="shrink-0 border-b border-slate-200 px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold text-slate-900">
              {isEditMode
                ? `Edit Jadwal Maintenance — ${editWorkOrder?.workOrderNumber}`
                : duplicateFrom
                ? `Duplikat / Jadwalkan Ulang — dari ${duplicateFrom.workOrderNumber}`
                : "Buat Jadwal Maintenance Rutin"}
            </h2>
            <button
              type="button"
              onClick={handleClose}
              className="text-slate-400 hover:text-slate-700 cursor-pointer rounded-lg p-1 hover:bg-slate-100"
            >
              <X size={18} />
            </button>
          </div>
          {isEditMode ? (
            editBlocked ? (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                Laporan sudah dikirim — jadwal ini tidak bisa diedit lagi. Gunakan tombol Minta Revisi
                di detail work order kalau laporan belum sesuai.
              </p>
            ) : editForcedNextPeriod ? (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                Jadwal ini sudah {editStatus === "cancelled" ? "dibatalkan" : "selesai"}. Perubahan akan
                dianggap sebagai pembaruan jadwal berikutnya atau jadwal ulang.
              </p>
            ) : (
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                {lockScheduleFields
                  ? "Status sedang Sedang Dikerjakan — hanya Catatan QHSE, Prioritas, dan daftar Asset yang bisa diubah."
                  : "Ubah field yang perlu, lalu isi alasan perubahan sebelum menyimpan."}
              </p>
            )
          ) : (
            <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
              Jadwal ini dibuat oleh QHSE/Asset Admin untuk menentukan asset mana yang perlu dicek
              secara rutin. Tim IT akan menerima tugas ini lalu mengeksekusinya melalui
              tombol Terima Tugas, Kerjakan, dan Kirim Laporan.
            </p>
          )}
        </div>

        {/* Body scroll sendiri */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Kolom kiri 40% */}
            <div className="lg:col-span-2 space-y-5">
              <section
                className={`rounded-2xl border border-slate-200 p-4 space-y-4 ${
                  lockScheduleFields || editBlocked ? "opacity-50 pointer-events-none" : ""
                }`}
              >
                <h3 className="text-sm font-semibold text-slate-800">Informasi Jadwal</h3>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">
                    Judul Maintenance <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="mis. Maintenance PC Finance"
                    className="input"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">
                    Frekuensi Maintenance <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {FREQUENCY_PRESETS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setFrequencyPreset(n)}
                        className={`rounded-xl border px-2 py-2 text-xs font-medium cursor-pointer transition-colors ${
                          frequencyPreset === n
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        Setiap {n} Bulan
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setFrequencyPreset("custom")}
                      className={`rounded-xl border px-2 py-2 text-xs font-medium cursor-pointer transition-colors ${
                        frequencyPreset === "custom"
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      Custom
                    </button>
                  </div>
                  {frequencyPreset === "custom" && (
                    <input
                      type="number"
                      min={1}
                      max={24}
                      value={frequencyCustomMonths}
                      onChange={(e) => setFrequencyCustomMonths(Number(e.target.value))}
                      placeholder="Jumlah bulan (1-24)"
                      className="input cursor-text w-48 mt-2"
                    />
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">
                      Mulai Bulan <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={startMonthIndex}
                      onChange={(e) => setStartMonthIndex(Number(e.target.value))}
                      className="input cursor-pointer"
                    >
                      {MONTH_NAMES.map((m, i) => (
                        <option key={m} value={i}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">
                      Tahun <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      value={startYear}
                      onChange={(e) => setStartYear(Number(e.target.value))}
                      className="input cursor-text"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">
                      Setiap Tanggal <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={scheduledDayOfMonth}
                      onChange={(e) => setScheduledDayOfMonth(Number(e.target.value))}
                      className="input cursor-text"
                    />
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  Jatuh tempo pertama:{" "}
                  <span className="font-medium text-slate-700">
                    {formatDate(computeNextDueDate(startMonthIndex, startYear, scheduledDayOfMonth))}
                  </span>
                  . Jika tanggal tidak ada di bulan tersebut, otomatis dipakai tanggal terakhir bulan
                  itu.
                </p>
              </section>

              <section
                className={`rounded-2xl border border-slate-200 p-4 space-y-3 ${
                  lockScheduleFields || editBlocked ? "opacity-50 pointer-events-none" : ""
                }`}
              >
                <h3 className="text-sm font-semibold text-slate-800">
                  Alamat Maintenance <span className="text-red-500">*</span>
                </h3>
                {locations.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-center">
                    <p className="text-xs text-slate-500 mb-2">Belum ada data Master Lokasi.</p>
                    <Link
                      href="/locations"
                      className="inline-block rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      + Tambah Lokasi Baru
                    </Link>
                  </div>
                ) : (
                  <LocationCascadeFields
                    locations={locations}
                    value={addressSelection}
                    onChange={setAddressSelection}
                    columns={2}
                  />
                )}
                {addressSelection.buildingId && (
                  <p className="text-xs text-slate-500">
                    Lokasi tugas:{" "}
                    <span className="font-medium text-slate-700">
                      {[
                        addressSelection.buildingName,
                        addressSelection.floorName,
                        addressSelection.roomName,
                        addressSelection.areaName,
                      ]
                        .filter(Boolean)
                        .join(" / ")}
                    </span>
                  </p>
                )}
                <p className="text-xs text-slate-400">
                  Alamat ini menentukan lokasi tugas maintenance — tidak otomatis memfilter asset di
                  sebelah kanan.
                </p>
                <button
                  type="button"
                  onClick={handleUseAddressAsFilter}
                  disabled={!addressSelection.buildingId}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 cursor-pointer hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Gunakan alamat ini untuk filter asset
                </button>
                {addressFilterInfo && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                    {addressFilterInfo}
                  </p>
                )}
              </section>

              <section className="rounded-2xl border border-slate-200 p-4 space-y-4">
                <h3 className="text-sm font-semibold text-slate-800">Penugasan</h3>
                <div
                  className={
                    lockScheduleFields || editBlocked ? "opacity-50 pointer-events-none" : undefined
                  }
                >
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">
                    Ditugaskan ke <span className="text-red-500">*</span>
                  </label>
                  <SearchableSelect
                    items={technicianItems}
                    value={assignedToUid}
                    onChange={setAssignedToUid}
                    placeholder="Pilih Tim IT"
                    searchPlaceholder="Cari Tim IT..."
                    emptyText="Belum ada Tim IT. Tambahkan Tim IT dari menu User Access."
                  />
                  {technicians.length === 0 && (
                    <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                      <p className="text-xs text-amber-700">
                        Belum ada Tim IT. Tambahkan Tim IT dari menu User Access.
                      </p>
                      <Link
                        href="/access"
                        className="mt-2 inline-flex items-center rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                      >
                        + Kelola User Access
                      </Link>
                    </div>
                  )}
                  {needsNewItTeamAssignee && (
                    <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      Jadwal lama ini masih ditugaskan ke Super Admin. Pilih Tim IT baru untuk melanjutkan.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">
                    Prioritas <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-4 gap-1">
                    {PRIORITIES.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPriority(p)}
                        className={`rounded-lg border px-1.5 py-2 text-[11px] font-medium cursor-pointer transition-colors ${
                          priority === p
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {WORK_ORDER_PRIORITY_LABEL[p]}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">
                    Catatan QHSE untuk Teknisi
                  </label>
                  <textarea
                    value={qhseNote}
                    onChange={(e) => setQhseNote(e.target.value)}
                    rows={2}
                    placeholder="Contoh: Fokus cek PC yang mulai lambat, pastikan QR masih terbaca, dan cek kelengkapan aksesoris."
                    className="input"
                  />
                </div>
              </section>

              {isEditMode && !editBlocked && (
                <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4 space-y-4">
                  <h3 className="text-sm font-semibold text-slate-800">Simpan Perubahan</h3>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">
                      Perubahan berlaku untuk:
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => !editForcedNextPeriod && setApplyTo("current")}
                        disabled={editForcedNextPeriod}
                        className={`rounded-xl border px-3 py-2 text-xs font-medium cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          applyTo === "current"
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        Periode Saat Ini
                      </button>
                      <button
                        type="button"
                        onClick={() => setApplyTo("next")}
                        className={`rounded-xl border px-3 py-2 text-xs font-medium cursor-pointer transition-colors ${
                          applyTo === "next"
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        Periode Berikutnya Saja
                      </button>
                    </div>
                    {editForcedNextPeriod && (
                      <p className="text-xs text-slate-500 mt-1.5">
                        Jadwal ini sudah {editStatus === "cancelled" ? "dibatalkan" : "selesai"} —
                        perubahan hanya bisa berlaku untuk periode berikutnya / jadwal ulang.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">
                      Alasan Perubahan <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={changeReason}
                      onChange={(e) => setChangeReason(e.target.value)}
                      rows={2}
                      placeholder='Contoh: "Frekuensi dipercepat karena asset sering dipakai."'
                      className="input"
                    />
                  </div>
                </section>
              )}
            </div>

            {/* Kolom kanan 60%: asset yang dicek */}
            <div className="lg:col-span-3 space-y-3">
              <section
                className={`rounded-2xl border border-slate-200 p-4 space-y-3 ${
                  editBlocked ? "opacity-50 pointer-events-none" : ""
                }`}
              >
                <h3 className="text-sm font-semibold text-slate-800">
                  Asset yang Dicek <span className="text-red-500">*</span>
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {SELECTION_MODES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setAssetSelectionMode(m)}
                      className={`rounded-xl border px-3 py-2 text-xs font-medium cursor-pointer transition-colors ${
                        assetSelectionMode === m
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {ASSET_SELECTION_MODE_LABEL[m]}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-500">
                  {assetSelectionMode === "all_assets"
                    ? "Semua asset aktif yang tampil akan masuk jadwal maintenance."
                    : "Gunakan filter untuk menentukan asset, lalu klik Pilih semua hasil filter atau centang manual."}
                </p>

                <AssetPickerTable
                  assets={assets}
                  categories={categories}
                  selectedIds={effectiveSelectedIds}
                  onChangeSelected={setManualSelectedIds}
                  filters={pickerFilters}
                  onFiltersChange={setFilters}
                  onFilteredAssetsChange={setFilteredAssets}
                  readOnly={assetSelectionMode === "all_assets"}
                  hideFilters={assetSelectionMode === "all_assets"}
                />

                {effectiveSelectedIds.size > 30 && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                    Anda akan menjadwalkan maintenance untuk {effectiveSelectedIds.size} asset.
                  </p>
                )}
              </section>
            </div>
          </div>
        </div>

        {/* Footer sticky */}
        <div className="shrink-0 border-t border-slate-200 px-4 sm:px-6 py-3 sm:py-4">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            {isEditMode ? (
              <>
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={submitting}
                  className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium cursor-pointer hover:bg-slate-50 disabled:opacity-60"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleSubmitEdit}
                  disabled={submitting || editBlocked}
                  className="flex-1 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2.5 text-sm font-medium cursor-pointer hover:brightness-105 shadow-md shadow-blue-900/20 disabled:opacity-60"
                >
                  {submitting ? "Menyimpan..." : "Simpan Perubahan"}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => handleSubmit(true)}
                  disabled={submitting}
                  className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium cursor-pointer hover:bg-slate-50 disabled:opacity-60"
                >
                  Simpan Draft
                </button>
                <button
                  type="button"
                  onClick={() => handleSubmit(false)}
                  disabled={submitting}
                  className="flex-1 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2.5 text-sm font-medium cursor-pointer hover:brightness-105 shadow-md shadow-blue-900/20 disabled:opacity-60"
                >
                  {submitting ? "Menyimpan..." : "Jadwalkan Maintenance"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
