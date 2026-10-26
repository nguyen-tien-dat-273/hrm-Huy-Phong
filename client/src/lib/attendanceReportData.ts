// ============================================================================
// Nghiệp vụ tổng hợp Báo cáo Chấm công, Chuyên cần, Làm thêm giờ (OT) & Nghỉ phép.
// ----------------------------------------------------------------------------
// Tập hợp dữ liệu từ:
// - profiles_directory: danh sách nhân sự
// - attendance: lượt chấm công thực tế từ máy/hệ thống
// - attendance_requests: đơn đi muộn, về sớm, làm thêm giờ (OT)
// - leave_requests: đơn nghỉ phép, nghỉ ốm, không lương
// - work_schedules: ca làm việc & khung giờ chuẩn
// - company_holidays: danh sách ngày lễ
// ============================================================================

import { endOfMonth, format, getDaysInMonth, startOfMonth } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { fetchWorkSchedules, scheduleForDate, dayWeight, monthStandardDays, type ScheduleSet } from '@/lib/workSchedule';
import { toDateString } from '@/lib/utils';
import type { Attendance, LeaveRequest, LeaveType, LeaveStatus, Profile } from '@/types';

/** Các loại đơn tính vào giờ làm thêm; đơn ca đêm tính theo công nên không nằm đây. */
const OT_REQUEST_TYPES: readonly string[] = ['OVERTIME', 'OT_WEEKDAY', 'OT_WEEKEND', 'OT_HOLIDAY'];

export type DisciplineGrade ='EXCELLENT' | 'GOOD' | 'FAIR' | 'WARNING';

export interface EmployeeAttendanceRollup {
  profile: Profile;
  // Ngày công & giờ làm
  workDays: number;
  standardDays: number;
  completionRate: number; // (workDays / standardDays) * 100
  totalHours: number;
  missingCheckoutCount: number;

  // Đi muộn & về sớm
  lateCount: number;
  lateMinutes: number;
  lateAfterCutoffCount: number; // vào sau 09:00
  lateExcusedCount: number; // có đơn giải trình đã duyệt
  lateUnexcusedCount: number; // không có đơn hoặc bị từ chối
  earlyCount: number;
  earlyMinutes: number;

  // Làm thêm giờ (OT)
  otHoursTotal: number;
  otHoursWeekday: number;
  otHoursWeekend: number;
  otHoursHoliday: number;
  otCount: number;
  otApprovedHours: number;
  otPendingHours: number;

  // Nghỉ phép
  leaveDaysTotal: number;
  leaveDaysAnnual: number;
  leaveDaysSick: number;
  leaveDaysUnpaid: number;
  leaveDaysOther: number;
  leaveCount: number;

  // Đánh giá kỷ luật & chuyên cần
  onTimeDays: number;
  punctualityRate: number; // (onTimeDays / workDays) * 100
  disciplineGrade: DisciplineGrade;
}

export interface DetailedLateRecord {
  id: string;
  userId: string;
  profile: Profile | null;
  date: string;
  checkInTime: string;
  checkOutTime: string | null;
  scheduledStartTime: string;
  lateMinutes: number;
  isAfterCutoff: boolean;
  requestStatus: 'APPROVED' | 'PENDING' | 'REJECTED' | 'NO_REQUEST';
  reason: string | null;
  reviewNote: string | null;
}

export interface DetailedOtRecord {
  id: string;
  userId: string;
  profile: Profile | null;
  workDate: string;
  hours: number;
  otType: 'WEEKDAY' | 'WEEKEND' | 'HOLIDAY';
  otTypeRate: number; // 150 | 200 | 300
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  reviewNote: string | null;
  createdAt: string;
}

export interface DetailedLeaveRecord {
  id: string;
  userId: string;
  profile: Profile | null;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  daysInMonth: number;
  totalDays: number;
  halfDay: boolean;
  reason: string | null;
  status: LeaveStatus;
  approvalStage: string | null;
  approvedBy: string | null;
  reasonReject: string | null;
}

export interface DailyTrendPoint {
  date: string;
  dayNum: number;
  weekday: string;
  isWeekend: boolean;
  checkins: number;
  onTime: number;
  late: number;
  onLeave: number;
  otHours: number;
}

export interface DepartmentReportStats {
  department: string;
  employeeCount: number;
  totalWorkDays: number;
  avgWorkDays: number;
  totalLateCount: number;
  totalLateMinutes: number;
  totalOtHours: number;
  totalLeaveDays: number;
  punctualityRate: number;
}

export interface AttendanceReportWorkspace {
  month: string; // YYYY-MM
  monthLabel: string; // MM/YYYY
  periodStatus: 'OPEN' | 'REVIEW' | 'LOCKED' | 'NOT_FOUND';
  standardDays: number;
  employees: Profile[];
  attendances: Attendance[];
  rollups: EmployeeAttendanceRollup[];
  lateRecords: DetailedLateRecord[];
  otRecords: DetailedOtRecord[];
  leaveRecords: DetailedLeaveRecord[];
  dailyTrend: DailyTrendPoint[];
  deptStats: DepartmentReportStats[];

  // Chỉ số KPI toàn công ty
  totalEmployees: number;
  totalWorkDays: number;
  totalWorkHours: number;
  avgWorkDays: number;

