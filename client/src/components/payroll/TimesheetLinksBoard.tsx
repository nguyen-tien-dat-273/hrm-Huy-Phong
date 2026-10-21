// ============================================================================
// Liên kết Bảng công → Bảng lương.
// ----------------------------------------------------------------------------
// Hai khối: (1) số nào của Bảng công điền vào đầu mục lương nào, (2) quy tắc tính
// công sau 22h và công bị trừ do đi muộn. Khi khoá kỳ công, database tự ghi số vào
// số liệu lương tháng — kế toán không phải nhập tay những đầu mục này nữa.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Link2, Plus, Save, SlidersHorizontal, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Dropdown } from '@/components/ui/Dropdown';
import { useToast } from '@/contexts/ToastContext';
import type { PayrollWorkspace } from '@/lib/payrollData';
import {
  DEFAULT_TIMESHEET_RULES, OT_VARIABLE_OPTIONS, TIMESHEET_LINK_SOURCES, fetchTimesheetLinks, fetchTimesheetRules,
  saveTimesheetLinks, saveTimesheetRules, type LateTier, type TimesheetLinkSource, type TimesheetRules,
} from '@/lib/timesheetPayroll';

interface TierRow { from: string; days: string }

const toNumber = (value: string) => {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : NaN;
};

const inputClass = 'h-9 w-full rounded-none border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 text-center text-sm font-black tabular-nums outline-none focus:border-indigo-500';

