// ============================================================================
// Khai báo giờ làm hành chính cố định theo từng khoảng hiệu lực.
// ----------------------------------------------------------------------------
// Đây là nơi trả lời tham số P02 của sheet "Đặc tả Lương – KPI". Công chuẩn
// tháng không còn là một con số gõ tay: nó được SUY RA từ lịch, nên tháng nào
// ra đúng số công của tháng đó. Thẻ hiện luôn kết quả cho tháng hiện tại để
// người khai đối chiếu ngay với phiếu lương mẫu.
//
// Cũng là nơi duy nhất khai GIỜ VÀO CHUẨN — điều kiện cần để đo đi muộn.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import {
  EMPTY_SCHEDULES, fetchWorkSchedules, hoursPerDay, monthStandardDays,
  type ScheduleSet, type WorkSchedule,
} from '@/lib/workSchedule';

const SATURDAY_LABEL: Record<WorkSchedule['saturday_mode'], string> = {
  OFF: 'Nghỉ cả ngày',
  HALF: 'Làm nửa ngày',
  FULL: 'Làm cả ngày',
};

interface Draft {
  id?: string;
  name: string;
  effective_from: string;
  effective_to: string;
  start_time: string;
  end_time: string;
  break_minutes: string;
  saturday_mode: WorkSchedule['saturday_mode'];
  grace_minutes: string;
  note: string;
}

const BLANK: Draft = {
  name: '', effective_from: '', effective_to: '',
  start_time: '08:00', end_time: '17:30', break_minutes: '90',
  saturday_mode: 'HALF', grace_minutes: '0', note: '',
};

/** 'HH:MM:SS' từ database về 'HH:MM' cho ô input type=time. */
const toInputTime = (value: string) => value.slice(0, 5);