  totalLateIncidents: number;
  totalLateMinutes: number;
  employeesWithLate: number;
  lateExcusedCount: number;
  lateUnexcusedCount: number;
  lateAfterCutoffCount: number;

  totalEarlyIncidents: number;
  totalEarlyMinutes: number;

  totalOtHours: number;
  otHoursWeekday: number;
  otHoursWeekend: number;
  otHoursHoliday: number;
  employeesWithOt: number;
  approvedOtHours: number;

  totalLeaveDays: number;
  leaveDaysAnnual: number;
  leaveDaysSick: number;
  leaveDaysUnpaid: number;
  leaveDaysOther: number;
  employeesWithLeave: number;

  avgPunctualityRate: number;
  totalMissingCheckouts: number;
  countExcellent: number;
  countGood: number;
  countFair: number;
  countWarning: number;

  error: string | null;
}

const VI_WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

function clockMinutes(val: string): number {
  const [h, m] = val.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function timeMinutes(timestamp: string): number {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return Number.NaN;
  return d.getHours() * 60 + d.getMinutes();
}

/** Tải toàn bộ dòng nếu vượt ngưỡng 1.000 dòng của PostgREST */
async function fetchAllRows<T = any>(
  fetcher: (from: number, to: number) => PromiseLike<{ data: any; error: any }>,
): Promise<{ data: T[]; error: any }> {
  const PAGE = 1000;
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetcher(from, from + PAGE - 1);
    if (error) return { data: all, error };
    all.push(...((data as T[]) ?? []));
    if (!data || data.length < PAGE) return { data: all, error: null };
  }
}

