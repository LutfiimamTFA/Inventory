"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, WheelEvent } from "react";
import {
  closestCorners,
  DndContext,
  DragEndEvent,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import clsx from "clsx";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Inbox,
  MapPin,
  Search,
  ShieldCheck,
  User,
  Wrench,
} from "lucide-react";
import {
  BOARD_FILTERS,
  BoardColumnKey,
  BoardFilterKey,
  BoardItem,
  canDragRoutineCard,
  COLUMN_OWNER_BADGE_COLOR,
  COLUMN_OWNER_GROUP_BAND_COLOR,
  ColumnOwner,
  getColumnAccentBarClass,
  getColumnBadgeColor,
  getColumnForItem,
  getIssueTypeLabel,
  getPrioritySeverity,
  getRoutineNextActor,
  getWorkflowColumnsByFilter,
  getWorkflowStatusLabel,
  isRoutineColumnLockedForRole,
  RoutineColumnKey,
  TASK_CATEGORY_COLOR,
  TASK_CATEGORY_LABEL,
} from "@/lib/maintenanceBoard";
import Badge from "@/components/Badge";
import { isAssignmentIncomplete } from "@/lib/issueTicketActions";
import type { AppRole, AssetIssueTicket, MaintenanceWorkOrder } from "@/lib/types";

const COLUMN_WIDTH = 340;
const COLUMN_GAP = 16;

const EMPTY_STATE_TEXT: Record<BoardFilterKey, string> = {
  issue_ticket: "Belum ada keluhan masuk.",
  routine: "Belum ada maintenance rutin.",
};

