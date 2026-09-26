// ============================================================================
// Phiếu KPI tháng — mở kỳ, theo dõi chấm/duyệt, khoá sổ, đối soát sang lương,
// mở lại phiếu đã khoá có biên bản.
// ============================================================================

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarClock, CheckCircle2, FilePlus2, Lock, LockKeyhole, Paperclip, RefreshCcw, RotateCcw, Search, TriangleAlert,
} from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Dropdown } from '@/components/ui/Dropdown';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Input';
import { ExportButtons } from '@/components/payroll/ExportButtons';
import { Banner } from '@/components/payroll/PayrollRegister';
import { KpiSheetView, type SheetViewer } from '@/components/kpi/KpiSheetView';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import {
  GRADE_TONE, SHEET_STATUS_LABEL, SHEET_STATUS_TONE, deadlineOf, fmtDeadline, fmtPct, fold, monthLabelOf,
  type KpiSettings, type KpiSheet, type KpiSheetStatus,
} from '@/lib/kpi';
import {
  decideReopen, lockPeriod, openKpiFile, openPeriod, requestReopen, setExempt, syncPayroll, uploadKpiFile,
  type KpiWorkspace,
} from '@/lib/kpiData';
import { formatDateTime } from '@/lib/utils';

const STATUS_ORDER: KpiSheetStatus[] = ['DRAFT', 'REJECTED', 'PENDING', 'BOARD', 'APPROVED'];