export async function loadAttendanceReportWorkspace(
  monthStartStr: string,
): Promise<AttendanceReportWorkspace> {
  const monthDate = new Date(`${monthStartStr}T00:00:00`);
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);
  const monthEndStr = toDateString(monthEnd);
  const monthKey = monthStartStr.slice(0, 7);
  const monthLabel = format(monthStart, 'MM/yyyy');
  const daysInMonth = getDaysInMonth(monthDate);

  if (!supabase) {
    return makeEmptyWorkspace(monthKey, monthLabel, 'Chưa kết nối Supabase');
  }

  try {
    // Tải song song tất cả các bảng dữ liệu
    const [
      profilesRes,
      schedulesRes,
      holidaysRes,
      periodRes,
      attendanceRes,
      requestsRes,
      leavesRes,
    ] = await Promise.all([
      supabase.from('profiles_directory').select('*').order('name'),
      fetchWorkSchedules(true),
      supabase
        .from('company_holidays')
        .select('holiday_date, is_active, name')
        .eq('is_active', true)
        .gte('holiday_date', monthStartStr)
        .lte('holiday_date', monthEndStr),
      supabase
        .from('timesheet_periods')
        .select('status')
        .eq('month_start', monthStartStr)
        .maybeSingle(),
      fetchAllRows<Attendance>((from, to) =>
        supabase
          .from('attendance')
          .select('id, user_id, date, check_in_time, check_out_time, status, approved_by_lead, check_in_method')
          .gte('date', monthStartStr)
          .lte('date', monthEndStr)
          .range(from, to),
      ),
      fetchAllRows<any>((from, to) =>
        supabase
          .from('attendance_requests')
          .select('*')
          .gte('work_date', monthStartStr)
          .lte('work_date', monthEndStr)
          .range(from, to),
      ),
      fetchAllRows<LeaveRequest>((from, to) =>
        supabase
          .from('leave_requests')
          .select('*')
          .lte('start_date', monthEndStr)
          .gte('end_date', monthStartStr)
          .range(from, to),
      ),
    ]);

    if (profilesRes.error) {
      return makeEmptyWorkspace(monthKey, monthLabel, describeDbError(profilesRes.error));
    }

    const profiles = (profilesRes.data || []) as Profile[];
    const profileMap = new Map<string, Profile>(profiles.map((p) => [p.id, p]));
    const schedules: ScheduleSet = schedulesRes;
    const holidayDates = new Set<string>((holidaysRes.data || []).map((h: any) => h.holiday_date));
    const periodStatus = periodRes.data?.status ?? 'NOT_FOUND';

    const attendances = attendanceRes.data || [];
    const requests = requestsRes.data || [];
    const leaves = leavesRes.data || [];

    // Tính công chuẩn tháng
    const standardDaysCalculated = monthStandardDays(schedules, monthStart, Array.from(holidayDates));
    const standardDays = standardDaysCalculated ?? 26;

    // Gom attendance_requests theo user_id và work_date
    // Map: userId -> Map<date, { late?: request, early?: request, ot: request[] }>
    type UserDayReqs = { late?: any; early?: any; ot: any[] };
    const userRequestsMap = new Map<string, Map<string, UserDayReqs>>();
    for (const req of requests) {
      let uMap = userRequestsMap.get(req.user_id);
      if (!uMap) {
        uMap = new Map();
        userRequestsMap.set(req.user_id, uMap);
      }
      let dayReq = uMap.get(req.work_date);
      if (!dayReq) {
        dayReq = { ot: [] };
        uMap.set(req.work_date, dayReq);
      }
      if (req.request_type === 'LATE_ARRIVAL') dayReq.late = req;
      else if (req.request_type === 'EARLY_LEAVE') dayReq.early = req;
      else if (OT_REQUEST_TYPES.includes(req.request_type)) dayReq.ot.push(req);
    }

    // Gom attendance theo user_id
    const userAttendanceMap = new Map<string, Attendance[]>();
    for (const att of attendances) {
      const list = userAttendanceMap.get(att.user_id) ?? [];
      list.push(att);
      userAttendanceMap.set(att.user_id, list);
    }

    // Gom leave_requests theo user_id
    const userLeavesMap = new Map<string, LeaveRequest[]>();
    for (const lev of leaves) {
      const list = userLeavesMap.get(lev.user_id) ?? [];
      list.push(lev);
      userLeavesMap.set(lev.user_id, list);
    }

    const detailedLateRecords: DetailedLateRecord[] = [];
    const detailedOtRecords: DetailedOtRecord[] = [];
    const detailedLeaveRecords: DetailedLeaveRecord[] = [];

    // Gom dữ liệu OT
    for (const req of requests) {
      if (!OT_REQUEST_TYPES.includes(req.request_type)) continue;
      const hours = Number(req.hours || 0);
      if (!Number.isFinite(hours) || hours <= 0) continue;

      const isHoliday = holidayDates.has(req.work_date);
      const isWeekend = schedules.supported
        ? dayWeight(schedules, req.work_date, holidayDates) === 0
        : [0, 6].includes(new Date(`${req.work_date}T00:00:00`).getDay());

      // Đơn chọn đúng loại thì theo loại đó; đơn "Làm thêm giờ" cũ mới đoán theo ngày.
      let otType: 'WEEKDAY' | 'WEEKEND' | 'HOLIDAY' = 'WEEKDAY';
      let otTypeRate = 150;
      if (req.request_type === 'OT_HOLIDAY' || (req.request_type === 'OVERTIME' && isHoliday)) {
        otType = 'HOLIDAY';
        otTypeRate = 300;
      } else if (req.request_type === 'OT_WEEKEND' || (req.request_type === 'OVERTIME' && isWeekend)) {
        otType = 'WEEKEND';
        otTypeRate = 200;
      }

      detailedOtRecords.push({
        id: req.id,
        userId: req.user_id,
        profile: profileMap.get(req.user_id) ?? null,
        workDate: req.work_date,
        hours,
        otType,
        otTypeRate,
        reason: req.reason || 'Làm thêm theo phân công',
        status: req.status || 'PENDING',
        reviewNote: req.review_note || null,
        createdAt: req.created_at || req.work_date,
      });
    }

    // Gom dữ liệu Nghỉ phép
    for (const lev of leaves) {
      // Đếm số ngày công nghỉ nằm trọn trong tháng này
      let daysInThisMonth = 0;
      const start = new Date(Math.max(new Date(`${lev.start_date}T00:00:00`).getTime(), monthStart.getTime()));
      const end = new Date(Math.min(new Date(`${lev.end_date}T00:00:00`).getTime(), monthEnd.getTime()));

      if (start <= end) {
        const cur = new Date(start);
        while (cur <= end) {
          const iso = toDateString(cur);
          const weight = dayWeight(schedules, iso, holidayDates);
          if (weight > 0) {
            daysInThisMonth += lev.half_day ? weight / 2 : weight;
          }
          cur.setDate(cur.getDate() + 1);
        }
      }
      daysInThisMonth = Math.round(daysInThisMonth * 100) / 100;

      detailedLeaveRecords.push({
        id: lev.id,
        userId: lev.user_id,
        profile: profileMap.get(lev.user_id) ?? null,
        leaveType: lev.leave_type,
        startDate: lev.start_date,
        endDate: lev.end_date,
        daysInMonth: daysInThisMonth,
        totalDays: lev.days,
        halfDay: lev.half_day,
        reason: lev.reason,
        status: lev.status,
        approvalStage: lev.approval_stage || null,
        approvedBy: lev.approved_by,
        reasonReject: lev.reason_reject,
      });
    }

    // Xử lý từng nhân viên để tạo EmployeeAttendanceRollup
    // Lấy nhân sự đang hoạt động (is_active) hoặc có phát sinh dữ liệu (công/đơn/nghỉ) trong tháng này
    const relevantProfiles = profiles.filter((p) => {
      if (p.is_active) return true;
      const hasAtt = (userAttendanceMap.get(p.id) || []).length > 0;
      const hasReq = (userRequestsMap.get(p.id)?.size || 0) > 0;
      const hasLeave = (userLeavesMap.get(p.id) || []).length > 0;
      return hasAtt || hasReq || hasLeave;
    });

    const rollups: EmployeeAttendanceRollup[] = [];

    for (const person of relevantProfiles) {
      const pAttendance = userAttendanceMap.get(person.id) || [];
      const pLeaves = userLeavesMap.get(person.id) || [];
      const pReqs = userRequestsMap.get(person.id);

      // Đi làm
      const withCheckIn = pAttendance.filter((a) => a.check_in_time);
      const workedDates = new Set(withCheckIn.map((a) => a.date));
      let workDays = 0;
      for (const d of workedDates) {
        workDays += schedules.supported ? dayWeight(schedules, d, holidayDates) : 1;
      }
      workDays = Math.round(workDays * 10) / 10;

      let totalHours = 0;
      let missingCheckoutCount = 0;

      for (const a of withCheckIn) {
        if (!a.check_out_time) {
          missingCheckoutCount++;
          continue;
        }
        const st = new Date(a.check_in_time!).getTime();
        const en = new Date(a.check_out_time).getTime();
        if (Number.isFinite(st) && Number.isFinite(en) && en > st) {
          totalHours += Math.min((en - st) / 3_600_000, 24);
        }
      }
      totalHours = Math.round(totalHours * 10) / 10;

      // Đi muộn & Về sớm
      let lateCount = 0;
      let lateMinutes = 0;
      let lateAfterCutoffCount = 0;
      let lateExcusedCount = 0;
      let lateUnexcusedCount = 0;
      let earlyCount = 0;
      let earlyMinutes = 0;

      for (const a of withCheckIn) {
        const schedule = scheduleForDate(schedules, a.date);
        if (!schedule) continue;
        if (dayWeight(schedules, a.date, holidayDates) === 0) continue; // Ngày nghỉ

        // Đo đi muộn
        if (a.check_in_time) {
          const actualMin = timeMinutes(a.check_in_time);
          const schedMin = clockMinutes(schedule.start_time);
          const grace = schedule.grace_minutes || 0;
          const diff = actualMin - schedMin - grace;

          if (diff > 0) {
            lateCount++;
            lateMinutes += diff;
            const isCutoff = actualMin >= 9 * 60; // Sau 09:00
            if (isCutoff) lateAfterCutoffCount++;

            // Kiểm tra xem có đơn giải trình không
            const dayReq = pReqs?.get(a.date);
            const lateReq = dayReq?.late;
            let reqStatus: DetailedLateRecord['requestStatus'] = 'NO_REQUEST';

            if (lateReq) {
              if (lateReq.status === 'APPROVED') {
                reqStatus = 'APPROVED';
                lateExcusedCount++;
              } else if (lateReq.status === 'PENDING') {
                reqStatus = 'PENDING';
              } else {
                reqStatus = 'REJECTED';
                lateUnexcusedCount++;
              }
            } else {
              lateUnexcusedCount++;
            }

            detailedLateRecords.push({
              id: a.id,
              userId: person.id,
              profile: person,
              date: a.date,
              checkInTime: a.check_in_time,
              checkOutTime: a.check_out_time,
              scheduledStartTime: schedule.start_time.slice(0, 5),
              lateMinutes: diff,
              isAfterCutoff: isCutoff,
              requestStatus: reqStatus,
              reason: lateReq?.reason ?? null,
              reviewNote: lateReq?.review_note ?? null,
            });
          }
        }

        // Đo về sớm
        if (a.check_out_time) {
          const actualOut = timeMinutes(a.check_out_time);
          const schedOut = clockMinutes(schedule.end_time);
          if (actualOut < schedOut) {
            const earlyDiff = schedOut - actualOut;
            earlyCount++;
            earlyMinutes += earlyDiff;
          }
        }
      }

      // Làm thêm giờ (OT)
      let otHoursTotal = 0;
      let otHoursWeekday = 0;
      let otHoursWeekend = 0;
      let otHoursHoliday = 0;
      let otApprovedHours = 0;
      let otPendingHours = 0;
      let otCount = 0;

      const pOtRecords = detailedOtRecords.filter((r) => r.userId === person.id);
      for (const ot of pOtRecords) {
        otCount++;
        otHoursTotal += ot.hours;
        if (ot.status === 'APPROVED') {
          otApprovedHours += ot.hours;
          if (ot.otType === 'WEEKDAY') otHoursWeekday += ot.hours;
          else if (ot.otType === 'WEEKEND') otHoursWeekend += ot.hours;
          else if (ot.otType === 'HOLIDAY') otHoursHoliday += ot.hours;
        } else if (ot.status === 'PENDING') {
          otPendingHours += ot.hours;
        }
      }

      // Nghỉ phép
      let leaveDaysTotal = 0;
      let leaveDaysAnnual = 0;
      let leaveDaysSick = 0;
      let leaveDaysUnpaid = 0;
      let leaveDaysOther = 0;
      let leaveCount = 0;

      const pLeaveRecords = detailedLeaveRecords.filter(
        (r) => r.userId === person.id && r.status === 'approved',
      );
      for (const lev of pLeaveRecords) {
        leaveCount++;
        leaveDaysTotal += lev.daysInMonth;
        if (lev.leaveType === 'annual') leaveDaysAnnual += lev.daysInMonth;
        else if (lev.leaveType === 'sick') leaveDaysSick += lev.daysInMonth;
        else if (lev.leaveType === 'unpaid') leaveDaysUnpaid += lev.daysInMonth;
        else leaveDaysOther += lev.daysInMonth;
      }

      leaveDaysTotal = Math.round(leaveDaysTotal * 100) / 100;
      leaveDaysAnnual = Math.round(leaveDaysAnnual * 100) / 100;
      leaveDaysSick = Math.round(leaveDaysSick * 100) / 100;
      leaveDaysUnpaid = Math.round(leaveDaysUnpaid * 100) / 100;
      leaveDaysOther = Math.round(leaveDaysOther * 100) / 100;

      // Tính tỷ lệ chuyên cần & hoàn thành
      const onTimeDays = Math.max(0, workDays - lateCount);
      const punctualityRate = workDays > 0 ? Math.round((onTimeDays / workDays) * 100) : 100;
      const completionRate = standardDays > 0 ? Math.round((workDays / standardDays) * 100) : 0;

      // Xếp loại kỷ luật / chuyên cần
      let disciplineGrade: DisciplineGrade = 'FAIR';
      if (workDays >= standardDays && lateCount === 0 && missingCheckoutCount === 0) {
        disciplineGrade = 'EXCELLENT';
      } else if (completionRate >= 90 && lateCount <= 2 && lateUnexcusedCount === 0 && missingCheckoutCount <= 1) {
        disciplineGrade = 'GOOD';
      } else if (lateCount > 4 || lateAfterCutoffCount >= 2 || missingCheckoutCount >= 3 || completionRate < 70) {
        disciplineGrade = 'WARNING';
      } else {
        disciplineGrade = 'FAIR';
      }

      rollups.push({
        profile: person,
        workDays,
        standardDays,
        completionRate,
        totalHours,
        missingCheckoutCount,
        lateCount,
        lateMinutes,
        lateAfterCutoffCount,
        lateExcusedCount,
        lateUnexcusedCount,
        earlyCount,
        earlyMinutes,
        otHoursTotal: Math.round(otHoursTotal * 10) / 10,
        otHoursWeekday: Math.round(otHoursWeekday * 10) / 10,
        otHoursWeekend: Math.round(otHoursWeekend * 10) / 10,
        otHoursHoliday: Math.round(otHoursHoliday * 10) / 10,
        otCount,
        otApprovedHours: Math.round(otApprovedHours * 10) / 10,
        otPendingHours: Math.round(otPendingHours * 10) / 10,
        leaveDaysTotal,
        leaveDaysAnnual,
        leaveDaysSick,
        leaveDaysUnpaid,
        leaveDaysOther,
        leaveCount,
        onTimeDays,
        punctualityRate,
        disciplineGrade,
      });
    }

    // Sắp xếp danh sách tổng hợp theo tên nhân viên
    rollups.sort((a, b) => a.profile.name.localeCompare(b.profile.name));

    // Tổng hợp chỉ số KPI toàn công ty
    const totalEmployees = relevantProfiles.length;
    const totalWorkDays = rollups.reduce((sum, r) => sum + r.workDays, 0);
    const totalWorkHours = Math.round(rollups.reduce((sum, r) => sum + r.totalHours, 0) * 10) / 10;
    const avgWorkDays = totalEmployees > 0 ? Math.round((totalWorkDays / totalEmployees) * 10) / 10 : 0;

    const totalLateIncidents = rollups.reduce((sum, r) => sum + r.lateCount, 0);
    const totalLateMinutes = rollups.reduce((sum, r) => sum + r.lateMinutes, 0);
    const employeesWithLate = rollups.filter((r) => r.lateCount > 0).length;
    const lateExcusedCount = rollups.reduce((sum, r) => sum + r.lateExcusedCount, 0);
    const lateUnexcusedCount = rollups.reduce((sum, r) => sum + r.lateUnexcusedCount, 0);
    const lateAfterCutoffCount = rollups.reduce((sum, r) => sum + r.lateAfterCutoffCount, 0);

    const totalEarlyIncidents = rollups.reduce((sum, r) => sum + r.earlyCount, 0);
    const totalEarlyMinutes = rollups.reduce((sum, r) => sum + r.earlyMinutes, 0);

    const totalOtHours = Math.round(rollups.reduce((sum, r) => sum + r.otHoursTotal, 0) * 10) / 10;
    const otHoursWeekday = Math.round(rollups.reduce((sum, r) => sum + r.otHoursWeekday, 0) * 10) / 10;
    const otHoursWeekend = Math.round(rollups.reduce((sum, r) => sum + r.otHoursWeekend, 0) * 10) / 10;
    const otHoursHoliday = Math.round(rollups.reduce((sum, r) => sum + r.otHoursHoliday, 0) * 10) / 10;
    const employeesWithOt = rollups.filter((r) => r.otHoursTotal > 0).length;
    const approvedOtHours = Math.round(rollups.reduce((sum, r) => sum + r.otApprovedHours, 0) * 10) / 10;

    const totalLeaveDays = Math.round(rollups.reduce((sum, r) => sum + r.leaveDaysTotal, 0) * 100) / 100;
    const leaveDaysAnnual = Math.round(rollups.reduce((sum, r) => sum + r.leaveDaysAnnual, 0) * 100) / 100;
    const leaveDaysSick = Math.round(rollups.reduce((sum, r) => sum + r.leaveDaysSick, 0) * 100) / 100;
    const leaveDaysUnpaid = Math.round(rollups.reduce((sum, r) => sum + r.leaveDaysUnpaid, 0) * 100) / 100;
    const leaveDaysOther = Math.round(rollups.reduce((sum, r) => sum + r.leaveDaysOther, 0) * 100) / 100;
    const employeesWithLeave = rollups.filter((r) => r.leaveDaysTotal > 0).length;

    const totalMissingCheckouts = rollups.reduce((sum, r) => sum + r.missingCheckoutCount, 0);
    const avgPunctualityRate =
      rollups.length > 0 ? Math.round(rollups.reduce((sum, r) => sum + r.punctualityRate, 0) / rollups.length) : 100;

    const countExcellent = rollups.filter((r) => r.disciplineGrade === 'EXCELLENT').length;
    const countGood = rollups.filter((r) => r.disciplineGrade === 'GOOD').length;
    const countFair = rollups.filter((r) => r.disciplineGrade === 'FAIR').length;
    const countWarning = rollups.filter((r) => r.disciplineGrade === 'WARNING').length;

    // Xây dựng DailyTrendPoint cho từng ngày trong tháng (Dùng cho biểu đồ xu hướng ngày)
    const dailyTrend: DailyTrendPoint[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = `${monthKey}-${String(day).padStart(2, '0')}`;
      const d = new Date(`${iso}T00:00:00`);
      const dayWeekday = VI_WEEKDAYS[d.getDay()];
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;

      const dayCheckins = attendances.filter((a) => a.date === iso && a.check_in_time).length;
      const dayLates = detailedLateRecords.filter((r) => r.date === iso).length;
      const dayOnTime = Math.max(0, dayCheckins - dayLates);

      // Nghỉ phép trong ngày này
      const dayLeaves = detailedLeaveRecords.filter(
        (lev) => lev.status === 'approved' && lev.startDate <= iso && lev.endDate >= iso,
      ).length;

      // OT trong ngày này
      const dayOtHours = detailedOtRecords
        .filter((ot) => ot.workDate === iso && ot.status === 'APPROVED')
        .reduce((sum, ot) => sum + ot.hours, 0);

      dailyTrend.push({
        date: iso,
        dayNum: day,
        weekday: dayWeekday,
        isWeekend,
        checkins: dayCheckins,
        onTime: dayOnTime,
        late: dayLates,
        onLeave: dayLeaves,
        otHours: Math.round(dayOtHours * 10) / 10,
      });
    }

    // Xây dựng DepartmentReportStats theo phòng ban
    const deptMap = new Map<string, EmployeeAttendanceRollup[]>();
    for (const r of rollups) {
      const dept = r.profile.department || 'Chưa phân bổ';
      const list = deptMap.get(dept) ?? [];
      list.push(r);
      deptMap.set(dept, list);
    }

    const deptStats: DepartmentReportStats[] = [];
    for (const [dept, list] of deptMap.entries()) {
      const count = list.length;
      const deptWorkDays = list.reduce((sum, r) => sum + r.workDays, 0);
      const deptLateCount = list.reduce((sum, r) => sum + r.lateCount, 0);
      const deptLateMinutes = list.reduce((sum, r) => sum + r.lateMinutes, 0);
      const deptOtHours = Math.round(list.reduce((sum, r) => sum + r.otHoursTotal, 0) * 10) / 10;
      const deptLeaveDays = Math.round(list.reduce((sum, r) => sum + r.leaveDaysTotal, 0) * 10) / 10;
      const deptPunctuality =
        count > 0 ? Math.round(list.reduce((sum, r) => sum + r.punctualityRate, 0) / count) : 100;

      deptStats.push({
        department: dept,
        employeeCount: count,
        totalWorkDays: deptWorkDays,
        avgWorkDays: count > 0 ? Math.round((deptWorkDays / count) * 10) / 10 : 0,
        totalLateCount: deptLateCount,
        totalLateMinutes: deptLateMinutes,
        totalOtHours: deptOtHours,
        totalLeaveDays: deptLeaveDays,
        punctualityRate: deptPunctuality,
      });
    }

    deptStats.sort((a, b) => b.employeeCount - a.employeeCount);

    // Sắp xếp chi tiết đi muộn theo ngày giảm dần
    detailedLateRecords.sort((a, b) => b.date.localeCompare(a.date));
    detailedOtRecords.sort((a, b) => b.workDate.localeCompare(a.workDate));
    detailedLeaveRecords.sort((a, b) => b.startDate.localeCompare(a.startDate));

    return {
      month: monthKey,
      monthLabel,
      periodStatus: periodStatus as any,
      standardDays,
      employees: relevantProfiles,
      attendances,
      rollups,
      lateRecords: detailedLateRecords,
      otRecords: detailedOtRecords,
      leaveRecords: detailedLeaveRecords,
      dailyTrend,
      deptStats,
      totalEmployees,
      totalWorkDays,
      totalWorkHours,
      avgWorkDays,
      totalLateIncidents,
      totalLateMinutes,
      employeesWithLate,
      lateExcusedCount,
      lateUnexcusedCount,
      lateAfterCutoffCount,
      totalEarlyIncidents,
      totalEarlyMinutes,
      totalOtHours,
      otHoursWeekday,
      otHoursWeekend,
      otHoursHoliday,
      employeesWithOt,
      approvedOtHours,
      totalLeaveDays,
      leaveDaysAnnual,
      leaveDaysSick,
      leaveDaysUnpaid,
      leaveDaysOther,
      employeesWithLeave,
      avgPunctualityRate,
      totalMissingCheckouts,
      countExcellent,
      countGood,
      countFair,
      countWarning,
      error: null,
    };
  } catch (err: any) {
    return makeEmptyWorkspace(monthKey, monthLabel, err?.message ?? String(err));
  }
}

