import webpush from 'web-push';

export type PushRow = { endpoint: string; p256dh: string; auth: string; user_id: string };
export type NoticeRow = { id: string; user_id: string; type: string; title: string; message: string };

/** Trang mở ra khi bấm vào thông báo đẩy. Khớp `notificationRoute` ở client. */
export function targetUrl(type: string): string {
  switch (type) {
    case 'assignment_submitted': return '/admin/assignments';
    case 'attendance_request_created':
    case 'leave_requested':
    case 'leave_updated':
    case 'leave_cancellation_requested': return '/admin/leave';
    case 'recruitment_request':
    case 'recruitment_review': return '/admin/recruitment';
    case 'assignment_new':
    case 'assignment_approved':
    case 'assignment_rejected': return '/staff/assignments';
    case 'project_task_assigned': return '/staff/kanban';
    case 'attendance_approved': return '/staff/attendance';
    case 'attendance_request_approved':
    case 'attendance_request_rejected':
    case 'leave_approved':
    case 'leave_rejected':
    case 'leave_cancellation_approved':
    case 'leave_cancellation_rejected': return '/staff/leave';
    case 'training_assigned': return '/staff/training';
    case 'lifecycle_assigned':
    case 'lifecycle_mentor':
    case 'lifecycle_task': return '/staff/growth';
    case 'push_test': return '/profile';

    // Nhắc nhở tự động (migration reminder_notifications).
    case 'reminder_att_checkin':
    case 'reminder_att_checkin_late':
    case 'reminder_att_checkout':
    case 'reminder_att_missing_checkout': return '/staff/attendance';
    case 'reminder_att_approval': return '/admin/attendance';
    case 'reminder_att_request_pending':
    case 'reminder_leave_pending': return '/admin/leave';
    case 'reminder_leave_upcoming': return '/staff/leave';
    case 'reminder_assign_today': return '/staff/assignments';
    case 'reminder_assign_review': return '/admin/assignments';
    case 'reminder_task_due': return '/staff/kanban';
    case 'reminder_task_review':
    case 'reminder_task_request_pending':
    case 'reminder_worklog_review':
    case 'reminder_project_event': return '/staff/projects';
    case 'reminder_worklog_submit': return '/staff/worklog';
    case 'reminder_kpi_open':
    case 'reminder_kpi_self':
    case 'reminder_kpi_manager': return '/staff/kpi';
    case 'reminder_kpi_board':
    case 'reminder_kpi_lock':
    case 'reminder_kpi_reopen': return '/admin/performance/review';
    case 'reminder_kpi_sales_target': return '/admin/performance/sales';
    case 'reminder_payroll_timesheet': return '/admin/timesheet';
    case 'reminder_payroll_run': return '/admin/payroll';
    case 'reminder_payroll_scheme_pending': return '/admin/payroll/approvals';
    case 'reminder_training_deadline': return '/staff/training';
    case 'reminder_lifecycle_task': return '/staff/growth';
    case 'reminder_recruit_sla':
    case 'reminder_recruit_interview':
    case 'reminder_recruit_offer': return '/admin/recruitment';
    case 'reminder_document_expiry': return '/profile';
    case 'reminder_worker_document_expiry': return '/admin/worker-documents';
    default: return '/';
  }
}

/**
 * Đẩy các thông báo đã có trong bảng `notifications` tới mọi thiết bị của người
 * nhận, dọn thiết bị đã hết hạn rồi đánh dấu đã đẩy. Dùng chung cho thông báo
 * do người dùng tạo (`push-notifications`) và nhắc nhở tự động (`reminders`).
 *
 * `service` là client Supabase quyền service role; nới kiểu `any` vì declaration
 * dùng chung của trình duyệt không suy luận chính xác API phía server.
 */
export async function deliverNotices(
  service: any,
  rows: NoticeRow[],
  vapid: { subject: string; publicKey: string; privateKey: string },
): Promise<{ sent: number; devices: number } | { error: string }> {
  if (rows.length === 0) return { sent: 0, devices: 0 };

  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const { data: subscriptions, error } = await service
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth, user_id')
    .in('user_id', userIds);
  if (error) return { error: 'Không đọc được danh sách thiết bị.' };

  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  const byUser = new Map<string, NoticeRow[]>();
  for (const row of rows) byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);

  const staleEndpoints: string[] = [];
  let sent = 0;

  // Mỗi thiết bị nhận MỌI thông báo mới của chủ nó (không chỉ cái đầu tiên),
  // vì một lượt nhắc có thể sinh nhiều thông báo cho cùng một người.
  await Promise.all(((subscriptions ?? []) as PushRow[]).flatMap((subscription) =>
    (byUser.get(subscription.user_id) ?? []).map(async (notice) => {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          JSON.stringify({
            title: notice.title,
            body: notice.message,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: notice.id,
            data: { url: targetUrl(notice.type), notificationId: notice.id },
          }),
          { TTL: 60 * 60 * 24, urgency: 'high' },
        );
        sent += 1;
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) staleEndpoints.push(subscription.endpoint);
      }
    }),
  ));

  if (staleEndpoints.length > 0) {
    await service.from('push_subscriptions').delete().in('endpoint', [...new Set(staleEndpoints)]);
  }
  await service
    .from('notifications')
    .update({ push_sent_at: new Date().toISOString() })
    .in('id', rows.map((row) => row.id));

  return { sent, devices: subscriptions?.length ?? 0 };
}
