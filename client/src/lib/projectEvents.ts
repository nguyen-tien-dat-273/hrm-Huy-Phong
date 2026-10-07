// ============================================================================
// Lịch họp & nhắc nhở dự án — đọc/ghi bảng `project_events`.
// ----------------------------------------------------------------------------
// RLS scoped theo dự án (migration 20260811250000): trưởng nhóm tạo/sửa/xoá
// sự kiện của dự án mình lead, thành viên dự án xem được. Khi tạo, trigger ở
// database tự bắn thông báo cho thành viên — client KHÔNG cần notify tay.
// ============================================================================

import { supabase } from './supabase';
import { describeDbError } from './dbError';
import { attachProfiles, fetchProfileMap } from './profileDirectory';
import type { ProjectEvent, ProjectEventType } from '@/types';

export const EVENT_TYPE_CONFIG: Record<
  ProjectEventType,
  { label: string; color: string; dot: string }
> = {
  meeting:  { label: 'Họp khách hàng', color: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-500' },
  reminder: { label: 'Nhắc nhở',       color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
};

/** "09:00 · Thứ Hai, 15/06/2027" — nhãn thời điểm dễ đọc. */
export function formatEventTime(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const date = d.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${time} · ${date}`;
}

/** Sự kiện đã qua thời điểm bắt đầu. */
export function isEventPast(ev: ProjectEvent): boolean {
  return new Date(ev.start_at).getTime() < Date.now();
}

export async function fetchProjectEvents(projectId: string): Promise<{ data: ProjectEvent[]; error: string | null }> {
  const { data, error } = await supabase
    .from('project_events')
    .select('*')
    .eq('project_id', projectId)
    .order('start_at', { ascending: true });
  if (error) return { data: [], error: describeDbError(error) };
  const rows = (data || []) as ProjectEvent[];
  const people = await fetchProfileMap(rows.map((row) => row.created_by));
  return { data: attachProfiles(rows, (row) => row.created_by, people, 'creator') as ProjectEvent[], error: null };
}

/**
 * Sự kiện SẮP TỚI của mọi dự án mà người dùng là thành viên (RLS tự lọc).
 * Dùng cho khối "Lịch họp sắp tới" ở khu nhân viên.
 */
export async function fetchUpcomingEvents(limit = 5): Promise<ProjectEvent[]> {
  const { data } = await supabase
    .from('project_events')
    .select('*, project:projects(id,name)')
    .gte('start_at', new Date().toISOString())
    .order('start_at', { ascending: true })
    .limit(limit);
  return (data || []) as ProjectEvent[];
}

export interface ProjectEventInput {
  type: ProjectEventType;
  title: string;
  description: string;
  client_name: string;
  location: string;
  /** Giá trị từ <input type="datetime-local"> (giờ địa phương, không có TZ). */
  start_at_local: string;
}

export function validateEvent(input: ProjectEventInput): string | null {
  if (!input.title.trim()) return 'Nhập tiêu đề.';
  if (!input.start_at_local) return 'Chọn thời điểm.';
  if (Number.isNaN(new Date(input.start_at_local).getTime())) return 'Thời điểm không hợp lệ.';
  return null;
}

export async function createProjectEvent(
  projectId: string,
  createdBy: string,
  input: ProjectEventInput,
): Promise<{ error: string | null }> {
  const invalid = validateEvent(input);
  if (invalid) return { error: invalid };

  const { error } = await supabase.from('project_events').insert({
    project_id: projectId,
    type: input.type,
    title: input.title.trim(),
    description: input.description.trim() || null,
    // Khách hàng chỉ có nghĩa với cuộc họp.
    client_name: input.type === 'meeting' ? (input.client_name.trim() || null) : null,
    location: input.location.trim() || null,
    // datetime-local là giờ địa phương; new Date() diễn giải theo TZ máy rồi
    // toISOString() đổi về UTC chuẩn để lưu.
    start_at: new Date(input.start_at_local).toISOString(),
    created_by: createdBy,
  });
  return { error: error ? describeDbError(error) : null };
}

export async function updateProjectEvent(
  id: string,
  input: ProjectEventInput,
): Promise<{ error: string | null }> {
  const invalid = validateEvent(input);
  if (invalid) return { error: invalid };

  const { error } = await supabase.from('project_events').update({
    type: input.type,
    title: input.title.trim(),
    description: input.description.trim() || null,
    client_name: input.type === 'meeting' ? (input.client_name.trim() || null) : null,
    location: input.location.trim() || null,
    start_at: new Date(input.start_at_local).toISOString(),
  }).eq('id', id);
  return { error: error ? describeDbError(error) : null };
}

export async function deleteProjectEvent(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('project_events').delete().eq('id', id);
  return { error: error ? describeDbError(error) : null };
}

/** Chuyển ISO sang value cho <input type="datetime-local"> (giờ địa phương). */
export function toDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