function makeEmptyWorkspace(month: string, monthLabel: string, error: string | null): AttendanceReportWorkspace {
  return {
    month,
    monthLabel,
    periodStatus: 'NOT_FOUND',
    standardDays: 26,
    employees: [],
    attendances: [],
    rollups: [],
    lateRecords: [],
    otRecords: [],
    leaveRecords: [],
    dailyTrend: [],
    deptStats: [],
    totalEmployees: 0,
    totalWorkDays: 0,
    totalWorkHours: 0,
    avgWorkDays: 0,
    totalLateIncidents: 0,
    totalLateMinutes: 0,
    employeesWithLate: 0,
    lateExcusedCount: 0,
    lateUnexcusedCount: 0,
    lateAfterCutoffCount: 0,
    totalEarlyIncidents: 0,
    totalEarlyMinutes: 0,
    totalOtHours: 0,
    otHoursWeekday: 0,
    otHoursWeekend: 0,
    otHoursHoliday: 0,
    employeesWithOt: 0,
    approvedOtHours: 0,
    totalLeaveDays: 0,
    leaveDaysAnnual: 0,
    leaveDaysSick: 0,
    leaveDaysUnpaid: 0,
    leaveDaysOther: 0,
    employeesWithLeave: 0,
    avgPunctualityRate: 100,
    totalMissingCheckouts: 0,
    countExcellent: 0,
    countGood: 0,
    countFair: 0,
    countWarning: 0,
    error,
  };
}

