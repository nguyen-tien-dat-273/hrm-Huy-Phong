// ============================================================================
// Một phiếu KPI: tự chấm, quản lý / BGĐ chấm duyệt, hoặc chỉ xem.
// ----------------------------------------------------------------------------
// Hai luồng điểm đặt cạnh nhau: điểm tự chấm + minh chứng bên trái, điểm duyệt
// + lý do bên phải. KPI% tính lại ngay khi gõ; database chốt lại khi lưu.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, CircleAlert, FileSpreadsheet, History, Paperclip, Save, Send, Undo2, X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dropdown } from '@/components/ui/Dropdown';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Input';
import { useToast } from '@/contexts/ToastContext';
import {
  GRADE_TONE, GROUP_LABEL, GROUP_ROMAN, LOG_ACTION_LABEL, METHOD_LABEL, SHEET_STATUS_LABEL, SHEET_STATUS_TONE,
  SOURCE_LABEL, deadlineOf, finalPct, fmtDeadline, fmtNum, fmtPct, gradeOf, groupCriteria, monthLabelOf, parseNum,
  previewSheet, rangeLabel, scoreOptions,
  type KpiLog, type KpiSettings, type KpiSheet, type KpiSheetItem,
} from '@/lib/kpi';
import {
  approveSheet, loadLogs, loadSheet, loadSheetItems, openKpiFile, returnSheet, saveReview, saveSelf, submitSheet,
  uploadKpiFile,
} from '@/lib/kpiData';
import { exportExcel } from '@/lib/tableExport';
import { notifyUsers } from '@/lib/assignments';
import { supabase } from '@/lib/supabase';
import { fetchWorkSchedules, measurePunctuality } from '@/lib/workSchedule';
import { formatDateTime } from '@/lib/utils';

export type SheetRole = 'SELF' | 'MANAGER' | 'BOARD' | null;

export interface SheetViewer {
  id: string | null;
  canManage: boolean;
  isBoard: boolean;
  canClose: boolean;
}

/** Bản sao `kpi_sheet_role` để biết hiện nút nào. */
export function sheetRole(sheet: KpiSheet, viewer: SheetViewer, settings: KpiSettings | null, opts: { locked: boolean; reopened: boolean }): SheetRole {
  if (opts.locked && !opts.reopened) return null;
  const now = new Date();
  if (sheet.status === 'BOARD' && viewer.isBoard) return 'BOARD';
  if (sheet.status === 'PENDING' && viewer.isBoard && now > deadlineOf(sheet.period_month, 'MANAGER', settings)) return 'BOARD';
  if (sheet.status === 'PENDING' && !sheet.reviewer_id && viewer.isBoard) return 'BOARD';
  if (sheet.status === 'PENDING' && (sheet.reviewer_id === viewer.id || viewer.canManage)) return 'MANAGER';
  if (sheet.status === 'PENDING' && opts.reopened && viewer.canClose) return 'MANAGER';
  if ((sheet.status === 'DRAFT' || sheet.status === 'REJECTED')
    && (sheet.reviewer_id === viewer.id || viewer.canManage)
    && now > deadlineOf(sheet.period_month, 'SELF', settings)) return 'MANAGER';
  if ((sheet.status === 'DRAFT' || sheet.status === 'REJECTED') && sheet.user_id === viewer.id) return 'SELF';
  return null;
}

interface SelfDraft { value: string; score: string; na: boolean; note: string; filePath: string | null; fileName: string | null }
interface MgrDraft { value: string; score: string; na: boolean; reason: string }

const isUrl = (text: string) => /^https?:\/\//i.test(text.trim());