export function KpiPeriodBoard({
  data, month, settings, viewer, onChanged,
}: {
  data: KpiWorkspace;
  month: string;
  settings: KpiSettings | null;
  viewer: SheetViewer;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [unitFilter, setUnitFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [query, setQuery] = useState('');
  const [openSheetId, setOpenSheetId] = useState<string | null>(null);
  const [missing, setMissing] = useState<Array<{ user_id: string; name: string }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [reopenFor, setReopenFor] = useState<KpiSheet | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenFile, setReopenFile] = useState<File | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const period = data.period;
  const locked = period?.status === 'LOCKED';
  const personById = useMemo(() => new Map(data.profiles.map((person) => [person.id, person])), [data.profiles]);
  const unitName = useMemo(() => new Map(data.units.map((unit) => [unit.id, unit.name])), [data.units]);
  const nameOf = (id: string | null) => (id ? personById.get(id)?.name ?? '—' : '—');
  const label = monthLabelOf(month);

  const openReopen = useMemo(
    () => new Set(data.reopen.filter((request) => request.status === 'APPROVED' && !request.closed_at).map((request) => request.sheet_id)),
    [data.reopen],
  );
  const sheetIds = new Set(data.sheets.map((sheet) => sheet.id));
  const pendingReopen = data.reopen.filter((request) => request.status === 'PENDING' && sheetIds.has(request.sheet_id));

  const counts = useMemo(() => {
    const map = new Map<KpiSheetStatus, number>();
    for (const sheet of data.sheets) map.set(sheet.status, (map.get(sheet.status) ?? 0) + 1);
    return map;
  }, [data.sheets]);

  const keyword = fold(query);
  const rows = data.sheets
    .filter((sheet) => !unitFilter || sheet.unit_id === unitFilter)
    .filter((sheet) => !statusFilter || sheet.status === statusFilter)
    .filter((sheet) => !keyword || fold(nameOf(sheet.user_id)).includes(keyword) || fold(sheet.set_name).includes(keyword))
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || nameOf(a.user_id).localeCompare(nameOf(b.user_id), 'vi'));

  const opened = data.sheets.find((sheet) => sheet.id === openSheetId) ?? null;

  const handleOpen = async () => {
    setBusy('open');
    const { data: result, error } = await openPeriod(month);
    setBusy(null);
    if (error) { toast(error, 'error'); return; }
    const payload = result as { created: number; missing: Array<{ user_id: string; name: string }> };
    setMissing(payload.missing ?? []);
    toast(payload.created ? `Đã tạo ${payload.created} phiếu KPI tháng ${label}.` : 'Không có phiếu mới cần tạo.');
    onChanged();
  };

  const handleLock = async () => {
    const notApproved = data.sheets.filter((sheet) => sheet.status !== 'APPROVED').length;
    const ok = await confirm({
      title: `Khoá sổ KPI tháng ${label}`,
      message: notApproved
        ? `Còn ${notApproved} phiếu chưa duyệt — các phiếu này không sang lương kỳ này, duyệt bổ sung thì mở lại để truy lĩnh. Kết quả đã duyệt sẽ điền vào bảng lương.`
        : 'Kết quả đã duyệt sẽ điền vào bảng lương. Sau khi khoá, sửa phiếu phải lập đề nghị mở lại.',
      confirmLabel: 'Khoá sổ',
      danger: true,
    });
    if (!ok) return;
    setBusy('lock');
    const { error } = await lockPeriod(month);
    setBusy(null);
    if (error) { toast(error, 'error'); return; }
    toast(`Đã khoá sổ KPI tháng ${label}.`);
    onChanged();
  };

  const handleSync = async () => {
    setBusy('sync');
    const { error } = await syncPayroll(month);
    setBusy(null);
    if (error) toast(error, 'error'); else { toast('Đã điền lại kết quả KPI vào bảng lương.'); onChanged(); }
  };

  const handleExempt = async (userId: string) => {
    const error = await setExempt(userId, true);
    if (error) { toast(error, 'error'); return; }
    setMissing((current) => current.filter((person) => person.user_id !== userId));
  };

  const handleRequestReopen = async () => {
    if (!reopenFor || !reopenFile) return;
    setBusy('reopen');
    const upload = await uploadKpiFile(`reopen/${reopenFor.id}`, reopenFile);
    if (upload.error || !upload.path) { setBusy(null); toast(upload.error ?? 'Tải biên bản thất bại.', 'error'); return; }
    const { error } = await requestReopen(reopenFor.id, reopenReason, upload.path, reopenFile.name);
    setBusy(null);
    if (error) { toast(error, 'error'); return; }
    toast('Đã gửi đề nghị mở lại, chờ Ban Giám đốc duyệt.');
    setReopenFor(null); setReopenReason(''); setReopenFile(null);
    onChanged();
  };

  const handleDecide = async (requestId: string, approve: boolean, note: string | null = null) => {
    const { error } = await decideReopen(requestId, approve, note);
    if (error) { toast(error, 'error'); return; }
    toast(approve ? 'Đã mở lại phiếu — chấm lại rồi duyệt.' : 'Đã từ chối mở lại.');
    setRejectId(null); setRejectNote('');
    onChanged();
  };

  // Đối soát chuyển lương theo phòng ban
  const reconcile = useMemo(() => {
    const map = new Map<string, { unit: string; total: number; approved: number; sum: number; synced: number }>();
    for (const sheet of data.sheets) {
      const key = sheet.unit_id ?? '';
      const row = map.get(key) ?? { unit: unitName.get(key) ?? 'Chưa gán phòng', total: 0, approved: 0, sum: 0, synced: 0 };
      row.total += 1;
      if (sheet.status === 'APPROVED') { row.approved += 1; row.sum += sheet.final_pct ?? 0; }
      if (sheet.payroll_synced_at) row.synced += 1;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => a.unit.localeCompare(b.unit, 'vi'));
  }, [data.sheets, unitName]);

  const exportOptions = () => ({
    filename: `phieu-kpi-${month.slice(0, 7)}`,
    sheetName: `KPI ${label.replace('/', '-')}`,
    title: `KẾT QUẢ KPI THÁNG ${label}`,
    subtitle: `${rows.length} phiếu · xuất lúc ${new Date().toLocaleString('vi-VN')}`,
    columns: [
      { header: 'Mã NV', value: (sheet: KpiSheet) => personById.get(sheet.user_id)?.employee_code ?? '', width: 12 },
      { header: 'Họ tên', value: (sheet: KpiSheet) => nameOf(sheet.user_id), width: 28 },
      { header: 'Phòng ban', value: (sheet: KpiSheet) => unitName.get(sheet.unit_id ?? '') ?? '', width: 24 },
      { header: 'Bộ KPI', value: (sheet: KpiSheet) => sheet.set_name, width: 30 },
      { header: 'Trạng thái', value: (sheet: KpiSheet) => SHEET_STATUS_LABEL[sheet.status], width: 14 },
      { header: 'Tự chấm %', value: (sheet: KpiSheet) => sheet.self_pct ?? '', width: 11 },
      { header: 'Quản lý %', value: (sheet: KpiSheet) => sheet.manager_pct ?? '', width: 11 },
      { header: 'Thưởng %', value: (sheet: KpiSheet) => sheet.bonus_pct || '', width: 10 },
      { header: 'KPI chốt %', value: (sheet: KpiSheet) => sheet.final_pct ?? '', width: 11 },
      { header: 'Xếp loại', value: (sheet: KpiSheet) => sheet.grade ?? '', width: 9 },
      { header: 'Người duyệt', value: (sheet: KpiSheet) => nameOf(sheet.approved_by), width: 22 },
      { header: 'Thời điểm duyệt', value: (sheet: KpiSheet) => (sheet.approved_at ? formatDateTime(sheet.approved_at) : ''), width: 18 },
    ],
    rows,
  });

  const deadlines: Array<[string, Date]> = [
    ['Tự chấm', deadlineOf(month, 'SELF', settings)],
    ['Quản lý', deadlineOf(month, 'MANAGER', settings)],
    ['BGĐ', deadlineOf(month, 'BOARD', settings)],
    ['Khoá sổ', deadlineOf(month, 'LOCK', settings)],
  ];
  const now = new Date();

  return (
    <div className="space-y-4">
      {/* Trạng thái kỳ */}
      <Card className="!rounded-none">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <p className="flex items-center gap-2 text-sm font-bold text-slate-800">
              {locked ? <LockKeyhole className="h-4 w-4 text-slate-500" /> : <CalendarClock className="h-4 w-4 text-indigo-600" />}
              Kỳ {label}:{' '}
              <span className={locked ? 'text-slate-600' : period ? 'text-indigo-700' : 'text-slate-400'}>
                {locked ? `Đã khoá sổ ${formatDateTime(period?.locked_at ?? null)}` : period ? 'Đang mở' : 'Chưa mở'}
              </span>
            </p>
            {!locked && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                {deadlines.map(([name, date]) => (
                  <span key={name} className={date < now ? 'text-slate-400 line-through' : ''}>
                    {name} <span className="font-semibold tabular-nums text-slate-700">{fmtDeadline(date)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 no-print">
            {viewer.canManage && !locked && (
              <Button size="sm" variant={period ? 'outline' : 'primary'} onClick={() => void handleOpen()} disabled={!!busy}>
                <FilePlus2 className="h-3.5 w-3.5" /> {busy === 'open' ? 'Đang tạo…' : period ? 'Bổ sung phiếu' : 'Mở kỳ & tạo phiếu'}
              </Button>
            )}
            {viewer.canClose && period && !locked && (
              <Button size="sm" variant="outline" onClick={() => void handleLock()} disabled={!!busy}>
                <Lock className="h-3.5 w-3.5" /> {busy === 'lock' ? 'Đang khoá…' : 'Khoá sổ'}
              </Button>
            )}
            {viewer.canClose && locked && (
              <Button size="sm" variant="outline" onClick={() => void handleSync()} disabled={!!busy}>
                <RefreshCcw className="h-3.5 w-3.5" /> Điền lại vào lương
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {missing.length > 0 && (
        <Banner tone="amber" icon={<TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />}>
          {missing.length} người chưa có bộ KPI nên chưa có phiếu.{' '}
          <Link to="/admin/performance" className="font-semibold underline">Gán bộ KPI</Link>, hoặc bấm tên để đánh dấu không áp dụng:{' '}
          {missing.map((person, index) => (
            <span key={person.user_id}>
              {index > 0 && ', '}
              <button type="button" className="font-semibold hover:underline" onClick={() => void handleExempt(person.user_id)}
                title="Không áp dụng KPI (part-time, thực tập sinh…)">
                {person.name}
              </button>
            </span>
          ))}
        </Banner>
      )}

      {pendingReopen.length > 0 && (
        <Card className="!rounded-none">
          <CardContent className="space-y-2 py-3">
            <p className="text-sm font-bold text-slate-800">Đề nghị mở lại phiếu đã khoá</p>
            {pendingReopen.map((request) => {
              const sheet = data.sheets.find((row) => row.id === request.sheet_id);
              return (
                <div key={request.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800">{nameOf(sheet?.user_id ?? null)} · {fmtPct(request.old_pct)}</p>
                    <p className="text-xs text-slate-500">
                      {request.reason} · {nameOf(request.requested_by)} · {formatDateTime(request.requested_at)}
                      {request.minutes_path && (
                        <button type="button" className="ml-2 inline-flex items-center gap-1 font-semibold text-indigo-600 hover:underline"
                          onClick={() => void openKpiFile(request.minutes_path!)}>
                          <Paperclip className="h-3 w-3" /> {request.minutes_name ?? 'Biên bản'}
                        </button>
                      )}
                    </p>
                  </div>
                  {viewer.isBoard ? (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setRejectId(request.id)}>Không duyệt</Button>
                      <Button size="sm" variant="success" onClick={() => void handleDecide(request.id, true)}>Duyệt mở lại</Button>
                    </div>
                  ) : <span className="text-xs font-semibold text-amber-700">Chờ BGĐ</span>}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Danh sách phiếu */}
      <Card className="!rounded-none">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 no-print">
          <div className="w-full sm:w-56">
            <Dropdown
              aria-label="Lọc theo phòng ban"
              value={unitFilter}
              searchable
              options={[{ value: '', label: 'Tất cả phòng ban' }, ...data.units.filter((unit) => unit.is_active).map((unit) => ({ value: unit.id, label: unit.name }))]}
              onChange={setUnitFilter}
            />
          </div>
          <div className="w-full sm:w-48">
            <Dropdown
              aria-label="Lọc theo trạng thái"
              value={statusFilter}
              searchable={false}
              options={[
                { value: '', label: 'Mọi trạng thái', detail: String(data.sheets.length) },
                ...STATUS_ORDER.map((status) => ({ value: status, label: SHEET_STATUS_LABEL[status], detail: String(counts.get(status) ?? 0) })),
              ]}
              onChange={setStatusFilter}
            />
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm theo tên, bộ KPI…"
              aria-label="Tìm phiếu"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
          <span className="ml-auto text-xs font-semibold text-slate-500">{rows.length}/{data.sheets.length} phiếu</span>
          <ExportButtons options={exportOptions} disabled={rows.length === 0} />
        </div>

        {data.sheets.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-slate-500">
            {period ? 'Kỳ đã mở nhưng chưa có phiếu nào.' : `Chưa mở kỳ KPI tháng ${label}.`}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] whitespace-nowrap text-xs tabular-nums text-slate-700">
              <thead>
                <tr className="border-b border-slate-200 bg-[#FCFAF8] text-[11px] font-semibold text-black">
                  <th className="px-4 py-3 text-left">Nhân sự</th>
                  <th className="border-l border-slate-100 px-3 py-3 text-left">Bộ KPI</th>
                  <th className="border-l border-slate-100 px-3 py-3 text-center">Trạng thái</th>
                  <th className="border-l border-slate-100 px-3 py-3 text-center">Tự chấm</th>
                  <th className="border-l border-slate-100 px-3 py-3 text-center">Quản lý</th>
                  <th className="border-l border-slate-100 px-3 py-3 text-center">Thưởng</th>
                  <th className="border-l border-slate-100 px-3 py-3 text-center">KPI chốt</th>
                  <th className="border-l border-slate-100 px-3 py-3 text-left">Người duyệt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((sheet) => {
                  const person = personById.get(sheet.user_id);
                  return (
                    <tr key={sheet.id} className="cursor-pointer transition-colors hover:bg-[#FCFAF8]" onClick={() => setOpenSheetId(sheet.id)}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={person?.name ?? '?'} url={person?.avatar_url ?? null} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-800">{person?.name ?? 'Nhân sự đã nghỉ'}</p>
                            <p className="truncate text-[11px] text-slate-400">{unitName.get(sheet.unit_id ?? '') ?? '—'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="max-w-[220px] truncate border-l border-slate-100 px-3 py-2.5" title={sheet.set_name}>{sheet.set_name}</td>
                      <td className="border-l border-slate-100 px-3 py-2.5 text-center">
                        <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset ${SHEET_STATUS_TONE[sheet.status]}`}>
                          {SHEET_STATUS_LABEL[sheet.status]}
                        </span>
                        {openReopen.has(sheet.id) && <span className="ml-1 text-[10px] font-semibold text-amber-700">mở lại</span>}
                      </td>
                      <td className="border-l border-slate-100 px-3 py-2.5 text-center">{fmtPct(sheet.self_pct)}</td>
                      <td className="border-l border-slate-100 px-3 py-2.5 text-center">{fmtPct(sheet.manager_pct)}</td>
                      <td className="border-l border-slate-100 px-3 py-2.5 text-center">{sheet.bonus_pct ? fmtPct(sheet.bonus_pct) : '—'}</td>
                      <td className="border-l border-slate-100 px-3 py-2.5 text-center font-semibold">
                        {fmtPct(sheet.final_pct)}
                        {sheet.grade && <span className={`ml-1.5 font-bold ${GRADE_TONE[sheet.grade] ?? ''}`}>{sheet.grade}</span>}
                      </td>
                      <td className="border-l border-slate-100 px-3 py-2.5">
                        {sheet.status === 'APPROVED' ? nameOf(sheet.approved_by)
                          : sheet.status === 'BOARD' || !sheet.reviewer_id ? 'Ban Giám đốc' : nameOf(sheet.reviewer_id)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Đối soát chuyển lương */}
      {locked && reconcile.length > 0 && (
        <Card className="!rounded-none">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-bold text-slate-800">Đối soát chuyển lương</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs tabular-nums text-slate-700">
              <thead>
                <tr className="border-b border-slate-200 bg-[#FCFAF8] text-[11px] font-semibold text-black">
                  <th className="px-4 py-2.5 text-left">Phòng ban</th>
                  <th className="border-l border-slate-100 px-3 py-2.5 text-center">Số phiếu</th>
                  <th className="border-l border-slate-100 px-3 py-2.5 text-center">Đã duyệt</th>
                  <th className="border-l border-slate-100 px-3 py-2.5 text-center">KPI bình quân</th>
                  <th className="border-l border-slate-100 px-3 py-2.5 text-center">Đã sang lương</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reconcile.map((row) => (
                  <tr key={row.unit}>
                    <td className="px-4 py-2">{row.unit}</td>
                    <td className="border-l border-slate-100 px-3 py-2 text-center">{row.total}</td>
                    <td className="border-l border-slate-100 px-3 py-2 text-center">{row.approved}</td>
                    <td className="border-l border-slate-100 px-3 py-2 text-center">{row.approved ? fmtPct(row.sum / row.approved) : '—'}</td>
                    <td className={`border-l border-slate-100 px-3 py-2 text-center font-semibold ${row.synced < row.approved ? 'text-amber-700' : 'text-emerald-700'}`}>
                      {row.synced}/{row.approved}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal square open={!!opened} onClose={() => setOpenSheetId(null)} title={`Phiếu KPI tháng ${label}`} size="2xl">
        {opened && (
          <div className="space-y-3">
            <KpiSheetView
              sheetId={opened.id}
              viewer={viewer}
              settings={settings}
              locked={locked}
              reopened={openReopen.has(opened.id)}
              personName={nameOf(opened.user_id)}
              nameOf={nameOf}
              onChanged={onChanged}
              onClose={() => setOpenSheetId(null)}
            />
            {locked && viewer.canClose && !openReopen.has(opened.id)
              && !data.reopen.some((request) => request.sheet_id === opened.id && request.status === 'PENDING') && (
              <div className="flex justify-end border-t border-slate-100 pt-3">
                <Button size="sm" variant="outline" onClick={() => setReopenFor(opened)}>
                  <RotateCcw className="h-3.5 w-3.5" /> Đề nghị mở lại
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal square open={!!rejectId} onClose={() => setRejectId(null)} title="Không duyệt mở lại" size="sm">
        <div className="space-y-3">
          <Textarea className="!rounded-none" label="Lý do" required rows={3} value={rejectNote}
            onChange={(event) => setRejectNote(event.target.value)} autoFocus />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRejectId(null)}>Huỷ</Button>
            <Button onClick={() => { if (rejectId) void handleDecide(rejectId, false, rejectNote); }} disabled={rejectNote.trim().length < 3}>Gửi</Button>
          </div>
        </div>
      </Modal>

      <Modal square open={!!reopenFor} onClose={() => setReopenFor(null)} title="Đề nghị mở lại phiếu đã khoá" size="md">
        {reopenFor && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">{nameOf(reopenFor.user_id)} · KPI chốt {fmtPct(reopenFor.final_pct)}</p>
            <Textarea className="!rounded-none" label="Lý do" required rows={3} value={reopenReason}
              onChange={(event) => setReopenReason(event.target.value)} placeholder="Sai sót phát hiện sau khoá sổ" />
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Biên bản điều chỉnh<span className="ml-1 text-red-500">*</span></span>
              <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(event) => setReopenFile(event.target.files?.[0] ?? null)}
                className="block w-full text-sm text-slate-600 file:mr-3 file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold" />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setReopenFor(null)}>Huỷ</Button>
              <Button onClick={() => void handleRequestReopen()} disabled={reopenReason.trim().length < 3 || !reopenFile || !!busy}>
                <CheckCircle2 className="h-4 w-4" /> {busy === 'reopen' ? 'Đang gửi…' : 'Gửi BGĐ duyệt'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
