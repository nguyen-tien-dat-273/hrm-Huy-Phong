// ============================================================================
// Thiết lập giờ làm cố định và định mức công.
// ----------------------------------------------------------------------------
// Đây là trang thuộc nhóm "Thời gian & Nghỉ phép", không nằm trong Cấu hình
// hệ thống. Dữ liệu vẫn ghi vào app_settings để Bảng công, Chấm công, Nghỉ
// phép và Bảng lương dùng chung một nguồn sự thật.
// ============================================================================

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Clock, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { saveSettings, type AppSettings } from '@/lib/settings';
import { WorkScheduleCard } from '@/components/attendance/WorkScheduleCard';

/** Giữ bản nháp là chuỗi khi đang gõ để xoá ô không bị nhảy về 0. */
function NumberField({
  label, hint, value, min, max, step = 1, onChange,
}: {
  label: string;
  hint: ReactNode;
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
    <div>
      <Input
        label={label}
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          const next = Number(event.target.value);
          if (event.target.value.trim() !== '' && Number.isFinite(next) && next >= min && next <= max) {
            onChange(next);
          }
        }}
      />
      <p className={`mt-1 text-xs leading-relaxed ${invalid ? 'text-red-600' : 'text-slate-500'}`}>
        {invalid ? `Nhập số trong khoảng ${min}–${max}.` : hint}
      </p>
    </div>
  );
}

export function AdminAttendanceSettings() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const { settings, loading, reload } = useSettings();
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

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

  return (
    <div className="max-w-3xl space-y-5 pb-28">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Clock className="h-4 w-4 text-indigo-600" />
        <span>Thiết lập tại đây được dùng trực tiếp bởi Chấm công, Bảng công và Bảng lương.</span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Định mức công</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <NumberField
            label="Số giờ làm chuẩn mỗi ngày"
            hint={
              <>
                Dùng để xác định đủ giờ công ở Bảng công và quy đổi <strong>đơn giá một giờ</strong>{' '}
                khi tính tăng ca, phụ cấp ca đêm.
              </>
            }
            value={draft.standardHoursPerDay}
            min={1}
            max={24}
            step={0.5}
            onChange={(value) => update({ standardHoursPerDay: value })}
          />
        </CardContent>
      </Card>

      {/* Quy tắc đọc dữ liệu từ máy chấm công. Đứng cạnh Định mức công vì cùng
          là thứ quyết định một lần quẹt có thành ngày công hay không. */}
      <Card>
        <CardHeader>
          <CardTitle>Quy tắc máy chấm công</CardTitle>
        </CardHeader>
        <CardContent>
          <NumberField
            label="Gộp các lần quẹt cách nhau dưới (giây)"
            hint="Quẹt lại vì máy không kêu, hoặc quẹt nhầm rồi quẹt lại, là chuyện hằng ngày — các lần đó được tính là MỘT. Đặt 0 để tắt."
            value={draft.deviceDedupSeconds}
            min={0}
            max={3600}
            step={10}
            onChange={(value) => update({ deviceDedupSeconds: value })}
          />
        </CardContent>
      </Card>

      {/* Giờ làm chuẩn tự lưu riêng (bảng `work_schedules`), không đi qua thanh
          "Lưu thiết lập" bên dưới — nó là danh mục nhiều dòng, không phải vài
          ô số như hai thẻ kia. */}
      <WorkScheduleCard />

      <Card>
        <CardHeader>
          <CardTitle>Nghỉ phép mặc định</CardTitle>
        </CardHeader>
        <CardContent>
          <NumberField
            label="Phép năm mặc định (ngày)"
            hint="Điều 113 BLLĐ 2019 đặt sàn 12 ngày với điều kiện lao động bình thường. Công ty được cho cao hơn."
            value={draft.defaultAnnualLeave}
            min={0}
            max={365}
            step={0.5}
            onChange={(value) => update({ defaultAnnualLeave: value })}
          />

          {/* Thâm niên: KHÔNG khoá cứng 5 năm / 1 ngày.
              Điều 114 BLLĐ 2019 là mức SÀN, công ty được cho hậu hơn. Khoá
              cứng thì công ty nào cho 3 năm +1 phải sửa code. */}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <NumberField
              label="Cứ đủ mấy năm thâm niên"
              hint="Điều 114 BLLĐ 2019: cứ đủ 5 năm làm việc cho một người sử dụng lao động."
              value={draft.leaveSeniorityStepYears}
              min={1}
              max={50}
              step={1}
              onChange={(value) => update({ leaveSeniorityStepYears: value })}
            />
            <NumberField
              label="Thì cộng thêm (ngày)"
              hint="Điều 114: tăng thêm tương ứng 1 ngày."
              value={draft.leaveSeniorityStepDays}
              min={0}
              max={30}
              step={0.5}
              onChange={(value) => update({ leaveSeniorityStepDays: value })}
            />
          </div>

          {/* Phép tồn chuyển sang năm sau là THOẢ THUẬN NỘI BỘ, không phải luật
              định — nên mặc định 0. Bật sẵn là đổi số dư của mọi người mà
              không ai yêu cầu. */}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <NumberField
              label="Phép tồn chuyển sang năm sau, tối đa (ngày)"
              hint="0 = không cho chuyển. Đây là quy định nội bộ của công ty, luật không bắt buộc."
              value={draft.leaveCarryOverMax}
              min={0}
              max={365}
              step={0.5}
              onChange={(value) => update({ leaveCarryOverMax: value })}
            />
            <div>
              <Input
                label="Hạn dùng hết phép chuyển sang"
                placeholder="VD: 03-31"
                value={draft.leaveCarryOverDeadline}
                onChange={(e) => update({
                  leaveCarryOverDeadline: e.target.value.replace(/[^\d-]/g, '').slice(0, 5),
                })}
              />
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Dạng <span className="font-mono">MM-DD</span> của năm sau. Để trống là không đặt hạn.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {dirty && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/90 px-4 py-3 shadow-lg backdrop-blur-md print:hidden">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 lg:pl-64">
            <p className="text-sm text-slate-600">Có thay đổi chưa lưu</p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={revert} disabled={saving}>Hoàn tác</Button>
              <Button theme="admin" onClick={save} disabled={saving}>
                {saving ? 'Đang lưu…' : 'Lưu thiết lập'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
