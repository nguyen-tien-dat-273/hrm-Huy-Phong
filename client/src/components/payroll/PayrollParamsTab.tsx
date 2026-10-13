// ============================================================================
// F06.02 — Tham số lương theo NGÀY HIỆU LỰC.
// ----------------------------------------------------------------------------
// Mỗi bộ tham số áp từ một tháng. Đổi luật / đổi chính sách = tạo bộ mới hiệu
// lực từ tháng đó; các tháng trước giữ bộ cũ nên số liệu quá khứ không bị sửa
// ngược. Bộ đã dùng cho kỳ lương ĐÃ CHỐT thì khoá (database chặn).
//
// FR06.02.01 — tham số chung: công chuẩn, bảo hiểm hai phía, giảm trừ, biểu thuế.
// FR06.02.03 — biểu thuế lũy tiến, giảm trừ gia cảnh, BHXH/BHYT/BHTN/KPCĐ.
// FR06.02.04 — đơn giá phạt, tỷ lệ trích quỹ: tham số nhóm "Phạt & khấu trừ"
//               và "Trích quỹ", gọi bằng mã trong công thức của mẫu bảng lương.
// Công thức theo khối (FR06.02.02) ở màn riêng "Công thức theo khối".
// ============================================================================

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CalendarClock, CheckCircle2, Copy, FlaskConical, Info, Lock, Plus, Save, Trash2, TriangleAlert,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { formatVND, getTodayString } from '@/lib/utils';
import { ENGINE_VARIABLE_NAMES } from '@/lib/payroll';
import { BUILTIN_FUNCTION_NAMES } from '@/lib/payrollFormula';
import {
  copyVersion, deleteParamVersion, firstEditableMonth, PARAM_GROUP_LABEL, PARAM_UNIT_LABEL,
  saveParamVersion, validateParamVersion,
  type NamedParamDef, type ParamGroup, type ParamUnit, type PayrollParamVersion, type TierTable,
} from '@/lib/payrollSettings';

interface PayrollParamsTabProps {
  versions: PayrollParamVersion[];
  /** Tháng lớn nhất đã khoá lương — bộ hiệu lực từ đó trở về trước bị khoá. */
  lastClosedMonth: string | null;
  /** Mã khoản lương — tham số không được đặt trùng. */
  componentCodes: string[];
  /** Tháng đang xem ở các màn khác, để đánh dấu bộ "đang áp dụng". */
  currentMonth: string;
  canManage: boolean;
  onSaved: () => void;
  /** Mở Chạy thử với bộ đang soạn (chưa cần lưu). */
  onDryRun: (version: PayrollParamVersion) => void;
}

const monthLabel = (iso: string) => (iso.startsWith('2000-01') ? 'Bộ gốc' : `${iso.slice(5, 7)}/${iso.slice(0, 4)}`);

