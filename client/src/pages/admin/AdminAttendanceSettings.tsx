// ============================================================================
// Thiết lập giờ làm cố định và định mức công.
// ----------------------------------------------------------------------------
// Đây là trang thuộc nhóm "Thời gian & Nghỉ phép", không nằm trong Cấu hình
// hệ thống. Dữ liệu vẫn ghi vào app_settings để Bảng công, Chấm công, Nghỉ
// phép và Bảng lương dùng chung một nguồn sự thật.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { saveSettings, type AppSettings } from '@/lib/settings';
import { EMPTY_SCHEDULES, fetchWorkSchedules, type ScheduleSet } from '@/lib/workSchedule';
import { WorkScheduleCard } from '@/components/attendance/WorkScheduleCard';
import { MonthStandardCard } from '@/components/attendance/MonthStandardCard';

/** Giữ bản nháp là chuỗi khi đang gõ để xoá ô không bị nhảy về 0. */
function NumberField({
  label, unit, value, min, max, step = 1, onChange,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const invalid =
    draft.trim() === '' || Number.isNaN(Number(draft)) || Number(draft) < min || Number(draft) > max;

  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-black text-slate-900 dark:text-slate-100">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={draft}
          aria-invalid={invalid}
          onChange={(event) => {
            setDraft(event.target.value);
            const next = Number(event.target.value);
            if (event.target.value.trim() !== '' && Number.isFinite(next) && next >= min && next <= max) {
              onChange(next);
            }
          }}
          className={`h-9 w-24 rounded-none border-2 bg-white dark:bg-slate-800 px-2.5 text-sm font-black tabular-nums focus:outline-none focus:ring-2 ${
            invalid
              ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
              : 'border-slate-400 dark:border-slate-600 focus:border-indigo-500 focus:ring-indigo-500/20'
          }`}
        />
        <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{unit}</span>
        {invalid && <span className="text-xs font-bold text-red-600">{min}–{max}</span>}
      </span>
    </label>
  );
}

export function AdminAttendanceSettings() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const { settings, loading, reload } = useSettings();
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [schedules, setSchedules] = useState<ScheduleSet>(EMPTY_SCHEDULES);
  const [schedulesLoading, setSchedulesLoading] = useState(true);

  const loadSchedules = useCallback(async () => {
    setSchedules(await fetchWorkSchedules(true));
    setSchedulesLoading(false);
  }, []);

  useEffect(() => { void loadSchedules(); }, [loadSchedules]);

  // Cấu hình đã khóa không tham gia tính công chuẩn.
  const activeSchedules = useMemo<ScheduleSet>(
    () => ({ ...schedules, schedules: schedules.schedules.filter((item) => item.is_active) }),
    [schedules],
  );

  useEffect(() => {
    if (!touched) setDraft(settings);
  }, [settings, touched]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(settings), [draft, settings]);

  const update = (patch: Partial<AppSettings>) => {
    setTouched(true);
    setDraft((previous) => ({ ...previous, ...patch }));
  };

  const save = async () => {
    setSaving(true);
    const { error } = await saveSettings(draft, profile?.id ?? null);
    setSaving(false);
    if (error) {
      toast(`Lưu thiết lập thất bại: ${error}`, 'error');
      return;
    }
    setTouched(false);
    await reload();
    toast('Đã lưu thiết lập giờ làm và định mức công', 'success');
  };

  const revert = () => {
    setTouched(false);
    setDraft(settings);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        Đang tải thiết lập…
      </div>
    );
  }

  const invalid = draft.standardHoursPerDay < 1 || draft.standardHoursPerDay > 24
    || draft.defaultAnnualLeave < 0 || draft.defaultAnnualLeave > 365;

  return (
    <div className="space-y-4">
      {/* Hai ô số chung nằm cùng một hàng với nút Lưu; giờ làm và công chuẩn
          bên dưới tự lưu riêng vì là danh mục nhiều dòng. */}
      <Card className="!rounded-none border-2 border-slate-400 dark:border-slate-600 shadow-sm">
        <CardContent className="flex flex-wrap items-end gap-x-8 gap-y-3 !py-3">
          <NumberField
            label="Giờ làm chuẩn / ngày"
            unit="giờ"
            value={draft.standardHoursPerDay}
            min={1}
            max={24}
            step={0.5}
            onChange={(value) => update({ standardHoursPerDay: value })}
          />
          <NumberField
            label="Phép năm mặc định"
            unit="ngày"
            value={draft.defaultAnnualLeave}
            min={0}
            max={365}
            step={0.5}
            onChange={(value) => update({ defaultAnnualLeave: value })}
          />
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" size="sm" onClick={revert} disabled={!dirty || saving}>Hoàn tác</Button>
            <Button theme="admin" size="sm" onClick={save} disabled={!dirty || saving || invalid}>
              {saving ? 'Đang lưu…' : 'Lưu'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <WorkScheduleCard set={schedules} loading={schedulesLoading} onChanged={loadSchedules} />
        <MonthStandardCard set={activeSchedules} />
      </div>
    </div>
  );
}