// ============================================================================
// Báo cáo công THEO NGÀY: một ngày, từng người có mặt / nghỉ / vắng, giờ vào ra,
// đi muộn, về sớm và các đơn phát sinh trong ngày.
// ----------------------------------------------------------------------------
// Dùng cùng cách đo với báo cáo tháng (ca làm việc, ngày lễ, đơn đã duyệt) để số
// liệu của một ngày cộng lại khớp với bảng tổng hợp tháng.
// ============================================================================

export type DailyPresence = 'PRESENT' | 'LEAVE' | 'ABSENT' | 'DAY_OFF';

export const DAILY_PRESENCE_LABEL: Record<DailyPresence, string> = {
  PRESENT: 'Có mặt',
  LEAVE: 'Nghỉ phép',
  ABSENT: 'Vắng',
  DAY_OFF: 'Ngày nghỉ',
};

export const ATTENDANCE_REQUEST_LABEL: Record<string, string> = {
  LATE_ARRIVAL: 'Đi muộn',
  EARLY_LEAVE: 'Về sớm',
  OVERTIME: 'Làm thêm giờ',
  OT_WEEKDAY: 'OT ngày thường',
  OT_WEEKEND: 'OT Chủ nhật / ngày nghỉ',
  OT_HOLIDAY: 'OT ngày lễ',
  NIGHT_WORK: 'Làm thêm ca đêm',
};

