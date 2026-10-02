// ============================================================================
// Giao việc theo ngày — cấu hình trạng thái + tiện ích dùng chung giữa trang
// quản lý (AdminAssignments) và trang chấm công nhân viên (StaffAttendance).
// ============================================================================

import { addDays, format, startOfWeek } from 'date-fns';
import { supabase } from './supabase';
import { getCachedSettings } from './settings';
import { toDateString } from './utils';
import type { AdminPermission } from './permissions';
import type { AssignmentStatus, DailyAssignment } from '@/types';

export const ASSIGNMENT_STATUS_CONFIG: Record<
  AssignmentStatus,
  { label: string; color: string; dot: string }
> = {
  pending:   { label: 'Cần làm',       color: 'bg-slate-100 text-slate-700',     dot: 'bg-slate-400' },
  submitted: { label: 'Chờ xác nhận',  color: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-500' },
  approved:  { label: 'Đã xác nhận',   color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  rejected:  { label: 'Cần làm lại',   color: 'bg-red-100 text-red-700',         dot: 'bg-red-500' },
};

/**
 * Điều kiện hiện nút CHECK-OUT — nơi DUY NHẤT định nghĩa luật này.
 * Ngày không được giao việc thì check-out tự do (không có gì để xác nhận);
 * có việc thì TẤT CẢ phải được nhân viên gửi duyệt hoặc đã được xác nhận.
 * Nhân viên không bị giữ ở trạng thái đang làm chỉ vì quản lý chưa online;
 * bước duyệt công việc và duyệt ngày công tiếp tục diễn ra sau check-out.
 *
 * Tắt "Bắt buộc duyệt công việc" trong Cấu hình thì luật này ngưng áp dụng —
 * công ty không chạy theo mô hình duyệt việc hằng ngày vẫn dùng được chấm công.
 */
export function canCheckOut(todayAssignments: DailyAssignment[]): boolean {
  if (!getCachedSettings().requireTaskApproval) return true;
  return todayAssignments.length === 0
    || todayAssignments.every((a) => a.status === 'submitted' || a.status === 'approved');
}

/** Thứ Hai của tuần chứa `date` — tuần làm việc Việt Nam bắt đầu Thứ Hai. */
export function mondayOf(date: Date): Date {
  return startOfWeek(date, { weekStartsOn: 1 });
}

/** 7 ngày của tuần bắt đầu từ `monday`, dạng Date. */
export function weekDates(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

const DAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/** "T2 11/08" — nhãn cột trong bảng phân công tuần. */
export function dayLabel(date: Date): string {
  return `${DAY_LABELS[date.getDay()]} ${format(date, 'dd/MM')}`;
}

/** "11/08 – 17/08" — nhãn khoảng tuần trên thanh điều hướng. */
export function weekRangeLabel(monday: Date): string {
  return `${format(monday, 'dd/MM')} – ${format(addDays(monday, 6), 'dd/MM')}`;
}

export function isToday(date: Date): boolean {
  return toDateString(date) === toDateString(new Date());
}

/**
 * Gửi thông báo chuông cho một danh sách người dùng. Lỗi được nuốt có chủ ý:
 * thông báo là phụ, không được làm hỏng thao tác chính (giao/gửi/duyệt việc).
 *
 * CỬA DUY NHẤT để ghi bảng `notifications` — mọi nơi phải đi qua đây thì công
 * tắc "Gửi thông báo tự động" mới thật sự tắt được toàn hệ thống. Trước đây năm
 * chỗ tự `insert` thẳng nên không có cách nào tắt tập trung.
 */
export async function notifyUsers(
  userIds: string[],
  title: string,
  message: string,
  type: string,
): Promise<void> {
  if (userIds.length === 0) return;
  if (!getCachedSettings().autoNotify) return;
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  const creatorId = session?.user.id;
  const notices = [...new Set(userIds)].map((user_id) => ({
    id: crypto.randomUUID(),
    user_id,
    type,
    title,
    message,
    created_by: creatorId,
  }));

  let { error } = await supabase
    .from('notifications')
    .insert(notices);

  // Giữ tương thích trong vài giây deploy lệch nhịp giữa frontend và migration:
  // thông báo trong app vẫn phải được tạo, chỉ push điện thoại tạm thời chưa có.
  if (error && /created_by|schema cache|column .* does not exist/i.test(error.message || '')) {
    ({ error } = await supabase
      .from('notifications')
      .insert(notices.map(({ created_by: _createdBy, ...notice }) => notice)));
    return;
  }
  if (error || !session?.access_token || !creatorId) return;

  // Push là kênh phụ: lỗi mạng hoặc thiết bị hết hạn không được làm hỏng thao
  // tác chính vừa tạo thông báo trong hệ thống.
  try {
    await fetch('/api/push-notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ notificationIds: notices.map((notice) => notice.id) }),
    });
  } catch {
    // Người dùng vẫn thấy thông báo trong chuông khi mở HRM.
  }
}

/**
 * Người NÊN nhận thông báo khi nhân viên gửi đơn/việc để duyệt: người duyệt
 * toàn cục (admin/CEO + quyền lẻ) CỘNG trưởng nhóm trực tiếp của người gửi.
 *
 * Vì sao cần: fetchManagerIds chỉ thấy quyền lẻ, mà trưởng nhóm lấy quyền qua
 * VAI TRÒ (không có trong cột permissions). Không gộp thì thành viên gửi đơn
 * mà trưởng nhóm — chính người duyệt — không nhận được gì. Gọi RPC my_lead_ids
 * để lấy trưởng nhóm của các dự án mà người gọi là thành viên.
 */
export async function fetchApproverIds(permission: AdminPermission): Promise<string[]> {
  const [managers, leadRes] = await Promise.all([
    fetchManagerIds(permission),
    supabase.rpc('my_lead_ids'),
  ]);
  const leadIds = ((leadRes.data as { user_id: string }[] | null) ?? []).map((r) => r.user_id);
  return [...new Set([...managers, ...leadIds])];
}

/** Lối tắt cho trường hợp phổ biến nhất: báo cho đúng một người. */
export async function notifyUser(
  userId: string,
  title: string,
  message: string,
  type: string,
): Promise<void> {
  await notifyUsers([userId], title, message, type);
}

/**
 * Id những người duyệt được một loại việc: admin/CEO (ngầm định đủ quyền) cộng
 * người được cấp quyền lẻ tương ứng.
 *
 * Mặc định `attendance` cho công việc hằng ngày; module nghỉ phép truyền
 * `'leave'`, ca làm truyền `'shifts'`. Trước đây hàm này khoá cứng vào
 * 'attendance' nên không tái sử dụng được cho module khác.
 */
export async function fetchManagerIds(permission: AdminPermission = 'attendance'): Promise<string[]> {
  const { data } = await supabase
    .from('profiles')
    .select('id, role, permissions')
    .eq('is_active', true);
  return (data || [])
    .filter(
      (p) =>
        p.role === 'admin' ||
        p.role === 'ceo' ||
        ((p.permissions as string[] | null) ?? []).includes(permission),
    )
    .map((p) => p.id);
}
