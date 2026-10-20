// ============================================================================
// Khai báo giờ làm hành chính cố định theo từng khoảng hiệu lực.
// ----------------------------------------------------------------------------
// Đây là nơi trả lời tham số P02 của sheet "Đặc tả Lương – KPI": công chuẩn
// tháng được SUY RA từ lịch này (xem `MonthStandardCard` để đối chiếu và chỉnh
// từng tháng). Cũng là nơi duy nhất khai GIỜ VÀO CHUẨN — điều kiện cần để đo
// đi muộn.
// ============================================================================

import { useState } from 'react';
import { Lock, LockOpen, Pencil, Plus, TriangleAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select } from '@/components/ui/Input';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { hoursPerDay, type ScheduleSet, type WorkSchedule } from '@/lib/workSchedule';

const SATURDAY_LABEL: Record<WorkSchedule['saturday_mode'], string> = {
  OFF: 'Nghỉ',
  HALF: 'Nửa ngày',
  FULL: 'Cả ngày',
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

/** '2026-04-01' → '01/04/2026'. */
const toViDate = (iso: string) => iso.split('-').reverse().join('/');

const TH = 'border-l border-[#eed5d8] dark:border-[#4a1c22] first:border-l-0 px-3.5 py-2.5 text-left text-xs font-black uppercase tracking-wider text-[#5c0f16] dark:text-[#fde8ea] whitespace-normal break-words';
const TD = 'border-l border-slate-300 dark:border-slate-700 first:border-l-0 px-3.5 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap';

interface Props {
  set: ScheduleSet;
  loading: boolean;
  /** Gọi sau khi thêm / sửa / xóa để trang nạp lại lịch. */
  onChanged: () => void;
}

export function WorkScheduleCard({ set, loading, onChanged }: Props) {
  const { toast } = useToast();
  const confirm = useConfirm();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

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
    onChanged();
  };

  // Không cho xóa: cấu hình đã dùng tính lương và đo đi muộn nên chỉ khóa / mở khóa.
  const toggleLock = async (schedule: WorkSchedule) => {
    if (schedule.is_active) {
      const ok = await confirm({
        title: `Khóa cấu hình "${schedule.name}"?`,
        message:
          'Những tháng đang dựa vào cấu hình này sẽ quay về ngày công chuẩn cố định trong Tham số lương, ' +
          'và hệ thống ngừng đo đi muộn cho khoảng thời gian đó. Phiếu lương đã duyệt không đổi. ' +
          'Có thể mở khóa lại bất cứ lúc nào.',
        confirmLabel: 'Khóa cấu hình',
        danger: true,
      });
      if (!ok) return;
    }
    if (!supabase) return;

    const { error } = await supabase.from('work_schedules')
      .update({ is_active: !schedule.is_active }).eq('id', schedule.id);
    if (error) {
      toast((schedule.is_active ? 'Khóa' : 'Mở khóa') + ' thất bại: ' + describeDbError(error), 'error');
      return;
    }
    toast(schedule.is_active ? 'Đã khóa cấu hình giờ làm.' : 'Đã mở khóa cấu hình giờ làm.', 'success');
    onChanged();
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
      <Card className="!rounded-none border-2 border-slate-400 dark:border-slate-600 shadow-sm">
        <CardHeader><CardTitle>Giờ làm cố định</CardTitle></CardHeader>
        <CardContent>
          <p className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-500">
            <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
            <span>
              Chưa bật quản lý giờ làm. Chạy migration{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                20260928110000_work_schedules.sql
              </code>.
            </span>
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="!rounded-none border-2 border-slate-400 dark:border-slate-600 shadow-sm">
      <CardHeader className="!py-3 border-b-2 border-slate-300 dark:border-slate-700">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Giờ làm cố định</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setDraft({ ...BLANK })}>
            <Plus className="h-3.5 w-3.5" /> Thêm
          </Button>
        </div>
      </CardHeader>

      {loading ? (
        <p className="py-6 text-center text-sm font-bold text-slate-400">Đang tải…</p>
      ) : set.schedules.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm font-semibold text-slate-500">
          Chưa khai giờ làm — công chuẩn lấy theo Tham số lương, chưa đo được đi muộn.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left border-collapse">
            <thead className="border-b-2 border-[#bf1f2b] dark:border-[#e66a76] bg-[#fdf2f4] dark:bg-[#201114] shadow-[inset_0_-2px_0_#bf1f2b] dark:shadow-[inset_0_-2px_0_#e66a76]">
              <tr>
                <th className={TH}>Tên</th>
                <th className={TH}>Áp dụng</th>
                <th className={TH}>Giờ làm</th>
                <th className={`${TH} text-right`}>Giờ/ngày</th>
                <th className={TH}>Thứ Bảy</th>
                <th className={`${TH} text-right`}>Ân hạn</th>
                <th className="w-20 border-l border-slate-300 dark:border-slate-700" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300 dark:divide-slate-700 bg-white dark:bg-slate-900 font-semibold">
              {set.schedules.map((schedule) => {
                const perDay = hoursPerDay(schedule);
                return (
                  <tr
                    key={schedule.id}
                    className={schedule.is_active ? 'hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition-colors' : 'bg-slate-100/60 dark:bg-slate-800/40 text-slate-400'}
                  >
                    <td className={`${TD} font-black ${schedule.is_active ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400'}`} title={schedule.note ?? undefined}>
                      {schedule.name}
                      {!schedule.is_active && (
                        <span className="ml-2 inline-flex items-center gap-1 bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
                          <Lock className="h-3 w-3" /> Đã khóa
                        </span>
                      )}
                    </td>
                    <td className={TD}>
                      {toViDate(schedule.effective_from)}
                      {' → '}
                      {schedule.effective_to ? toViDate(schedule.effective_to) : '…'}
                    </td>
                    <td className={TD}>
                      {toInputTime(schedule.start_time)}–{toInputTime(schedule.end_time)}
                      <span className="text-slate-400"> · nghỉ {schedule.break_minutes}′</span>
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>{perDay ?? '—'}</td>
                    <td className={TD}>{SATURDAY_LABEL[schedule.saturday_mode]}</td>
                    <td className={`${TD} text-right tabular-nums`}>
                      {schedule.grace_minutes > 0 ? `${schedule.grace_minutes} phút` : '—'}
                    </td>
                    <td className="px-2 text-right">
                      <button
                        onClick={() => openEdit(schedule)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                        aria-label={`Sửa ${schedule.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => void toggleLock(schedule)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-amber-50 hover:text-amber-600"
                        title={schedule.is_active ? 'Khóa' : 'Mở khóa'}
                        aria-label={`${schedule.is_active ? 'Khóa' : 'Mở khóa'} ${schedule.name}`}
                      >
                        {schedule.is_active ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Sửa giờ làm' : 'Thêm giờ làm'}
        size="lg"
      >
        {draft && (
          <div className="space-y-3">
            <Input
              label="Tên cấu hình"
              placeholder="VD: Giờ mùa hè"
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
                label="Đến ngày (trống = mãi mãi)"
                type="date"
                value={draft.effective_to}
                onChange={(e) => setDraft({ ...draft, effective_to: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
              <Input
                label="Ân hạn muộn (phút)"
                inputMode="numeric"
                value={draft.grace_minutes}
                onChange={(e) => setDraft({ ...draft, grace_minutes: e.target.value.replace(/[^\d]/g, '') })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Thứ Bảy"
                value={draft.saturday_mode}
                onChange={(e) => setDraft({ ...draft, saturday_mode: e.target.value as Draft['saturday_mode'] })}
              >
                {Object.entries(SATURDAY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
              <Input
                label="Ghi chú"
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              />
            </div>

            <div className="flex gap-3 pt-1">
              <Button variant="outline" onClick={() => setDraft(null)} className="flex-1" disabled={saving}>
                Hủy
              </Button>
              <Button onClick={save} className="flex-1" disabled={saving}>
                {saving ? 'Đang lưu…' : 'Lưu'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}
