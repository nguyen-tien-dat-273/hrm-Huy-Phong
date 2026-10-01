// ============================================================================
// Nhật ký giờ làm theo ngày.
// ============================================================================

import { supabase } from './supabase';
import { describeDbError, describeDbErrorOrNull } from '@/lib/dbError';
import { toDateString } from './utils';
import type { Attendance, Task, TaskWorklog } from '@/types';

/** Chênh lệch dưới ngưỡng này thì coi như khớp, không cảnh báo. */
export const UNLOGGED_TOLERANCE_HOURS = 0.5;

/** Tiện ích tuần dùng cho nhật ký giờ; không liên quan đến ca làm cá nhân. */
export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const weekday = d.getDay();
  d.setDate(d.getDate() + (weekday === 0 ? -6 : 1 - weekday));
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function weekDays(date: Date): { date: Date; key: string; label: string; weekdayLabel: string }[] {
  const monday = startOfWeek(date);
  const names = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  return names.map((weekdayLabel, index) => {
    const day = addDays(monday, index);
    return { date: day, key: toDateString(day), label: day.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }), weekdayLabel };
  });
}

export interface WorklogEntry {
  task: Task;
  hours: number;
  note: string;
  /** id của bản ghi đã có; rỗng nghĩa là chưa ghi ngày này. */
  worklogId: string | null;
}

/**
 * Tác vụ mà một người có thể ghi giờ trong ngày, kèm giờ đã ghi (nếu có).
 *
 * Lấy tác vụ CHƯA HOÀN THÀNH được giao cho người đó, cộng thêm mọi tác vụ họ
 * đã lỡ ghi giờ hôm đó — kể cả tác vụ đã xong hoặc đã đổi người phụ trách, để
 * không nuốt mất dữ liệu đã nhập.
 */
export async function fetchDayEntries(
  userId: string,
  workDate: string,
): Promise<{ entries: WorklogEntry[]; error?: string }> {
  const [taskResult, logResult] = await Promise.all([
    supabase
      .from('tasks')
      .select('*, project:projects(id, name)')
      .eq('assignee_id', userId)
      .neq('status', 'done')
      .order('order_index', { ascending: true }),
    supabase
      .from('task_worklogs')
      .select('*, task:tasks(*, project:projects(id, name))')
      .eq('user_id', userId)
      .eq('work_date', workDate),
  ]);

  const error = describeDbErrorOrNull(taskResult.error) ?? describeDbErrorOrNull(logResult.error);
  if (error) return { entries: [], error };

  const logs = (logResult.data || []) as (TaskWorklog & { task?: Task })[];
  const logByTask = new Map(logs.map((l) => [l.task_id, l]));

  const entries: WorklogEntry[] = ((taskResult.data || []) as Task[]).map((task) => {
    const log = logByTask.get(task.id);
    return {
      task,
      hours: log ? Number(log.hours) : 0,
      note: log?.note ?? '',
      worklogId: log?.id ?? null,
    };
  });

  // Bổ sung tác vụ đã ghi giờ nhưng không còn nằm trong danh sách trên.
  const seen = new Set(entries.map((e) => e.task.id));
  for (const log of logs) {
    if (seen.has(log.task_id) || !log.task) continue;
    entries.push({
      task: log.task,
      hours: Number(log.hours),
      note: log.note ?? '',
      worklogId: log.id,
    });
  }

  return { entries };
}

/**
 * Lưu nhật ký một ngày.
 * Giờ = 0 nghĩa là xóa bản ghi, không lưu dòng 0 giờ vô nghĩa.
 */
export async function saveDayEntries(
  userId: string,
  workDate: string,
  entries: WorklogEntry[],
): Promise<{ error?: string }> {
  const toDelete = entries.filter((e) => e.worklogId && e.hours <= 0).map((e) => e.worklogId!);
  const toUpsert = entries
    .filter((e) => e.hours > 0)
    .map((e) => ({
      task_id: e.task.id,
      user_id: userId,
      work_date: workDate,
      hours: e.hours,
      note: e.note.trim() || null,
    }));

  if (toDelete.length > 0) {
    const { error } = await supabase.from('task_worklogs').delete().in('id', toDelete);
    if (error) return { error: `Xóa dòng cũ thất bại: ${describeDbError(error)}` };
  }

  if (toUpsert.length > 0) {
    // UNIQUE(task_id, user_id, work_date) cho phép upsert — ghi lại là sửa dòng
    // cũ chứ không tạo dòng mới.
    const { error } = await supabase
      .from('task_worklogs')
      .upsert(toUpsert as never, { onConflict: 'task_id,user_id,work_date' });
    if (error) return { error: `Lưu nhật ký thất bại: ${describeDbError(error)}` };
  }

  return {};
}

/** Giờ có mặt theo chấm công của một ngày. `null` khi chưa check-out. */
export function attendanceHours(record: Pick<Attendance, 'check_in_time' | 'check_out_time'> | undefined): number | null {
  if (!record?.check_in_time || !record?.check_out_time) return null;
  const ms = new Date(record.check_out_time).getTime() - new Date(record.check_in_time).getTime();
  if (ms <= 0) return null;
  return Math.round((ms / 3_600_000) * 10) / 10;
}

export function formatHours(hours: number): string {
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

/** Tổng giờ đã ghi cho từng tác vụ — dùng để so với ước lượng. */
export async function fetchTaskTotals(taskIds: string[]): Promise<Map<string, number>> {
  if (taskIds.length === 0) return new Map();
  const { data } = await supabase.from('task_worklogs').select('task_id, hours').in('task_id', taskIds);

  const totals = new Map<string, number>();
  for (const row of (data || []) as { task_id: string; hours: number }[]) {
    totals.set(row.task_id, (totals.get(row.task_id) ?? 0) + Number(row.hours));
  }
  return totals;
}

/** Tỷ lệ thực tế so với ước lượng. `null` khi tác vụ chưa có ước lượng. */
export function estimateRatio(actual: number, estimated: number | null): number | null {
  if (!estimated || estimated <= 0) return null;
  return Math.round((actual / estimated) * 100);
}