export interface DailyRequestChip {
  type: string;
  label: string;
  status: string;
  hours: number | null;
  minutes: number | null;
}

export interface DailyAttendanceRow {
  profile: Profile;
  presence: DailyPresence;
  checkIn: string | null;
  checkOut: string | null;
  workHours: number;
  missingCheckout: boolean;
  lateMinutes: number;
  earlyMinutes: number;
  leaveLabel: string | null;
  requests: DailyRequestChip[];
  /** Giờ làm thêm đã duyệt trong ngày (mọi loại OT). */
  otApprovedHours: number;
  /** Có đơn ca đêm đã duyệt: ngày này được cộng một công làm thêm ca đêm. */
  nightApproved: boolean;
}

export interface DailyAttendanceReport {
  date: string;
  weekday: string;
  holidayName: string | null;
  isWorkingDay: boolean;
  rows: DailyAttendanceRow[];
  present: number;
  onLeave: number;
  absent: number;
  late: number;
  early: number;
  missingCheckout: number;
  otApprovedHours: number;
  nightWorkers: number;
  pendingRequests: number;
  error: string | null;
}

const LEAVE_TYPE_LABEL: Record<string, string> = {
  annual: 'Phép năm',
  sick: 'Nghỉ ốm',
  unpaid: 'Không lương',
};

