// ============================================================================
// Tham số KPI (theo tháng hiệu lực) và liên kết kết quả KPI → đầu mục lương.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Link2, Plus, Save, SlidersHorizontal, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Dropdown } from '@/components/ui/Dropdown';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { DEFAULT_GRADES, LINK_SOURCES, fmtNum, parseNum, type KpiGrade, type KpiLinkSource, type KpiSettings } from '@/lib/kpi';
import {
  deleteSettings, loadComponentModes, savePayrollLinks, saveSettings, settingsFor, type KpiWorkspace,
} from '@/lib/kpiData';

interface Form {
  effective_from: string;
  cap_pct: string;
  bonus_max_pct: string;
  grades: Array<{ code: string; label: string; min: string }>;
  open_day: string;
  self_due_day: string;
  manager_due_day: string;
  manager_due_time: string;
  board_due_day: string;
  board_due_time: string;
  lock_day: string;
  lock_time: string;
}

const toForm = (row: KpiSettings | null, month: string): Form => ({
  effective_from: (row?.effective_from ?? month).slice(0, 7),
  cap_pct: String(row?.cap_pct ?? 120),
  bonus_max_pct: String(row?.bonus_max_pct ?? 10),
  grades: (row?.grades ?? DEFAULT_GRADES).map((grade) => ({ code: grade.code, label: grade.label, min: String(grade.min) })),
  open_day: String(row?.open_day ?? 25),
  self_due_day: String(row?.self_due_day ?? 2),
  manager_due_day: String(row?.manager_due_day ?? 3),
  manager_due_time: row?.manager_due_time ?? '17:00',
  board_due_day: String(row?.board_due_day ?? 4),
  board_due_time: row?.board_due_time ?? '12:00',
  lock_day: String(row?.lock_day ?? 4),
  lock_time: row?.lock_time ?? '17:00',
});

