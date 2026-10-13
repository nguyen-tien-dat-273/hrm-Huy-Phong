// ============================================================================
// F06.02 — Chạy thử công thức (dry-run nghiệm thu).
// ----------------------------------------------------------------------------
// Bước 8–9 của luồng hoạt động: "chọn một nhân sự ngẫu nhiên để hệ thống ráp
// số liệu giả định và xuất nhật ký tính toán chi tiết".
//
// Chạy đúng engine của Bảng lương (`computeForPerson`) — không có bản tính
// riêng cho chạy thử, nên con số ở đây là con số bảng lương sẽ ra. Có thể
// chạy với bộ tham số ĐANG SOẠN (chưa lưu) và thử một mẫu BL khác mẫu người
// đó đang theo. Không ghi gì xuống database.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Dices, FlaskConical, TriangleAlert } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { PayslipBreakdown } from '@/components/payroll/PayslipBreakdown';
import { useAppSettings } from '@/contexts/SettingsContext';
import { formatVND } from '@/lib/utils';
import { ENGINE_VARIABLE_NAMES, type CalcTraceStep } from '@/lib/payroll';
import { BUILTIN_FUNCTION_NAMES } from '@/lib/payrollFormula';
import { computeForPerson, paramsForMonth, type PersonComputation } from '@/lib/payrollRun';
import type { PayrollParamVersion } from '@/lib/payrollSettings';
import type { PayrollWorkspace } from '@/lib/payrollData';

const SECTION_LABEL: Record<CalcTraceStep['section'], string> = {
  BASE: 'Lương gốc', EARNING: 'Khoản cộng', INSURANCE: 'Bảo hiểm', TAX: 'Thuế TNCN',
  DEDUCTION: 'Khấu trừ', EMPLOYER: 'Doanh nghiệp', NET: 'Thực lĩnh',
};

interface PayrollDryRunModalProps {
  open: boolean;
  onClose: () => void;
  data: PayrollWorkspace;
  monthStart: Date;
  monthStartStr: string;
  monthEndStr: string;
  /** Bộ tham số đang soạn ở màn Tham số lương — null = bộ đã lưu của tháng. */
  draftVersion?: PayrollParamVersion | null;
  /** Mẫu BL đang thử ở màn Công thức theo khối. */
  templateId?: string | null;
}

