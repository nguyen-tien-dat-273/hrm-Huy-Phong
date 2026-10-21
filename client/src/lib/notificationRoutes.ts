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
    case 'payroll_scheme_submitted':
    case 'payroll_run_submitted':
      return '/admin/payroll/approvals';
    case 'payroll_scheme_reviewed':
      return '/admin/payroll/setup/schemes';
    case 'payroll_run_reviewed':
      return '/admin/payroll';
    case 'payslip_published':
      return '/staff/payroll';

    case 'assignment_new':
    case 'assignment_approved':
    case 'assignment_rejected':
      return '/staff/assignments';
    case 'project_task_assigned':
      return '/staff/assignments';
    case 'project_task_review_result':
      return '/staff/projects';
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
    case 'kpi_reminder':
    case 'kpi_submitted':
    case 'kpi_returned':
    case 'kpi_approved':
      return '/staff/kpi';
    case 'reminder_att_checkin':
    case 'reminder_att_checkin_late':
    case 'reminder_att_checkout':
    case 'reminder_att_missing_checkout':
      return '/staff/attendance';
    case 'reminder_att_approval':
      return '/admin/attendance';
    case 'reminder_att_request_pending':
    case 'reminder_leave_pending':
      return '/admin/leave';
    case 'reminder_leave_upcoming':
      return '/staff/leave';
    case 'reminder_assign_today':
      return '/staff/assignments';
    case 'reminder_assign_review':
      return '/admin/assignments';
    case 'reminder_task_due':
      return '/staff/kanban';
    case 'reminder_task_review':
    case 'reminder_task_request_pending':
    case 'reminder_worklog_review':
    case 'reminder_project_event':
      return '/staff/projects';
    case 'reminder_worklog_submit':
      return '/staff/worklog';
    case 'reminder_kpi_open':
    case 'reminder_kpi_self':
    case 'reminder_kpi_manager':
      return '/staff/kpi';
    case 'reminder_kpi_board':
    case 'reminder_kpi_lock':
    case 'reminder_kpi_reopen':
      return '/admin/performance/review';
    case 'reminder_kpi_sales_target':
      return '/admin/performance/sales';
    case 'reminder_payroll_timesheet':
      return '/admin/timesheet';
    case 'reminder_payroll_run':
      return '/admin/payroll';
    case 'reminder_payroll_scheme_pending':
      return '/admin/payroll/approvals';
    case 'reminder_training_deadline':
      return '/staff/training';
    case 'reminder_lifecycle_task':
      return '/staff/growth';
    case 'reminder_recruit_sla':
    case 'reminder_recruit_interview':
    case 'reminder_recruit_offer':
      return '/admin/recruitment';
    case 'reminder_document_expiry':
      return '/profile';
    case 'reminder_worker_document_expiry':
      return '/admin/worker-documents';
    case 'push_test':
      return '/profile';
    default:
      return '/';
  }
}
