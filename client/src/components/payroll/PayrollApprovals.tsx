// ============================================================================
// Phê duyệt lương — màn của người có chức năng Phê duyệt lương (Admin/CEO, Ban Giám đốc, Kế toán trưởng…).
// ----------------------------------------------------------------------------
// Hai loại hồ sơ cùng một hàng chờ:
//   • Đề xuất cơ chế lương — BGĐ thấy đúng phần THAY ĐỔI so với cơ chế hiện
//     hành (đổi cơ chế, đổi giá trị riêng), không phải đọc lại cả cơ chế;
//   • Kỳ lương đã khoá — BGĐ thấy tổng quỹ lương rồi ký chi.
//
// "Ký" = xác thực lại bằng mật khẩu ngay trước thao tác (ReauthDialog);
// database chỉ nhận khi phiên vừa xác thực trong vài phút. Từ chối bắt buộc
// ghi lý do. Mọi quyết định ghi vào lịch sử phê duyệt (payroll_approval_events).
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, History, Search, XCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { ReauthDialog } from '@/components/payroll/ReauthDialog';
import { useAuth } from '@/contexts/AuthContext';
import { isFullAdmin } from '@/lib/permissions';
import { useToast } from '@/contexts/ToastContext';
import { formatDateTime, formatVND } from '@/lib/utils';
import { paramsOf, versionForMonth } from '@/lib/payrollSettings';
import { describeFormula, formatFormulaNumber } from '@/lib/formulaTokens';
import { nameResolver } from '@/lib/payrollRun';
import {
  SCHEME_STATUS_LABEL, SCHEME_STATUS_TONE, diffSchemeItems, personalItemsAt, unitItemsAt,
} from '@/lib/payrollScheme';
import { stripVietnamese } from '@/lib/tableExport';
import {
  REAUTH_REQUIRED, fetchApprovalEvents, fetchRunTotals, fetchRunsForApproval, fetchSchemeRequests,
  reviewPayrollRun, reviewSchemeRequest, type PayrollWorkspace, type RunTotals,
} from '@/lib/payrollData';
import { notifyUsers } from '@/lib/assignments';
import { Skeleton } from '@/components/ui/Skeleton';
import { ApprovalListSkeleton } from '@/components/payroll/PayrollSkeletons';
import type { PayComponent, PayrollApprovalEvent, PayrollRun, PayrollSchemeRequest, SchemePayloadItem } from '@/types';

interface PayrollApprovalsProps {
  data: PayrollWorkspace;
  canApprove: boolean;
  onChanged: () => void;
  onOpenRun: (monthStart: string) => void;
}

type Kind = 'ALL' | 'SCHEME' | 'RUN';
type Decision = 'APPROVED' | 'REJECTED';

const RUN_STATUS_TEXT: Record<PayrollRun['status'], string> = {
  DRAFT: 'Bản nháp', CALCULATED: 'Đã tính', LOCKED: 'Chờ duyệt', APPROVED: 'Đã duyệt chi', PAID: 'Đã chi trả & phát hành',
};

export const PAYROLL_EVENT_TEXT: Record<string, string> = {
  SAVED: 'Lưu nháp', SUBMITTED: 'Trình duyệt', APPROVED: 'Ký duyệt', REJECTED: 'Từ chối', CANCELLED: 'Huỷ',
  CALCULATED: 'Tính lương', LOCKED: 'Khoá kỳ (2FA)', WITHDRAWN: 'Rút lại để sửa',
  PAID: 'Xác nhận chi trả & phát hành phiếu', BANK_EXPORTED: 'Xuất file ngân hàng',
};