export function PayrollDryRunModal({
  open, onClose, data, monthStart, monthStartStr, monthEndStr, draftVersion = null, templateId,
}: PayrollDryRunModalProps) {
  const app = useAppSettings();
  const [personId, setPersonId] = useState('');
  const [templateChoice, setTemplateChoice] = useState<string>('');
  const [assumed, setAssumed] = useState<Record<string, string>>({});
  const [result, setResult] = useState<PersonComputation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError(null);
    setTemplateChoice(templateId ?? '');
    setPersonId((current) => current || data.profiles[0]?.id || '');
  }, [open, templateId, data.profiles]);

  const params = useMemo(
    () => paramsForMonth(data, app, monthStart, monthStartStr, draftVersion),
    [data, app, monthStart, monthStartStr, draftVersion],
  );
  const person = data.profiles.find((item) => item.id === personId) ?? null;

  /** Tính một lượt với số liệu thật để làm điểm xuất phát cho số liệu giả định. */
  const baseline = useMemo(() => {
    if (!person || !params) return null;
    return computeForPerson(person, data, params, monthStart, monthStartStr, monthEndStr, {
      templateIdOverride: templateChoice ? templateChoice : undefined,
    });
  }, [person, params, data, monthStart, monthStartStr, monthEndStr, templateChoice]);

  /**
   * Số liệu tháng mà công thức của người này đọc tới — để người thử điền số
   * giả định đúng chỗ công thức cần, không phải đoán tên biến.
   */
  const inputCodes = useMemo(() => {
    if (!baseline) return [];
    const reserved = new Set([
      ...ENGINE_VARIABLE_NAMES, ...BUILTIN_FUNCTION_NAMES,
      ...data.components.map((component) => component.code),
      ...Object.keys(params?.namedParams ?? {}), ...Object.keys(params?.tierFunctions ?? {}),
    ]);
    const codes = new Set<string>(['OT_WEEKDAY_HOURS', 'OT_WEEKEND_HOURS', 'OT_HOLIDAY_HOURS']);
    for (const entry of baseline.items) {
      const formula = `${entry.item.formula ?? ''} ${entry.component.formula ?? ''}`;
      for (const token of formula.toUpperCase().match(/[A-Z][A-Z0-9_]*/g) ?? []) {
        if (!reserved.has(token)) codes.add(token);
      }
      if (entry.component.input_code) codes.add(entry.component.input_code);
    }
    return [...codes].sort();
  }, [baseline, data.components, params]);

  // Nạp lại số liệu giả định từ số thật khi đổi người hoặc đổi mẫu.
  useEffect(() => {
    if (!baseline) return;
    const next: Record<string, string> = {
      workDays: String(baseline.stats.workDays),
      leaveDays: String(baseline.stats.leaveDays),
      holidayDays: String(baseline.stats.holidayDays),
      lateCount: String(baseline.stats.lateCount),
      earlyCount: String(baseline.stats.earlyCount),
    };
    for (const code of inputCodes) next[`input:${code}`] = String(baseline.inputs[code] ?? 0);
    setAssumed(next);
    setResult(null);
  }, [baseline, inputCodes]);

  const pickRandom = () => {
    const candidates = data.profiles.filter((item) => item.id !== personId);
    if (candidates.length === 0) return;
    setPersonId(candidates[Math.floor(Math.random() * candidates.length)].id);
  };

  const run = () => {
    if (!person || !params) return;
    setError(null);
    const num = (key: string) => {
      const value = Number(assumed[key]);
      return Number.isFinite(value) ? value : 0;
    };
    try {
      const inputsOverride: Record<string, number> = {};
      for (const code of inputCodes) inputsOverride[code] = num(`input:${code}`);
      setResult(computeForPerson(person, data, params, monthStart, monthStartStr, monthEndStr, {
        templateIdOverride: templateChoice ? templateChoice : undefined,
        statsOverride: {
          workDays: num('workDays'), leaveDays: num('leaveDays'), holidayDays: num('holidayDays'),
          lateCount: num('lateCount'), earlyCount: num('earlyCount'),
        },
        inputsOverride,
        trace: true,
      }));
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    }
  };

  const field = (key: string, label: string) => (
    <Input key={key} label={label} inputMode="decimal" value={assumed[key] ?? ''}
      onChange={(event) => setAssumed((current) => ({ ...current, [key]: event.target.value.replace(/[^\d.]/g, '') }))} />
  );

  return (
    <Modal open={open} onClose={onClose} title="Chạy thử công thức lương" size="xl">
      <div className="space-y-5">
        <p className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm leading-relaxed text-indigo-900">
          Chạy đúng engine của Bảng lương với số liệu tháng {monthStartStr.slice(5, 7)}/{monthStartStr.slice(0, 4)} của
          một nhân sự, đè bằng số liệu giả định bạn nhập. {draftVersion ? 'Dùng bộ tham số ĐANG SOẠN (chưa lưu). ' : ''}
          Không ghi gì xuống hệ thống.
        </p>

        {!params ? (
          <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <TriangleAlert className="mt-0.5 h-4 w-4" /> Chưa có bộ tham số lương hiệu lực cho tháng này.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr]">
              <Select label="Nhân sự" value={personId} onChange={(event) => setPersonId(event.target.value)}>
                {data.profiles.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}{item.employee_code ? ` · ${item.employee_code}` : ''}</option>
                ))}
              </Select>
              <div className="flex items-end">
                <Button variant="outline" onClick={pickRandom}><Dices className="h-4 w-4" /> Ngẫu nhiên</Button>
              </div>
              <Select label="Mẫu bảng lương thử" value={templateChoice} onChange={(event) => setTemplateChoice(event.target.value)}>
                <option value="">Theo cơ chế hiện hành của người này</option>
                {data.templates.filter((template) => template.is_active).map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </Select>
            </div>
            {baseline && (
              <p className="-mt-2 text-xs text-slate-500">
                Mẫu đang áp: <strong>{baseline.template.label}</strong> · {baseline.items.length} khoản ·
                {baseline.payProfile ? ` ${baseline.payProfile.dependents} người phụ thuộc` : ' chưa có cơ chế lương riêng'}
              </p>
            )}

            <div className="rounded-xl border border-slate-200 p-4">
              <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Số liệu giả định</p>
              <div className="grid gap-3 sm:grid-cols-5">
                {field('workDays', 'Ngày đi làm')}
                {field('leaveDays', 'Ngày phép')}
                {field('holidayDays', 'Ngày lễ')}
                {field('lateCount', 'Lần đi muộn')}
                {field('earlyCount', 'Lần về sớm')}
              </div>
              {inputCodes.length > 0 && (
                <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-4">
                  {inputCodes.map((code) => field(`input:${code}`, code))}
                </div>
              )}
              <div className="mt-4 flex justify-end">
                <Button onClick={run} disabled={!person}><FlaskConical className="h-4 w-4" /> Chạy thử</Button>
              </div>
            </div>
          </>
        )}

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {result && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Tổng thu nhập" value={formatVND(result.computed.gross)} />
              <Stat label="Bảo hiểm + thuế" value={formatVND(result.computed.insuranceEmployee + result.computed.personalIncomeTax)} />
              <Stat label="Khấu trừ khác" value={formatVND(result.computed.otherDeductions)} />
              <Stat label="Thực lĩnh" value={formatVND(result.computed.netPay)} strong />
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200">
              <p className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                Nhật ký tính toán
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Phần</th>
                      <th className="px-3 py-2">Khoản</th>
                      <th className="px-3 py-2">Công thức / phép tính</th>
                      <th className="px-3 py-2">Biến đã dùng</th>
                      <th className="px-3 py-2 text-right">Kết quả</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {(result.computed.trace ?? []).map((step, index) => (
                      <tr key={index} className="align-top">
                        <td className="px-3 py-2 text-slate-400">{index + 1}</td>
                        <td className="px-3 py-2 font-semibold text-slate-500">{SECTION_LABEL[step.section]}</td>
                        <td className="px-3 py-2 font-semibold text-slate-800">{step.label}</td>
                        <td className="max-w-[260px] px-3 py-2">
                          {step.expression && <code className="break-words font-mono text-[11px] text-indigo-700">{step.expression}</code>}
                          {step.note && <p className="mt-0.5 text-[11px] text-slate-500">{step.note}</p>}
                        </td>
                        <td className="max-w-[240px] px-3 py-2 font-mono text-[11px] text-slate-600">
                          {Object.entries(step.variables ?? {}).map(([name, value]) => (
                            <span key={name} className="mr-2 inline-block whitespace-nowrap">{name}={formatNumber(value)}</span>
                          ))}
                        </td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-900">{formatVND(step.result)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <PayslipBreakdown
              lines={result.computed.lines}
              netPay={result.computed.netPay}
              roundingAdjustment={result.computed.roundingAdjustment}
              warnings={result.computed.warnings}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value);
}

function Stat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`mt-0.5 truncate text-sm font-bold tabular-nums ${strong ? 'text-indigo-700' : 'text-slate-800'}`}>{value}</p>
    </div>
  );
}