export function TimesheetLinksBoard({ data, canManage, onChanged }: { data: PayrollWorkspace; canManage: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [tiers, setTiers] = useState<TierRow[]>([]);
  const [rules, setRules] = useState<Omit<TimesheetRules, 'late_tiers'>>({
    night_cutoff: DEFAULT_TIMESHEET_RULES.night_cutoff,
    night_requires_ot: DEFAULT_TIMESHEET_RULES.night_requires_ot,
    deduct_leave_first: DEFAULT_TIMESHEET_RULES.deduct_leave_first,
  });

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchTimesheetLinks(), fetchTimesheetRules()]).then(([linkRows, ruleRow]) => {
      if (cancelled) return;
      setLinks(Object.fromEntries(linkRows.map((link) => [link.source, link.component_code ?? ''])));
      const loadedRules = ruleRow ?? DEFAULT_TIMESHEET_RULES;
      setTiers(loadedRules.late_tiers.map((tier) => ({ from: String(tier.from), days: String(tier.days) })));
      setRules({
        night_cutoff: loadedRules.night_cutoff,
        night_requires_ot: loadedRules.night_requires_ot,
        deduct_leave_first: loadedRules.deduct_leave_first,
      });
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  const componentByCode = useMemo(
    () => new Map(data.components.map((component) => [component.code.toUpperCase(), component])),
    [data.components],
  );
  const monthlyInputIds = useMemo(
    () => new Set([...data.items, ...data.schemeItems]
      .filter((item) => item.mode === 'MONTHLY_INPUT').map((item) => item.component_id)),
    [data.items, data.schemeItems],
  );
  const kpiCodes = useMemo(() => new Set(data.kpiCodes.map((code) => code.toUpperCase())), [data.kpiCodes]);

  const options = useMemo(() => [
    { value: '', label: '— Không điền' },
    ...OT_VARIABLE_OPTIONS.map((option) => ({ value: option.code, label: option.name, detail: 'Biến có sẵn trong công thức' })),
    ...data.components
      .filter((component) => component.is_active && !OT_VARIABLE_OPTIONS.some((option) => option.code === component.code.toUpperCase()))
      .map((component) => ({ value: component.code, label: component.name, detail: component.code })),
  ], [data.components]);

  const warningFor = (source: TimesheetLinkSource, code: string): string | null => {
    if (!code) return null;
    const upper = code.toUpperCase();
    if (OT_VARIABLE_OPTIONS.some((option) => option.code === upper)) return null;
    if (kpiCodes.has(upper)) return 'Đầu mục này đang nhận số từ KPI';
    const component = componentByCode.get(upper);
    if (!component) return 'Không còn đầu mục này';
    if (!monthlyInputIds.has(component.id)) return 'Chưa có cơ chế nào bật “theo tháng” cho đầu mục này — số điền vào sẽ không được dùng';
    void source;
    return null;
  };

  const handleSave = async () => {
    const used = Object.values(links).filter(Boolean).map((code) => code.toUpperCase());
    if (new Set(used).size !== used.length) { toast('Mỗi đầu mục lương chỉ nhận số từ một nguồn của Bảng công.', 'error'); return; }

    const parsedTiers: LateTier[] = [];
    for (const row of tiers) {
      if (!row.from.trim() && !row.days.trim()) continue;
      const from = toNumber(row.from);
      const days = toNumber(row.days);
      if (!Number.isInteger(from) || from < 1 || !(days > 0)) {
        toast('Mỗi bậc phạt cần số lần là số nguyên từ 1 và số ngày phạt lớn hơn 0.', 'error');
        return;
      }
      parsedTiers.push({ from, days });
    }
    if (new Set(parsedTiers.map((tier) => tier.from)).size !== parsedTiers.length) {
      toast('Hai bậc phạt không được trùng số lần.', 'error');
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(rules.night_cutoff)) { toast('Nhập mốc giờ đêm theo dạng 22:00.', 'error'); return; }

    setSaving(true);
    const ruleError = await saveTimesheetRules({ ...rules, late_tiers: parsedTiers.sort((a, b) => a.from - b.from) });
    if (ruleError) { setSaving(false); toast(ruleError, 'error'); return; }
    const linkError = await saveTimesheetLinks(
      TIMESHEET_LINK_SOURCES.map(({ source }) => ({ source, component_code: links[source] || null })),
    );
    setSaving(false);
    if (linkError) { toast(linkError, 'error'); return; }
    toast('Đã lưu — số liệu của các kỳ công đã khoá (kỳ lương còn mở) được điền lại.');
    onChanged();
  };

  if (!loaded) {
    return <p className="px-1 py-6 text-center text-sm font-semibold text-slate-500">Đang tải…</p>;
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card className="!rounded-none border-2 border-slate-400 dark:border-slate-600 shadow-sm">
        <CardContent className="space-y-3 py-4">
          <p className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-slate-100">
            <Link2 className="h-4 w-4 text-indigo-600" /> Điền số Bảng công vào lương
          </p>
          <div className="border-2 border-slate-400 dark:border-slate-600 shadow-sm">
            <div className="grid grid-cols-[1fr_1.2fr] border-b-2 border-slate-400 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 text-xs font-black uppercase tracking-wider text-slate-900 dark:text-slate-100">
              <div className="px-3 py-2.5">Số của Bảng công</div>
              <div className="border-l border-slate-300 dark:border-slate-700 px-3 py-2.5">Đầu mục lương nhận số</div>
            </div>
            {TIMESHEET_LINK_SOURCES.map(({ source, label, unit, hint }) => {
              const warning = warningFor(source, links[source] ?? '');
              return (
                <div key={source} className="grid grid-cols-[1fr_1.2fr] border-b border-slate-300 dark:border-slate-700 last:border-b-0">
                  <div className="px-3 py-2.5" title={hint}>
                    <p className="text-sm font-black text-slate-900 dark:text-slate-100">{label}</p>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{unit}</p>
                  </div>
                  <div className="border-l border-slate-300 dark:border-slate-700 px-2 py-1.5">
                    <Dropdown compact square searchable disabled={!canManage} aria-label={`Đầu mục nhận ${label}`}
                      value={links[source] ?? ''} options={options}
                      onChange={(value) => setLinks((current) => ({ ...current, [source]: value }))} />
                    {warning && (
                      <p className="mt-1 flex items-start gap-1 text-xs font-bold text-amber-700 dark:text-amber-400">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /> {warning}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs font-medium text-slate-500">
            Số được điền khi khoá kỳ công và gỡ khi mở lại kỳ công. Đầu mục đã liên kết thì không sửa tay ở Bảng lương.
            Lương nghỉ lễ tự tính từ ngày lễ công ty nên không cần liên kết — Bảng công chỉ hiện số ngày để đối chiếu.
          </p>
        </CardContent>
      </Card>

      <Card className="!rounded-none border-2 border-slate-400 dark:border-slate-600 shadow-sm">
        <CardContent className="space-y-4 py-4">
          <p className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-slate-100">
            <SlidersHorizontal className="h-4 w-4 text-indigo-600" /> Quy tắc tính
          </p>

          <div>
            <p className="mb-1 text-xs font-bold text-slate-700 dark:text-slate-300">
              Công làm thêm sau 22h <span className="font-normal text-slate-400">— ngày ra sau mốc giờ này cộng một công</span>
            </p>
            <div className="grid grid-cols-[8rem_1fr] items-center gap-3">
              <input type="time" value={rules.night_cutoff} disabled={!canManage}
                onChange={(event) => setRules((value) => ({ ...value, night_cutoff: event.target.value }))} className={inputClass} />
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={rules.night_requires_ot} disabled={!canManage}
                  onChange={(event) => setRules((value) => ({ ...value, night_requires_ot: event.target.checked }))} />
                Chỉ tính ngày có đơn làm thêm đã duyệt
              </label>
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs font-bold text-slate-700 dark:text-slate-300">
              Phạt đi muộn quá số lần <span className="font-normal text-slate-400">— từ số lần này trở lên bị phạt ngần ấy ngày công</span>
            </p>
            <div className="border-2 border-slate-400 dark:border-slate-600 shadow-sm">
              <div className="grid grid-cols-[1fr_1fr_2.5rem] border-b-2 border-slate-400 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 text-xs font-black text-slate-900 dark:text-slate-100">
                <div className="px-3 py-2">Từ số lần đi muộn</div>
                <div className="border-l border-slate-300 dark:border-slate-700 px-3 py-2">Ngày công bị phạt</div>
                <div />
              </div>
              {tiers.map((row, index) => (
                <div key={index} className="grid grid-cols-[1fr_1fr_2.5rem] border-b border-slate-300 dark:border-slate-700 last:border-b-0">
                  <div className="p-1.5">
                    <input value={row.from} inputMode="numeric" disabled={!canManage} className={inputClass}
                      onChange={(event) => setTiers((rows) => rows.map((item, i) => (i === index ? { ...item, from: event.target.value } : item)))} />
                  </div>
                  <div className="border-l border-slate-300 dark:border-slate-700 p-1.5">
                    <input value={row.days} inputMode="decimal" disabled={!canManage} className={inputClass}
                      onChange={(event) => setTiers((rows) => rows.map((item, i) => (i === index ? { ...item, days: event.target.value } : item)))} />
                  </div>
                  <button type="button" disabled={!canManage} aria-label="Xoá bậc"
                    onClick={() => setTiers((rows) => rows.filter((_, i) => i !== index))}
                    className="flex items-center justify-center text-slate-400 hover:text-red-600 disabled:opacity-40">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {tiers.length === 0 && (
                <p className="px-3 py-3 text-xs font-semibold text-slate-500">Chưa có bậc nào — đi muộn bao nhiêu lần cũng không bị trừ công.</p>
              )}
            </div>
            {canManage && (
              <Button size="sm" variant="outline" className="mt-2" onClick={() => setTiers((rows) => [...rows, { from: '', days: '' }])}>
                <Plus className="h-3.5 w-3.5" /> Thêm bậc
              </Button>
            )}
            <p className="mt-2 text-xs font-medium text-slate-500">
              Số lần đi muộn đo từ ca làm việc, bỏ những ngày có đơn đi muộn đã duyệt.
            </p>
          </div>

          <label className="flex items-start gap-2 text-xs font-bold text-slate-700 dark:text-slate-300">
            <input type="checkbox" className="mt-0.5" checked={rules.deduct_leave_first} disabled={!canManage}
              onChange={(event) => setRules((value) => ({ ...value, deduct_leave_first: event.target.checked }))} />
            <span>
              Trừ phép năm còn lại trước
              <span className="block font-normal text-slate-500">
                Ngày phạt trừ vào phép năm (ghi vào sổ phép); phần thiếu mới thành công bị trừ trong lương. Mở lại kỳ công thì hoàn phép.
              </span>
            </span>
          </label>

          {canManage && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
                <Save className="h-3.5 w-3.5" /> {saving ? 'Đang lưu…' : 'Lưu'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