const monthText = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const monthEndOf = (monthStart: string) => {
  const [year, month] = monthStart.split('-').map(Number);
  return `${monthStart.slice(0, 7)}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
};
const friendly = (error: string) => (error === REAUTH_REQUIRED
  ? 'Phiên ký đã quá hạn — nhập lại mật khẩu rồi ký lại.'
  : error);

export function PayrollApprovals({ data, canApprove, onChanged, onOpenRun }: PayrollApprovalsProps) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [view, setView] = useState<'pending' | 'history'>('pending');
  const [kind, setKind] = useState<Kind>('ALL');
  const [query, setQuery] = useState('');
  const [schemes, setSchemes] = useState<PayrollSchemeRequest[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [totals, setTotals] = useState<Map<string, RunTotals>>(new Map());
  const [events, setEvents] = useState<Record<string, PayrollApprovalEvent[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [action, setAction] = useState<{ type: 'SCHEME'; item: PayrollSchemeRequest; decision: Decision }
    | { type: 'RUN'; item: PayrollRun; decision: Decision } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [schemeRows, runRows] = await Promise.all([
      fetchSchemeRequests(['SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED']),
      fetchRunsForApproval(),
    ]);
    setSchemes(schemeRows);
    setRuns(runRows);
    setTotals(await fetchRunTotals(runRows.map((run) => run.id)));
    setEvents({});
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const nameOf = useMemo(() => {
    const byId = new Map(data.profiles.map((person) => [person.id, person.name]));
    return (id: string | null | undefined) => (id ? byId.get(id) ?? 'Người dùng đã nghỉ' : '—');
  }, [data.profiles]);
  const componentById = useMemo(() => new Map(data.components.map((c) => [c.id, c])), [data.components]);
  const formulaNameOf = useMemo(() => nameResolver(data.components, null), [data.components]);

  const targetOf = (request: PayrollSchemeRequest) => (request.target_type === 'USER'
    ? { name: nameOf(request.user_id), sub: data.profiles.find((p) => p.id === request.user_id)?.department ?? 'Nhân sự' }
    : { name: data.units.find((u) => u.id === request.unit_id)?.name ?? 'Đơn vị đã xoá', sub: 'Cơ chế chung của đơn vị' });

  const toggle = async (key: string, type: 'SCHEME' | 'RUN', id: string) => {
    setExpanded((current) => (current === key ? null : key));
    if (!events[id]) {
      const rows = await fetchApprovalEvents(type, [id]);
      setEvents((current) => ({ ...current, [id]: rows }));
    }
  };

  const keyword = stripVietnamese(query).toLowerCase().trim();
  const matches = (text: string) => !keyword || stripVietnamese(text).toLowerCase().includes(keyword);

  const pendingSchemes = schemes.filter((row) => row.status === 'SUBMITTED');
  const pendingRuns = runs.filter((run) => run.status === 'LOCKED');
  const shownSchemes = (view === 'pending' ? pendingSchemes : schemes.filter((row) => row.status !== 'SUBMITTED'))
    .filter(() => kind !== 'RUN')
    .filter((row) => matches(`${row.code} ${targetOf(row).name}`));
  const shownRuns = (view === 'pending' ? pendingRuns : runs.filter((run) => run.status !== 'LOCKED'))
    .filter(() => kind !== 'SCHEME')
    .filter((run) => matches(`ky luong ${monthText(run.month_start)}`));

  const decide = async (note: string): Promise<string | null> => {
    if (!action) return null;
    const approved = action.decision === 'APPROVED';
    if (action.type === 'SCHEME') {
      const error = await reviewSchemeRequest(action.item.id, action.decision, note || null);
      if (error) return friendly(error);
      const target = targetOf(action.item);
      const recipient = action.item.submitted_by ?? action.item.created_by;
      if (recipient) {
        await notifyUsers(
          [recipient],
          approved ? 'Cơ chế lương đã được duyệt' : 'Cơ chế lương bị từ chối',
          `${action.item.code} — ${target.name}, áp dụng từ ${monthText(action.item.effective_from)}.${note ? ` Ghi chú: ${note}` : ''}`,
          'payroll_scheme_reviewed',
        );
      }
      toast(approved ? `Đã duyệt ${action.item.code} — cơ chế áp dụng từ ${monthText(action.item.effective_from)}.` : `Đã từ chối ${action.item.code}.`, 'success');
    } else {
      const error = await reviewPayrollRun(action.item.id, action.decision, note || null);
      if (error) return friendly(error);
      const recipient = action.item.locked_by ?? action.item.calculated_by ?? action.item.created_by;
      if (recipient) {
        await notifyUsers(
          [recipient],
          approved ? `Bảng lương ${monthText(action.item.month_start)} đã được duyệt chi` : `Bảng lương ${monthText(action.item.month_start)} bị từ chối`,
          approved ? 'Có thể xuất file ngân hàng và xác nhận chi trả.' : `Lý do: ${note}. Kỳ đã trả về Đã tính để Kế toán điều chỉnh.`,
          'payroll_run_reviewed',
        );
      }
      toast(approved ? `Đã duyệt chi bảng lương ${monthText(action.item.month_start)}.` : 'Đã từ chối — kỳ trả về Kế toán.', 'success');
    }
    await load();
    onChanged();
    return null;
  };

  const pendingTotal = pendingSchemes.length + pendingRuns.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-none bg-slate-100 p-1">
          {([['pending', `Chờ duyệt`, ClipboardCheck], ['history', 'Lịch sử', History]] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={`inline-flex items-center gap-1.5 rounded-none px-3 py-1.5 text-sm font-semibold transition ${
                view === key ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
              {key === 'pending' && pendingTotal > 0 && (
                <span className="rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{pendingTotal}</span>
              )}
            </button>
          ))}
        </div>
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm theo mã đề xuất, tên nhân viên / đơn vị, tháng…"
            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>
        <div className="w-48">
          <Select aria-label="Loại hồ sơ" value={kind} onChange={(event) => setKind(event.target.value as Kind)}>
            <option value="ALL">Tất cả hồ sơ</option>
            <option value="SCHEME">Cơ chế lương</option>
            <option value="RUN">Kỳ lương</option>
          </Select>
        </div>
      </div>

      {!canApprove && view === 'pending' && pendingTotal > 0 && (
        <p className="rounded-none border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Bạn đang xem với quyền đọc. Chỉ người có chức năng <strong>Phê duyệt lương</strong> được ký.
        </p>
      )}

      {loading ? (
        <ApprovalListSkeleton />
      ) : shownSchemes.length === 0 && shownRuns.length === 0 ? (
        <Card className="!rounded-none">
          <CardContent>
            <p className="py-10 text-center text-sm text-slate-500">
              {view === 'pending' ? 'Không có hồ sơ nào chờ duyệt.' : 'Chưa có lịch sử phê duyệt.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {shownRuns.map((run) => {
            const key = `run-${run.id}`;
            const total = totals.get(run.id);
            const open = expanded === key;
            return (
              <Card className="!rounded-none" key={key}>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={() => void toggle(key, 'RUN', run.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                      <div className="min-w-0">
                        <p className="font-bold text-slate-800">Bảng lương tháng {monthText(run.month_start)}</p>
                        <p className="text-xs text-slate-500">
                          Khoá bởi {nameOf(run.locked_by)}{run.locked_at ? ` · ${formatDateTime(run.locked_at)}` : ''}
                          {run.approved_at && ` · Duyệt bởi ${nameOf(run.approved_by)} ${formatDateTime(run.approved_at)}`}
                        </p>
                      </div>
                    </button>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${run.status === 'LOCKED' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      {RUN_STATUS_TEXT[run.status]}
                    </span>
                  </div>
                  {total && (
                    <div className="grid gap-2 rounded-none bg-slate-50 p-3 text-xs sm:grid-cols-4">
                      <Stat label="Số phiếu" text={String(total.count)} />
                      <Stat label="Tổng các khoản cộng" text={formatVND(total.gross)} />
                      <Stat label="Tổng các khoản trừ" text={formatVND(total.deductions)} />
                      <Stat label="Tổng thực chi" text={formatVND(total.net)} strong />
                    </div>
                  )}
                  {open && <Timeline rows={events[run.id]} nameOf={nameOf} />}
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => onOpenRun(run.month_start)}>Xem bảng lương chi tiết</Button>
                    {run.status === 'LOCKED' && canApprove && (
                      <>
                        <Button size="sm" variant="danger" onClick={() => setAction({ type: 'RUN', item: run, decision: 'REJECTED' })}>
                          <XCircle className="h-4 w-4" /> Từ chối
                        </Button>
                        <Button size="sm" variant="success" onClick={() => setAction({ type: 'RUN', item: run, decision: 'APPROVED' })}>
                          <CheckCircle2 className="h-4 w-4" /> Ký duyệt chi
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {shownSchemes.map((request) => {
            const key = `scheme-${request.id}`;
            const target = targetOf(request);
            const open = expanded === key || view === 'pending';
            // Database miễn quy tắc "người trình không tự duyệt" cho Admin/CEO — giao diện khớp theo.
            const ownRequest = request.submitted_by === profile?.id && !isFullAdmin(profile);
            return (
              <Card className="!rounded-none" key={key}>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={() => void toggle(key, 'SCHEME', request.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      {expanded === key ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                      <div className="min-w-0">
                        <p className="font-bold text-slate-800">
                          {request.code} · Cơ chế lương {target.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {target.sub} · Áp dụng từ {monthText(request.effective_from)} · Trình bởi {nameOf(request.submitted_by)}
                          {request.submitted_at ? ` ${formatDateTime(request.submitted_at)}` : ''}
                        </p>
                      </div>
                    </button>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${SCHEME_STATUS_TONE[request.status]}`}>
                      {SCHEME_STATUS_LABEL[request.status]}
                    </span>
                  </div>
                  {request.note && <p className="text-xs text-slate-600"><strong>Căn cứ:</strong> {request.note}</p>}
                  {request.review_note && request.status !== 'SUBMITTED' && (
                    <p className="text-xs text-slate-600"><strong>Ý kiến người duyệt:</strong> {request.review_note}</p>
                  )}
                  {open && (
                    request.status === 'SUBMITTED'
                      ? <SchemeChanges request={request} data={data} componentById={componentById} />
                      : <PayloadList items={request.payload.items} componentById={componentById} nameOf={formulaNameOf} />
                  )}
                  {expanded === key && <Timeline rows={events[request.id]} nameOf={nameOf} />}
                  {request.status === 'SUBMITTED' && canApprove && (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {ownRequest && <span className="mr-auto text-xs text-slate-500">Bạn là người trình — người có quyền duyệt khác phải duyệt.</span>}
                      <Button size="sm" variant="danger" disabled={ownRequest} onClick={() => setAction({ type: 'SCHEME', item: request, decision: 'REJECTED' })}>
                        <XCircle className="h-4 w-4" /> Từ chối
                      </Button>
                      <Button size="sm" variant="success" disabled={ownRequest} onClick={() => setAction({ type: 'SCHEME', item: request, decision: 'APPROVED' })}>
                        <CheckCircle2 className="h-4 w-4" /> Ký duyệt
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ReauthDialog
        open={!!action}
        title={action?.decision === 'APPROVED' ? 'Ký duyệt' : 'Từ chối'}
        tone={action?.decision === 'APPROVED' ? 'success' : 'danger'}
        confirmLabel={action?.decision === 'APPROVED' ? 'Ký duyệt' : 'Từ chối'}
        description={action ? (
          action.type === 'RUN'
            ? (action.decision === 'APPROVED'
              ? <>Ký duyệt chi bảng lương tháng <strong>{monthText(action.item.month_start)}</strong> — tổng thực chi <strong>{formatVND(totals.get(action.item.id)?.net ?? 0)}</strong>. Sau khi duyệt, số liệu kỳ này không sửa được nữa.</>
              : <>Từ chối bảng lương tháng <strong>{monthText(action.item.month_start)}</strong>. Kỳ sẽ trả về Kế toán để điều chỉnh và khoá lại.</>)
            : (action.decision === 'APPROVED'
              ? <>Ký duyệt <strong>{action.item.code}</strong> — cơ chế lương của <strong>{targetOf(action.item).name}</strong> sẽ áp dụng từ tháng {monthText(action.item.effective_from)}.</>
              : <>Từ chối <strong>{action.item.code}</strong>. Đề xuất trả về người trình kèm lý do của bạn.</>)
        ) : null}
        note={action?.decision === 'REJECTED'
          ? { label: 'Lý do từ chối', required: true, placeholder: 'Ghi rõ cần sửa gì' }
          : { label: 'Ghi chú (không bắt buộc)', required: false }}
        onClose={() => setAction(null)}
        onConfirmed={decide}
      />
    </div>
  );
}

function Stat({ label, text, strong = false }: { label: string; text: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`tabular-nums ${strong ? 'text-sm font-black text-indigo-700' : 'font-bold text-slate-700'}`}>{text}</p>
    </div>
  );
}

function itemText(item: SchemePayloadItem | null, nameOf: (code: string) => string | undefined): string {
  if (!item) return '—';
  if (item.formula?.trim()) return describeFormula(item.formula.trim(), nameOf);
  if (item.amount == null) return 'theo mức chung';
  return formatFormulaNumber(item.amount);
}

function PayloadList({ items, componentById, nameOf }: {
  items: SchemePayloadItem[]; componentById: Map<string, PayComponent>; nameOf: (code: string) => string | undefined;
}) {
  if (items.length === 0) return <p className="text-xs text-slate-500">Không có giá trị khai riêng.</p>;
  return (
    <ul className="divide-y divide-slate-100 rounded-none border border-slate-200 text-xs">
      {items.map((item) => (
        <li key={item.component_id} className="flex items-center gap-2 px-3 py-1.5">
          <span className="font-semibold text-slate-700">{componentById.get(item.component_id)?.name ?? '?'}</span>
          <span className="ml-auto text-slate-500">{itemText(item, nameOf)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Phần THAY ĐỔI so với cơ chế đang áp ở tháng hiệu lực — thứ BGĐ ký. */
function SchemeChanges({ request, data, componentById }: {
  request: PayrollSchemeRequest;
  data: PayrollWorkspace;
  componentById: Map<string, PayComponent>;
}) {
  const month = request.effective_from;
  const monthEnd = monthEndOf(month);
  const version = versionForMonth(data.paramVersions, month);
  const nameOf = nameResolver(data.components, null);
  const before = request.target_type === 'USER' && request.user_id
    ? personalItemsAt(data.items, request.user_id, month, monthEnd)
    : request.unit_id ? unitItemsAt(data.unitItems, request.unit_id, month, monthEnd) : [];
  const changes = diffSchemeItems(before, request.payload.items).filter((change) => change.kind !== 'SAME');

  // Kiểm tra mức sàn của bộ tham số (nếu có khai), để BGĐ thấy trước khi ký.
  const floorComponent = version?.floorComponentCode ? data.components.find((item) => item.code === version.floorComponentCode) : undefined;
  const floorParam = version?.floorParamCode ? paramsOf(version).find((item) => item.code === version.floorParamCode) : undefined;
  const floorValue = floorComponent ? request.payload.items.find((item) => item.component_id === floorComponent.id)?.amount ?? null : null;

  return (
    <div className="space-y-2">
      {changes.length === 0 ? (
        <p className="text-xs text-slate-500">Không đổi gì so với cơ chế hiện hành.</p>
      ) : (
        <div className="overflow-x-auto rounded-none border border-slate-200">
          <table className="w-full min-w-[480px] text-xs">
            <thead>
              <tr className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wider text-black">
                <th className="px-3 py-1.5">Nội dung</th>
                <th className="px-3 py-1.5">Hiện hành</th>
                <th className="px-3 py-1.5">Đề xuất</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {changes.map((change) => {
                const component = componentById.get(change.componentId);
                return (
                  <tr key={change.componentId}>
                    <td className="px-3 py-1.5 font-semibold text-slate-700">
                      {component?.name ?? '?'}
                      <span className={`ml-1.5 rounded px-1 py-0.5 text-[9px] font-bold ${
                        change.kind === 'ADDED' ? 'bg-emerald-50 text-emerald-700' : change.kind === 'REMOVED' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
                      }`}>
                        {change.kind === 'ADDED' ? 'MỚI' : change.kind === 'REMOVED' ? 'BỎ' : 'ĐỔI'}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-slate-500">{itemText(change.before, nameOf)}</td>
                    <td className="px-3 py-1.5 font-semibold text-slate-800">{itemText(change.after, nameOf)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {floorComponent && floorParam && floorValue != null && (
        <p className={`text-xs ${floorValue < floorParam.value ? 'font-semibold text-red-600' : 'text-slate-500'}`}>
          {floorComponent.name} đề xuất {formatVND(floorValue)} · {floorParam.name}: {formatVND(floorParam.value)}
        </p>
      )}
    </div>
  );
}

export function Timeline({ rows, nameOf }: { rows: PayrollApprovalEvent[] | undefined; nameOf: (id: string | null) => string }) {
  if (!rows) {
    return (
      <div className="space-y-2 border-l-2 border-slate-100 pl-3" role="status" aria-busy="true">
        <span className="sr-only">Đang tải lịch sử…</span>
        <Skeleton className="h-3.5 w-3/4 !rounded-md" />
        <Skeleton className="h-3.5 w-1/2 !rounded-md" />
      </div>
    );
  }
  if (rows.length === 0) return <p className="text-xs text-slate-400">Chưa có lịch sử.</p>;
  return (
    <ol className="space-y-1.5 border-l-2 border-slate-100 pl-3 text-xs">
      {rows.map((row) => (
        <li key={row.id}>
          <span className="font-semibold text-slate-700">{PAYROLL_EVENT_TEXT[row.action] ?? row.action}</span>
          <span className="text-slate-500"> · {row.actor_name ?? nameOf(row.actor_id)} · {formatDateTime(row.created_at)}</span>
          {row.note && <span className="block text-slate-600">“{row.note}”</span>}
        </li>
      ))}
    </ol>
  );
}