export function PayrollParamsTab({
  versions, lastClosedMonth, componentCodes, currentMonth, canManage, onSaved, onDryRun,
}: PayrollParamsTabProps) {
  const { toast } = useToast();
  const confirm = useConfirm();

  const sorted = useMemo(
    () => [...versions].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)),
    [versions],
  );
  const activeId = useMemo(
    () => sorted.find((version) => version.effectiveFrom <= currentMonth)?.id ?? null,
    [sorted, currentMonth],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PayrollParamVersion | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  // Mở bộ đang áp dụng khi vào màn / khi dữ liệu mới về và người dùng chưa sửa dở.
  useEffect(() => {
    if (touched) return;
    const pick = sorted.find((version) => version.id === selectedId) ?? sorted.find((version) => version.id === activeId) ?? sorted[0];
    if (pick) {
      setSelectedId(pick.id);
      setDraft({ ...copyVersion(pick, pick.effectiveFrom), id: pick.id, label: pick.label, note: pick.note });
    }
  }, [sorted, activeId, selectedId, touched]);

  const reserved = useMemo(
    () => new Set([...ENGINE_VARIABLE_NAMES, ...BUILTIN_FUNCTION_NAMES, ...componentCodes]),
    [componentCodes],
  );
  const issues = draft ? validateParamVersion(draft, reserved) : {};
  const issueCount = Object.keys(issues).length;
  const locked = !!draft?.id && !!lastClosedMonth && draft.effectiveFrom <= lastClosedMonth;
  const readOnly = !canManage || locked;
  const minMonth = firstEditableMonth(lastClosedMonth, getTodayString());

  const update = (patch: Partial<PayrollParamVersion>) => {
    setTouched(true);
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const select = (version: PayrollParamVersion) => {
    setTouched(false);
    setSelectedId(version.id);
    setDraft({ ...copyVersion(version, version.effectiveFrom), id: version.id, label: version.label, note: version.note });
  };

  const startNew = () => {
    const base = draft ?? sorted[0];
    if (!base) return;
    setTouched(true);
    setSelectedId(null);
    setDraft(copyVersion(base, minMonth));
  };

  const save = async () => {
    if (!draft) return;
    if (issueCount > 0) {
      toast('Còn tham số chưa hợp lệ — sửa các ô đánh dấu đỏ.', 'warning');
      return;
    }
    const clash = versions.find((version) => version.effectiveFrom === draft.effectiveFrom && version.id !== draft.id);
    if (clash) {
      toast(`Đã có bộ tham số hiệu lực từ ${monthLabel(draft.effectiveFrom)} — mở bộ đó để sửa.`, 'warning');
      return;
    }
    const ok = await confirm({
      title: draft.id ? 'Lưu thay đổi bộ tham số?' : `Lưu bộ tham số mới hiệu lực từ ${monthLabel(draft.effectiveFrom)}?`,
      message: `Áp dụng cho kỳ lương từ ${monthLabel(draft.effectiveFrom)} cho tới bộ kế tiếp. Các kỳ chưa khoá trong khoảng đó sẽ tính theo số mới khi chạy lại bảng lương; kỳ đã khoá giữ nguyên. Thao tác được ghi Audit Log.`,
      confirmLabel: 'Lưu bộ tham số',
    });
    if (!ok) return;
    setSaving(true);
    const { error, id } = await saveParamVersion(draft);
    setSaving(false);
    if (error) {
      toast('Lưu thất bại: ' + error, 'error');
      return;
    }
    toast('Đã lưu bộ tham số lương.', 'success');
    setTouched(false);
    setSelectedId(id);
    onSaved();
  };

  const remove = async () => {
    if (!draft?.id) return;
    const ok = await confirm({
      title: `Xoá bộ tham số hiệu lực từ ${monthLabel(draft.effectiveFrom)}?`,
      message: 'Các tháng đang theo bộ này sẽ quay về bộ liền trước. Chỉ xoá được bộ chưa dùng cho kỳ lương đã khoá.',
      confirmLabel: 'Xoá bộ tham số',
      danger: true,
    });
    if (!ok) return;
    const error = await deleteParamVersion(draft.id);
    if (error) {
      toast('Xoá thất bại: ' + error, 'error');
      return;
    }
    toast('Đã xoá bộ tham số.', 'success');
    setTouched(false);
    setSelectedId(null);
    onSaved();
  };

  if (sorted.length === 0 && !draft) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-slate-500">
          Chưa có bộ tham số lương nào. Chạy migration <code className="font-mono">20261013110000_m06_f0602_payroll_params_formulas.sql</code> để
          chép cấu hình hiện hành thành bộ gốc.
        </CardContent>
      </Card>
    );
  }

  const employeeTotal = draft ? draft.socialInsuranceRate + draft.healthInsuranceRate + draft.unemploymentInsuranceRate : 0;
  const employerTotal = draft ? draft.employerSocialRate + draft.employerHealthRate + draft.employerUnemploymentRate : 0;

  return (
    <div className="space-y-5 pb-24">
      <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3">
        <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600" />
        <p className="text-sm leading-relaxed text-blue-900">
          Không có con số pháp lý nào nằm trong phần mềm: mọi tỷ lệ, mức giảm trừ, biểu thuế, hệ số và đơn giá
          đều khai ở đây theo <strong>ngày bắt đầu hiệu lực</strong>. Luật đổi thì tạo bộ mới từ tháng áp dụng —
          kỳ cũ giữ nguyên số đã dùng.
        </p>
      </div>

      {/* --- Dòng thời gian các bộ tham số --- */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Các bộ tham số theo ngày hiệu lực</CardTitle>
          {canManage && (
            <Button size="sm" variant="outline" onClick={startNew}>
              <Copy className="h-3.5 w-3.5" /> Tạo bộ mới từ bộ đang xem
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {sorted.map((version) => {
            const isLocked = !!lastClosedMonth && version.effectiveFrom <= lastClosedMonth;
            const isSelected = version.id === selectedId && !(touched && !draft?.id);
            return (
              <button
                key={version.id}
                type="button"
                onClick={() => select(version)}
                className={`min-w-[150px] rounded-xl border px-3 py-2 text-left transition ${
                  isSelected ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-500/20' : 'border-slate-200 hover:border-indigo-300'
                }`}
              >
                <span className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                  <CalendarClock className="h-3.5 w-3.5 text-indigo-500" /> Từ {monthLabel(version.effectiveFrom)}
                </span>
                <span className="mt-0.5 block truncate text-xs text-slate-500">{version.label || '—'}</span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {version.id === activeId && (
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">Đang áp dụng</span>
                  )}
                  {isLocked && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                      <Lock className="h-2.5 w-2.5" /> Đã dùng cho kỳ chốt
                    </span>
                  )}
                </span>
              </button>
            );
          })}
          {touched && draft && !draft.id && (
            <span className="min-w-[150px] rounded-xl border-2 border-dashed border-indigo-400 bg-indigo-50/40 px-3 py-2 text-sm font-bold text-indigo-700">
              Bộ mới (chưa lưu)
            </span>
          )}
        </CardContent>
      </Card>

      {draft && (
        <>
          {locked && (
            <p className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <Lock className="mt-0.5 h-4 w-4 flex-shrink-0" />
              Bộ này đã dùng cho kỳ lương đã khoá (tới {monthLabel(lastClosedMonth ?? '')}) nên chỉ xem được. Bấm
              <strong className="mx-1">Tạo bộ mới từ bộ đang xem</strong> để đổi số từ tháng {monthLabel(minMonth)}.
            </p>
          )}

          <Card>
            <CardHeader><CardTitle>Hiệu lực & căn cứ</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <Input
                label="Áp dụng từ tháng"
                required
                type="month"
                value={draft.effectiveFrom.slice(0, 7)}
                min={draft.id ? undefined : minMonth.slice(0, 7)}
                disabled={readOnly || (!!draft.id && draft.effectiveFrom.startsWith('2000-01'))}
                onChange={(event) => update({ effectiveFrom: event.target.value ? `${event.target.value}-01` : '' })}
                error={issues.effectiveFrom}
              />
              <Input label="Tên bộ (không bắt buộc)" value={draft.label ?? ''} disabled={!canManage}
                onChange={(event) => update({ label: event.target.value })} placeholder="VD: Giảm trừ gia cảnh 2026" />
              <Textarea label="Căn cứ / ghi chú" rows={1} value={draft.note ?? ''} disabled={!canManage}
                onChange={(event) => update({ note: event.target.value })} placeholder="VD: Nghị quyết 110/2025/UBTVQH15" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Công chuẩn & làm tròn thực lĩnh</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <NumberField label="Ngày công chuẩn / tháng" required value={draft.standardWorkDays} step={0.5}
                disabled={readOnly} error={issues.standardWorkDays} onChange={(v) => update({ standardWorkDays: v })}
                hint="BR-PAY-001. Tháng đã khai ca làm việc thì công chuẩn lấy theo lịch thực tế của tháng." />
              <Select label="Làm tròn thực lĩnh tới" value={String(draft.netRoundingUnit)} disabled={readOnly}
                onChange={(event) => update({ netRoundingUnit: Number(event.target.value) as PayrollParamVersion['netRoundingUnit'] })}>
                {[1, 10, 100, 1000, 10000].map((unit) => <option key={unit} value={unit}>{unit === 1 ? 'Không làm tròn' : `${formatVND(unit)}`}</option>)}
              </Select>
              <Select label="Cách làm tròn" value={draft.netRoundingMode} disabled={readOnly || draft.netRoundingUnit === 1}
                onChange={(event) => update({ netRoundingMode: event.target.value as PayrollParamVersion['netRoundingMode'] })}>
                <option value="NEAREST">Gần nhất (≥ nửa đơn vị làm tròn lên)</option>
                <option value="DOWN">Luôn làm tròn xuống</option>
                <option value="UP">Luôn làm tròn lên</option>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Mức nền theo quy định</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <NumberField label="Mức lương cơ sở (VND)" required value={draft.baseSalaryLevel} step={10000}
                disabled={readOnly} error={issues.baseSalaryLevel} onChange={(v) => update({ baseSalaryLevel: v })}
                hint={`Trần BHXH/BHYT thường = 20 lần: ${formatVND(draft.baseSalaryLevel * 20)}`} />
              <NumberField label="Lương tối thiểu vùng (VND)" required value={draft.regionalMinimumWage} step={10000}
                disabled={readOnly} error={issues.regionalMinimumWage} onChange={(v) => update({ regionalMinimumWage: v })}
                hint="BR-PAY-013: lương cơ bản không được thấp hơn mức này khi trình cơ chế lương." />
              <Select label="Vùng" value={draft.regionCode} disabled={readOnly}
                onChange={(event) => update({ regionCode: event.target.value as PayrollParamVersion['regionCode'] })}>
                {(['I', 'II', 'III', 'IV'] as const).map((code) => <option key={code} value={code}>Vùng {code}</option>)}
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Bảo hiểm bắt buộc & kinh phí công đoàn</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs font-semibold text-slate-600">Người lao động đóng (trừ vào lương) — tổng {employeeTotal.toFixed(1)}%</p>
              <div className="grid gap-4 sm:grid-cols-3">
                <NumberField label="BHXH (%)" required value={draft.socialInsuranceRate} step={0.1} disabled={readOnly}
                  error={issues.socialInsuranceRate} onChange={(v) => update({ socialInsuranceRate: v })} />
                <NumberField label="BHYT (%)" required value={draft.healthInsuranceRate} step={0.1} disabled={readOnly}
                  error={issues.healthInsuranceRate} onChange={(v) => update({ healthInsuranceRate: v })} />
                <NumberField label="BHTN (%)" required value={draft.unemploymentInsuranceRate} step={0.1} disabled={readOnly}
                  error={issues.unemploymentInsuranceRate} onChange={(v) => update({ unemploymentInsuranceRate: v })} />
              </div>
              <p className="border-t border-slate-100 pt-4 text-xs font-semibold text-slate-600">
                Doanh nghiệp đóng (không trừ lương) — tổng {(employerTotal + draft.employerUnionFundRate).toFixed(1)}%
              </p>
              <div className="grid gap-4 sm:grid-cols-4">
                <NumberField label="BHXH DN (%)" required value={draft.employerSocialRate} step={0.1} disabled={readOnly}
                  error={issues.employerSocialRate} onChange={(v) => update({ employerSocialRate: v })} />
                <NumberField label="BHYT DN (%)" required value={draft.employerHealthRate} step={0.1} disabled={readOnly}
                  error={issues.employerHealthRate} onChange={(v) => update({ employerHealthRate: v })} />
                <NumberField label="BHTN DN (%)" required value={draft.employerUnemploymentRate} step={0.1} disabled={readOnly}
                  error={issues.employerUnemploymentRate} onChange={(v) => update({ employerUnemploymentRate: v })} />
                <NumberField label="KPCĐ (%)" required value={draft.employerUnionFundRate} step={0.1} disabled={readOnly}
                  error={issues.employerUnionFundRate} onChange={(v) => update({ employerUnionFundRate: v })}
                  hint="0 = không tự tính. Khai ở đây thì khoản ER_UNION_FUND gán tay tự bỏ qua, không tính hai lần." />
              </div>
              <div className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-3">
                <NumberField label="Trần đóng BHXH/BHYT (VND)" required value={draft.insuranceSalaryCap} step={100000}
                  disabled={readOnly} error={issues.insuranceSalaryCap} onChange={(v) => update({ insuranceSalaryCap: v })} />
                <NumberField label="Trần đóng BHTN (VND)" required value={draft.unemploymentSalaryCap} step={100000}
                  disabled={readOnly} error={issues.unemploymentSalaryCap} onChange={(v) => update({ unemploymentSalaryCap: v })} />
                <NumberField label="Nghỉ không lương từ (ngày) thì không đóng" required value={draft.unpaidDaysWaiveInsurance} step={0.5}
                  disabled={readOnly} error={issues.unpaidDaysWaiveInsurance} onChange={(v) => update({ unpaidDaysWaiveInsurance: v })}
                  hint="Ngưỡng của Luật BHXH, áp cả hai phía." />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Thuế thu nhập cá nhân</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <NumberField label="Giảm trừ bản thân (VND/tháng)" required value={draft.taxPersonalDeduction} step={100000}
                  disabled={readOnly} error={issues.taxPersonalDeduction} onChange={(v) => update({ taxPersonalDeduction: v })} />
                <NumberField label="Giảm trừ mỗi người phụ thuộc" required value={draft.taxDependentDeduction} step={100000}
                  disabled={readOnly} error={issues.taxDependentDeduction} onChange={(v) => update({ taxDependentDeduction: v })}
                  hint="Số người phụ thuộc khai ở Cơ chế lương từng người." />
                <NumberField label="Khấu trừ thẳng HĐ < 3 tháng (%)" required value={draft.flatTaxRate} step={0.5}
                  disabled={readOnly} error={issues.flatTaxRate} onChange={(v) => update({ flatTaxRate: v })} />
              </div>
              <BracketEditor version={draft} readOnly={readOnly} issues={issues} onChange={(brackets) => update({ brackets })} />
            </CardContent>
          </Card>

          <NamedParamsCard version={draft} readOnly={readOnly} issues={issues} onChange={(namedParams) => update({ namedParams })} />
          <TierTablesCard version={draft} readOnly={readOnly} issues={issues} onChange={(tierTables) => update({ tierTables })} />

          {/* --- Thanh lưu / chạy thử --- */}
          <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur-md print:hidden">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 lg:pl-64">
              <p className={`flex items-center gap-1.5 text-sm ${issueCount > 0 ? 'text-red-600' : 'text-slate-600'}`}>
                {issueCount > 0
                  ? <><TriangleAlert className="h-4 w-4" /> {issueCount} ô chưa hợp lệ</>
                  : touched
                    ? <><Save className="h-4 w-4" /> Có thay đổi chưa lưu — bộ hiệu lực từ {monthLabel(draft.effectiveFrom)}</>
                    : <><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Bộ hiệu lực từ {monthLabel(draft.effectiveFrom)}</>}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => onDryRun(draft)} disabled={issueCount > 0}>
                  <FlaskConical className="h-4 w-4" /> Chạy thử với bộ này
                </Button>
                {canManage && draft.id && !locked && sorted.length > 1 && (
                  <Button variant="ghost" onClick={() => void remove()}><Trash2 className="h-4 w-4" /> Xoá bộ</Button>
                )}
                {touched && (
                  <Button variant="secondary" onClick={() => { setTouched(false); setSelectedId(selectedId ?? activeId); }} disabled={saving}>
                    Huỷ thay đổi
                  </Button>
                )}
                {canManage && !locked && (
                  <Button theme="admin" onClick={() => void save()} disabled={saving || !touched || issueCount > 0}>
                    <Save className="h-4 w-4" /> {saving ? 'Đang lưu…' : 'Lưu bộ tham số'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function BracketEditor({ version, readOnly, issues, onChange }: {
  version: PayrollParamVersion; readOnly: boolean; issues: Record<string, string | undefined>;
  onChange: (brackets: PayrollParamVersion['brackets']) => void;
}) {
  const brackets = version.brackets;
  const set = (index: number, patch: Partial<PayrollParamVersion['brackets'][number]>) =>
    onChange(brackets.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const add = () => {
    const lastBound = [...brackets].reverse().find((row) => row.upperBound != null)?.upperBound ?? 0;
    const next = [...brackets];
    // Chèn trước bậc cuối (bậc cuối luôn để trống cận trên).
    next.splice(Math.max(next.length - 1, 0), 0, { step: 0, upperBound: lastBound + 10_000_000, rate: 0 });
    onChange(next.map((row, i) => ({ ...row, step: i + 1 })));
  };
  const remove = (index: number) =>
    onChange(brackets.filter((_, i) => i !== index).map((row, i) => ({ ...row, step: i + 1 })));

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-bold text-slate-600">Biểu thuế lũy tiến từng phần ({brackets.length} bậc)</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        Mỗi bậc chỉ đánh trên <strong>phần</strong> thu nhập tính thuế nằm trong bậc đó. Bậc cuối để trống cận trên.
        Số bậc không cố định — luật đổi số bậc thì thêm / bớt dòng.
      </p>
      {issues.brackets && <p className="mt-2 text-xs text-red-600">{issues.brackets}</p>}
      <div className="overflow-x-auto">
        <table className="mt-3 w-full min-w-[480px] text-xs">
          <thead>
            <tr className="text-left text-slate-400">
              <th className="pb-1.5 font-semibold">Bậc</th>
              <th className="pb-1.5 font-semibold">Từ</th>
              <th className="pb-1.5 font-semibold">Đến (trống = trở lên)</th>
              <th className="pb-1.5 font-semibold">Thuế suất %</th>
              <th />
            </tr>
          </thead>
          <tbody className="text-slate-600">
            {brackets.map((bracket, index) => {
              const lower = index === 0 ? 0 : brackets[index - 1].upperBound ?? 0;
              const issue = issues[`bracket.${index}`];
              return (
                <tr key={index} className="border-t border-slate-200/70 align-top">
                  <td className="py-1.5 pr-2">{index + 1}</td>
                  <td className="py-1.5 pr-2 tabular-nums text-slate-500">{formatVND(lower)}</td>
                  <td className="py-1.5 pr-2">
                    <input inputMode="numeric" placeholder="trở lên" disabled={readOnly}
                      value={bracket.upperBound == null ? '' : String(bracket.upperBound)}
                      onChange={(event) => {
                        const digits = event.target.value.replace(/[^\d]/g, '');
                        set(index, { upperBound: digits ? Number(digits) : null });
                      }}
                      className={`h-8 w-36 rounded-lg border bg-white px-2 text-right tabular-nums outline-none focus:border-indigo-500 disabled:bg-slate-100 ${issue ? 'border-red-400' : 'border-slate-200'}`} />
                    {issue && <p className="mt-1 max-w-xs text-[11px] text-red-600">{issue}</p>}
                  </td>
                  <td className="py-1.5">
                    <input inputMode="decimal" disabled={readOnly} value={Number.isFinite(bracket.rate) ? String(bracket.rate) : ''}
                      onChange={(event) => set(index, { rate: Number(event.target.value.replace(/[^\d.]/g, '')) })}
                      className="h-8 w-20 rounded-lg border border-slate-200 bg-white px-2 text-right tabular-nums outline-none focus:border-indigo-500 disabled:bg-slate-100" />
                  </td>
                  <td className="py-1.5 text-right">
                    {!readOnly && brackets.length > 1 && (
                      <button type="button" onClick={() => remove(index)} aria-label={`Bỏ bậc ${index + 1}`}
                        className="rounded p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <Button size="sm" variant="ghost" onClick={add} className="mt-2"><Plus className="h-3.5 w-3.5" /> Thêm bậc</Button>
      )}
    </div>
  );
}

const PARAM_GROUP_HINT: Record<ParamGroup, string> = {
  OT: 'Hệ số OT ngày thường / ngày nghỉ / ngày lễ, ca đêm. Dùng trong công thức làm thêm giờ của mẫu bảng lương.',
  PENALTY: 'FR06.02.04 — đơn giá phạt đi muộn, lỗi báo cáo… Engine tự lấy số lần đi muộn / về sớm từ chấm công (LATE_COUNT, EARLY_COUNT). Lưu ý Điều 127 BLLĐ 2019.',
  FUND: 'FR06.02.04 — tỷ lệ trừ quỹ nội bộ (1%) và các khoản trích khác.',
  COMMISSION: 'Doanh thu, hoa hồng, thưởng doanh số vượt (BR-PAY-004).',
  OTHER: 'Đơn giá, định mức khác của công ty.',
};

function NamedParamsCard({ version, readOnly, issues, onChange }: {
  version: PayrollParamVersion; readOnly: boolean; issues: Record<string, string | undefined>;
  onChange: (params: NamedParamDef[]) => void;
}) {
  const params = version.namedParams;
  const set = (index: number, patch: Partial<NamedParamDef>) =>
    onChange(params.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const add = (group: ParamGroup) =>
    onChange([...params, { code: '', name: '', value: 0, unit: group === 'PENALTY' ? 'VND' : 'HE_SO', group, note: null }]);
  const remove = (index: number) => onChange(params.filter((_, i) => i !== index));

  return (
    <Card>
      <CardHeader><CardTitle>Tham số công ty dùng trong công thức (FR06.02.04)</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm leading-relaxed text-slate-500">
          Mỗi tham số có một <span className="font-mono font-semibold">MÃ</span> gọi thẳng trong công thức, ví dụ
          <code className="mx-1 font-mono text-indigo-700">HOURLY_RATE * HE_SO_OT_THUONG * OT_WEEKDAY_HOURS</code>.
          Đổi chính sách chỉ sửa giá trị ở đây.
        </p>
        {(Object.keys(PARAM_GROUP_LABEL) as ParamGroup[]).map((group) => {
          const rows = params.map((row, index) => ({ row, index })).filter(({ row }) => row.group === group);
          return (
            <div key={group} className="rounded-xl border border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
                <div>
                  <p className="text-xs font-bold text-slate-700">{PARAM_GROUP_LABEL[group]} ({rows.length})</p>
                  <p className="text-[11px] leading-relaxed text-slate-500">{PARAM_GROUP_HINT[group]}</p>
                </div>
                {!readOnly && <Button size="sm" variant="ghost" onClick={() => add(group)}><Plus className="h-3.5 w-3.5" /> Thêm</Button>}
              </div>
              {rows.length === 0 ? (
                <p className="px-3 py-3 text-xs text-slate-400">Chưa có tham số.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {rows.map(({ row, index }) => {
                    const issue = issues[`param.${index}`];
                    return (
                      <div key={index} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[1.4fr_1fr_8rem_6rem_auto]">
                        <div className="min-w-0 space-y-1">
                          <input value={row.name} disabled={readOnly} placeholder="Tên tham số"
                            onChange={(event) => set(index, { name: event.target.value })}
                            className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-semibold outline-none focus:border-indigo-500 disabled:bg-slate-50" />
                          {row.note && <p className="text-[11px] leading-relaxed text-slate-400">{row.note}</p>}
                          {issue && <p className="text-[11px] text-red-600">{issue}</p>}
                        </div>
                        <input value={row.code} disabled={readOnly} placeholder="MA_THAM_SO"
                          onChange={(event) => set(index, { code: event.target.value.replace(/[^A-Za-z0-9_]/g, '').toUpperCase() })}
                          className={`h-9 rounded-lg border px-2.5 font-mono text-xs text-indigo-700 outline-none focus:border-indigo-500 disabled:bg-slate-50 ${issue ? 'border-red-400' : 'border-slate-200'}`} />
                        <input inputMode="decimal" disabled={readOnly} value={Number.isFinite(row.value) ? String(row.value) : ''}
                          onChange={(event) => set(index, { value: Number(event.target.value.replace(/[^\d.-]/g, '')) })}
                          className="h-9 rounded-lg border border-slate-200 px-2.5 text-right font-mono text-sm outline-none focus:border-indigo-500 disabled:bg-slate-50" />
                        <select value={row.unit} disabled={readOnly} onChange={(event) => set(index, { unit: event.target.value as ParamUnit })}
                          className="h-9 rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-indigo-500 disabled:bg-slate-50">
                          {(Object.keys(PARAM_UNIT_LABEL) as ParamUnit[]).map((unit) => <option key={unit} value={unit}>{PARAM_UNIT_LABEL[unit]}</option>)}
                        </select>
                        {!readOnly && (
                          <button type="button" onClick={() => remove(index)} aria-label={`Xoá ${row.name || 'tham số'}`}
                            className="justify-self-end rounded-lg p-2 text-slate-300 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function TierTablesCard({ version, readOnly, issues, onChange }: {
  version: PayrollParamVersion; readOnly: boolean; issues: Record<string, string | undefined>;
  onChange: (tiers: TierTable[]) => void;
}) {
  const tiers = version.tierTables;
  const set = (index: number, patch: Partial<TierTable>) =>
    onChange(tiers.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const add = () => onChange([...tiers, {
    code: '', name: '', inputLabel: 'Tỷ lệ đạt (%)', unit: '%', note: null, rows: [{ from: 0, value: 0 }],
  }]);

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle>Biểu bậc thang (hoa hồng khoán, thưởng theo mức)</CardTitle>
        {!readOnly && <Button size="sm" variant="outline" onClick={add}><Plus className="h-3.5 w-3.5" /> Thêm biểu</Button>}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed text-slate-500">
          Gọi trong công thức như một hàm: <code className="font-mono text-indigo-700">HH_BL02(DOANH_SO / DOANH_SO_KHOAN * 100)</code> trả về
          giá trị của mức có ngưỡng lớn nhất không vượt giá trị tra. Mỗi mức áp từ ngưỡng của nó tới ngay dưới ngưỡng kế tiếp.
        </p>
        {tiers.length === 0 && <p className="text-xs text-slate-400">Chưa có biểu nào.</p>}
        {tiers.map((tier, index) => {
          const issue = issues[`tier.${index}`];
          return (
            <div key={index} className={`rounded-xl border p-3 ${issue ? 'border-red-300' : 'border-slate-200'}`}>
              <div className="grid gap-2 sm:grid-cols-[1fr_1.6fr_1.4fr_auto]">
                <input value={tier.code} disabled={readOnly} placeholder="MA_BIEU"
                  onChange={(event) => set(index, { code: event.target.value.replace(/[^A-Za-z0-9_]/g, '').toUpperCase() })}
                  className="h-9 rounded-lg border border-slate-200 px-2.5 font-mono text-xs text-indigo-700 outline-none focus:border-indigo-500 disabled:bg-slate-50" />
                <input value={tier.name} disabled={readOnly} placeholder="Tên biểu"
                  onChange={(event) => set(index, { name: event.target.value })}
                  className="h-9 rounded-lg border border-slate-200 px-2.5 text-sm font-semibold outline-none focus:border-indigo-500 disabled:bg-slate-50" />
                <input value={tier.inputLabel ?? ''} disabled={readOnly} placeholder="Giá trị tra (VD: Tỷ lệ đạt %)"
                  onChange={(event) => set(index, { inputLabel: event.target.value })}
                  className="h-9 rounded-lg border border-slate-200 px-2.5 text-xs outline-none focus:border-indigo-500 disabled:bg-slate-50" />
                {!readOnly && (
                  <button type="button" onClick={() => onChange(tiers.filter((_, i) => i !== index))} aria-label="Xoá biểu"
                    className="justify-self-end rounded-lg p-2 text-slate-300 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                )}
              </div>
              {tier.note && <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{tier.note}</p>}
              {issue && <p className="mt-1.5 text-[11px] text-red-600">{issue}</p>}
              <table className="mt-2 w-full max-w-md text-xs">
                <thead><tr className="text-left text-slate-400"><th className="pb-1">Từ ngưỡng (≥)</th><th className="pb-1">Giá trị</th><th /></tr></thead>
                <tbody>
                  {tier.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      <td className="py-1 pr-2">
                        <input inputMode="decimal" disabled={readOnly} value={Number.isFinite(row.from) ? String(row.from) : ''}
                          onChange={(event) => set(index, { rows: tier.rows.map((r, i) => (i === rowIndex ? { ...r, from: Number(event.target.value.replace(/[^\d.-]/g, '')) } : r)) })}
                          className="h-8 w-28 rounded-lg border border-slate-200 px-2 text-right tabular-nums outline-none focus:border-indigo-500 disabled:bg-slate-50" />
                      </td>
                      <td className="py-1 pr-2">
                        <input inputMode="decimal" disabled={readOnly} value={Number.isFinite(row.value) ? String(row.value) : ''}
                          onChange={(event) => set(index, { rows: tier.rows.map((r, i) => (i === rowIndex ? { ...r, value: Number(event.target.value.replace(/[^\d.-]/g, '')) } : r)) })}
                          className="h-8 w-28 rounded-lg border border-slate-200 px-2 text-right tabular-nums outline-none focus:border-indigo-500 disabled:bg-slate-50" />
                        <span className="ml-1 text-slate-400">{PARAM_UNIT_LABEL[tier.unit]}</span>
                      </td>
                      <td className="py-1 text-right">
                        {!readOnly && tier.rows.length > 1 && (
                          <button type="button" aria-label="Bỏ mức" onClick={() => set(index, { rows: tier.rows.filter((_, i) => i !== rowIndex) })}
                            className="rounded p-1 text-slate-300 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!readOnly && (
                <Button size="sm" variant="ghost" onClick={() => set(index, {
                  rows: [...tier.rows, { from: (tier.rows[tier.rows.length - 1]?.from ?? 0) + 10, value: 0 }],
                })}><Plus className="h-3.5 w-3.5" /> Thêm mức</Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/**
 * Ô số giữ giá trị dạng CHUỖI khi đang gõ: ép về số mỗi lần gõ sẽ khiến xoá
 * hết ô là nhảy về 0, không gõ tiếp được. Lỗi ngưỡng hiện ngay dưới ô (UI_03).
 */
function NumberField({
  label, value, onChange, step = 1, hint, error, disabled, required,
}: {
  label: string; value: number; onChange: (v: number) => void; step?: number;
  hint?: ReactNode; error?: string; disabled?: boolean; required?: boolean;
}) {
  const [text, setText] = useState(Number.isFinite(value) ? String(value) : '');
  // Chỉ đồng bộ từ ngoài vào khi số thật sự khác chữ đang gõ — không thì gõ
  // "1." là mất dấu chấm ngay.
  useEffect(() => {
    setText((current) => (Number(current) === value && current.trim() !== '' ? current : Number.isFinite(value) ? String(value) : ''));
  }, [value]);
  return (
    <div>
      <Input
        label={label}
        required={required}
        type="number"
        step={step}
        value={text}
        disabled={disabled}
        error={error}
        onChange={(event) => {
          setText(event.target.value);
          const parsed = event.target.value.trim() === '' ? Number.NaN : Number(event.target.value);
          onChange(parsed);
        }}
      />
      {!error && hint && <p className="mt-1 text-xs leading-relaxed text-slate-500">{hint}</p>}
    </div>
  );
}