export async function loadDailyAttendanceReport(dateStr: string): Promise<DailyAttendanceReport> {
  const empty = (error: string | null): DailyAttendanceReport => ({
    date: dateStr,
    weekday: VI_WEEKDAYS[new Date(`${dateStr}T00:00:00`).getDay()],
    holidayName: null,
    isWorkingDay: true,
    rows: [],
    present: 0, onLeave: 0, absent: 0, late: 0, early: 0, missingCheckout: 0,
    otApprovedHours: 0, nightWorkers: 0, pendingRequests: 0,
    error,
  });
  if (!supabase) return empty('Chưa kết nối Supabase');

  try {
    const [profilesRes, schedules, holidayRes, attendanceRes, requestsRes, leavesRes] = await Promise.all([
      supabase.from('profiles_directory').select('*').order('name'),
      fetchWorkSchedules(true),
      supabase.from('company_holidays').select('holiday_date, name').eq('is_active', true).eq('holiday_date', dateStr).maybeSingle(),
      fetchAllRows<Attendance>((from, to) =>
        supabase.from('attendance')
          .select('id, user_id, date, check_in_time, check_out_time, status, approved_by_lead, check_in_method')
          .eq('date', dateStr).range(from, to)),
      fetchAllRows<any>((from, to) =>
        supabase.from('attendance_requests').select('*').eq('work_date', dateStr).range(from, to)),
      fetchAllRows<LeaveRequest>((from, to) =>
        supabase.from('leave_requests').select('*').eq('status', 'approved')
          .lte('start_date', dateStr).gte('end_date', dateStr).range(from, to)),
    ]);
    if (profilesRes.error) return empty(describeDbError(profilesRes.error));

    const profiles = (profilesRes.data || []) as Profile[];
    const holidayName = holidayRes.data ? String((holidayRes.data as any).name ?? 'Ngày lễ') : null;
    const holidays = new Set<string>(holidayRes.data ? [dateStr] : []);
    const weight = schedules.supported
      ? dayWeight(schedules, dateStr, holidays)
      : ([0, 6].includes(new Date(`${dateStr}T00:00:00`).getDay()) ? 0 : 1);
    const schedule = scheduleForDate(schedules, dateStr);

    const attByUser = new Map<string, Attendance[]>();
    for (const a of attendanceRes.data) attByUser.set(a.user_id, [...(attByUser.get(a.user_id) ?? []), a]);
    const reqByUser = new Map<string, any[]>();
    for (const r of requestsRes.data) reqByUser.set(r.user_id, [...(reqByUser.get(r.user_id) ?? []), r]);
    const leaveByUser = new Map<string, LeaveRequest>();
    for (const l of leavesRes.data) leaveByUser.set(l.user_id, l);

    const rows: DailyAttendanceRow[] = [];
    for (const person of profiles) {
      const atts = attByUser.get(person.id) ?? [];
      const reqs = reqByUser.get(person.id) ?? [];
      const leave = leaveByUser.get(person.id) ?? null;
      // Người đã nghỉ việc chỉ hiện khi ngày đó họ còn phát sinh dữ liệu.
      if (!person.is_active && atts.length === 0 && reqs.length === 0 && !leave) continue;

      const ins = atts.map((a) => a.check_in_time).filter((t): t is string => !!t).sort();
      const outs = atts.map((a) => a.check_out_time).filter((t): t is string => !!t).sort();
      const checkIn = ins[0] ?? null;
      const checkOut = outs.length > 0 ? outs[outs.length - 1] : null;

      let workHours = 0;
      if (checkIn && checkOut) {
        const span = (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 3_600_000;
        if (Number.isFinite(span) && span > 0) workHours = Math.round(Math.min(span, 24) * 10) / 10;
      }

      let lateMinutes = 0;
      let earlyMinutes = 0;
      if (schedule && weight > 0) {
        if (checkIn) {
          const diff = timeMinutes(checkIn) - clockMinutes(schedule.start_time) - (schedule.grace_minutes || 0);
          if (diff > 0) lateMinutes = diff;
        }
        if (checkOut) {
          const diff = clockMinutes(schedule.end_time) - timeMinutes(checkOut);
          if (diff > 0) earlyMinutes = diff;
        }
      }

      const presence: DailyPresence = checkIn ? 'PRESENT' : leave ? 'LEAVE' : weight === 0 ? 'DAY_OFF' : 'ABSENT';

      const requests: DailyRequestChip[] = reqs
        .filter((r) => r.status !== 'CANCELLED')
        .map((r) => ({
          type: r.request_type,
          label: ATTENDANCE_REQUEST_LABEL[r.request_type] ?? r.request_type,
          status: r.status,
          hours: r.hours != null ? Number(r.hours) : null,
          minutes: r.minutes != null ? Number(r.minutes) : null,
        }));
      const approved = reqs.filter((r) => r.status === 'APPROVED');

      rows.push({
        profile: person,
        presence,
        checkIn,
        checkOut,
        workHours,
        missingCheckout: !!checkIn && !checkOut,
        lateMinutes,
        earlyMinutes,
        leaveLabel: leave ? `${LEAVE_TYPE_LABEL[leave.leave_type] ?? 'Nghỉ phép'}${leave.half_day ? ' (nửa ngày)' : ''}` : null,
        requests,
        otApprovedHours: Math.round(approved
          .filter((r) => OT_REQUEST_TYPES.includes(r.request_type))
          .reduce((sum, r) => sum + Number(r.hours || 0), 0) * 10) / 10,
        nightApproved: approved.some((r) => r.request_type === 'NIGHT_WORK'),
      });
    }

    rows.sort((a, b) => a.profile.name.localeCompare(b.profile.name));
    return {
      date: dateStr,
      weekday: VI_WEEKDAYS[new Date(`${dateStr}T00:00:00`).getDay()],
      holidayName,
      isWorkingDay: weight > 0,
      rows,
      present: rows.filter((r) => r.presence === 'PRESENT').length,
      onLeave: rows.filter((r) => r.presence === 'LEAVE').length,
      absent: rows.filter((r) => r.presence === 'ABSENT').length,
      late: rows.filter((r) => r.lateMinutes > 0).length,
      early: rows.filter((r) => r.earlyMinutes > 0).length,
      missingCheckout: rows.filter((r) => r.missingCheckout).length,
      otApprovedHours: Math.round(rows.reduce((s, r) => s + r.otApprovedHours, 0) * 10) / 10,
      nightWorkers: rows.filter((r) => r.nightApproved).length,
      pendingRequests: rows.reduce((s, r) => s + r.requests.filter((q) => q.status === 'PENDING').length, 0),
      error: null,
    };
  } catch (err: any) {
    return empty(err?.message ?? String(err));
  }
}
