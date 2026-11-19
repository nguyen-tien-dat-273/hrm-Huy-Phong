// ============================================================================
// Nghỉ phép — cấu hình hiển thị và các phép tính ngày công.
// ============================================================================

import type { LeaveLedgerEntry, LeaveRequest, LeaveStatus, LeaveType } from '@/types';
import { formatDate, toDateString } from './utils';
import type { RequestDetail } from '@/components/ui/RequestDetailModal';
import { SIGN_HINT_CONFIRM, STANDARD_RECIPIENTS } from '@/lib/requestForm';
import { dayWeight, type ScheduleSet } from './workSchedule';

export const LEAVE_TYPE_CONFIG: Record<LeaveType, { label: string; color: string; dot: string; paid: boolean }> = {
  annual: { label: 'Phép năm', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-400', paid: true },
  sick:   { label: 'Nghỉ ốm', color: 'bg-violet-100 text-violet-700', dot: 'bg-violet-400', paid: true },
  unpaid: { label: 'Không lương', color: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400', paid: false },
  other:  { label: 'Khác', color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-400', paid: true },
};

export const LEAVE_STATUS_CONFIG: Record<LeaveStatus, { label: string; color: string }> = {
  pending:  { label: 'Chờ duyệt', color: 'bg-amber-100 text-amber-700' },
  approved: { label: 'Đã duyệt', color: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'Từ chối', color: 'bg-red-100 text-red-700' },
};

/**
 * Nhãn trạng thái có kèm cấp đang chờ duyệt.
 */
export function leaveStatusLabel(request: Pick<LeaveRequest, 'status' | 'approval_stage'>): {
  label: string;
  color: string;
} {
  if (request.status === 'pending' && request.approval_stage === 'MANAGER') {
    return { label: 'Chờ quản lý', color: 'bg-amber-100 text-amber-700' };
  }
  if (request.status === 'pending' && request.approval_stage === 'HR') {
    return { label: 'Chờ HR', color: 'bg-indigo-100 text-indigo-700' };
  }
  return LEAVE_STATUS_CONFIG[request.status];
}

/**
 * Số ngày công thật sự nghỉ trong khoảng — thứ bị TRỪ VÀO QUỸ PHÉP.
 *
 * Truyền `calendar` thì đếm theo đúng lịch làm việc của công ty: trừ ngày lễ,
 * và thứ Bảy tính 0 / 0,5 / 1 ngày theo `saturday_mode` của ca.
 *
 * Trước đây hàm này chỉ bỏ thứ Bảy và Chủ nhật, kèm comment nói "hệ thống chưa
 * có bảng ngày lễ". Câu đó đã lỗi thời từ migration 20260927120000 — bảng
 * `company_holidays` có rồi, và `dayWeight` dùng nó để tính công chuẩn cho cả
 * bảng lương. Nghĩa là đơn nghỉ vắt qua Tết đang bị TRỪ OAN mấy ngày phép cho
 * những hôm vốn đã nghỉ; còn công ty làm cả thứ Bảy thì ngược lại, đếm thiếu.
 *
 * Không truyền `calendar` thì giữ nguyên cách cũ (thứ Hai–Sáu, không trừ lễ),
 * để nơi gọi chưa kịp nạp lịch vẫn chạy như trước chứ không đổi số âm thầm.
 */
export function countWorkingDays(
  startDate: string,
  endDate: string,
  calendar?: { schedules: ScheduleSet; holidays: ReadonlySet<string> },
): number {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;

  let days = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    if (calendar) {
      days += dayWeight(calendar.schedules, toDateString(cursor), calendar.holidays);
    } else {
      const weekday = cursor.getDay(); // 0 = CN, 6 = T7
      if (weekday !== 0 && weekday !== 6) days += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  // Thứ Bảy nửa ngày sinh ra số lẻ .5; làm tròn 2 chữ số để không ra 2.7999…
  return Math.round(days * 100) / 100;
}

export interface LeaveBalance {
  quota: number;
  /** Đã dùng: phép năm ĐÃ DUYỆT trong năm hiện tại. */
  used: number;
  /** Đang chờ duyệt — chưa trừ vào quỹ nhưng cần cho người dùng thấy. */
  pending: number;
  remaining: number;
}

/**
 * Quỹ phép năm còn lại.
 *
 * Chỉ `annual` mới trừ vào quỹ — nghỉ ốm và nghỉ không lương theo dõi riêng.
 * Tính theo năm dương lịch của `start_date`.
 */
export function calculateBalance(requests: LeaveRequest[], quota: number, year = new Date().getFullYear()): LeaveBalance {
  const inYear = requests.filter(
    (r) => r.leave_type === 'annual' && !r.is_cancelled && new Date(`${r.start_date}T00:00:00`).getFullYear() === year,
  );

  const used = inYear.filter((r) => r.status === 'approved').reduce((sum, r) => sum + Number(r.days), 0);
  const pending = inYear.filter((r) => r.status === 'pending').reduce((sum, r) => sum + Number(r.days), 0);

  return { quota, used, pending, remaining: Math.max(quota - used, 0) };
}

/** Số dư chính thức từ sổ phát sinh; đơn chờ duyệt vẫn hiển thị riêng. */
export function calculateLedgerBalance(
  entries: LeaveLedgerEntry[],
  requests: LeaveRequest[],
  fallbackQuota: number,
  year = new Date().getFullYear(),
): LeaveBalance {
  const annualEntries = entries.filter((entry) => entry.leave_type === 'annual' && entry.leave_year === year);
  if (annualEntries.length === 0) return calculateBalance(requests, fallbackQuota, year);

  const granted = annualEntries
    .filter((entry) => ['GRANT', 'CARRY_FORWARD', 'ADJUSTMENT'].includes(entry.entry_type))
    .reduce((sum, entry) => sum + Number(entry.days), 0);
  const balance = annualEntries.reduce((sum, entry) => sum + Number(entry.days), 0);
  const pending = requests
    .filter((request) => request.leave_type === 'annual' && request.status === 'pending' && !request.is_cancelled && new Date(`${request.start_date}T00:00:00`).getFullYear() === year)
    .reduce((sum, request) => sum + Number(request.days), 0);
  return { quota: granted, used: Math.max(granted - balance, 0), pending, remaining: Math.max(balance, 0) };
}

/** Ngày hôm nay ở dạng YYYY-MM-DD, dùng làm giá trị mặc định cho form. */
export function defaultLeaveDate(): string {
  return toDateString(new Date());
}

/** Nội dung chi tiết / in / Excel của một đơn nghỉ phép. */
export function leaveRequestDetail(
  request: LeaveRequest,
  applicant: { name?: string | null; department?: string | null } | null | undefined,
  approvers: { manager?: string | null; final?: string | null } = {},
): RequestDetail {
  const status = request.is_cancelled ? 'Đã hủy' : leaveStatusLabel(request).label;
  const name = applicant?.name ?? 'Nhân viên';
  const halfDayNote = (r: LeaveRequest) => !r.half_day ? ''
    : r.half_day_period === 'morning' ? ' (nghỉ sáng)'
    : r.half_day_period === 'afternoon' ? ' (nghỉ chiều)' : ' (nửa ngày)';
  return {
    title: 'Đơn nghỉ phép',
    applicant: name,
    status,
    fields: [
      { label: 'Nhân sự', value: name },
      { label: 'Phòng ban', value: applicant?.department ?? '' },
      { label: 'Loại nghỉ', value: LEAVE_TYPE_CONFIG[request.leave_type].label },
      { label: 'Từ ngày', value: formatDate(request.start_date) },
      { label: 'Đến ngày', value: formatDate(request.end_date) },
      { label: 'Số ngày', value: `${Number(request.days)}${halfDayNote(request)}` },
      { label: 'Lý do', value: request.reason ?? '' },
      ...(approvers.manager ? [{ label: 'Quản lý duyệt', value: approvers.manager }] : []),
      ...(approvers.final ? [{ label: 'Người chốt', value: approvers.final }] : []),
      ...(request.reason_reject ? [{ label: 'Lý do từ chối', value: request.reason_reject }] : []),
    ],
    signers: [
      { role: 'Người làm đơn' },
      { role: 'Quản lý trực tiếp', name: approvers.manager, signedAt: request.manager_approved_by ? request.manager_approved_at : null },
      { role: 'Nhân sự / HR', name: approvers.final, signedAt: request.status === 'approved' ? request.approved_at : null },
    ],
    form: {
      title: 'ĐƠN XIN NGHỈ PHÉP',
      department: applicant?.department,
      recipients: STANDARD_RECIPIENTS,
      info: [
        { label: 'Họ và tên', value: name },
        { label: 'Loại nghỉ', value: LEAVE_TYPE_CONFIG[request.leave_type].label },
        { label: 'Nghỉ từ ngày', value: formatDate(request.start_date) },
        { label: 'Đến hết ngày', value: formatDate(request.end_date) },
        { label: 'Số ngày nghỉ', value: `${Number(request.days)}${halfDayNote(request)}` },
      ],
      reason: { label: 'Lý do xin nghỉ', value: request.reason ?? '' },
      signers: [
        { role: 'Nhân sự / HR', hint: SIGN_HINT_CONFIRM, name: approvers.final, signedAt: request.status === 'approved' ? request.approved_at : null },
        { role: 'Quản lý trực tiếp', hint: SIGN_HINT_CONFIRM, name: approvers.manager, signedAt: request.manager_approved_by ? request.manager_approved_at : null },
        { role: 'Người làm đơn', name },
      ],
    },
  };
}