export function WorkScheduleCard() {
  const { toast } = useToast();
  const confirm = useConfirm();

  const [set, setSet] = useState<ScheduleSet>(EMPTY_SCHEDULES);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setSet(await fetchWorkSchedules());
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  // Đối chiếu ngay: khai lịch xong thấy luôn công chuẩn tháng này ra bao nhiêu.
  const preview = useMemo(() => {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      label: `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`,
      days: monthStandardDays(set, thisMonth),
    };
  }, [set]);

  const save = async () => {
    if (!draft || !supabase) return;
    if (!draft.name.trim()) {
      toast('Nhập tên cấu hình giờ làm.', 'warning');
      return;
    }
    if (!draft.effective_from) {
      toast('Chọn ngày bắt đầu áp dụng.', 'warning');
      return;
    }
    if (draft.end_time === draft.start_time) {
      toast('Giờ ra phải khác giờ vào.', 'warning');
      return;
    }

    const payload = {
      name: draft.name.trim(),
      effective_from: draft.effective_from,
      effective_to: draft.effective_to || null,
      start_time: draft.start_time,
      end_time: draft.end_time,
      break_minutes: Number(draft.break_minutes) || 0,
      saturday_mode: draft.saturday_mode,
      grace_minutes: Number(draft.grace_minutes) || 0,
      note: draft.note.trim() || null,
    };

    setSaving(true);
    const { error } = draft.id
      ? await supabase.from('work_schedules').update(payload).eq('id', draft.id)
      : await supabase.from('work_schedules').insert(payload);
    setSaving(false);

    if (error) {
      toast('Lưu giờ làm thất bại: ' + describeDbError(error), 'error');
      return;
    }
    toast(`Đã lưu giờ làm "${draft.name}".`, 'success');
    setDraft(null);
    void load();
  };

  const remove = async (schedule: WorkSchedule) => {
    const ok = await confirm({
      title: `Xóa cấu hình "${schedule.name}"?`,
      message:
        'Những tháng đang dựa vào cấu hình này sẽ quay về ngày công chuẩn cố định trong Tham số lương, ' +
        'và hệ thống ngừng đo đi muộn cho khoảng thời gian đó. Phiếu lương đã duyệt không đổi.',
      confirmLabel: 'Xóa cấu hình',
      danger: true,
    });
    if (!ok || !supabase) return;

    const { error } = await supabase.from('work_schedules').delete().eq('id', schedule.id);
    if (error) {
      toast('Xóa thất bại: ' + describeDbError(error), 'error');
      return;
    }
    toast('Đã xóa cấu hình giờ làm.', 'success');
    void load();
  };

  const openEdit = (schedule: WorkSchedule) => setDraft({
    id: schedule.id,
    name: schedule.name,
    effective_from: schedule.effective_from,
    effective_to: schedule.effective_to ?? '',
    start_time: toInputTime(schedule.start_time),
    end_time: toInputTime(schedule.end_time),
    break_minutes: String(schedule.break_minutes),
    saturday_mode: schedule.saturday_mode,
    grace_minutes: String(schedule.grace_minutes),
    note: schedule.note ?? '',
  });

  // Migration chưa chạy — nói thẳng thay vì hiện một thẻ rỗng khó hiểu.
  if (!loading && !set.supported) {
    return (
      <Card>
        <CardHeader><CardTitle>Giờ làm chuẩn</CardTitle></CardHeader>
        <CardContent>
          <p className="flex items-start gap-2.5 py-2 text-sm leading-relaxed text-slate-500">
            <TriangleAlert className="mt-0.5 h-4.5 w-4.5 flex-shrink-0 text-amber-500" />
            Chưa bật quản lý giờ làm chuẩn. Chạy migration{' '}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
              20260928110000_work_schedules.sql
            </code>{' '}
            để công chuẩn tính theo lịch từng tháng và đo được đi muộn.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Giờ làm cố định</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setDraft({ ...BLANK })}>
            <Plus className="h-3.5 w-3.5" /> Thêm cấu hình
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-xs leading-relaxed text-slate-500">
          Khai báo giờ vào/ra cố định để đối chiếu dữ liệu máy chấm công, tính đi muộn, về sớm
          và <strong>công chuẩn của từng tháng</strong>. Chỉ cần tạo cấu hình mới khi giờ làm thay đổi.
        </p>

        {preview.days != null && (
          <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800">
            <CalendarClock className="h-4 w-4 flex-shrink-0" />
            Công chuẩn tháng {preview.label} theo lịch này: <strong>{preview.days} công</strong>
          </p>
        )}

        {loading ? (
          <p className="py-4 text-center text-sm text-slate-400">Đang tải…</p>
        ) : set.schedules.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
            Chưa khai giờ làm. Công chuẩn đang lấy theo số cố định trong Tham số lương,
            và hệ thống chưa đo được đi muộn.
          </p>
        ) : (
          <ul className="divide-y divide-slate-50">
            {set.schedules.map((schedule) => {
              const perDay = hoursPerDay(schedule);
              return (
                <li key={schedule.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800">{schedule.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {toInputTime(schedule.start_time)}–{toInputTime(schedule.end_time)}
                      {perDay != null && ` · ${perDay} giờ/ngày`}
                      {' · Thứ Bảy: '}{SATURDAY_LABEL[schedule.saturday_mode]}
                      {schedule.grace_minutes > 0 && ` · ân hạn ${schedule.grace_minutes} phút`}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Áp dụng từ {schedule.effective_from}
                      {schedule.effective_to ? ` đến ${schedule.effective_to}` : ' (không giới hạn)'}
                    </p>
                    {schedule.note && (
                      <p className="mt-1 text-xs leading-relaxed text-slate-400">{schedule.note}</p>
                    )}
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <button
                      onClick={() => openEdit(schedule)}
                      className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                      aria-label={`Sửa ${schedule.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => remove(schedule)}
                      className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                      aria-label={`Xóa ${schedule.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Sửa giờ làm' : 'Thiết lập giờ làm'}
        size="lg"
      >
        {draft && (
          <div className="space-y-4">
            <Input
              label="Tên cấu hình"
              placeholder="VD: Giờ làm hành chính"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Áp dụng từ"
                type="date"
                value={draft.effective_from}
                onChange={(e) => setDraft({ ...draft, effective_from: e.target.value })}
              />
              <Input
                label="Đến ngày (trống = không giới hạn)"
                type="date"
                value={draft.effective_to}
                onChange={(e) => setDraft({ ...draft, effective_to: e.target.value })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                label="Giờ vào"
                type="time"
                value={draft.start_time}
                onChange={(e) => setDraft({ ...draft, start_time: e.target.value })}
              />
              <Input
                label="Giờ ra"
                type="time"
                value={draft.end_time}
                onChange={(e) => setDraft({ ...draft, end_time: e.target.value })}
              />
              <Input
                label="Nghỉ trưa (phút)"
                inputMode="numeric"
                value={draft.break_minutes}
                onChange={(e) => setDraft({ ...draft, break_minutes: e.target.value.replace(/[^\d]/g, '') })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Select
                  label="Thứ Bảy"
                  value={draft.saturday_mode}
                  onChange={(e) => setDraft({ ...draft, saturday_mode: e.target.value as Draft['saturday_mode'] })}
                >
                  {Object.entries(SATURDAY_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </Select>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                  Quyết định công chuẩn tháng. "Làm nửa ngày" cho ra 23,5 công tháng 8/2026 —
                  đúng con số trên phiếu lương mẫu.
                </p>
              </div>
              <div>
                <Input
                  label="Ân hạn đi muộn (phút)"
                  inputMode="numeric"
                  value={draft.grace_minutes}
                  onChange={(e) => setDraft({ ...draft, grace_minutes: e.target.value.replace(/[^\d]/g, '') })}
                />
                <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                  Vào trễ trong khoảng này không tính là muộn. Để 0 nếu công ty tính từ phút đầu.
                </p>
              </div>
            </div>

            <Textarea
              label="Ghi chú"
              rows={2}
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />

            <div className="flex gap-3 pt-1">
              <Button variant="outline" onClick={() => setDraft(null)} className="flex-1" disabled={saving}>
                Hủy
              </Button>
              <Button onClick={save} className="flex-1" disabled={saving}>
                {saving ? 'Đang lưu…' : 'Lưu giờ làm'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}
