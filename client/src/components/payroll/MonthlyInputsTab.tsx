// ============================================================================
// Số liệu biến động theo tháng.
// ----------------------------------------------------------------------------
// Giờ tăng ca, sản lượng khoán, doanh số — những con số đổi mỗi tháng và không
// suy ra được từ chấm công. Chúng trở thành BIẾN trong công thức lương, nên
// nhập ở đây là đủ để cả loạt khoản tự tính lại.
//
// Lưới nhập cố ý để trống thay vì điền 0: ô trống nghĩa là "chưa nhập", khác
// hẳn với "tháng này thực sự bằng 0" — và người nhập cần phân biệt được.
// ============================================================================

import { useMemo, useState } from 'react';
import { Save, SlidersHorizontal } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { useToast } from '@/contexts/ToastContext';
import { savePayrollInput } from '@/lib/payrollData';
import type { EmployeePayItem, PayComponent, PayrollInput, Profile, UnitPayItem } from '@/types';

interface MonthlyInputsTabProps {
  profiles: Profile[];
  components: PayComponent[];
  employeeItems: EmployeePayItem[];
  unitItems: UnitPayItem[];
  inputs: PayrollInput[];
  monthStart: string;
  actorId: string | null;
  /** Kỳ đã duyệt thì khóa nhập — số liệu đã đóng băng vào phiếu lương. */
  readOnly: boolean;
  onChanged: () => void;
}

export function MonthlyInputsTab({
  profiles, components, employeeItems, unitItems, inputs, monthStart, actorId, readOnly, onChanged,
}: MonthlyInputsTabProps) {
  const { toast } = useToast();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Chỉ hiện cột cho mã thực sự được khoản nào đó dùng tới. Bảng nhập liệu mà
  // có cột không ai dùng thì người nhập sẽ đoán và điền bừa.
  const codes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const component of components) {
      if (!component.is_active || !component.input_code) continue;
      if (!seen.has(component.input_code)) seen.set(component.input_code, component.name);
    }
    // Công thức cũng tham chiếu mã số liệu mà không khai báo input_code
    // (ví dụ REVENUE trong công thức hoa hồng), nên quét thêm từ công thức.
    for (const component of components) {
      if (!component.is_active) continue;
      const source = `${component.formula ?? ''} ${component.base_code ?? ''}`;
      for (const token of source.match(/[A-Z][A-Z0-9_]*/g) ?? []) {
        if (RESERVED.has(token)) continue;
        if (components.some((item) => item.code === token)) continue;
        if (!seen.has(token)) seen.set(token, component.name);
      }
    }
    // Công thức gán riêng ở nhân viên/phòng ban có thể biến một khoản cố định
    // thành khoản theo KPI, doanh số... Các biến đó cũng phải tự tạo cột nhập
    // liệu; nếu chỉ quét công thức chung trong danh mục thì công thức riêng lưu
    // được nhưng không có nơi nhập số liệu để chạy.
    const assigned = [...employeeItems, ...unitItems];
    for (const item of assigned) {
      const source = item.formula ?? '';
      const component = components.find((entry) => entry.id === item.component_id);
      for (const token of source.match(/[A-Z][A-Z0-9_]*/g) ?? []) {
        if (RESERVED.has(token)) continue;
        if (components.some((entry) => entry.code === token)) continue;
        if (!seen.has(token)) seen.set(token, component?.name ?? 'Công thức riêng');
      }
    }
    return [...seen.entries()].map(([code, usedBy]) => ({ code, usedBy }));
  }, [components, employeeItems, unitItems]);

  const valueOf = (userId: string, code: string): string => {
    const key = `${userId}|${code}`;
    if (edits[key] !== undefined) return edits[key];
    const existing = inputs.find((input) => input.user_id === userId && input.code === code);
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
        quantity: Number(raw) || 0,
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

  if (codes.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <SlidersHorizontal className="mx-auto h-10 w-10 text-slate-300" />
          <h3 className="mt-3 text-base font-bold text-slate-800">Chưa có mã số liệu nào</h3>
          <p className="mx-auto mt-1.5 max-w-lg text-sm leading-relaxed text-slate-500">
            Số liệu tháng chỉ hiện ra khi có khoản lương dùng tới. Sang tab{' '}
            <strong>Danh mục khoản</strong> tạo khoản tính theo giờ, theo sản lượng hoặc theo công
            thức có biến đầu vào.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Tiêu đề do trang in, xem ghi chú trong ComponentCatalog. */}
        <p className="max-w-2xl text-xs leading-relaxed text-slate-400">
          Giờ tăng ca, sản lượng, doanh số — đầu vào cho công thức lương của tháng này.
        </p>
        {!readOnly && (
          <Button onClick={handleSave} disabled={saving || dirtyCount === 0}>
            <Save className="h-4 w-4" />
            {saving ? 'Đang lưu…' : dirtyCount > 0 ? `Lưu ${dirtyCount} thay đổi` : 'Chưa có thay đổi'}
          </Button>
        )}
      </div>

      {readOnly && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Kỳ lương đã duyệt nên số liệu khóa lại. Mở lại kỳ ở tab Bảng lương nếu cần sửa.
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
                  {codes.map(({ code, usedBy }) => (
                    <th key={code} className="px-3 py-4 text-center" title={`Dùng bởi: ${usedBy}`}>
                      <span className="block font-mono text-[10px] font-bold text-slate-600">{code}</span>
                      <span className="mt-0.5 block text-[9px] font-medium normal-case text-slate-400">
                        {usedBy}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {profiles.map((person) => (
                  <tr key={person.id} className="hover:bg-[#FCFAF8]">
                    <td className="sticky left-0 z-10 bg-white px-5 py-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar name={person.name} url={person.avatar_url} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-800">{person.name}</p>
                          <p className="text-[10px] uppercase tracking-tighter text-slate-400">
                            {person.department || '—'}
                          </p>
                        </div>
                      </div>
                    </td>
                    {codes.map(({ code }) => (
                      <td key={code} className="px-2 py-3 text-center">
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={readOnly}
                          value={valueOf(person.id, code)}
                          onChange={(event) => setEdits((current) => ({
                            ...current,
                            [`${person.id}|${code}`]: event.target.value.replace(/[^\d.]/g, ''),
                          }))}
                          placeholder="—"
                          className="h-9 w-24 rounded-lg border border-slate-200 px-2 text-center text-sm tabular-nums text-slate-800 transition-colors placeholder:text-slate-300 focus:border-indigo-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** Biến do engine cung cấp — không phải số liệu người dùng nhập. */
const RESERVED = new Set([
  'BASE', 'BASE_WORK', 'BASE_LEAVE', 'BASE_HOLIDAY', 'GROSS', 'MUC_RIENG',
  'HOURLY_RATE', 'DAILY_RATE', 'MONTHLY_RATE', 'WORK_DAYS', 'LEAVE_DAYS', 'HOLIDAY_DAYS',
  'PAID_DAYS', 'STANDARD_DAYS', 'WORK_HOURS', 'HOURS_PER_DAY', 'DEPENDENTS', 'INSURANCE_BASE',
  'LATE_MINUTES', 'LATE_COUNT', 'LATE_AFTER_CUTOFF', 'EARLY_MINUTES', 'EARLY_COUNT',
  'INSURANCE_EMPLOYEE', 'PIT', 'TAXABLE_INCOME',
  'MIN', 'MAX', 'ROUND', 'FLOOR', 'CEIL', 'ABS', 'IF',
]);
