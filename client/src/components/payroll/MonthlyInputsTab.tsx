// ============================================================================
// Số liệu lương tháng — con số nhập mỗi tháng cho các dòng "Hằng tháng".
// ----------------------------------------------------------------------------
// Cột là các đầu mục mà cơ chế lương khai cách lấy "Hằng tháng" (doanh số, số
// chuyến…). Ô của người không theo cơ chế có dòng đó thì khoá, để người nhập
// không điền nhầm chỗ không ai dùng tới.
//
// Ô để trống thay vì điền 0: trống là "chưa nhập", khác hẳn "tháng này bằng
// 0" — và người nhập cần phân biệt được.
// ============================================================================

import { useMemo, useState } from 'react';
import { Save, Search, SlidersHorizontal } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { useToast } from '@/contexts/ToastContext';
import { savePayrollInput, type PayrollWorkspace } from '@/lib/payrollData';
import { payProfileForPeriod } from '@/lib/payroll';
import { resolveMechanismRows } from '@/lib/payrollScheme';
import { schemeSourceOf } from '@/lib/payrollRun';
import { SYSTEM_VARIABLE_BY_CODE } from '@/lib/payrollVariables';
import { stripVietnamese } from '@/lib/tableExport';

interface MonthlyInputsTabProps {
  data: PayrollWorkspace;
  monthStart: string;
  monthEnd: string;
  actorId: string | null;
  /** Kỳ đã khoá thì khóa nhập — số liệu đã đóng băng vào phiếu lương. */
  readOnly: boolean;
  onChanged: () => void;
}

interface Column {
  code: string;
  name: string;
  /** Cột của dòng "Hằng tháng" — chỉ người có dòng đó mới nhập. */
  mechanism: boolean;
}

/** Số liệu do hệ thống tự đẩy sang, không nhập tay ở đây. */
const AUTO_CODES = new Set(['KPI_PCT']);