export default function MaintenanceKanbanBoard({
  items,
  activeFilter,
  onFilterChange,
  onOpenDetail,
  onMoveItem,
  currentRole,
  currentUserUid,
}: {
  items: BoardItem[];
  activeFilter: BoardFilterKey;
  onFilterChange: (filter: BoardFilterKey) => void;
  onOpenDetail: (item: BoardItem) => void;
  onMoveItem?: (item: BoardItem, toColumn: BoardColumnKey) => void | Promise<void>;
  currentRole?: AppRole | null;
  currentUserUid?: string | null;
}) {
  const kanbanScrollRef = useRef<HTMLDivElement | null>(null);
  const [search, setSearch] = useState("");
  // Section F perbaikan alur — Workflow Board default fokus ke pekerjaan
  // AKTIF saja untuk Keluhan Masuk; kolom Selesai/Tidak Dilanjutkan hanya
  // muncul kalau toggle ini diaktifkan.
  const [showFinal, setShowFinal] = useState(false);
  const [activeDragItem, setActiveDragItem] = useState<BoardItem | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const allColumns = useMemo(() => getWorkflowColumnsByFilter(activeFilter), [activeFilter]);
  const columns = useMemo(() => {
    if (activeFilter !== "issue_ticket" || showFinal) return allColumns;
    return allColumns.filter((c) => c.key !== "completed" && c.key !== "not_continued");
  }, [allColumns, activeFilter, showFinal]);

  // Section B — kelompokkan kolom rutin yang berurutan berdasarkan owner
  // (QHSE/Admin vs Tim IT) supaya band header di atas Kanban bisa
  // menunjukkan siapa penanggung jawab sekelompok tahap sekaligus, ikut
  // scroll horizontal bareng kolomnya (band ini dirender di container
  // scroll yang sama, bukan posisi terpisah).
  const ownerGroups = useMemo(() => {
    if (activeFilter !== "routine") return [];
    const groups: { owner: ColumnOwner; ownerLabel: string; count: number }[] = [];
    columns.forEach((c) => {
      const owner = (c as { owner?: ColumnOwner }).owner;
      const ownerLabel = (c as { ownerLabel?: string }).ownerLabel;
      if (!owner || !ownerLabel) return;
      const last = groups[groups.length - 1];
      if (last && last.owner === owner) {
        last.count += 1;
      } else {
        groups.push({ owner, ownerLabel, count: 1 });
      }
    });
    return groups;
  }, [activeFilter, columns]);

  const filterCounts = useMemo(() => {
    return {
      issue_ticket: items.filter((i) => i.sourceType === "ticket").length,
      routine: items.filter((i) => i.sourceType === "work_order").length,
    };
  }, [items]);

  const baseItems = useMemo(
    () => items.filter((item) => (activeFilter === "routine" ? item.sourceType === "work_order" : item.sourceType === "ticket")),
    [items, activeFilter]
  );

  const filteredItems = useMemo(() => {
    if (!search) return baseItems;
    const q = search.toLowerCase();
    return baseItems.filter((item) => {
      const haystack = `${item.number} ${item.title} ${item.locationText} ${item.assignedToName || ""} ${item.reportedByName || ""} ${item.reportTypeLabel || ""} ${getWorkflowStatusLabel(item)}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [baseItems, search]);

  const itemsByColumn = useMemo(() => {
    const map = new Map<BoardColumnKey, BoardItem[]>();
    columns.forEach((c) => map.set(c.key, []));
    filteredItems.forEach((item) => {
      const column = getColumnForItem(item);
      map.get(column)?.push(item);
    });
    return map;
  }, [filteredItems, columns]);

  function scrollKanban(direction: "left" | "right") {
    kanbanScrollRef.current?.scrollBy({
      left: direction === "right" ? 360 : -360,
      behavior: "smooth",
    });
  }

  function handleKanbanWheel(event: WheelEvent<HTMLDivElement>) {
    const el = kanbanScrollRef.current;
    if (!el) return;

    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      event.preventDefault();
      el.scrollLeft += event.deltaY;
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || !onMoveItem) return;

    const item = active.data.current as BoardItem | undefined;
    const toColumn = String(over.id) as BoardColumnKey;
    if (!item || !columns.some((column) => column.key === toColumn)) return;
    const fromColumn = getColumnForItem(item);
    if (fromColumn === toColumn) return;

    void onMoveItem(item, toColumn);
  };

  useEffect(() => {
    const el = kanbanScrollRef.current;
    if (!el) return;

    console.log("[Workflow Board Layout Debug]", {
      viewportWidth: window.innerWidth,
      scrollClientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      canScroll: el.scrollWidth > el.clientWidth,
      scrollParentClass: el.className,
    });
  }, [items.length, filteredItems.length]);

  return (
    <div className="workflow-board-kanban w-full max-w-full min-w-0 overflow-hidden">
      <BoardToolbar
        activeFilter={activeFilter}
        onFilterChange={onFilterChange}
        counts={filterCounts}
        search={search}
        onSearchChange={setSearch}
      />

      <div className="relative mt-4 w-full max-w-full min-w-0 overflow-hidden">
        <div className="mb-3 flex w-full max-w-full min-w-0 flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 text-xs text-slate-500">
            Geser kanan/kiri untuk melihat tahap lainnya. Drag card lewat ikon pegangan.
          </p>

          {activeFilter === "issue_ticket" && (
            <label className="flex shrink-0 items-center gap-2 text-xs font-medium text-slate-600">
              <input
                type="checkbox"
                checked={showFinal}
                onChange={(e) => setShowFinal(e.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer"
              />
              Tampilkan Selesai &amp; Tidak Dilanjutkan
            </label>
          )}

          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => scrollKanban("left")}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              title="Geser ke kiri"
            >
              <ChevronLeft size={16} />
            </button>

            <button
              type="button"
              onClick={() => scrollKanban("right")}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              title="Geser ke kanan"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {filteredItems.length === 0 ? (
          <div className="flex min-h-[200px] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/70 p-6 text-center">
            <p className="text-sm font-semibold text-slate-500">{EMPTY_STATE_TEXT[activeFilter]}</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={(event) => {
              setActiveDragItem((event.active.data.current as BoardItem | undefined) || null);
            }}
            onDragEnd={(event) => {
              setActiveDragItem(null);
              handleDragEnd(event);
            }}
            onDragCancel={() => setActiveDragItem(null)}
            autoScroll={true}
          >
            <div
              ref={kanbanScrollRef}
              onWheel={handleKanbanWheel}
              className="kanban-scroll w-full max-w-full min-w-0 overflow-x-auto overflow-y-hidden pb-6"
            >
              {ownerGroups.length > 0 && (
                <div className="sticky top-0 z-10 mb-3 flex w-max min-w-max gap-4 pr-6">
                  {ownerGroups.map((group, index) => (
                    <div
                      key={`${group.owner}-${index}`}
                      style={{ width: group.count * COLUMN_WIDTH + (group.count - 1) * COLUMN_GAP }}
                      className={clsx(
                        "flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold shadow-sm",
                        COLUMN_OWNER_GROUP_BAND_COLOR[group.owner]
                      )}
                    >
                      {group.owner === "qhse" ? <ShieldCheck size={14} /> : <Wrench size={14} />}
                      {group.ownerLabel}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex w-max min-w-max gap-4 pr-6">
                {columns.map((column) => (
                  <KanbanColumn
                    key={column.key}
                    column={column}
                    items={itemsByColumn.get(column.key) || []}
                    onOpenDetail={onOpenDetail}
                    currentRole={currentRole}
                    currentUserUid={currentUserUid}
                  />
                ))}
              </div>
            </div>
            <DragOverlay>
              {activeDragItem ? (
                <KanbanCard item={activeDragItem} isOverlay currentRole={currentRole} currentUserUid={currentUserUid} />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </div>
  );
}

function BoardToolbar({
  activeFilter,
  onFilterChange,
  counts,
  search,
  onSearchChange,
}: {
  activeFilter: BoardFilterKey;
  onFilterChange: (filter: BoardFilterKey) => void;
  counts: Record<BoardFilterKey, number>;
  search: string;
  onSearchChange: (v: string) => void;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1">
        {BOARD_FILTERS.map((f) => {
          const active = activeFilter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => onFilterChange(f.key)}
              className={clsx(
                "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors",
                active ? "bg-slate-900 text-white shadow-sm" : "border border-transparent bg-white text-slate-700 hover:bg-slate-100"
              )}
            >
              {f.label}
              <span
                className={clsx(
                  "rounded-full px-1.5 py-0.5 text-xs font-bold",
                  active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"
                )}
              >
                {counts[f.key]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="relative w-full">
        <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Cari nomor, judul, lokasi, penanggung jawab..."
          className="block w-full min-w-0 rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
      </div>
    </div>
  );
}

function KanbanColumn({
  column,
  items,
  onOpenDetail,
  currentRole,
  currentUserUid,
}: {
  column: {
    key: BoardColumnKey;
    label: string;
    description: string;
    dotClass: string;
    headerClass: string;
    columnBg?: string;
    borderClass?: string;
    textClass?: string;
    owner?: ColumnOwner;
    ownerLabel?: string;
  };
  items: BoardItem[];
  onOpenDetail: (item: BoardItem) => void;
  currentRole?: AppRole | null;
  currentUserUid?: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.key,
    data: { column },
  });

  // Section H — kolom yang bukan kewenangan role yang sedang login tetap
  // tampil (untuk monitoring) tapi dikunci: badge kepemilikan, tidak
  // menyala saat drag-over, dan cursor not-allowed.
  const locked = isRoutineColumnLockedForRole(column.key as RoutineColumnKey, currentRole);

  return (
    <div
      ref={setNodeRef}
      className={clsx(
        "flex min-w-[280px] max-w-[340px] shrink-0 flex-col rounded-2xl border shadow-sm sm:min-w-[320px]",
        "min-h-[520px] max-h-[calc(100vh-320px)] xl:max-h-[620px]",
        column.borderClass || "border-slate-200",
        column.columnBg || "bg-slate-50",
        isOver && !locked && "ring-2 ring-blue-400 ring-offset-2",
        locked && "cursor-not-allowed opacity-80"
      )}
      title={locked ? "Tahap ini bukan kewenangan role Anda." : undefined}
    >
      <div className={clsx("sticky top-0 z-[1] rounded-t-2xl border-b p-3", column.headerClass, column.borderClass || "border-slate-200")}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className={clsx("h-2.5 w-2.5 shrink-0 rounded-full", column.dotClass)} />
            <h3 className={clsx("truncate text-sm font-bold", column.textClass || "text-slate-800")}>{column.label}</h3>
          </div>

          <span className="shrink-0 rounded-full bg-white px-2 py-1 text-xs font-bold text-slate-600 shadow-sm">
            {items.length}
          </span>
        </div>

        {/* Section C/D — badge owner per kolom, supaya jelas ini tahap QHSE
            atau tahap Tim IT tanpa harus baca deskripsi. */}
        {column.owner && column.ownerLabel && (
          <span className={clsx("mt-1.5 inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold", COLUMN_OWNER_BADGE_COLOR[column.owner])}>
            {column.ownerLabel}
            {locked ? " only" : ""}
          </span>
        )}

        <p className="mt-1 text-xs text-slate-500">{column.description}</p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {items.length === 0 ? (
          <EmptyColumn owner={column.owner} />
        ) : (
          items.map((item) => (
            <KanbanCard
              key={`${item.sourceCollection}-${item.id}`}
              item={item}
              onOpenDetail={onOpenDetail}
              currentRole={currentRole}
              currentUserUid={currentUserUid}
            />
          ))
        )}
      </div>
    </div>
  );
}

function EmptyColumn({ owner }: { owner?: ColumnOwner }) {
  const Icon = owner === "it" ? Wrench : owner === "qhse" ? ShieldCheck : Inbox;
  const title = owner === "it" ? "Belum ada tugas Tim IT" : owner === "qhse" ? "Belum ada tugas QHSE" : "Belum ada tugas";
  const subtitle =
    owner === "it"
      ? "Jika ada tugas di tahap ini, card akan muncul di sini."
      : owner === "qhse"
      ? "Card yang perlu review atau keputusan QHSE akan muncul di sini."
      : "Geser card ke sini jika status berubah.";

  return (
    <div className="flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white/70 p-4 text-center">
      <div
        className={clsx(
          "flex h-9 w-9 items-center justify-center rounded-full",
          owner === "it" ? "bg-violet-100 text-violet-500" : owner === "qhse" ? "bg-blue-100 text-blue-500" : "bg-slate-100 text-slate-400"
        )}
      >
        <Icon size={16} />
      </div>
      <p className="text-sm font-semibold text-slate-500">{title}</p>
      <p className="text-xs text-slate-400">{subtitle}</p>
    </div>
  );
}

function KanbanCard({
  item,
  onOpenDetail,
  isOverlay = false,
  currentRole,
  currentUserUid,
}: {
  item: BoardItem;
  onOpenDetail?: (item: BoardItem) => void;
  isOverlay?: boolean;
  currentRole?: AppRole | null;
  currentUserUid?: string | null;
}) {
  const isRoutine = item.sourceType === "work_order";
  // Section I — drag handle hanya aktif kalau user punya minimal satu
  // transisi valid dari status kartu saat ini (diturunkan dari tabel
  // transisi yang sama dengan canMoveMaintenanceCard, lihat maintenanceBoard.ts).
  const canDrag =
    isRoutine &&
    canDragRoutineCard({
      item,
      role: currentRole,
      currentUserUid,
    });
  // Laporan Kendala Staff tidak lagi bisa di-drag — statusnya wajib lewat
  // tombol aksi di IssueTicketDetailModal (lihat lib/issueTicketActions.ts).
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `${item.sourceCollection}-${item.id}`,
    data: item,
    disabled: isOverlay || !canDrag,
  });
  const severity = getPrioritySeverity(item.priority);
  const column = getColumnForItem(item);
  // Section F — accent bar kiri card mengikuti warna kolom/status card saat
  // ini (bukan severity lagi), supaya sekilas lihat langsung tahu tahapnya.
  // Kartu terlambat tetap ditandai merah karena itu sinyal paling kritis.
  const accentBarClass = item.overdue ? "bg-red-500" : getColumnAccentBarClass(column);
  const style: CSSProperties | undefined = !isOverlay && transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;
  const statusLabel = getWorkflowStatusLabel(item);
  const categoryBadgeLabel = isRoutine
    ? TASK_CATEGORY_LABEL.routine
    : getIssueTypeLabel(item.reportType) || TASK_CATEGORY_LABEL.staff_issue;
  const categoryBadgeColor = isRoutine ? TASK_CATEGORY_COLOR.routine : TASK_CATEGORY_COLOR.staff_issue;

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={() => {
        if (!isOverlay) onOpenDetail?.(item);
      }}
      className={clsx(
        "relative rounded-2xl border bg-white p-3.5 text-left shadow-sm transition-all hover:-translate-y-[1px] hover:shadow-md",
        item.overdue ? "border-red-200 bg-red-50/40" : severity === "critical" ? "border-red-200" : severity === "high" ? "border-orange-200" : "border-slate-200",
        isDragging && !isOverlay && "opacity-30",
        isOverlay && "w-[320px] cursor-grabbing shadow-2xl ring-2 ring-blue-300"
      )}
    >
      <span className={clsx("absolute left-0 top-0 h-full w-1.5 rounded-l-2xl", accentBarClass)} />

      <div className="flex items-start justify-between gap-2 pl-1.5">
        <div className="min-w-0">
          <p className="truncate font-mono text-xs font-medium text-slate-400">{item.number}</p>
          <h4 className="break-words text-sm font-bold text-slate-900">{item.title}</h4>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {item.overdue && (
            <span className="text-red-500" title="Terlambat">
              <AlertTriangle size={15} />
            </span>
          )}
          {isRoutine && canDrag && (
            <button
              type="button"
              {...(isOverlay ? {} : attributes)}
              {...(isOverlay || !listeners ? {} : listeners)}
              onClick={(event) => event.stopPropagation()}
              disabled={isOverlay}
              className="shrink-0 cursor-grab rounded-lg p-1 text-slate-400 hover:bg-slate-100 active:cursor-grabbing"
              title="Geser status"
              aria-label="Geser status"
            >
              <GripVertical size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 pl-1.5">
        <Badge label={categoryBadgeLabel} colorClass={categoryBadgeColor} />
        {!isRoutine && (item.raw as AssetIssueTicket).externalHandling && (
          <Badge label="Teknisi Eksternal" colorClass="bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200" />
        )}
        <Badge label={statusLabel} colorClass={getColumnBadgeColor(column)} />
        {!isRoutine && item.severityLabel && (
          <Badge label={item.severityLabel === "critical" ? "Kritis" : item.severityLabel === "high" ? "Tinggi" : item.severityLabel === "medium" ? "Sedang" : "Rendah"} colorClass="bg-slate-100 text-slate-600 border-slate-200" />
        )}
      </div>

      <div className="mt-3 space-y-1 pl-1.5 text-xs text-slate-600">
        <p className="flex items-center gap-1.5 truncate">
          <MapPin size={12} className="shrink-0 text-slate-400" />
          {item.locationText || "-"}
        </p>

        {isRoutine ? (
          <>
            <p className="flex items-center gap-1.5 truncate">
              <User size={12} className="shrink-0 text-slate-400" />
              Teknisi: {item.assignedToName || "-"}
            </p>
            <p className="flex items-center gap-1.5 truncate">
              <CalendarDays size={12} className="shrink-0 text-slate-400" />
              Jatuh tempo: {item.dueDateText || "-"}
            </p>
            {/* Section D — supaya sekilas lihat card langsung tahu bola ada
                di tangan siapa, tanpa perlu buka detail. */}
            {(() => {
              const nextActor = getRoutineNextActor(item.raw as MaintenanceWorkOrder);
              if (nextActor.actor === "done") return null;
              return (
                <p
                  className={clsx(
                    "truncate pl-[18px] font-medium",
                    nextActor.actor === "qhse" ? "text-blue-600" : "text-purple-600"
                  )}
                >
                  Aktor berikutnya: {nextActor.label}
                </p>
              );
            })()}
          </>
        ) : (
          <>
            <p className="flex items-center gap-1.5 truncate">
              <User size={12} className="shrink-0 text-slate-400" />
              Pelapor: {item.reportedByName || "-"}
            </p>
            <p className="truncate pl-[18px] text-slate-500">
              {item.hasAsset ? item.assetSummary : "Tidak terkait asset tertentu"}
            </p>
            {(item.raw as AssetIssueTicket).externalHandling ? (
              <>
                <p className="truncate pl-[18px] text-slate-500">
                  Penanganan: {(item.raw as AssetIssueTicket).externalHandlerLabel || "Teknisi Eksternal"}
                </p>
                <p className="truncate pl-[18px] text-slate-500">
                  Status: {(item.raw as AssetIssueTicket).externalCoordinationStatusLabel || "-"}
                </p>
              </>
            ) : isAssignmentIncomplete(item.raw as AssetIssueTicket) ? (
              <p className="truncate pl-[18px] font-medium text-amber-600">Penugasan belum lengkap</p>
            ) : (item.raw as AssetIssueTicket).assignedTeam ? (
              <>
                <p className="truncate pl-[18px] text-slate-500">
                  Tim: {(item.raw as AssetIssueTicket).assignedTeamLabel || (item.raw as AssetIssueTicket).assignedTeam}
                </p>
                <p className="truncate pl-[18px] text-slate-500">PJ: {item.assignedToName || "Belum ada petugas"}</p>
              </>
            ) : (
              <p className="truncate pl-[18px] text-slate-500">Ditugaskan ke: Belum ditugaskan</p>
            )}
          </>
        )}
      </div>

      {isRoutine && item.progressPercent !== null && (
        <div className="mt-3 pl-1.5">
          <div className="mb-1 flex justify-between text-xs font-medium text-slate-500">
            <span>Progress</span>
            <span className="font-bold text-slate-700">{item.progressPercent}%</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all"
              style={{ width: `${item.progressPercent}%` }}
            />
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={isOverlay}
        onClick={(event) => {
          event.stopPropagation();
          if (!isOverlay) onOpenDetail?.(item);
        }}
        className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        Lihat Detail
      </button>
    </div>
  );
}