export function KpiSettingsBoard({ data, month, onChanged }: { data: KpiWorkspace; month: string; onChanged: () => void }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const current = settingsFor(data.settings, month);
  const [form, setForm] = useState<Form>(() => toForm(current, month));
  const [saving, setSaving] = useState(false);
  const [links, setLinks] = useState<Record<string, string>>(() =>
    Object.fromEntries(data.links.map((link) => [link.source, link.component_code ?? ''])));
  const [modes, setModes] = useState<Map<string, Set<string>> | null>(null);

  useEffect(() => { void loadComponentModes().then(setModes); }, []);

  const set = (patch: Partial<Form>) => setForm((value) => ({ ...value, ...patch }));
  const componentByCode = useMemo(() => new Map(data.components.map((component) => [component.code.toUpperCase(), component])), [data.components]);
  const componentOptions = [
    { value: '', label: '— Không điền' },
    ...data.components.filter((component) => component.is_active).map((component) => ({ value: component.code, label: component.name, detail: component.code })),
  ];

  const handleSave = async () => {
    const grades: KpiGrade[] = form.grades
      .filter((grade) => grade.code.trim())
      .map((grade) => ({ code: grade.code.trim(), label: grade.label.trim(), min: parseNum(grade.min) ?? 0 }))
      .sort((a, b) => b.min - a.min);
    const int = (value: string) => Math.round(parseNum(value) ?? 0);
    setSaving(true);
    const error = await saveSettings({
      effective_from: `${form.effective_from}-01`,
      cap_pct: parseNum(form.cap_pct) ?? 120,
      bonus_max_pct: parseNum(form.bonus_max_pct) ?? 10,
      grades,
      open_day: int(form.open_day),
      self_due_day: int(form.self_due_day),
      manager_due_day: int(form.manager_due_day),
      manager_due_time: form.manager_due_time,
      board_due_day: int(form.board_due_day),
      board_due_time: form.board_due_time,
      lock_day: int(form.lock_day),
      lock_time: form.lock_time,
    });
    setSaving(false);
    if (error) { toast(error, 'error'); return; }
    toast(`Đã lưu tham số áp dụng từ ${form.effective_from.slice(5)}/${form.effective_from.slice(0, 4)}.`);
    onChanged();
  };

  const handleDeleteVersion = async (row: KpiSettings) => {
    if (!(await confirm({ title: 'Xoá bộ tham số này?', confirmLabel: 'Xoá', danger: true }))) return;
    const error = await deleteSettings(row.id);
    if (error) toast(error, 'error'); else onChanged();
  };

  const handleSaveLinks = async () => {
    const used = Object.values(links).filter(Boolean);
    if (new Set(used).size !== used.length) { toast('Mỗi đầu mục lương chỉ nhận số từ một kết quả KPI.', 'error'); return; }
    setSaving(true);
    const { error } = await savePayrollLinks(LINK_SOURCES.map(({ source }) => ({ source, component_code: links[source] || null })));
    setSaving(false);
    if (error) { toast(error, 'error'); return; }
    toast('Đã lưu liên kết lương — kết quả các kỳ đã khoá sổ được điền lại.');
    onChanged();
  };

  const linkWarning = (code: string) => {
    if (!code || !modes) return null;
    const component = componentByCode.get(code.toUpperCase());
    if (!component) return 'Không còn đầu mục này';
    const used = modes.get(component.id);
    if (!used || used.size === 0) return 'Chưa có trong cơ chế lương nào';
    if (!used.has('MONTHLY_INPUT')) return 'Cơ chế đang tính bằng cách khác — đổi sang “Theo tháng” để nhận số';
    return null;
  };

  const numInput = 'h-9 w-full rounded-none border-2 border-slate-300 dark:border-slate-600 px-2 text-center text-sm font-black tabular-nums outline-none focus:border-indigo-500';
  const versions = [...data.settings].sort((a, b) => b.effective_from.localeCompare(a.effective_from));

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {/* Liên kết lương */}
      <Card className="!rounded-none border-2 border-slate-400 dark:border-slate-600 shadow-sm xl:order-2">
        <CardContent className="space-y-3 py-4">
          <p className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-slate-100"><Link2 className="h-4 w-4 text-indigo-600" /> Điền kết quả KPI vào lương</p>
          <div className="border-2 border-slate-400 dark:border-slate-600 shadow-sm">
            <div className="grid grid-cols-[1fr_1.2fr] border-b-2 border-slate-400 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 text-xs font-black uppercase tracking-wider text-slate-900 dark:text-slate-100">
              <div className="px-3 py-2.5">Kết quả KPI</div>
              <div className="border-l border-slate-300 dark:border-slate-700 px-3 py-2.5">Đầu mục lương nhận số</div>
            </div>
            {LINK_SOURCES.map(({ source, label, unit, hint }) => {
              const warning = linkWarning(links[source] ?? '');
              return (
                <div key={source} className="grid grid-cols-[1fr_1.2fr] border-b border-slate-300 dark:border-slate-700 last:border-b-0">
                  <div className="px-3 py-2.5" title={hint}>
                    <p className="text-sm font-black text-slate-900 dark:text-slate-100">{label}</p>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{unit}</p>
                  </div>
                  <div className="border-l border-slate-300 dark:border-slate-700 px-2 py-1.5">
                    <Dropdown compact square searchable aria-label={`Đầu mục nhận ${label}`} value={links[source] ?? ''}
                      options={componentOptions}
                      onChange={(value) => setLinks((current) => ({ ...current, [source as KpiLinkSource]: value }))} />
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
          <p className="text-xs font-medium text-slate-500">Tỷ lệ KPI chốt luôn có sẵn trong công thức lương với tên “Tỷ lệ KPI”.</p>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => void handleSaveLinks()} disabled={saving}><Save className="h-3.5 w-3.5" /> Lưu liên kết</Button>
          </div>
        </CardContent>
      </Card>

      {/* Tham số */}
      <Card className="!rounded-none border-2 border-slate-400 dark:border-slate-600 shadow-sm xl:order-1">
        <CardContent className="space-y-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-slate-100"><SlidersHorizontal className="h-4 w-4 text-indigo-600" /> Tham số KPI</p>
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300">
              Áp dụng từ tháng
              <input type="month" value={form.effective_from} onChange={(event) => set({ effective_from: event.target.value })}
                className="h-9 rounded-none border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 text-sm font-black outline-none focus:border-indigo-500" />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300">Trần KPI (%)</span>
              <input value={form.cap_pct} inputMode="decimal" onChange={(event) => set({ cap_pct: event.target.value })} className={numInput} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300">Thưởng trọng điểm tối đa (%)</span>
              <input value={form.bonus_max_pct} inputMode="decimal" onChange={(event) => set({ bonus_max_pct: event.target.value })} className={numInput} />
            </label>
          </div>

          <div>
            <p className="mb-1 text-xs font-bold text-slate-700 dark:text-slate-300">Xếp loại <span className="font-normal text-slate-400">(KPI% từ mức này trở lên)</span></p>
            <div className="border-2 border-slate-400 dark:border-slate-600 shadow-sm">
              {form.grades.map((grade, index) => (
                <div key={index} className="grid grid-cols-[64px_1fr_96px_36px] border-b border-slate-300 dark:border-slate-700 last:border-b-0">
                  <input value={grade.code} aria-label="Ký hiệu"
                    onChange={(event) => set({ grades: form.grades.map((row, i) => (i === index ? { ...row, code: event.target.value } : row)) })}
                    className="h-9 border-0 border-r border-slate-300 dark:border-slate-700 px-2 text-center text-sm font-black text-slate-900 dark:text-slate-100 outline-none focus:bg-indigo-50/40" />
                  <input value={grade.label} aria-label="Tên loại"
                    onChange={(event) => set({ grades: form.grades.map((row, i) => (i === index ? { ...row, label: event.target.value } : row)) })}
                    className="h-9 border-0 border-r border-slate-300 dark:border-slate-700 px-2 text-sm font-bold text-slate-900 dark:text-slate-100 outline-none focus:bg-indigo-50/40" />
                  <input value={grade.min} inputMode="decimal" aria-label="Từ %"
                    onChange={(event) => set({ grades: form.grades.map((row, i) => (i === index ? { ...row, min: event.target.value } : row)) })}
                    className="h-9 border-0 border-r border-slate-300 dark:border-slate-700 px-2 text-center text-sm font-black tabular-nums text-slate-900 dark:text-slate-100 outline-none focus:bg-indigo-50/40" />
                  <button type="button" aria-label="Bỏ loại" className="flex items-center justify-center text-slate-400 hover:text-red-600 transition-colors"
                    onClick={() => set({ grades: form.grades.filter((_, i) => i !== index) })}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
              onClick={() => set({ grades: [...form.grades, { code: '', label: '', min: '' }] })}><Plus className="h-3 w-3" /> Thêm loại</button>
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold text-slate-600">Lịch kỳ</p>
            <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
              <DayField label="Mở kỳ: ngày (tháng đánh giá)" day={form.open_day} onDay={(value) => set({ open_day: value })} />
              <DayField label="Hạn tự chấm: ngày (tháng sau)" day={form.self_due_day} onDay={(value) => set({ self_due_day: value })} />
              <DayField label="Hạn quản lý chấm" day={form.manager_due_day} time={form.manager_due_time}
                onDay={(value) => set({ manager_due_day: value })} onTime={(value) => set({ manager_due_time: value })} />
              <DayField label="Hạn BGĐ duyệt" day={form.board_due_day} time={form.board_due_time}
                onDay={(value) => set({ board_due_day: value })} onTime={(value) => set({ board_due_time: value })} />
              <DayField label="Khoá sổ" day={form.lock_day} time={form.lock_time}
                onDay={(value) => set({ lock_day: value })} onTime={(value) => set({ lock_time: value })} />
            </div>
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={() => void handleSave()} disabled={saving}><Save className="h-3.5 w-3.5" /> Lưu tham số</Button>
          </div>

          {versions.length > 1 && (
            <div className="border-t border-slate-100 pt-3">
              <p className="mb-1 text-xs font-semibold text-slate-600">Các lần thay đổi</p>
              <ul className="divide-y divide-slate-100 text-xs">
                {versions.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-2 py-1.5">
                    <button type="button" className="text-left hover:text-indigo-700" onClick={() => setForm(toForm(row, month))}>
                      Từ {row.effective_from.slice(5, 7)}/{row.effective_from.slice(0, 4)} · trần {fmtNum(row.cap_pct)}% · thưởng tối đa {fmtNum(row.bonus_max_pct)}%
                    </button>
                    {row.id !== current?.id && (
                      <button type="button" aria-label="Xoá" className="text-slate-400 hover:text-red-600" onClick={() => void handleDeleteVersion(row)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DayField({ label, day, time, onDay, onTime }: {
  label: string; day: string; time?: string; onDay: (value: string) => void; onTime?: (value: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 border border-slate-200 px-2 py-1.5">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <input value={day} inputMode="numeric" aria-label={`${label} — ngày`} onChange={(event) => onDay(event.target.value.replace(/\D/g, ''))}
          className="h-8 w-12 rounded-none border border-slate-200 px-1 text-center tabular-nums outline-none focus:border-indigo-500" />
        {onTime && (
          <input type="time" value={time} aria-label={`${label} — giờ`} onChange={(event) => onTime(event.target.value)}
            className="h-8 rounded-none border border-slate-200 px-1 tabular-nums outline-none focus:border-indigo-500" />
        )}
      </span>
    </label>
  );
}
