// ============================================================================
// Số liệu lương tháng — nhập hệ số thay đổi mỗi tháng, thấy lương ngay.
// ----------------------------------------------------------------------------
// Một bảng duy nhất: mỗi người một hàng, mỗi hệ số thay đổi (doanh số, số
// chuyến…) một cột, cuối hàng là lương thực nhận nếu đi đủ công chuẩn theo số
// đang gõ. Danh sách đã lọc sẵn những người có hệ số cần nhập; cơ chế chỉ
// quyết định hệ số nào cần nhập cho ai.
//
// Giả định "đủ công" để kế toán thấy ngay mỗi người sẽ nhận bao nhiêu khi số
// liệu đã đủ; công thực tế và điều chỉnh tính ở Bảng lương.
//
// Ô để trống thay vì điền 0: trống là "chưa nhập", khác hẳn "tháng này bằng 0".
// ============================================================================

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calculator, Save, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { fullMonthStats } from '@/components/payroll/schemeWorkbench';
import { useToast } from '@/contexts/ToastContext';
import { useAppSettings } from '@/contexts/SettingsContext';
import { savePayrollInput, type PayrollWorkspace } from '@/lib/payrollData';
import { resolveMechanismRows } from '@/lib/payrollScheme';
import { computeForPerson, paramsForMonth, schemeSourceOf } from '@/lib/payrollRun';
import type { PayrollParams } from '@/lib/payrollSettings';
import { SYSTEM_VARIABLE_BY_CODE } from '@/lib/payrollVariables';
import { stripVietnamese } from '@/lib/tableExport';
import { formatVND } from '@/lib/utils';
import type { Profile } from '@/types';

interface MonthlyInputsTabProps {
  data: PayrollWorkspace;
  monthStart: string;
  monthEnd: string;
  actorId: string | null;
  /** Kỳ đã khoá thì khóa nhập — số liệu đã đóng băng vào phiếu lương. */
  readOnly: boolean;
  /** Người cần làm nổi (vừa mở từ trang cơ chế). */
  focusUserId?: string | null;
  onChanged: () => void;
}

interface Column {
  code: string;
  name: string;
}

/** Số liệu do hệ thống tự đẩy sang, không nhập tay ở đây. */
const AUTO_CODES = new Set(['KPI_PCT']);

const parseQuantity = (raw: string) => Number(raw.replace(',', '.')) || 0;

/**
 * Lương thực nhận của một người nếu đi đủ công chuẩn, theo số đang gõ — chỉ
 * tính lại khi số của chính người đó đổi. Ra 0 hoặc thiếu đầu vào thì nói rõ
 * vì sao (thiếu giá trị "Từng người", chưa có công chuẩn, chưa nhập hệ số) chứ
 * không để một con số trơ trọi.
 */
const NetCell = memo(function NetCell({ person, data, params, monthStart, monthEnd, typed, needed, nameOfCode, onFix }: {
  person: Profile;
  /** Dữ liệu đã bỏ điều chỉnh — con số này là dự tính theo cơ chế, không phải số chốt. */
  data: PayrollWorkspace;
  params: PayrollParams | null;
  monthStart: string;
  monthEnd: string;
  typed: Record<string, number>;
  needed: ReadonlySet<string>;
  nameOfCode: (code: string) => string;
  onFix: () => void;
}) {
  const result = useMemo(() => {
    if (!params) return null;
    try {
      return computeForPerson(person, data, params, new Date(`${monthStart}T00:00:00`), monthStart, monthEnd, {
        inputsOverride: typed,
        statsOverride: fullMonthStats(params),
      });
    } catch {
      return null;
    }
  }, [data, monthEnd, monthStart, params, person, typed]);
  if (!result) return <span className="text-slate-300">—</span>;
  const fix = (text: string, title?: string) => (
    <button
      type="button"
      onClick={onFix}
      title={title ?? 'Mở cơ chế lương của người này'}
      className="text-right text-[11px] font-semibold text-red-600 underline decoration-dotted hover:text-red-700"
    >
      {text}
    </button>
  );
  if (!result.hasScheme) return fix('Chưa có cơ chế');
  const missing = result.rows.filter((row) => row.mode === 'PER_PERSON' && row.amount == null);
  const pending = [...needed].filter((code) => !AUTO_CODES.has(code) && result.inputs[code] == null);
  const net = result.computed.netPay;
  const hints: React.ReactNode[] = [];
  if (missing.length > 0) {
    hints.push(fix(
      `Chưa khai: ${missing.slice(0, 2).map((row) => row.component.name).join(', ')}${missing.length > 2 ? '…' : ''}`,
      'Giá trị "Từng người" còn thiếu — bấm để khai ở cơ chế lương của người này',
    ));
  }
  if (params && !(params.standardDays > 0)) {
    hints.push(<span key="std" className="text-[11px] font-semibold text-amber-700">Chưa có công chuẩn (Tham số lương → Thiết lập chung)</span>);
  }
  if (pending.length > 0) {
    hints.push(
      <span key="pending" className="text-[11px] font-semibold text-amber-700">
        Chưa nhập: {pending.slice(0, 2).map(nameOfCode).join(', ')}{pending.length > 2 ? '…' : ''}
      </span>,
    );
  }
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span
        title={result.computed.warnings.join(' · ') || undefined}
        className={`font-bold tabular-nums ${result.computed.warnings.length > 0 ? 'text-amber-600' : 'text-slate-900'}`}
      >
        {formatVND(net)}
      </span>
      {hints}
    </span>
  );
});

