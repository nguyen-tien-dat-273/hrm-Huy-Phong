import { useEffect, useState, useCallback } from 'react';
import {
  Fingerprint, CheckCircle2, Clock, LogOut, Calendar, Send, Lock,
  RotateCcw, AlertTriangle, ClipboardList, Undo2, LogIn, MapPin, ExternalLink,
} from 'lucide-react';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { PRIORITY_CONFIG, formatTime, getTodayString, toDateString } from '@/lib/utils';
import {
  ASSIGNMENT_STATUS_CONFIG, canCheckOut, fetchApproverIds, notifyUsers,
  mondayOf, weekDates, dayLabel, isToday,
} from '@/lib/assignments';
import { addDays } from 'date-fns';
import type { Attendance, AttendanceSession, DailyAssignment } from '@/types';

type AttendanceState = 'loading' | 'not_checked_in' | 'working' | 'checked_out';
type WorkLocation = { id: string; name: string; address?: string | null; latitude: number; longitude: number; radius_meters: number };

const distanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const rad = (value: number) => value * Math.PI / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export function StaffAttendance() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [assignments, setAssignments] = useState<DailyAssignment[]>([]);
  /** Toàn bộ phân công của tuần hiện tại — cho dải "Kế hoạch tuần này". */
  const [currentTime, setCurrentTime] = useState(new Date());
  const [elapsedTime, setElapsedTime] = useState('00:00:00');

  // Modal "Gửi duyệt"
  const [submitTarget, setSubmitTarget] = useState<DailyAssignment | null>(null);
  const [submitNote, setSubmitNote] = useState('');
  const [sendingWork, setSendingWork] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (attendance?.check_in_time && attendance.status === 'active') {
      const updateElapsed = () => {
        const sessionSeconds = sessions.length > 0
          ? sessions.reduce((sum, session) => {
              const start = new Date(session.started_at).getTime();
              const end = session.ended_at ? new Date(session.ended_at).getTime() : Date.now();
              return sum + Math.max(0, Math.floor((end - start) / 1000));
            }, 0)
          : Math.max(0, Math.floor((Date.now() - new Date(attendance.check_in_time!).getTime()) / 1000));
        const diff = sessionSeconds;
        const h = Math.floor(diff / 3600).toString().padStart(2, '0');
        const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
        const s = (diff % 60).toString().padStart(2, '0');
        setElapsedTime(`${h}:${m}:${s}`);
      };
      updateElapsed();
      const interval = setInterval(updateElapsed, 1000);
      return () => clearInterval(interval);
    }
  }, [attendance, sessions]);

  const loadData = useCallback(async (silent = false) => {
    if (!profile) return;
    if (!silent) setLoading(true);

    const today = getTodayString();

    const monday = mondayOf(new Date());

    // daily_assignments có 3 khóa ngoại tới profiles nên phải chỉ rõ khóa khi
    // embed, tránh lỗi PGRST201 như từng gặp ở shifts/attendance.
    const [{ data: attData, error: attErr }, { data: asgData, error: asgErr }] = await Promise.all([
      // KHONG `maybeSingle()`: no nem loi khi co nhieu hon mot dong, ma mot
      // ngay lam hai ca la hop le - chi cam hai dong cung DANG MO (chi muc
      // attendance_one_open_per_user_day).
      supabase.from('attendance').select('*, location:work_locations(id,name,address,latitude,longitude,radius_meters)')
        .eq('user_id', profile.id).eq('date', today)
        .order('check_in_time', { ascending: false }),
      supabase
        .from('daily_assignments')
        .select('*, assigner:profiles!daily_assignments_assigned_by_fkey(id,name,avatar_url)')
        .eq('user_id', profile.id)
        .eq('work_date', today)
        .order('created_at', { ascending: true }),
    ]);

    const firstError = attErr ?? asgErr;
    // Uu tien ca DANG MO - do la ca nguoi dung can check-out. Khong co ca
    // nao mo thi lay ca gan nhat, de man hinh bao "ngay lam viec da ket thuc".
    const todayRows = (attData ?? []) as Attendance[];
    const todayShift = todayRows.find((row) => row.status === 'active') ?? todayRows[0] ?? null;

    const sessionResult = todayShift
      ? await supabase.from('attendance_sessions').select('*').eq('attendance_id', todayShift.id).order('started_at')
      : { data: [], error: null };
    setLoadError(firstError ? describeDbError(firstError) : null);
    setAttendance(todayShift);
    // Migration chưa chạy: giữ cách tính một phiên cũ thay vì làm hỏng trang.
    setSessions(sessionResult.error ? [] : (sessionResult.data || []) as AttendanceSession[]);
    setAssignments((asgData || []) as DailyAssignment[]);
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    loadData();
  }, [profile, loadData]);

  // Quản lý xác nhận/từ chối ở máy khác thì trạng thái từng việc và nút
  // check-out ở đây phải đổi theo ngay — toàn bộ luồng dựa vào realtime này.
  useRealtimeSync(
    profile
      ? [
          { table: 'attendance', filter: `user_id=eq.${profile.id}` },
          { table: 'daily_assignments', filter: `user_id=eq.${profile.id}` },
          { table: 'organization_unit_work_locations' },
          { table: 'work_locations' },
          { table: 'feature_flags' },
        ]
      : [],
    () => loadData(true),
    { enabled: !!profile, channelKey: `staff-attendance-${profile?.id || 'anonymous'}` },
  );

  const state: AttendanceState = loading
    ? 'loading'
    : !attendance
    ? 'not_checked_in'
    : attendance.status === 'completed'
    ? 'checked_out'
    : 'working';

  const approvedCount = assignments.filter((a) => a.status === 'approved').length;
  const submittedCount = assignments.filter((a) => a.status === 'submitted').length;
  const pendingCount = assignments.filter((a) => a.status === 'pending').length;
  const rejectedCount = assignments.filter((a) => a.status === 'rejected').length;
  const checkoutReady = canCheckOut(assignments);
  /**
   * Việc còn phải làm: chưa gửi duyệt, hoặc bị trả lại. Dùng để biết có nên mời
   * nhân viên MỞ LẠI ngày làm việc sau khi đã check-out hay không — trường hợp
   * điển hình là quản lý giao thêm việc sau lúc họ tan ca.
   */
  const unfinishedAfterCheckout = pendingCount + rejectedCount;

  // Hiển thị lại đúng địa điểm và tọa độ đã được ghi cùng bản chấm công,
  // để nhân viên tự đối chiếu với thông tin Admin nhìn thấy.
  const attendanceLocation = attendance?.location;
  const attendanceMapUrl = attendance?.check_in_latitude != null && attendance?.check_in_longitude != null
    ? `https://www.google.com/maps?q=${attendance.check_in_latitude},${attendance.check_in_longitude}`
    : null;
  const LocationSummary = () => attendance && (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2.5 text-sm text-indigo-900">
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <MapPin className="h-4 w-4 text-indigo-600" />
        {attendanceLocation?.name || 'Vị trí GPS đã ghi nhận'}
      </span>
      {attendanceLocation?.address && <span className="text-xs text-indigo-700">{attendanceLocation.address}</span>}
      {attendance.gps_accuracy_meters != null && <span className="text-xs text-indigo-700">Độ chính xác ±{Math.round(attendance.gps_accuracy_meters)} m</span>}
      {attendance.anomaly_flags && attendance.anomaly_flags.length > 0 && <span className="text-xs font-semibold text-amber-700">Cần đối soát</span>}
      {attendanceMapUrl && (
        <a href={attendanceMapUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:text-indigo-900">
          Xem vị trí <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );

  const handleCheckIn = async () => {
    setSubmitting(true);

    // Hoi lai database truoc khi chen.
    //
    // Giao dien che nut Check-in khi da cham, nhung do la che theo trang thai
    // TREN MAN. Mo hai tab, dung hai may, hoac mat mang roi bam lai thi man
    // nay van tuong chua ai cham. Database da co rang buoc chan (migration
    // 20261001110000), nhung de no bao loi thi nguoi dung nhan mot cau ky
    // thuat - hoi truoc de noi bang tieng Viet.
    const { data: existing } = await supabase
      .from('attendance')
      .select('id')
      .eq('user_id', profile?.id ?? '')
      .eq('date', getTodayString())
      .eq('status', 'active')
      .maybeSingle();

    if (existing) {
      toast('Hôm nay bạn đã check-in rồi. Tải lại trang để thấy ca đang mở.', 'warning');
      setSubmitting(false);
      await loadData(true);
      return;
    }

    const [{ data: flag }, { data: locationRows }] = await Promise.all([
      supabase.from('feature_flags').select('enabled').eq('key', 'geofence_attendance').maybeSingle(),
      supabase.from('work_locations').select('id, name, address, latitude, longitude, radius_meters').eq('is_active', true).not('latitude', 'is', null).not('longitude', 'is', null),
    ]);
    const geofenceEnabled = flag?.enabled === true;
    let locationInfo = 'Vị trí không xác định';
    let latitude: number | null = null;
    let longitude: number | null = null;
    let gpsAccuracy: number | null = null;
    let gpsCapturedAt: string | null = null;
    try {
      if ('geolocation' in navigator) {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
        });
        latitude = pos.coords.latitude;
        longitude = pos.coords.longitude;
        gpsAccuracy = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null;
        gpsCapturedAt = new Date().toISOString();
      }
    } catch (e) {
      console.warn('Không lấy được vị trí:', e);
    }

    if (geofenceEnabled && (latitude === null || longitude === null)) {
      toast('Bạn cần cho phép quyền Vị trí/GPS cho trình duyệt rồi thử Check-in lại.', 'warning');
      setSubmitting(false);
      return;
    }

    // Thu hẹp danh sách theo đơn vị hiện tại. Nếu migration mapping chưa có,
    // hoặc đơn vị chưa được gán điểm nào, fallback về toàn bộ điểm hoạt động
    // để không làm gián đoạn dữ liệu cũ; trigger database vẫn là lớp chốt cuối.
    let locations = ((locationRows || []) as WorkLocation[]).filter((item) => item.latitude != null && item.longitude != null);
    if (profile?.unit_id) {
      const [{ data: mappings, error: mappingError }, { data: units, error: unitsError }] = await Promise.all([
        supabase.from('organization_unit_work_locations').select('unit_id,location_id'),
        supabase.from('organization_units').select('id,parent_id').eq('is_active', true),
      ]);
      if (!mappingError && !unitsError && mappings) {
        const parentById = new Map((units || []).map((unit) => [unit.id as string, unit.parent_id as string | null]));
        const scopedUnitIds = new Set<string>();
        let cursor: string | null = profile.unit_id;
        while (cursor && !scopedUnitIds.has(cursor)) {
          scopedUnitIds.add(cursor);
          cursor = parentById.get(cursor) || null;
        }
        const allowedLocationIds = new Set((mappings as { unit_id: string; location_id: string }[])
          .filter((mapping) => scopedUnitIds.has(mapping.unit_id))
          .map((mapping) => mapping.location_id));
        if (allowedLocationIds.size > 0) locations = locations.filter((location) => allowedLocationIds.has(location.id));
      }
    }
    const nearest = latitude !== null && longitude !== null
      ? locations.map((item) => ({ ...item, distance: distanceMeters(latitude!, longitude!, Number(item.latitude), Number(item.longitude)) })).sort((a, b) => a.distance - b.distance)[0]
      : undefined;
    if (geofenceEnabled && !nearest) {
      toast('Chưa có địa điểm GPS hoạt động. Hãy liên hệ quản trị viên.', 'warning');
      setSubmitting(false);
      return;
    }
    if (geofenceEnabled && nearest && nearest.distance > nearest.radius_meters) {
      toast(`Ngoài phạm vi ${nearest.name} (${Math.round(nearest.distance)} m, giới hạn ${nearest.radius_meters} m).`, 'warning');
      setSubmitting(false);
      return;
    }
    if (geofenceEnabled && nearest && gpsAccuracy !== null) {
      const maxAccuracy = Math.max(50, Math.min(100, nearest.radius_meters));
      if (gpsAccuracy > maxAccuracy) {
        toast(`GPS chưa đủ chính xác (±${Math.round(gpsAccuracy)} m). Hãy bật Vị trí chính xác rồi thử lại.`, 'warning');
        setSubmitting(false);
        return;
      }
    }
    if (nearest) locationInfo = `${nearest.name} · ${Math.round(nearest.distance)} m`;

    const { data, error } = await supabase.from('attendance').insert({
      user_id: profile?.id,
      date: getTodayString(),
      check_in_time: new Date().toISOString(),
      status: 'active',
      approved_by_lead: false,
      location_id: nearest?.id ?? null,
      check_in_method: latitude !== null ? 'GPS' : null,
      check_in_latitude: latitude,
      check_in_longitude: longitude,
      gps_accuracy_meters: gpsAccuracy,
      gps_captured_at: gpsCapturedAt,
      anomaly_flags: [],
    }).select().single();

    if (error) {
      if (error.code === '23505') {
        toast('Bạn đã Check-in hôm nay rồi', 'warning');
        loadData(true);
      } else {
        toast('Check-in thất bại: ' + describeDbError(error), 'error');
      }
    } else {
      setAttendance(data as Attendance);
      loadData(true);
      toast(`Check-in thành công tại ${locationInfo}!`, 'success');
    }
    setSubmitting(false);
  };

  const handleCheckOut = async () => {
    if (!attendance) return;
    // Chốt chặn cuối — bình thường nút không hiện khi chưa đủ điều kiện,
    // nhưng realtime có thể vừa đưa thêm việc mới vào giữa hai nhịp render.
    if (!canCheckOut(assignments)) {
      toast('Hãy gửi duyệt tất cả công việc trước khi Check-out.', 'warning');
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.from('attendance').update({
      check_out_time: new Date().toISOString(),
      status: 'completed',
    })
      .eq('id', attendance.id)
      .eq('status', 'active')
      .is('check_out_time', null)
      .select()
      .maybeSingle();

    if (error) {
      toast('Check-out thất bại: ' + describeDbError(error), 'error');
    } else if (!data) {
      toast('Ngày công vừa được cập nhật ở nơi khác. Đang tải lại dữ liệu.', 'warning');
      loadData(true);
    } else {
      setAttendance(data as Attendance);
      loadData(true);
      toast('Check-out thành công! Giờ công đã được ghi nhận.', 'success');
    }
    setSubmitting(false);
  };

  /**
   * Mở lại ngày làm việc sau khi đã check-out.
   *
   * Vì sao cần: trước đây check-out là đóng ngày vĩnh viễn. Quản lý giao thêm
   * việc trong ngày (hoặc trả lại việc để làm lại) thì nhân viên chịu — việc
   * hiện ra đó mà không thao tác được, phải đợi sang hôm sau.
   *
   * Xoá `check_out_time` và đưa `status` về 'active'. Trigger database tạo một
   * phiên REOPEN mới, nên thời gian đã rời nơi làm không bị cộng vào giờ công.
   */
  const handleReopen = async () => {
    if (!attendance) return;

    // Quản lý đã duyệt công ngày này rồi thì không tự mở lại — sửa sau lưng
    // người duyệt sẽ làm sai số liệu họ đã chốt.
    if (attendance.approved_by_lead) {
      toast('Ngày công đã được quản lý duyệt — liên hệ quản lý nếu cần mở lại.', 'warning');
      return;
    }

    setSubmitting(true);
    const { data, error } = await supabase.from('attendance').update({
      check_out_time: null,
      status: 'active',
    })
      .eq('id', attendance.id)
      .eq('status', 'completed')
      .eq('approved_by_lead', false)
      .not('check_out_time', 'is', null)
      .select()
      .maybeSingle();

    if (error) {
      toast('Mở lại ngày làm việc thất bại: ' + describeDbError(error), 'error');
    } else if (!data) {
      toast('Ngày công đã được duyệt hoặc thay đổi ở nơi khác. Đang tải lại dữ liệu.', 'warning');
      loadData(true);
    } else {
      setAttendance(data as Attendance);
      loadData(true);
      toast('Đã mở lại ngày làm việc. Hoàn thành việc còn lại rồi check-out lần nữa.', 'success');
    }
    setSubmitting(false);
  };

  const openSubmitModal = (assignment: DailyAssignment) => {
    setSubmitTarget(assignment);
    setSubmitNote('');
  };

  /** Gửi việc cho quản lý xác nhận: pending/rejected → submitted. */
  const handleSubmitWork = async () => {
    if (!submitTarget || !profile) return;
    setSendingWork(true);

    const { data, error } = await supabase
      .from('daily_assignments')
      .update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        submit_note: submitNote.trim() || null,
      })
      .eq('id', submitTarget.id)
      .in('status', ['pending', 'rejected'])
      .select();

    if (error) {
      toast('Gửi thất bại: ' + describeDbError(error), 'error');
    } else if (!data || data.length === 0) {
      // Quản lý vừa xử lý dòng này ở máy khác — nạp lại cho khớp.
      toast('Công việc này vừa được quản lý cập nhật, thử lại sau.', 'warning');
      loadData(true);
    } else {
      toast('Đã gửi — chờ quản lý xác nhận.', 'success');
      setSubmitTarget(null);
      loadData(true);
      // Báo cho cả người duyệt toàn cục lẫn trưởng nhóm trực tiếp — người giao
      // việc này có thể chính là trưởng nhóm của mình.
      const approverIds = await fetchApproverIds('attendance');
      await notifyUsers(
        approverIds,
        'Công việc chờ xác nhận',
        `${profile.name} đã hoàn thành "${submitTarget.title}" và đang chờ xác nhận.`,
        'assignment_submitted',
      );
    }
    setSendingWork(false);
  };

  /** Thu hồi khi lỡ gửi nhầm — chỉ được khi quản lý chưa duyệt. */
  const handleRecall = async (assignment: DailyAssignment) => {
    const { data, error } = await supabase
      .from('daily_assignments')
      .update({ status: 'pending', submitted_at: null, submit_note: null })
      .eq('id', assignment.id)
      .eq('status', 'submitted')
      .select();

    if (error) {
      toast('Thu hồi thất bại: ' + describeDbError(error), 'error');
    } else if (!data || data.length === 0) {
      toast('Quản lý đã xử lý công việc này rồi.', 'warning');
      loadData(true);
    } else {
      toast('Đã thu hồi — công việc quay về "Cần làm".');
      loadData(true);
    }
  };

  if (state === 'loading') {
    return <Skeleton className="h-96" />;
  }

  if (loadError) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl">
        <ErrorState message={loadError} onRetry={loadData} />
      </div>
    );
  }

  const renderAssignment = (a: DailyAssignment, interactive: boolean) => {
    const priority = PRIORITY_CONFIG[a.priority];
    const statusCfg = ASSIGNMENT_STATUS_CONFIG[a.status];
    return (
      <div key={a.id} className={`px-5 py-4 border-l-4 ${priority.border} ${a.status === 'approved' ? 'bg-emerald-50/40' : ''}`}>
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium ${a.status === 'approved' ? 'text-slate-500 line-through decoration-emerald-400' : 'text-slate-800'}`}>
              {a.title}
            </p>
            {a.description && (
              <p className="text-xs text-slate-500 mt-1 whitespace-pre-line">{a.description}</p>
            )}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge className={statusCfg.color}>
                <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`} />
                {statusCfg.label}
              </Badge>
              <Badge className={priority.color}>{priority.label}</Badge>
              {a.assigner && (
                <span className="text-xs text-slate-400">Giao bởi {a.assigner.name}</span>
              )}
              {a.status === 'approved' && a.reviewed_at && (
                <span className="text-xs text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Xác nhận lúc {formatTime(a.reviewed_at)}
                </span>
              )}
              {a.status === 'submitted' && a.submitted_at && (
                <span className="text-xs text-amber-600">Đã gửi lúc {formatTime(a.submitted_at)}</span>
              )}
            </div>
            {a.status === 'rejected' && a.review_note && (
              <div className="mt-2 flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>Quản lý yêu cầu làm lại: {a.review_note}</span>
              </div>
            )}
          </div>

          {interactive && (
            <div className="flex-shrink-0">
              {a.status === 'pending' && (
                <Button size="sm" theme="staff" onClick={() => openSubmitModal(a)}>
                  <Send className="w-3.5 h-3.5" /> Gửi duyệt
                </Button>
              )}
              {a.status === 'rejected' && (
                <Button size="sm" theme="staff" onClick={() => openSubmitModal(a)}>
                  <RotateCcw className="w-3.5 h-3.5" /> Gửi lại
                </Button>
              )}
              {a.status === 'submitted' && (
                <Button size="sm" variant="ghost" onClick={() => handleRecall(a)} title="Lỡ gửi nhầm? Thu hồi để làm tiếp">
                  <Undo2 className="w-3.5 h-3.5" /> Thu hồi
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-4xl space-y-6">
      {/* ================= Chưa check-in ================= */}
      {state === 'not_checked_in' && (
        <>
          <Card className="p-8">
            <div className="flex flex-col items-center text-center py-8">
              <div className="text-4xl font-bold text-slate-800 mb-2">
                {currentTime.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
              </div>
              <p className="text-sm text-slate-400 mb-8">
                {currentTime.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </p>

              <button
                onClick={handleCheckIn}
                disabled={submitting}
                className="pulse-ring w-44 h-44 rounded-full bg-emerald-500 hover:bg-emerald-600 transition-colors flex flex-col items-center justify-center text-white shadow-lg shadow-emerald-500/30 active:scale-95 disabled:opacity-60"
              >
                {submitting ? (
                  <span className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <Fingerprint className="w-14 h-14 mb-2" />
                    <span className="text-lg font-bold tracking-wide">CHECK-IN</span>
                  </>
                )}
              </button>
              <p className="text-sm text-slate-500 mt-6">Nhấn để bắt đầu ngày làm việc</p>

              <div className="mt-8 flex items-center gap-2 text-sm text-slate-500 bg-slate-50 px-4 py-2.5 rounded-full">
                <Calendar className="w-4 h-4" />
                {assignments.length > 0
                  ? `Quản lý đã giao ${assignments.length} công việc cho bạn hôm nay`
                  : 'Hôm nay bạn chưa được giao công việc nào'}
              </div>
            </div>
          </Card>

          {/* Xem trước việc được giao — biết hôm nay chờ đợi gì trước khi bắt đầu */}
          {assignments.length > 0 && (
            <Card>
              <div className="px-5 py-4 border-b border-slate-100">
                <h3 className="text-base font-semibold text-slate-800">Công việc hôm nay</h3>
                <p className="text-xs text-slate-400 mt-0.5">Check-in để bắt đầu thực hiện và gửi duyệt</p>
              </div>
              <CardContent className="p-0">
                <div className="divide-y divide-slate-50">
                  {assignments.map((a) => renderAssignment(a, false))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ================= Đang làm việc ================= */}
      {state === 'working' && attendance && (
        <>
          {/* Header: giờ vào + đồng hồ */}
          <Card className="p-5">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Check-in lúc</p>
                  <p className="text-lg font-semibold text-slate-800">{formatTime(attendance.check_in_time)}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-sm text-slate-500">Đang làm việc</p>
                  <p className="text-2xl font-bold text-emerald-600 tabular-nums">{elapsedTime}</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center">
                  <Clock className="w-6 h-6 text-blue-600" />
                </div>
              </div>
            </div>
            <LocationSummary />
          </Card>

          {/* Danh sách việc + tiến độ */}
          <Card>
            <div className="px-5 py-4 border-b border-slate-100">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="text-base font-semibold text-slate-800">Công việc hôm nay</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Làm xong việc nào, bấm "Gửi duyệt" việc đó để quản lý xác nhận</p>
                </div>
                {assignments.length > 0 && (
                  <span className="text-sm font-semibold text-slate-600 tabular-nums">
                    {approvedCount}/{assignments.length} đã xác nhận
                  </span>
                )}
              </div>
              {assignments.length > 0 && (
                <div className="mt-3 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
                    style={{ width: `${(approvedCount / assignments.length) * 100}%` }}
                  />
                </div>
              )}
            </div>
            <CardContent className="p-0">
              {assignments.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <ClipboardList className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-400">Hôm nay bạn chưa được giao công việc nào.</p>
                  <p className="text-xs text-slate-400 mt-1">Bạn có thể Check-out bất cứ lúc nào.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {assignments.map((a) => renderAssignment(a, true))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Check-out: CHỈ hiện khi mọi việc trong ngày đã được xác nhận */}
          {checkoutReady ? (
            <div className="space-y-3">
              {assignments.length > 0 && (
                <p className="text-sm text-emerald-600 flex items-center justify-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  Tất cả công việc đã được gửi duyệt — bạn có thể kết thúc ngày làm việc.
                </p>
              )}
              <button
                onClick={handleCheckOut}
                disabled={submitting}
                className="w-full py-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-base transition-colors active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/30"
              >
                {submitting ? (
                  <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <LogOut className="w-5 h-5" />
                    CHECK-OUT
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-200/70 flex items-center justify-center flex-shrink-0">
                  <Lock className="w-5 h-5 text-slate-500" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-700">Nút Check-out sẽ mở khi mọi công việc được xác nhận</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Gửi duyệt từng việc đã xong — quản lý xác nhận đến đâu, tiến độ chạy đến đó. Trang tự cập nhật, không cần tải lại.
                  </p>
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    {pendingCount > 0 && (
                      <Badge className={ASSIGNMENT_STATUS_CONFIG.pending.color}>{pendingCount} cần làm</Badge>
                    )}
                    {rejectedCount > 0 && (
                      <Badge className={ASSIGNMENT_STATUS_CONFIG.rejected.color}>{rejectedCount} cần làm lại</Badge>
                    )}
                    {submittedCount > 0 && (
                      <Badge className={ASSIGNMENT_STATUS_CONFIG.submitted.color}>{submittedCount} chờ xác nhận</Badge>
                    )}
                    {approvedCount > 0 && (
                      <Badge className={ASSIGNMENT_STATUS_CONFIG.approved.color}>{approvedCount} đã xác nhận</Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ================= Đã check-out ================= */}
      {state === 'checked_out' && attendance && (
        <Card className="p-8">
          <div className="flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-10 h-10 text-emerald-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-800 mb-1">
              {unfinishedAfterCheckout > 0 ? 'Bạn còn việc chưa xong hôm nay' : 'Ngày làm việc đã kết thúc'}
            </h2>
            <p className="text-sm text-slate-500 mb-6">
              {unfinishedAfterCheckout > 0
                ? `Có ${unfinishedAfterCheckout} việc được giao trong ngày mà bạn chưa gửi duyệt. Mở lại ngày làm việc để tiếp tục.`
                : 'Giờ công của bạn đã được ghi nhận. Hẹn gặp lại ngày mai!'}
            </p>

            {/* Trước đây check-out là đóng ngày vĩnh viễn: quản lý giao thêm việc
                hay trả việc về làm lại thì nhân viên không thao tác được nữa. */}
            {unfinishedAfterCheckout > 0 && (
              <Button
                onClick={handleReopen}
                disabled={submitting}
                theme="staff"
                className="mb-6"
              >
                <LogIn className="w-4 h-4" />
                {submitting ? 'Đang mở lại…' : 'Mở lại ngày làm việc'}
              </Button>
            )}

            <div className="grid grid-cols-3 gap-4 w-full max-w-md mb-6">
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="text-xs text-slate-400 mb-1">Check-in</p>
                <p className="text-sm font-semibold text-slate-800">{formatTime(attendance.check_in_time)}</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="text-xs text-slate-400 mb-1">Check-out</p>
                <p className="text-sm font-semibold text-slate-800">{formatTime(attendance.check_out_time)}</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="text-xs text-slate-400 mb-1">Giờ công</p>
                <p className="text-sm font-semibold text-slate-800">
                  {attendance.check_in_time && attendance.check_out_time
                    ? (() => {
                        const diff = sessions.length > 0
                          ? sessions.reduce((sum, session) => sum + (session.ended_at ? Math.max(0, new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) : 0), 0)
                          : new Date(attendance.check_out_time).getTime() - new Date(attendance.check_in_time).getTime();
                        const h = Math.floor(diff / 3600000);
                        const m = Math.floor((diff % 3600000) / 60000);
                        return `${h}h ${m}p${sessions.length > 1 ? ` · ${sessions.length} phiên` : ''}`;
                      })()
                    : '—'}
                </p>
              </div>
            </div>

            <LocationSummary />

            {assignments.length > 0 && (
              <div className="w-full max-w-md">
                <p className="text-sm font-medium text-slate-700 mb-3 text-left">
                  Công việc đã hoàn thành ({approvedCount}/{assignments.length})
                </p>
                <div className="space-y-2">
                  {assignments.map((a) => (
                    <div key={a.id} className="flex items-center gap-3 p-3 rounded-lg bg-emerald-50/50 border border-emerald-100">
                      <CheckCircle2 className={`w-4 h-4 flex-shrink-0 ${a.status === 'approved' ? 'text-emerald-600' : 'text-slate-300'}`} />
                      <span className="text-sm text-slate-700 flex-1 text-left">{a.title}</span>
                      <Badge className={ASSIGNMENT_STATUS_CONFIG[a.status].color}>
                        {ASSIGNMENT_STATUS_CONFIG[a.status].label}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ================= Modal Gửi duyệt ================= */}
      <Modal
        open={!!submitTarget}
        onClose={() => setSubmitTarget(null)}
        title={submitTarget?.status === 'rejected' ? 'Gửi lại cho quản lý' : 'Gửi quản lý xác nhận'}
        size="sm"
      >
        <div className="space-y-4">
          {submitTarget && (
            <div className="p-3 rounded-lg bg-slate-50">
              <p className="text-sm font-medium text-slate-800">{submitTarget.title}</p>
              {submitTarget.status === 'rejected' && submitTarget.review_note && (
                <p className="text-xs text-red-600 mt-1">Lý do bị trả lại: {submitTarget.review_note}</p>
              )}
            </div>
          )}
          <Textarea
            label="Ghi chú cho quản lý (không bắt buộc)"
            rows={3}
            placeholder="VD: Đã hoàn thành, kết quả để trong thư mục chung..."
            value={submitNote}
            onChange={(e) => setSubmitNote(e.target.value)}
          />
          <p className="text-xs text-slate-400">
            Sau khi gửi, công việc chuyển sang "Chờ xác nhận". Quản lý xác nhận xong sẽ tính là hoàn thành.
          </p>
          <div className="flex gap-3 pt-1">
            <Button variant="outline" onClick={() => setSubmitTarget(null)} className="flex-1" disabled={sendingWork}>
              Hủy
            </Button>
            <Button theme="staff" onClick={handleSubmitWork} className="flex-1" disabled={sendingWork}>
              {sendingWork ? 'Đang gửi…' : (<><Send className="w-4 h-4" /> Gửi duyệt</>)}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