export function MonthlyInputsTab({ data, monthStart, monthEnd, actorId, readOnly, onChanged }: MonthlyInputsTabProps) {
  const { toast } = useToast();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [onlyNeeded, setOnlyNeeded] = useState(true);

  const source = useMemo(() => schemeSourceOf(data), [data]);

  /** Mã "Hằng tháng" của từng người theo cơ chế đang áp. */
  const neededByPerson = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const person of data.profiles) {
      const profile = payProfileForPeriod(data.payProfiles.filter((row) => row.user_id === person.id), monthEnd);
      const rows = resolveMechanismRows(person, profile, source, monthStart, monthEnd);
      map.set(person.id, new Set(rows.filter((row) => row.mode === 'MONTHLY_INPUT').map((row) => row.component.code)));
    }
    return map;
  }, [data.payProfiles, data.profiles, monthEnd, monthStart, source]);

  const columns = useMemo<Column[]>(() => {
    const componentByCode = new Map(data.components.map((component) => [component.code, component]));
    const used = new Set<string>();
    for (const codes of neededByPerson.values()) for (const code of codes) used.add(code);
    const list: Column[] = [...used]
      .map((code) => ({ code, name: componentByCode.get(code)?.name ?? code, mechanism: true }))
      .sort((a, b) => (componentByCode.get(a.code)?.sort_order ?? 0) - (componentByCode.get(b.code)?.sort_order ?? 0));
    // Số đã nhập từ trước cho mã không còn dòng "Hằng tháng" nào: vẫn hiện để
    // xem / sửa, không để số liệu nằm đó mà không ai thấy.
    for (const input of data.inputs) {
      if (used.has(input.code) || AUTO_CODES.has(input.code) || list.some((column) => column.code === input.code)) continue;
      list.push({
        code: input.code,
        name: componentByCode.get(input.code)?.name ?? SYSTEM_VARIABLE_BY_CODE.get(input.code)?.name ?? input.code,
        mechanism: false,
      });
    }
    return list;
  }, [data.components, data.inputs, neededByPerson]);

  const keyword = stripVietnamese(query).toLowerCase().trim();
  const people = data.profiles.filter((person) => {
    if (keyword && !stripVietnamese(`${person.name} ${person.employee_code ?? ''}`).toLowerCase().includes(keyword)) return false;
    if (onlyNeeded && (neededByPerson.get(person.id)?.size ?? 0) === 0
      && !data.inputs.some((input) => input.user_id === person.id && !AUTO_CODES.has(input.code))) return false;
    return true;
  });

  const valueOf = (userId: string, code: string): string => {
    const key = `${userId}|${code}`;
    if (edits[key] !== undefined) return edits[key];
    const existing = data.inputs.find((input) => input.user_id === userId && input.code === code);
    return existing ? String(Number(existing.quantity)) : '';
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
        quantity: Number(raw.replace(',', '.')) || 0,
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

  if (columns.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <SlidersHorizontal className="mx-auto h-10 w-10 text-slate-300" />
          <h3 className="mt-3 text-base font-bold text-slate-800">Chưa có số liệu nào cần nhập hằng tháng</h3>
          <p className="mx-auto mt-1.5 max-w-lg text-sm leading-relaxed text-slate-500">
            Cột ở đây là các dòng có cách lấy giá trị <strong>Thay đổi theo tháng</strong> trong cơ chế lương (ví dụ Doanh số, Số
            chuyến). Khai ở <strong>Cơ chế lương › Thiết kế cơ chế</strong>.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm nhân viên…"
              className="h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-indigo-500"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" checked={onlyNeeded} onChange={(event) => setOnlyNeeded(event.target.checked)} />
            Chỉ người cần nhập
          </label>
        </div>
        {!readOnly && (
          <Button onClick={() => void handleSave()} disabled={saving || dirtyCount === 0}>
            <Save className="h-4 w-4" />
            {saving ? 'Đang lưu…' : dirtyCount > 0 ? `Lưu ${dirtyCount} thay đổi` : 'Chưa có thay đổi'}
          </Button>
        )}
      </div>

      {readOnly && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Kỳ lương tháng này đã khoá nên số liệu khóa lại. Kỳ đang chờ BGĐ duyệt thì rút lại ở tab
          Bảng lương để sửa; kỳ đã duyệt thì ghi sai sót vào Điều chỉnh lương của kỳ sau.
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-[#FCFAF8]">
                  <th className="sticky left-0 z-10 bg-[#FCFAF8] px-5 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Nhân sự
                  </th>
                  {columns.map((column) => (
                    <th key={column.code} className="px-3 py-4 text-center" title={column.mechanism ? 'Dòng “Thay đổi theo tháng” của cơ chế' : 'Số đã nhập trước đây'}>
                      <span className="block text-xs font-bold text-slate-700">{column.name}</span>
                      {!column.mechanism && <span className="mt-0.5 block text-[9px] font-medium text-amber-600">không còn dòng nào dùng</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {people.map((person) => {
                  const needed = neededByPerson.get(person.id) ?? new Set<string>();
                  return (
                    <tr key={person.id} className="hover:bg-[#FCFAF8]">
                      <td className="sticky left-0 z-10 bg-white px-5 py-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Avatar name={person.name} url={person.avatar_url} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-800">{person.name}</p>
                            <p className="text-[10px] uppercase tracking-tighter text-slate-400">{person.department || '—'}</p>
                          </div>
                        </div>
                      </td>
                      {columns.map((column) => {
                        const applies = !column.mechanism || needed.has(column.code);
                        const value = valueOf(person.id, column.code);
                        return (
                          <td key={column.code} className="px-2 py-3 text-center">
                            {applies || value ? (
                              <input
                                type="text"
                                inputMode="decimal"
                                disabled={readOnly}
                                value={value}
                                onChange={(event) => setEdits((current) => ({
                                  ...current,
                                  [`${person.id}|${column.code}`]: event.target.value.replace(/[^\d.,]/g, ''),
                                }))}
                                placeholder="—"
                                aria-label={`${column.name} của ${person.name}`}
                                className="h-9 w-28 rounded-lg border border-slate-200 px-2 text-center text-sm tabular-nums text-slate-800 transition-colors placeholder:text-slate-300 focus:border-indigo-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
                              />
                            ) : (
                              <span className="text-xs text-slate-300" title="Cơ chế của người này không có dòng này">·</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {people.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-500">Không có nhân sự nào cần nhập.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