export function MonthlyInputsTab({ data, monthStart, monthEnd, actorId, readOnly, focusUserId, onChanged }: MonthlyInputsTabProps) {
  const { toast } = useToast();
  const app = useAppSettings();
  const navigate = useNavigate();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [onlyNeeded, setOnlyNeeded] = useState(true);
  const focusRef = useRef<HTMLTableRowElement | null>(null);

  const source = useMemo(() => schemeSourceOf(data), [data]);
  const params = useMemo(
    () => paramsForMonth(data, app, new Date(`${monthStart}T00:00:00`), monthStart),
    [app, data, monthStart],
  );
  // Điều chỉnh là việc của kỳ chốt; ở đây chỉ cho thấy lương theo cơ chế.
  const projection = useMemo(() => ({ ...data, adjustments: [] }), [data]);

  /** Mã hệ số thay đổi theo tháng của từng người, theo cơ chế đang áp. */
  const neededByPerson = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const person of data.profiles) {
      const rows = resolveMechanismRows(person, source, monthStart, monthEnd);
      map.set(person.id, new Set(rows.filter((row) => row.mode === 'MONTHLY_INPUT').map((row) => row.component.code)));
    }
    return map;
  }, [data.profiles, monthEnd, monthStart, source]);

  const componentByCode = useMemo(() => new Map(data.components.map((c) => [c.code, c])), [data.components]);
  const nameOfCode = (code: string) => componentByCode.get(code)?.name ?? SYSTEM_VARIABLE_BY_CODE.get(code)?.name ?? code;

  /** Số đã nhập tháng này của từng người (không gồm số hệ thống tự đẩy). */
  const enteredByPerson = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const input of data.inputs) {
      if (AUTO_CODES.has(input.code)) continue;
      if (!map.has(input.user_id)) map.set(input.user_id, new Set());
      map.get(input.user_id)?.add(input.code);
    }
    return map;
  }, [data.inputs]);

  const valueOf = (userId: string, code: string): string => {
    const key = `${userId}|${code}`;
    if (edits[key] !== undefined) return edits[key];
    const existing = data.inputs.find((input) => input.user_id === userId && input.code === code);
    return existing ? String(Number(existing.quantity)) : '';
  };

  const people = useMemo(() => {
    const keyword = stripVietnamese(query).toLowerCase().trim();
    let list = data.profiles;
    if (keyword) {
      list = list.filter((person) => stripVietnamese(`${person.name} ${person.employee_code ?? ''}`).toLowerCase().includes(keyword));
    }
    if (onlyNeeded) {
      list = list.filter((person) => person.id === focusUserId
        || (neededByPerson.get(person.id)?.size ?? 0) > 0
        || (enteredByPerson.get(person.id)?.size ?? 0) > 0);
    }
    return list;
  }, [data.profiles, enteredByPerson, focusUserId, neededByPerson, onlyNeeded, query]);

  useEffect(() => { focusRef.current?.scrollIntoView({ block: 'center' }); }, [focusUserId, people.length]);

  /** Cột của bảng: mọi hệ số mà ít nhất một người đang xem cần hoặc đã nhập. */
  const columns: Column[] = useMemo(() => {
    const codes = new Set<string>();
    for (const person of people) {
      for (const code of neededByPerson.get(person.id) ?? []) codes.add(code);
      for (const code of enteredByPerson.get(person.id) ?? []) codes.add(code);
    }
    return [...codes]
      .sort((a, b) => (componentByCode.get(a)?.sort_order ?? 1e6) - (componentByCode.get(b)?.sort_order ?? 1e6) || a.localeCompare(b))
      .map((code) => ({ code, name: nameOfCode(code) }));
  }, [componentByCode, enteredByPerson, neededByPerson, people]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Số đang gõ của từng người — ổn định theo nội dung để NetCell không tính lại vô ích. */
  const typedCache = useRef(new Map<string, { key: string; value: Record<string, number> }>());
  const typedOf = (userId: string): Record<string, number> => {
    const entries = Object.entries(edits).filter(([key]) => key.startsWith(`${userId}|`));
    const value: Record<string, number> = {};
    for (const [key, raw] of entries) value[key.split('|')[1]] = parseQuantity(raw);
    const key = JSON.stringify(value);
    const cached = typedCache.current.get(userId);
    if (cached && cached.key === key) return cached.value;
    typedCache.current.set(userId, { key, value });
    return value;
  };

  const dirtyCount = Object.keys(edits).length;

  const handleSave = async () => {
    setSaving(true);
    for (const [key, raw] of Object.entries(edits)) {
      const [userId, code] = key.split('|');
      const error = await savePayrollInput({
        user_id: userId,
        month_start: monthStart,
        code,
        quantity: parseQuantity(raw),
        created_by: actorId,
      });
      if (error) {
        setSaving(false);
        toast('Lưu số liệu thất bại: ' + error, 'error');
        return;
      }
    }
    setSaving(false);
    setEdits({});
    toast(`Đã lưu ${dirtyCount} ô số liệu.`, 'success');
    onChanged();
  };

  return (
    <div className="space-y-4">
      {readOnly && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Kỳ lương tháng này đã khoá nên số liệu khóa lại. Kỳ đang chờ duyệt thì rút lại ở Bảng lương để sửa;
          kỳ đã duyệt thì ghi sai sót vào Điều chỉnh lương của kỳ sau.
        </p>
      )}

      <Card className="min-w-0">
        <CardHeader className="flex flex-wrap items-center gap-3">
          <CardTitle className="min-w-0 flex-1 truncate">
            {onlyNeeded ? 'Nhân sự cần nhập số liệu' : 'Toàn bộ nhân sự'}
            <span className="ml-2 text-sm font-medium text-slate-400">{people.length} người</span>
          </CardTitle>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm nhân viên theo tên / mã..."
              className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50/60 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" checked={onlyNeeded} onChange={(event) => setOnlyNeeded(event.target.checked)} />
            Chỉ người cần nhập
          </label>
          <Button variant="outline" size="sm" onClick={() => navigate(`/admin/payroll?month=${monthStart.slice(0, 7)}`)}>
            <Calculator className="h-4 w-4" /> Tính bảng lương
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {people.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
              {query.trim()
                ? 'Không tìm thấy nhân sự phù hợp.'
                : onlyNeeded ? 'Không có nhân sự nào cần nhập hệ số trong tháng này.' : 'Không có nhân sự nào.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 320 + columns.length * 140 }}>
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <th className="py-2 pr-3">Nhân viên</th>
                    {columns.map((column) => (
                      <th key={column.code} className="py-2 pr-3 text-right normal-case tracking-normal">{column.name}</th>
                    ))}
                    <th className="py-2 text-right">Lương thực nhận (đủ công)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {people.map((row) => {
                    const needed = neededByPerson.get(row.id) ?? new Set<string>();
                    const entered = enteredByPerson.get(row.id) ?? new Set<string>();
                    return (
                      <tr
                        key={row.id}
                        ref={row.id === focusUserId ? focusRef : undefined}
                        className={row.id === focusUserId ? 'bg-indigo-50/60' : ''}
                      >
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2">
                            <Avatar name={row.name} url={row.avatar_url} size="sm" />
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-slate-800">{row.name}</p>
                              <p className="truncate text-[11px] text-slate-400">{row.employee_code ?? '—'} · {row.department || '—'}</p>
                            </div>
                          </div>
                        </td>
                        {columns.map((column) => {
                          const applies = needed.has(column.code) || entered.has(column.code);
                          return (
                            <td key={column.code} className="py-1.5 pr-3 text-right">
                              {applies ? (
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  disabled={readOnly}
                                  value={valueOf(row.id, column.code)}
                                  onChange={(event) => setEdits((current) => ({
                                    ...current,
                                    [`${row.id}|${column.code}`]: event.target.value.replace(/[^\d.,]/g, ''),
                                  }))}
                                  placeholder="Chưa nhập"
                                  aria-label={`${column.name} của ${row.name}`}
                                  className="h-9 w-32 rounded-lg border border-slate-200 px-2.5 text-right text-sm tabular-nums text-slate-800 transition-colors placeholder:text-slate-300 focus:border-indigo-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
                                />
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="py-2 text-right">
                          <NetCell
                            person={row}
                            data={projection}
                            params={params}
                            monthStart={monthStart}
                            monthEnd={monthEnd}
                            typed={typedOf(row.id)}
                            needed={needed}
                            nameOfCode={nameOfCode}
                            onFix={() => navigate(`/admin/payroll/schemes?month=${monthStart.slice(0, 7)}&user=${row.id}`)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-slate-500">
            Lương thực nhận tính như thể người đó đi đủ công chuẩn của tháng, theo số liệu đã nhập và số đang gõ;
            chưa gồm điều chỉnh. Công thực tế và điều chỉnh tính ở Bảng lương. Ô trống = chưa nhập.
          </p>
        </CardContent>
      </Card>

      {!readOnly && dirtyCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur-md print:hidden">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 lg:pl-64">
            <p className="flex items-center gap-1.5 text-sm text-slate-600">
              <Save className="h-4 w-4" /> {dirtyCount} ô chưa lưu
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setEdits({})} disabled={saving}>Huỷ thay đổi</Button>
              <Button onClick={() => void handleSave()} disabled={saving}>
                <Save className="h-4 w-4" /> {saving ? 'Đang lưu…' : `Lưu ${dirtyCount} thay đổi`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
