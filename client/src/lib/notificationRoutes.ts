/**
 * Một nguồn điều hướng cho chuông thông báo ở cả hai layout.
 *
 * Đích đi theo Ý NGHĨA sự kiện, không đi theo layout đang mở: quản trị viên
 * được giao việc cá nhân vẫn phải vào màn nhân viên; nhân viên có quyền quản
 * lý nhận đơn chờ duyệt vẫn phải vào màn quản trị.
 */
export function notificationRoute(type: string): string {
  switch (type) {
    case 'assignment_submitted':
      return '/admin/assignments';
    case 'attendance_request_created':
    case 'leave_requested':
    case 'leave_updated':
    case 'leave_cancellation_requested':
      return '/admin/leave';
    case 'recruitment_request':
    case 'recruitment_review':
      return '/admin/recruitment';

    case 'assignment_new':
    case 'assignment_approved':
    case 'assignment_rejected':
      return '/staff/assignments';
    case 'project_task_assigned':
      return '/staff/kanban';
    case 'attendance_approved':
      return '/staff/attendance';
    case 'attendance_request_approved':
    case 'attendance_request_rejected':
    case 'leave_approved':
    case 'leave_rejected':
    case 'leave_cancellation_approved':
    case 'leave_cancellation_rejected':
      return '/staff/leave';
    case 'training_assigned':
      return '/staff/training';
    case 'lifecycle_assigned':
    case 'lifecycle_mentor':
    case 'lifecycle_task':
      return '/staff/growth';
    case 'push_test':
      return '/profile';
    default:
      return '/';
  }
}
