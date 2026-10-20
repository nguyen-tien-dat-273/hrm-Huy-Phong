import { type TaskStatus, type TaskPriority, type ProjectStatus, type MemberRole } from '@/types';

export const TASK_STATUSES: { value: TaskStatus; label: string; color: string }[] = [
  { value: 'todo', label: 'Cần làm', color: 'bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300' },
  { value: 'in_progress', label: 'Đang làm', color: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400' },
  { value: 'in_review', label: 'Đang duyệt', color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  { value: 'done', label: 'Hoàn thành', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
];

export const KANBAN_COLUMNS: { value: TaskStatus; label: string; accent: string }[] = [
  { value: 'todo', label: 'Cần làm', accent: 'border-t-slate-400' },
  { value: 'in_progress', label: 'Đang làm', accent: 'border-t-blue-500' },
  { value: 'in_review', label: 'Đang duyệt', accent: 'border-t-amber-500' },
  { value: 'done', label: 'Hoàn thành', accent: 'border-t-emerald-500' },
];

export const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string; border: string; dot: string }> = {
  low: { label: 'Thấp', color: 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/15', border: 'border-l-emerald-500', dot: 'bg-emerald-500' },
  medium: { label: 'Trung bình', color: 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15', border: 'border-l-amber-500', dot: 'bg-amber-500' },
  high: { label: 'Cao', color: 'text-orange-700 bg-orange-50 dark:text-orange-400 dark:bg-orange-500/15', border: 'border-l-orange-500', dot: 'bg-orange-500' },
  critical: { label: 'Khẩn cấp', color: 'text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-500/15', border: 'border-l-red-500', dot: 'bg-red-500' },
};

export const PROJECT_STATUS_CONFIG: Record<ProjectStatus, { label: string; color: string }> = {
  planning: { label: 'Lập kế hoạch', color: 'bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300' },
  active: { label: 'Đang hoạt động', color: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400' },
  on_hold: { label: 'Tạm dừng', color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  completed: { label: 'Hoàn thành', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  archived: { label: 'Lưu trữ', color: 'bg-slate-200 text-slate-500 dark:bg-slate-700/60 dark:text-slate-400' },
};

export const MEMBER_ROLE_CONFIG: Record<string, { label: string; color: string }> = {
  lead: { label: 'Trưởng nhóm', color: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400' },
  member: { label: 'Thành viên', color: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400' },
  viewer: { label: 'Người xem', color: 'bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300' },
};

export function formatVND(amount: number | null): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(amount);
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  return date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatTime(dateStr: string | null): string {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Chào buổi sáng';
  if (hour < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

export function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

/**
 * Ngày hiện tại dạng YYYY-MM-DD theo MÚI GIỜ MÁY.
 *
 * Trước đây hàm này dùng `toISOString()` — trả về giờ UTC. Việt Nam là UTC+7
 * nên từ 00:00 đến 07:00 sáng, `toISOString()` vẫn đang ở ngày hôm trước:
 * chấm công lúc 6h sáng bị ghi vào ngày hôm qua, và bộ lọc "Hôm nay" hiện sai
 * dữ liệu suốt buổi sáng sớm.
 */
export function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getTodayString(): string {
  return toDateString(new Date());
}

export function isOverdue(dueDate: string | null, status: string): boolean {
  if (!dueDate || status === 'done') return false;
  return new Date(dueDate) < new Date(getTodayString());
}
