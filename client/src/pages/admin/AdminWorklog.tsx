import { useCallback, useEffect, useMemo, useState } from 'react';
import { describeDbError, describeDbErrorOrNull } from '@/lib/dbError';
import { ChevronLeft, ChevronRight, CalendarDays, TriangleAlert, NotebookPen } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { supabase } from '@/lib/supabase';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { useToast } from '@/contexts/ToastContext';
import { notifyUser } from '@/lib/assignments';
import { addDays, startOfWeek, weekDays, UNLOGGED_TOLERANCE_HOURS, attendanceHours, formatHours } from '@/lib/worklog';
import { formatDate, toDateString } from '@/lib/utils';
import type { Attendance, Profile } from '@/types';

interface WorklogRow {
  user_id: string;
  work_date: string;
  hours: number;
}

/**
 * Báo cáo giờ theo người theo tuần, đối chiếu với chấm công.
 *
 * Câu hỏi trang này trả lời: ai đang quá tải, ai chưa khai giờ, và giờ có mặt
 * có khớp với giờ đã ghi vào tác vụ hay không.
 */
export function AdminWorklog() {
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date()));
  const [staff, setStaff] = useState<Profile[]>([]);
  const [logs, setLogs] = useState<WorklogRow[]>([]);
  const [attendance, setAttendance] = useState<Pick<Attendance, 'user_id' | 'date' | 'check_in_time' | 'check_out_time'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const days = useMemo(() => weekDays(anchor), [anchor]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const from = days[0].key;
    const to = days[6].key;

    const [staffResult, logResult, attResult] = await Promise.all([
      supabase.from('profiles_directory').select('*').eq('is_active', true).order('name'),
      supabase.from('task_worklogs').select('user_id, work_date, hours').gte('work_date', from).lte('work_date', to),
      supabase.from('attendance').select('user_id, date, check_in_time, check_out_time').gte('date', from).lte('date', to),
    ]);

    const error = describeDbErrorOrNull(staffResult.error) ?? describeDbErrorOrNull(logResult.error) ?? describeDbErrorOrNull(attResult.error) ?? null;
    setLoadError(error);
    setStaff((staffResult.data || []) as Profile[]);
    setLogs((logResult.data || []) as WorklogRow[]);
    setAttendance((attResult.data || []) as typeof attendance);
    setLoading(false);
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  useRealtimeSync(
    [{ table: 'task_worklogs' }, { table: 'attendance' }],
    () => load(true),
  );

  const loggedOn = (userId: string, dateKey: string) =>
    logs
      .filter((l) => l.user_id === userId && l.work_date === dateKey)
      .reduce((sum, l) => sum + Number(l.hours), 0);

  const presentOn = (userId: string, dateKey: string) =>
    attendanceHours(attendance.find((a) => a.user_id === userId && a.date === dateKey));

  const today = toDateString(new Date());
  const isThisWeek = toDateString(startOfWeek(new Date())) === days[0].key;

  /** Tổng giờ chưa khai của cả tuần — chỉ tính ngày đã qua và có chấm công đủ. */
  const totalUnlogged = staff.reduce((sum, person) => {
    for (const day of days) {
      if (day.key > today) continue;
      const present = presentOn(person.id, day.key);
      if (present === null) continue;
      const gap = present - loggedOn(person.id, day.key);
      if (gap > UNLOGGED_TOLERANCE_HOURS) sum += gap;
    }
    return sum;
  }, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button onClick={() => setAnchor(addDays(anchor, -7))} className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors" aria-label="Tuần trước">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={() => setAnchor(addDays(anchor, 7))} className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors" aria-label="Tuần sau">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <p className="font-display text-base font-bold text-slate-800">{days[0].label} — {days[6].label}</p>
        {!isThisWeek && (
          <Button variant="outline" size="sm" onClick={() => setAnchor(startOfWeek(new Date()))}>
            <CalendarDays className="w-4 h-4" />
            Về tuần này
          </Button>
        )}

        {!loading && totalUnlogged > UNLOGGED_TOLERANCE_HOURS && (
          <span className="ml-auto flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-1.5">
            <TriangleAlert className="w-4 h-4" />
            {formatHours(Math.round(totalUnlogged * 10) / 10)} có mặt nhưng chưa khai
          </span>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-5 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : loadError ? (
            <ErrorState message={loadError} onRetry={load} />
          ) : staff.length === 0 ? (
            <EmptyState icon={<NotebookPen className="w-8 h-8" />} title="Chưa có nhân sự" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse min-w-[820px]">
                <thead>
                  <tr className="bg-slate-50/70">
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3 sticky left-0 bg-slate-50/70 z-10 min-w-[180px]">
                      Nhân viên
                    </th>
                    {days.map((d) => (
                      <th key={d.key} className="text-center text-xs font-semibold px-2 py-3 min-w-[86px]">
                        <span className="block text-slate-600">{d.weekdayLabel}</span>
                        <span className="block text-[11px] font-normal text-slate-400">{d.label}</span>
                      </th>
                    ))}
                    <th className="text-center text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 min-w-[86px]">
                      Tổng
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-50">
                  {staff.map((person) => {
                    const weekTotal = days.reduce((sum, d) => sum + loggedOn(person.id, d.key), 0);
                    return (
                      <tr key={person.id} className="hover:bg-slate-50/40 transition-colors">
                        <td className="px-4 py-2.5 sticky left-0 bg-white z-10">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={person.name} url={person.avatar_url} size="sm" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-800 truncate">{person.name}</p>
                              {person.department && <p className="text-xs text-slate-400 truncate">{person.department}</p>}
                            </div>
                          </div>
                        </td>

                        {days.map((d) => {
                          const logged = loggedOn(person.id, d.key);
                          const present = presentOn(person.id, d.key);
                          const future = d.key > today;
                          // Có mặt mà chưa khai giờ — chỗ cần hỏi lại.
                          const unlogged = !future && present !== null && present - logged > UNLOGGED_TOLERANCE_HOURS;

                          return (
                            <td key={d.key} className="px-2 py-2.5 text-center">
                              {logged > 0 ? (
                                <span className={`text-sm font-semibold ${unlogged ? 'text-amber-600' : 'text-slate-700'}`}>
                                  {formatHours(logged)}
                                </span>
                              ) : (
                                <span className={`text-sm ${unlogged ? 'text-amber-500' : 'text-slate-300'}`}>—</span>
                              )}
                              {unlogged && (
                                <span className="block text-[10px] text-amber-600" title="Giờ có mặt theo chấm công">
                                  có mặt {formatHours(present!)}
                                </span>
                              )}
                            </td>
                          );
                        })}

                        <td className="px-3 py-2.5 text-center">
                          <span className="text-sm font-bold text-slate-800">{formatHours(weekTotal)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>

                <tfoot className="bg-slate-50/70 border-t-2 border-slate-200">
                  <tr>
                    <td className="px-4 py-2.5 sticky left-0 bg-slate-50/70 z-10 text-xs font-semibold text-slate-600">
                      Tổng toàn đội
                    </td>
                    {days.map((d) => {
                      const dayTotal = staff.reduce((sum, p) => sum + loggedOn(p.id, d.key), 0);
                      return (
                        <td key={d.key} className="px-2 py-2.5 text-center">
                          <span className={`text-sm font-semibold ${dayTotal === 0 ? 'text-slate-300' : 'text-slate-700'}`}>
                            {dayTotal > 0 ? formatHours(dayTotal) : '—'}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5 text-center">
                      <span className="text-sm font-bold text-slate-800">
                        {formatHours(staff.reduce((sum, p) => sum + days.reduce((s, d) => s + loggedOn(p.id, d.key), 0), 0))}
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <WorklogApprovalQueue weekStart={days[0].key} />

      <p className="text-xs text-slate-400 leading-relaxed">
        Ô màu cam nghĩa là chấm công ghi nhận có mặt nhưng nhật ký khai ít hơn quá {UNLOGGED_TOLERANCE_HOURS} giờ.
        Ngày chưa tới và ngày chưa check-out không được tính.
      </p>
    </div>
  );
}

interface WorklogReviewRow {
  id: string;
  user_id: string;
  project_id: string;
  week_start: string;
  submit_note: string | null;
  created_at: string;
}

interface WorklogReviewEntry {
  work_date: string;
  hours: number;
  note: string | null;
  task: { id: string; title: string; project_id: string } | Array<{ id: string; title: string; project_id: string }>;
}

export function WorklogApprovalQueue({
  weekStart,
  projectId,
}: {
  weekStart?: string;
  projectId?: string;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<WorklogReviewRow[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [projects, setProjects] = useState<Map<string, string>>(new Map());
  const [entriesBySubmission, setEntriesBySubmission] = useState<Map<string, WorklogReviewEntry[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [target, setTarget] = useState<WorklogReviewRow | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    let query = supabase.from('worklog_submissions')
      .select('id,user_id,project_id,week_start,submit_note,created_at')
      .eq('status', 'SUBMITTED')
      .order('week_start', { ascending: true })
      .order('created_at', { ascending: true });
    if (weekStart) query = query.eq('week_start', weekStart);
    if (projectId) query = query.eq('project_id', projectId);
    if (!weekStart) query = query.limit(100);
    const { data, error } = await query;
    if (error) {
      setLoadError(describeDbError(error));
      setLoading(false);
      return;
    }
    const submissions = (data || []) as WorklogReviewRow[];
    const userIds = [...new Set(submissions.map((row) => row.user_id))];
    const projectIds = [...new Set(submissions.map((row) => row.project_id))];
    const rangeStart = weekStart ?? submissions.reduce(
      (minimum, row) => row.week_start < minimum ? row.week_start : minimum,
      submissions[0]?.week_start ?? toDateString(new Date()),
    );
    const rangeEnd = weekStart
      ? toDateString(addDays(new Date(`${weekStart}T00:00:00`), 6))
      : submissions.reduce((maximum, row) => {
          const end = toDateString(addDays(new Date(`${row.week_start}T00:00:00`), 6));
          return end > maximum ? end : maximum;
        }, rangeStart);
    const [peopleResult, projectResult, logsResult] = await Promise.all([
      userIds.length ? supabase.from('profiles_directory').select('id,name').in('id', userIds) : Promise.resolve({ data: [], error: null }),
      projectIds.length ? supabase.from('projects').select('id,name').in('id', projectIds) : Promise.resolve({ data: [], error: null }),
      userIds.length ? supabase.from('task_worklogs')
        .select('user_id,work_date,hours,note,task:tasks!inner(id,title,project_id)')
        .in('user_id', userIds).gte('work_date', rangeStart).lte('work_date', rangeEnd)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const detailError = peopleResult.error ?? projectResult.error ?? logsResult.error;
    const worklogEntries = (logsResult.data || []) as (WorklogReviewEntry & { user_id: string })[];
    const entryMap = new Map<string, WorklogReviewEntry[]>();
    for (const submission of submissions) {
      const items = worklogEntries.filter((entry) => {
        const task = Array.isArray(entry.task) ? entry.task[0] : entry.task;
        const submissionWeekEnd = toDateString(addDays(new Date(`${submission.week_start}T00:00:00`), 6));
        return entry.user_id === submission.user_id
          && task?.project_id === submission.project_id
          && entry.work_date >= submission.week_start
          && entry.work_date <= submissionWeekEnd;
      });
      entryMap.set(submission.id, items);
    }
    setLoadError(detailError ? describeDbError(detailError) : null);
    setRows(submissions);
    setNames(new Map((peopleResult.data || []).map((row) => [row.id, row.name])));
    setProjects(new Map((projectResult.data || []).map((row) => [row.id, row.name])));
    setEntriesBySubmission(entryMap);
    setLoading(false);
  }, [weekStart, projectId]);

  useEffect(() => { void load(); }, [load]);
  useRealtimeSync([{ table: 'worklog_submissions' }], () => load(true), {
    channelKey: `worklog-approval-${projectId ?? 'all'}-${weekStart ?? 'pending'}`,
  });

  const review = async (submission: WorklogReviewRow, decision: 'APPROVED' | 'RETURNED') => {
    if (decision === 'RETURNED' && reviewNote.trim().length < 3) {
      toast('Nhập lý do trả worklog (ít nhất 3 ký tự).', 'warning');
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('review_project_worklog_submission', {
      target_submission: submission.id,
      decision,
      decision_note: reviewNote.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast(`Xử lý worklog thất bại: ${describeDbError(error)}`, 'error');
      return;
    }
    toast(decision === 'APPROVED' ? 'Đã duyệt worklog.' : 'Đã trả worklog để chỉnh sửa.', 'success');
    await notifyUser(
      submission.user_id,
      decision === 'APPROVED' ? 'Worklog đã được duyệt' : 'Worklog cần chỉnh sửa',
      `${projects.get(submission.project_id) ?? 'Dự án'}${decision === 'RETURNED' ? ` · ${reviewNote.trim()}` : ''}`,
      'worklog_review_result',
    );
    setTarget(null);
    setReviewNote('');
    await load(true);
  };

  return (
    <>
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">
                Worklog chờ duyệt{weekStart ? ` · tuần từ ${weekStart}` : ' của dự án'}
              </h3>
              <p className="mt-1 text-xs text-slate-500">Chỉ Project lead của dự án hoặc Admin/CEO có thể xử lý.</p>
            </div>
            <Badge className="bg-amber-50 text-amber-700">{rows.length} chờ duyệt</Badge>
          </div>
          {loading ? (
            <Skeleton className="h-16" />
          ) : loadError ? (
            <ErrorState message={loadError} onRetry={() => void load()} />
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-400">Không có worklog chờ duyệt trong tuần này hoặc tài khoản không có phạm vi duyệt.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((row) => (
                <li key={row.id} className="flex flex-wrap items-start gap-3 py-3">
                  <NotebookPen className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800">
                      {names.get(row.user_id) ?? 'Nhân viên'} · {projects.get(row.project_id) ?? 'Dự án'}
                    </p>
                    <p className="text-xs text-slate-500">
                      Tuần từ {row.week_start} · gửi {new Date(row.created_at).toLocaleString('vi-VN')}
                    </p>
                    {row.submit_note && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{row.submit_note}</p>}
                    <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2">
                      <p className="text-xs font-semibold text-slate-600">
                        {formatHours((entriesBySubmission.get(row.id) || []).reduce((sum, entry) => sum + Number(entry.hours), 0))} tổng giờ
                      </p>
                      <ul className="mt-1 space-y-1">
                        {(entriesBySubmission.get(row.id) || []).map((entry, index) => {
                          const task = Array.isArray(entry.task) ? entry.task[0] : entry.task;
                          return (
                            <li key={`${entry.work_date}-${task?.id ?? index}`} className="text-xs text-slate-500">
                              {formatDate(entry.work_date)} · {task?.title ?? 'Task'}: {formatHours(Number(entry.hours))}
                              {entry.note ? ` · ${entry.note}` : ''}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => { setTarget(row); setReviewNote(''); }} disabled={busy}>
                      Trả lại
                    </Button>
                    <Button size="sm" variant="success" onClick={() => void review(row, 'APPROVED')} disabled={busy}>
                      Duyệt
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Modal open={!!target} onClose={() => setTarget(null)} title="Trả worklog">
        {target && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              {names.get(target.user_id) ?? 'Nhân viên'} · {projects.get(target.project_id) ?? 'Dự án'}
            </p>
            <Textarea
              label="Lý do cần chỉnh sửa"
              rows={3}
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
              required
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setTarget(null)} disabled={busy}>Hủy</Button>
              <Button onClick={() => void review(target, 'RETURNED')} disabled={busy || reviewNote.trim().length < 3}>
                Trả để chỉnh sửa
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