export function KpiSheetView({
  sheetId, viewer, settings, locked, reopened = false, personName, nameOf, onChanged, onClose,
}: {
  sheetId: string;
  viewer: SheetViewer;
  settings: KpiSettings | null;
  locked: boolean;
  reopened?: boolean;
  personName: string;
  nameOf: (id: string | null) => string;
  onChanged?: () => void;
  onClose?: () => void;
}) {
  const { toast } = useToast();
  const [sheet, setSheet] = useState<KpiSheet | null>(null);
  const [items, setItems] = useState<KpiSheetItem[]>([]);
  const [selfDraft, setSelfDraft] = useState<SelfDraft[]>([]);
  const [mgrDraft, setMgrDraft] = useState<MgrDraft[]>([]);
  const [explanation, setExplanation] = useState('');
  const [bonus, setBonus] = useState('0');
  const [bonusNote, setBonusNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [logs, setLogs] = useState<KpiLog[] | null>(null);
  const [lateCount, setLateCount] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = async () => {
    const [nextSheet, result] = await Promise.all([loadSheet(sheetId), loadSheetItems(sheetId)]);
    setLoadError(result.error ?? (nextSheet ? null : 'Không mở được phiếu này.'));
    setSheet(nextSheet);
    setItems(result.items);
    setSelfDraft(result.items.map((item) => ({
      value: item.self_value == null ? '' : String(item.self_value),
      score: item.self_score == null ? '' : String(item.self_score),
      na: item.self_na,
      note: item.evidence_url ?? item.self_note ?? '',
      filePath: item.evidence_path,
      fileName: item.evidence_name,
    })));
    setMgrDraft(result.items.map((item) => ({
      value: item.mgr_value == null ? '' : String(item.mgr_value),
      score: item.mgr_score == null ? '' : String(item.mgr_score),
      na: item.mgr_na,
      reason: item.mgr_reason ?? '',
    })));
    setExplanation(nextSheet?.explanation ?? '');
    setBonus(String(nextSheet?.bonus_pct ?? 0));
    setBonusNote(nextSheet?.bonus_note ?? '');
    setDirty(false);
  };

  useEffect(() => { void load(); setLogs(null); }, [sheetId]); // eslint-disable-line react-hooks/exhaustive-deps

  const role = sheet ? sheetRole(sheet, viewer, settings, { locked, reopened }) : null;
  const selfEditable = role === 'SELF';
  const mgrEditable = role === 'MANAGER' || role === 'BOARD';
  const needsLate = items.some((item) => item.source === 'LATE_COUNT');

  // Số lần đi muộn / về sớm từ chấm công — gợi ý cho tiêu chí chuyên cần.
  useEffect(() => {
    if (!sheet || !needsLate || (!selfEditable && !mgrEditable)) return;
    let active = true;
    void (async () => {
      const month = sheet.period_month;
      const end = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0);
      const monthEnd = `${month.slice(0, 7)}-${String(end.getDate()).padStart(2, '0')}`;
      const [schedules, attendance, requests, holidays] = await Promise.all([
        fetchWorkSchedules(),
        supabase.from('attendance').select('date, check_in_time, check_out_time')
          .eq('user_id', sheet.user_id).gte('date', month).lte('date', monthEnd),
        supabase.from('attendance_requests').select('request_type, work_date')
          .eq('user_id', sheet.user_id).eq('status', 'APPROVED').gte('work_date', month).lte('work_date', monthEnd),
        supabase.from('company_holidays').select('holiday_date').eq('is_active', true)
          .gte('holiday_date', month).lte('holiday_date', monthEnd),
      ]);
      if (!active || attendance.error || !schedules.supported) return;
      const reqs = (requests.data || []) as Array<{ request_type: string; work_date: string }>;
      const stats = measurePunctuality(
        schedules,
        (attendance.data || []) as Array<{ date: string; check_in_time: string | null; check_out_time: string | null }>,
        ((holidays.data || []) as Array<{ holiday_date: string }>).map((row) => row.holiday_date),
        {
          lateDates: new Set(reqs.filter((r) => r.request_type === 'LATE_ARRIVAL').map((r) => r.work_date)),
          earlyDates: new Set(reqs.filter((r) => r.request_type === 'EARLY_LEAVE').map((r) => r.work_date)),
        },
      );
      setLateCount(stats.lateCount + stats.earlyCount);
    })();
    return () => { active = false; };
  }, [sheet?.id, needsLate, selfEditable, mgrEditable]); // eslint-disable-line react-hooks/exhaustive-deps

  const selfInputs = useMemo(() => items.map((item, index) => {
    const draft = selfDraft[index];
    return { value: draft ? parseNum(draft.value) : item.self_value, score: draft ? parseNum(draft.score) : item.self_score, na: draft?.na ?? item.self_na };
  }), [items, selfDraft]);
  const mgrInputs = useMemo(() => items.map((item, index) => {
    const draft = mgrDraft[index];
    return { value: draft ? parseNum(draft.value) : item.mgr_value, score: draft ? parseNum(draft.score) : item.mgr_score, na: draft?.na ?? item.mgr_na };
  }), [items, mgrDraft]);
  const selfPreview = useMemo(() => previewSheet(items, selfInputs), [items, selfInputs]);
  const mgrPreview = useMemo(() => previewSheet(items, mgrInputs), [items, mgrInputs]);

  if (loadError) return <p className="py-10 text-center text-sm text-red-600">{loadError}</p>;
  if (!sheet) return <p className="py-10 text-center text-sm text-slate-400">Đang mở phiếu…</p>;

  const cap = settings?.cap_pct ?? 120;
  const bonusMax = settings?.bonus_max_pct ?? 10;
  const bonusValue = parseNum(bonus) ?? 0;
  const showMgr = (sheet.status !== 'DRAFT' && sheet.status !== 'REJECTED') || mgrEditable;
  const liveMgr = mgrPreview.complete ? finalPct(mgrPreview.total, bonusValue, cap) : null;
  const shownFinal = mgrEditable ? liveMgr : sheet.final_pct;
  const shownGrade = mgrEditable ? gradeOf(liveMgr, settings?.grades ?? []) : gradeOf(sheet.final_pct, settings?.grades ?? []);
  const fromSelf = sheet.status === 'PENDING' || sheet.status === 'BOARD' || sheet.status === 'APPROVED';

  const setSelf = (index: number, patch: Partial<SelfDraft>) => {
    setSelfDraft((current) => current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
    setDirty(true);
  };
  const setMgr = (index: number, patch: Partial<MgrDraft>) => {
    setMgrDraft((current) => current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
    setDirty(true);
  };

  const differs = (index: number) => {
    if (!fromSelf) return false;
    const s = selfInputs[index];
    const m = mgrInputs[index];
    const levelBased = items[index].method === 'LEVEL' || items[index].method === 'BINARY';
    return s.na !== m.na || (!m.na && (s.value !== m.value || (levelBased && s.score !== m.score)));
  };

  const persistSelf = async () => {
    const { error } = await saveSelf(sheet.id, items.map((item, index) => {
      const draft = selfDraft[index];
      const note = draft.note.trim();
      return {
        id: item.id,
        value: parseNum(draft.value),
        score: parseNum(draft.score),
        na: draft.na,
        note: isUrl(note) ? '' : note,
        evidence_url: isUrl(note) ? note : '',
        evidence_path: draft.filePath,
        evidence_name: draft.fileName,
      };
    }), explanation);
    return error;
  };

  const persistReview = async () => {
    const { error } = await saveReview(sheet.id, items.map((item, index) => {
      const draft = mgrDraft[index];
      return { id: item.id, value: parseNum(draft.value), score: parseNum(draft.score), na: draft.na, reason: draft.reason.trim() };
    }), bonusValue, bonusNote);
    return error;
  };

  const run = async (key: string, task: () => Promise<string | null>, success: string) => {
    setBusy(key);
    const error = await task();
    setBusy(null);
    if (error) { toast(error, 'error'); return false; }
    toast(success);
    await load();
    setLogs(null);
    onChanged?.();
    return true;
  };

  const handleSaveSelf = () => run('save', persistSelf, 'Đã lưu phần tự chấm.');
  const monthText = monthLabelOf(sheet.period_month);
  const notify = (ids: Array<string | null>, type: string, message: string) =>
    void notifyUsers(ids.filter((id): id is string => !!id && id !== viewer.id), `KPI tháng ${monthText}`, message, type);

  const handleSubmit = async () => {
    if (await run('submit', async () => (await persistSelf()) ?? (await submitSheet(sheet.id)).error, 'Đã gửi quản lý duyệt.')) {
      notify([sheet.reviewer_id], 'kpi_submitted', `${personName} đã gửi phiếu KPI, chờ bạn chấm duyệt.`);
    }
  };
  const handleSaveReview = () => run('save', persistReview, 'Đã lưu điểm duyệt.');
  const toBoard = sheet.board_review && role === 'MANAGER';
  const handleApprove = async () => {
    const ok = await run('approve', async () => {
      const saveError = await persistReview();
      if (saveError) return saveError;
      const { error } = await approveSheet(sheet.id, null);
      return error;
    }, toBoard ? 'Đã duyệt, chuyển Ban Giám đốc.' : 'Đã duyệt phiếu.');
    if (ok && !toBoard) notify([sheet.user_id], 'kpi_approved', `Phiếu KPI của bạn đã được duyệt: ${fmtPct(liveMgr)}.`);
  };
  const handleReturn = async () => {
    const ok = await run('return', async () => (await returnSheet(sheet.id, returnReason)).error, 'Đã trả phiếu kèm lý do.');
    if (ok) {
      notify([sheet.status === 'BOARD' ? sheet.reviewer_id : sheet.user_id], 'kpi_returned', `Phiếu KPI bị trả về: ${returnReason.trim()}`);
      setReturnOpen(false); setReturnReason('');
    }
  };

  const attach = async (index: number, file: File) => {
    setBusy(`file-${index}`);
    const { path, error } = await uploadKpiFile(`${sheet.user_id}/${sheet.period_month.slice(0, 7)}`, file);
    setBusy(null);
    if (error || !path) { toast(error ?? 'Tải tệp thất bại.', 'error'); return; }
    setSelf(index, { filePath: path, fileName: file.name });
  };

  const exportSheet = () => exportExcel({
    filename: `phieu-kpi-${personName}-${sheet.period_month.slice(0, 7)}`,
    sheetName: 'Phiếu KPI',
    title: `PHIẾU ĐÁNH GIÁ KPI THÁNG ${monthLabelOf(sheet.period_month)} — ${personName.toUpperCase()}`,
    subtitle: `${sheet.set_name} · ${SHEET_STATUS_LABEL[sheet.status]} · KPI chốt ${fmtPct(sheet.final_pct)} (${sheet.grade ?? '—'})`
      + (sheet.approved_at ? ` · duyệt ${formatDateTime(sheet.approved_at)} bởi ${nameOf(sheet.approved_by)}` : ''),
    columns: [
      { header: 'Nhóm', value: (row: KpiSheetItem) => GROUP_LABEL[row.group_code], width: 12 },
      { header: 'Hạng mục', value: (row) => row.category, width: 30 },
      { header: 'Tiêu chí', value: (row) => row.name, width: 40 },
      { header: 'Tỷ trọng %', value: (row) => row.weight, width: 10 },
      { header: 'Điểm chuẩn', value: (row) => row.standard_score, width: 10 },
      { header: 'Tự chấm', value: (row) => (row.self_na ? 'Không phát sinh' : row.self_score ?? ''), width: 12 },
      { header: 'Minh chứng / ghi chú', value: (row) => [row.self_note, row.evidence_url, row.evidence_name].filter(Boolean).join(' · '), width: 36 },
      { header: 'Điểm duyệt', value: (row) => (row.mgr_na ? 'Không phát sinh' : row.mgr_score ?? ''), width: 12 },
      { header: 'Lý do điều chỉnh', value: (row) => row.mgr_reason ?? '', width: 30 },
      { header: 'Kết quả %', value: (row) => row.mgr_points ?? row.self_points ?? '', width: 10 },
    ],
    rows: items,
  });

  const groups = groupCriteria(items);
  const eff = mgrEditable || showMgr ? mgrPreview.eff : selfPreview.eff;

  const statusChip = (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${SHEET_STATUS_TONE[sheet.status]}`}>
      {SHEET_STATUS_LABEL[sheet.status]}
    </span>
  );

  return (
    <div className="space-y-4">
      {/* Đầu phiếu */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold text-slate-900">{personName}</h3>
            {statusChip}
            {sheet.version > 1 && <span className="text-[11px] font-semibold text-slate-400">Lần {sheet.version}</span>}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {sheet.set_name} · Tháng {monthLabelOf(sheet.period_month)}
            {sheet.reviewer_id ? ` · Quản lý: ${nameOf(sheet.reviewer_id)}` : ''}
            {sheet.board_review ? ' · BGĐ duyệt cuối' : ''}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-px overflow-hidden border border-slate-200 bg-slate-200 text-center sm:grid-cols-4">
          <Tile label="Tự chấm" value={fmtPct(selfEditable ? selfPreview.total : sheet.self_pct)} />
          <Tile label="Quản lý" value={fmtPct(mgrEditable ? (mgrPreview.complete ? mgrPreview.total : null) : sheet.manager_pct)} />
          <Tile label="Thưởng" value={fmtPct(mgrEditable ? bonusValue : sheet.bonus_pct)} />
          <Tile
            label="KPI chốt"
            value={<>{fmtPct(shownFinal)} {shownGrade && <span className={GRADE_TONE[shownGrade.code] ?? ''}>{shownGrade.code}</span>}</>}
            strong
          />
        </div>
      </div>

      {sheet.return_reason && (sheet.status === 'REJECTED' || sheet.status === 'PENDING') && (
        <p className="flex items-start gap-2 border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <CircleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" /> Lý do trả về: <strong className="font-semibold">{sheet.return_reason}</strong>
        </p>
      )}
      {role === 'SELF' && (
        <p className="text-xs text-slate-500">Hạn gửi: {fmtDeadline(deadlineOf(sheet.period_month, 'SELF', settings))}</p>
      )}
      {role === 'MANAGER' && (sheet.status === 'DRAFT' || sheet.status === 'REJECTED') && (
        <p className="text-xs font-semibold text-amber-700">Nhân viên quá hạn tự chấm — quản lý chấm thẳng.</p>
      )}

      {/* Bảng tiêu chí */}
      <div className="overflow-x-auto border border-slate-200">
        <div className="min-w-[760px] text-xs text-slate-700">
          <div className="grid grid-cols-[minmax(220px,1.6fr)_70px_minmax(150px,1fr)_minmax(150px,1fr)_minmax(170px,1fr)] border-b border-slate-200 bg-[#FCFAF8] text-[11px] font-semibold text-black">
            <div className="px-3 py-2.5">Tiêu chí</div>
            <div className="border-l border-slate-100 px-2 py-2.5 text-center">Tỷ trọng</div>
            <div className="border-l border-slate-100 px-2 py-2.5 text-center">Tự chấm</div>
            <div className="border-l border-slate-100 px-2 py-2.5 text-center">Minh chứng</div>
            <div className="border-l border-slate-100 px-2 py-2.5 text-center">{showMgr ? 'Điểm duyệt' : 'Quản lý chấm'}</div>
          </div>
          {groups.map(({ group, categories }) => {
            const groupWeight = categories.reduce((sum, cat) => sum + cat.items.reduce((s, { item }) => s + item.weight, 0), 0);
            return (
              <div key={group}>
                <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  {GROUP_ROMAN[group]}. {GROUP_LABEL[group]} · {fmtNum(groupWeight)}%
                </div>
                {categories.map((category) => (
                  <div key={category.name}>
                    {(category.items.length > 1 || category.items[0].item.name !== category.name) && (
                      <div className="border-b border-slate-100 px-3 py-1.5 text-[11px] font-semibold text-slate-600">
                        {category.name}
                        <span className="ml-1.5 font-normal text-slate-400">{fmtNum(category.items.reduce((s, { item }) => s + item.weight, 0))}%</span>
                      </div>
                    )}
                    {category.items.map(({ item, index }) => (
                      <CriterionRow
                        key={item.id}
                        item={item}
                        eff={eff[index]}
                        self={selfDraft[index]}
                        mgr={mgrDraft[index]}
                        selfPoints={selfEditable ? selfPreview.points[index] : item.self_points}
                        mgrPoints={mgrEditable ? mgrPreview.points[index] : item.mgr_points}
                        selfEditable={selfEditable}
                        mgrEditable={mgrEditable}
                        showMgr={showMgr}
                        needReason={mgrEditable && differs(index)}
                        lateCount={lateCount}
                        uploading={busy === `file-${index}`}
                        onSelf={(patch) => setSelf(index, patch)}
                        onMgr={(patch) => setMgr(index, patch)}
                        onAttach={(file) => void attach(index, file)}
                        onOpenFile={async (path) => { const error = await openKpiFile(path); if (error) toast(error, 'error'); }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Giải trình chung, thưởng trọng điểm */}
      <div className="grid gap-3 md:grid-cols-2">
        {(selfEditable || sheet.explanation) && (
          <div>
            <p className="mb-1.5 text-xs font-semibold text-slate-700">Giải trình chung</p>
            {selfEditable ? (
              <textarea
                value={explanation}
                onChange={(event) => { setExplanation(event.target.value); setDirty(true); }}
                rows={2}
                placeholder="Tóm tắt kết quả tháng, việc chưa đạt và lý do"
                className="w-full rounded-none border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />
            ) : <p className="whitespace-pre-line text-sm text-slate-700">{sheet.explanation}</p>}
          </div>
        )}
        {(mgrEditable || sheet.bonus_pct > 0) && (
          <div>
            <p className="mb-1.5 text-xs font-semibold text-slate-700">Thưởng trọng điểm <span className="font-normal text-slate-400">(tối đa {fmtNum(bonusMax)}%)</span></p>
            {mgrEditable ? (
              <div className="flex gap-2">
                <div className="relative w-24 shrink-0">
                  <input
                    value={bonus}
                    inputMode="decimal"
                    onChange={(event) => { setBonus(event.target.value.replace(/[^\d.,]/g, '')); setDirty(true); }}
                    className="h-10 w-full rounded-none border border-slate-200 pl-3 pr-6 text-sm tabular-nums outline-none focus:border-indigo-500"
                    aria-label="Thưởng trọng điểm %"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
                </div>
                <input
                  value={bonusNote}
                  onChange={(event) => { setBonusNote(event.target.value); setDirty(true); }}
                  placeholder="Công việc trọng điểm"
                  className="h-10 min-w-0 flex-1 rounded-none border border-slate-200 px-3 text-sm outline-none focus:border-indigo-500"
                />
              </div>
            ) : (
              <p className="text-sm text-slate-700">{fmtPct(sheet.bonus_pct)} — {sheet.bonus_note}</p>
            )}
            {bonusValue > bonusMax && mgrEditable && <p className="mt-1 text-xs text-red-600">Vượt mức tối đa {fmtNum(bonusMax)}%.</p>}
          </div>
        )}
      </div>

      {/* Thao tác */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void (async () => setLogs(logs ? null : await loadLogs({ sheetId: sheet.id })))()}>
            <History className="h-3.5 w-3.5" /> Lịch sử
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void exportSheet()}>
            <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
          </Button>
          {sheet.approved_at && (
            <span className="text-[11px] text-slate-500">Duyệt {formatDateTime(sheet.approved_at)} · {nameOf(sheet.approved_by)}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onClose && !role && <Button variant="outline" size="sm" onClick={onClose}>Đóng</Button>}
          {role === 'SELF' && (
            <>
              <Button variant="outline" size="sm" onClick={() => void handleSaveSelf()} disabled={!!busy || !dirty}>
                <Save className="h-3.5 w-3.5" /> {busy === 'save' ? 'Đang lưu…' : 'Lưu nháp'}
              </Button>
              <Button size="sm" onClick={() => void handleSubmit()} disabled={!!busy}>
                <Send className="h-3.5 w-3.5" /> {busy === 'submit' ? 'Đang gửi…' : 'Gửi duyệt'}
              </Button>
            </>
          )}
          {mgrEditable && (
            <>
              <Button variant="outline" size="sm" onClick={() => void handleSaveReview()} disabled={!!busy || !dirty}>
                <Save className="h-3.5 w-3.5" /> Lưu
              </Button>
              {(sheet.status === 'PENDING' || sheet.status === 'BOARD') && (
                <Button variant="outline" size="sm" onClick={() => setReturnOpen(true)} disabled={!!busy}>
                  <Undo2 className="h-3.5 w-3.5" /> {sheet.status === 'BOARD' ? 'Trả quản lý' : 'Trả về'}
                </Button>
              )}
              <Button variant="success" size="sm" onClick={() => void handleApprove()} disabled={!!busy || !mgrPreview.complete}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                {busy === 'approve' ? 'Đang duyệt…' : role === 'BOARD' ? 'Duyệt cuối' : sheet.board_review ? 'Duyệt, chuyển BGĐ' : 'Duyệt'}
              </Button>
            </>
          )}
        </div>
      </div>

      {logs && (
        <ol className="space-y-1.5 border-l-2 border-slate-200 pl-3 text-xs">
          {logs.length === 0 && <li className="text-slate-400">Chưa có thao tác.</li>}
          {logs.map((log) => (
            <li key={log.id} className="text-slate-600">
              <span className="font-semibold text-slate-800">{LOG_ACTION_LABEL[log.action] ?? log.action}</span>
              {' · '}{nameOf(log.actor_id)} · {formatDateTime(log.created_at)}
              {log.reason && <span className="text-slate-500"> — {log.reason}</span>}
            </li>
          ))}
        </ol>
      )}

      <Modal square open={returnOpen} onClose={() => setReturnOpen(false)} title={sheet.status === 'BOARD' ? 'Trả phiếu cho quản lý' : 'Trả phiếu cho nhân viên'} size="sm">
        <div className="space-y-3">
          <Textarea className="!rounded-none" label="Lý do" required rows={3} value={returnReason}
            onChange={(event) => setReturnReason(event.target.value)} placeholder="Cần bổ sung gì" autoFocus />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setReturnOpen(false)}>Huỷ</Button>
            <Button onClick={() => void handleReturn()} disabled={returnReason.trim().length < 3 || !!busy}>Trả về</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Tile({ label, value, strong = false }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="min-w-[84px] bg-white px-3 py-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`tabular-nums ${strong ? 'text-base font-bold text-slate-900' : 'text-sm font-semibold text-slate-700'}`}>{value}</p>
    </div>
  );
}

function CriterionRow({
  item, eff, self, mgr, selfPoints, mgrPoints, selfEditable, mgrEditable, showMgr, needReason, lateCount, uploading,
  onSelf, onMgr, onAttach, onOpenFile,
}: {
  item: KpiSheetItem;
  eff: number;
  self: SelfDraft | undefined;
  mgr: MgrDraft | undefined;
  selfPoints: number | null;
  mgrPoints: number | null;
  selfEditable: boolean;
  mgrEditable: boolean;
  showMgr: boolean;
  needReason: boolean;
  lateCount: number | null;
  uploading: boolean;
  onSelf: (patch: Partial<SelfDraft>) => void;
  onMgr: (patch: Partial<MgrDraft>) => void;
  onAttach: (file: File) => void;
  onOpenFile: (path: string) => void;
}) {
  const rule = item.method === 'RANGE'
    ? item.ranges.map((range) => `${rangeLabel(range, item.value_unit)} → ${fmtNum(range.score)}`).join('\n')
    : item.method === 'PENALTY'
      ? `Trừ ${fmtNum(item.penalty_pct)}% mỗi lần vi phạm`
      : item.levels.map((level) => `${fmtNum(level.score)}: ${level.label}`).join('\n');
  const weightChanged = Math.abs(eff - item.weight) > 0.005;

  return (
    <div className="grid grid-cols-[minmax(220px,1.6fr)_70px_minmax(150px,1fr)_minmax(150px,1fr)_minmax(170px,1fr)] border-b border-slate-100 last:border-b-0 hover:bg-[#FCFAF8]">
      <div className="px-3 py-2" title={rule}>
        <p className="font-semibold text-slate-800">{item.name}</p>
        {item.measure && <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{item.measure}</p>}
        <p className="mt-0.5 text-[10px] text-slate-400">
          {METHOD_LABEL[item.method]} · chuẩn {fmtNum(item.standard_score)}{item.allow_over ? ' · được vượt chuẩn' : ''}
          {item.source ? ` · ${SOURCE_LABEL[item.source]}` : ''}
        </p>
      </div>
      <div className="border-l border-slate-100 px-2 py-2 text-center tabular-nums">
        {weightChanged ? (
          <span title="Tỷ trọng sau khi chia lại phần không phát sinh">
            <span className="text-slate-400 line-through">{fmtNum(item.weight)}</span>{' '}
            <span className="font-semibold text-slate-800">{fmtNum(Math.round(eff * 100) / 100)}</span>
          </span>
        ) : `${fmtNum(item.weight)}%`}
      </div>
      <div className="border-l border-slate-100 px-2 py-1.5">
        {selfEditable && self ? (
          <ScoreInput item={item} value={self.value} score={self.score} na={self.na}
            hint={item.source === 'LATE_COUNT' && lateCount != null ? lateCount : null}
            onChange={(patch) => onSelf(patch)} />
        ) : (
          <ScoreText item={item} value={item.self_value} score={item.self_score} na={item.self_na} />
        )}
        <Points value={selfPoints} />
      </div>
      <div className="border-l border-slate-100 px-2 py-1.5">
        {selfEditable && self ? (
          <div className="space-y-1">
            <input
              value={self.note}
              onChange={(event) => onSelf({ note: event.target.value })}
              placeholder="Ghi chú hoặc link"
              className="h-8 w-full rounded-none border border-slate-200 px-2 text-xs outline-none focus:border-indigo-500"
            />
            <div className="flex items-center gap-1.5">
              <label className={`inline-flex cursor-pointer items-center gap-1 text-[11px] font-semibold ${uploading ? 'text-slate-400' : 'text-indigo-600 hover:text-indigo-700'}`}>
                <Paperclip className="h-3 w-3" /> {uploading ? 'Đang tải…' : self.fileName ? 'Đổi tệp' : 'Đính tệp'}
                <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.doc,.docx,.xls,.xlsx"
                  onChange={(event) => { const file = event.target.files?.[0]; if (file) onAttach(file); event.target.value = ''; }} />
              </label>
              {self.fileName && (
                <span className="flex min-w-0 items-center gap-1 text-[11px] text-slate-500">
                  <span className="truncate">{self.fileName}</span>
                  <button type="button" onClick={() => onSelf({ filePath: null, fileName: null })} aria-label="Bỏ tệp" className="text-slate-400 hover:text-red-600">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-0.5 text-[11px] text-slate-600">
            {item.self_note && <p className="whitespace-pre-line">{item.self_note}</p>}
            {item.evidence_url && (
              <a href={item.evidence_url} target="_blank" rel="noreferrer" className="block truncate font-semibold text-indigo-600 hover:underline">{item.evidence_url}</a>
            )}
            {item.evidence_path && (
              <button type="button" onClick={() => onOpenFile(item.evidence_path!)} className="flex items-center gap-1 font-semibold text-indigo-600 hover:underline">
                <Paperclip className="h-3 w-3" /> {item.evidence_name ?? 'Tệp đính kèm'}
              </button>
            )}
            {!item.self_note && !item.evidence_url && !item.evidence_path && <span className="text-slate-300">—</span>}
          </div>
        )}
      </div>
      <div className="border-l border-slate-100 px-2 py-1.5">
        {mgrEditable && mgr ? (
          <div className="space-y-1">
            <ScoreInput item={item} value={mgr.value} score={mgr.score} na={mgr.na}
              hint={item.source === 'LATE_COUNT' && lateCount != null ? lateCount : null}
              onChange={(patch) => onMgr(patch)} />
            {(needReason || mgr.reason) && (
              <input
                value={mgr.reason}
                onChange={(event) => onMgr({ reason: event.target.value })}
                placeholder="Lý do điều chỉnh *"
                className={`h-8 w-full rounded-none border px-2 text-xs outline-none focus:border-indigo-500 ${needReason && !mgr.reason.trim() ? 'border-red-300 bg-red-50/50' : 'border-slate-200'}`}
              />
            )}
          </div>
        ) : showMgr ? (
          <div>
            <ScoreText item={item} value={item.mgr_value} score={item.mgr_score} na={item.mgr_na} />
            {item.mgr_reason && <p className="mt-0.5 text-[11px] text-amber-700">{item.mgr_reason}</p>}
          </div>
        ) : <span className="text-slate-300">—</span>}
        {showMgr && <Points value={mgrPoints} />}
      </div>
    </div>
  );
}

function Points({ value }: { value: number | null }) {
  if (value == null) return null;
  return <p className="mt-0.5 text-right text-[10px] font-semibold tabular-nums text-slate-400">= {fmtNum(Math.round(value * 100) / 100)}%</p>;
}

function ScoreText({ item, value, score, na }: { item: KpiSheetItem; value: number | null; score: number | null; na: boolean }) {
  if (na) return <span className="text-[11px] font-semibold text-slate-400">Không phát sinh</span>;
  if (score == null && value == null) return <span className="text-slate-300">—</span>;
  const level = item.levels.find((entry) => Number(entry.score) === Number(score));
  return (
    <div className="tabular-nums">
      {(item.method === 'RANGE' || item.method === 'PENALTY') && value != null && (
        <span className="text-slate-500">{fmtNum(value)}{item.method === 'PENALTY' ? ' lần' : item.value_unit === '%' ? '%' : item.value_unit ? ` ${item.value_unit}` : ''} → </span>
      )}
      <span className="font-semibold text-slate-800">{fmtNum(score)}</span>
      {level && <span className="ml-1 text-[11px] text-slate-500">{level.label}</span>}
    </div>
  );
}

function ScoreInput({ item, value, score, na, hint, onChange }: {
  item: KpiSheetItem;
  value: string;
  score: string;
  na: boolean;
  hint: number | null;
  onChange: (patch: { value?: string; score?: string; na?: boolean }) => void;
}) {
  const auto = item.source && item.source !== 'LATE_COUNT';
  const numeric = item.method === 'RANGE' || item.method === 'PENALTY';
  const unit = item.method === 'PENALTY' ? 'lần' : item.value_unit === '%' ? '%' : item.value_unit ?? '';
  return (
    <div className="space-y-1">
      {na ? null : auto ? (
        <p className="text-[11px] text-slate-500">
          {value ? <><span className="font-semibold text-slate-800">{fmtNum(parseNum(value))}{unit}</span> · tự điền</> : 'Chờ số liệu kinh doanh'}
        </p>
      ) : numeric ? (
        <div className="flex items-center gap-1">
          <input
            value={value}
            inputMode="decimal"
            onChange={(event) => onChange({ value: event.target.value.replace(/[^\d.,]/g, '') })}
            placeholder={item.method === 'PENALTY' ? 'Số lần' : 'Giá trị'}
            className="h-8 w-full min-w-0 rounded-none border border-slate-200 px-2 text-xs tabular-nums outline-none focus:border-indigo-500"
            aria-label={`${item.name} — giá trị`}
          />
          {unit && <span className="shrink-0 text-[11px] text-slate-400">{unit}</span>}
        </div>
      ) : (
        <Dropdown
          compact
          square
          searchable={false}
          aria-label={`${item.name} — điểm`}
          value={score}
          placeholder="Chọn điểm"
          options={scoreOptions(item)}
          onChange={(next) => onChange({ score: next })}
        />
      )}
      <div className="flex items-center justify-between gap-2">
        <label className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-slate-500">
          <input type="checkbox" checked={na} onChange={(event) => onChange({ na: event.target.checked })} className="h-3.5 w-3.5 accent-indigo-600" />
          Không phát sinh
        </label>
        {hint != null && !na && (
          <button type="button" onClick={() => onChange({ value: String(hint) })} className="text-[11px] font-semibold text-indigo-600 hover:underline"
            title="Đi muộn + về sớm theo chấm công">
            Chấm công: {hint}
          </button>
        )}
      </div>
    </div>
  );
}
