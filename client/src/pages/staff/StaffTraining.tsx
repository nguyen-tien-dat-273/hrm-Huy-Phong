import { useEffect, useState } from 'react';
import { BookOpen, CheckCircle2, ExternalLink, PlayCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { createTrainingVideoUrl } from '@/lib/training';
import type { TrainingCourse, TrainingEnrollment, TrainingEnrollmentStatus } from '@/types';

const statusConfig: Record<TrainingEnrollmentStatus, { label: string; color: string }> = {
  enrolled: { label: 'Chưa bắt đầu', color: 'bg-slate-100 text-slate-600' },
  in_progress: { label: 'Đang học', color: 'bg-blue-100 text-blue-700' },
  completed: { label: 'Hoàn thành', color: 'bg-emerald-100 text-emerald-700' },
};

export function StaffTraining() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [enrollments, setEnrollments] = useState<TrainingEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [videoUrls, setVideoUrls] = useState<Record<string, string>>({});
  const [progressDrafts, setProgressDrafts] = useState<Record<string, number>>({});
  const [savingEnrollmentId, setSavingEnrollmentId] = useState<string | null>(null);

  const load = async (silent = false) => {
    if (!profile) return;
    if (!silent) setLoading(true);
    const [{ data: courseData, error: courseError }, { data: enrollmentData, error: enrollmentError }] = await Promise.all([
      supabase.from('training_courses').select('*').eq('status', 'published').order('deadline', { ascending: true, nullsFirst: false }),
      supabase.from('training_enrollments').select('*, course:training_courses(*)').eq('user_id', profile.id),
    ]);
    const error = courseError || enrollmentError;
    setLoadError(error ? 'Không tải được dữ liệu đào tạo: ' + describeDbError(error) : null);
    setCourses((courseData || []) as TrainingCourse[]);
    const nextEnrollments = (enrollmentData || []) as TrainingEnrollment[];
    setEnrollments(nextEnrollments);
    const nextUrls: Record<string, string> = {};
    for (const course of (courseData || []) as TrainingCourse[]) {
      if (course.video_path) {
        const signed = await createTrainingVideoUrl(course.video_path);
        if (signed.url) nextUrls[course.id] = signed.url;
      }
    }
    setVideoUrls(nextUrls);
    setLoading(false);
  };

  useEffect(() => { load(); }, [profile]);
  useRealtimeSync(profile ? [{ table: 'training_courses' }, { table: 'training_enrollments', filter: `user_id=eq.${profile.id}` }] : [], () => load(true), { enabled: !!profile, channelKey: `staff-training-${profile?.id ?? 'anonymous'}` });

  const enrollmentFor = (courseId: string) => enrollments.find((item) => item.course_id === courseId);
  const enroll = async (course: TrainingCourse) => {
    const { error } = await supabase.from('training_enrollments').insert({ course_id: course.id, user_id: profile?.id, status: 'enrolled', progress: 0 });
    if (error) toast('Đăng ký thất bại: ' + describeDbError(error), 'error'); else { toast('Đã thêm khóa học vào lộ trình.', 'success'); void load(true); }
  };
  const updateProgress = async (enrollment: TrainingEnrollment, progress: number) => {
    setSavingEnrollmentId(enrollment.id);
    const status: TrainingEnrollmentStatus = progress === 100 ? 'completed' : progress > 0 ? 'in_progress' : 'enrolled';
    const { error } = await supabase.from('training_enrollments').update({ progress, status, completed_at: progress === 100 ? new Date().toISOString() : null }).eq('id', enrollment.id);
    setSavingEnrollmentId(null);
    if (error) {
      toast('Cập nhật tiến độ thất bại: ' + describeDbError(error), 'error');
      return;
    }
    setProgressDrafts((current) => {
      const next = { ...current };
      delete next[enrollment.id];
      return next;
    });
    toast(progress === 100 ? 'Đã đánh dấu hoàn thành khóa học.' : 'Đã cập nhật tiến độ.', 'success');
    void load(true);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-xl font-bold text-slate-800">Đào tạo của tôi</h2>
        <p className="mt-1 text-sm text-slate-500">Theo dõi các khóa học và lộ trình phát triển cá nhân.</p>
      </div>
      {loading ? (
        <Card><CardContent><p className="py-10 text-center text-sm text-slate-400">Đang tải lộ trình...</p></CardContent></Card>
      ) : loadError ? (
        <Card><ErrorState message={loadError} onRetry={() => load()} /></Card>
      ) : courses.length === 0 ? (
        <Card><EmptyState icon={<BookOpen className="h-8 w-8" />} title="Chưa có khóa học mới" description="Các khóa học được công ty mở sẽ xuất hiện ở đây." /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {courses.map((course) => {
            const enrollment = enrollmentFor(course.id);
            const status = enrollment ? statusConfig[enrollment.status] : null;
            const draftProgress = enrollment ? (progressDrafts[enrollment.id] ?? enrollment.progress) : 0;
            const hasProgressChanges = !!enrollment && draftProgress !== enrollment.progress;
            const isSaving = enrollment?.id === savingEnrollmentId;

            return (
              <Card key={course.id}>
                <CardContent>
                  {videoUrls[course.id] && (
                    <video controls preload="metadata" className="mb-4 aspect-video w-full rounded-xl bg-slate-900" src={videoUrls[course.id]} />
                  )}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                      <BookOpen className="h-5 w-5" />
                    </div>
                    {status ? <Badge className={status.color}>{status.label}</Badge> : <Badge className="bg-amber-100 text-amber-700">Chưa đăng ký</Badge>}
                  </div>
                  <h3 className="mt-4 font-display text-base font-bold text-slate-800">{course.title}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-500">{course.description || 'Chưa có mô tả.'}</p>
                  <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-500">
                    <span>{course.category}</span>
                    <span>{course.duration_hours} giờ</span>
                    {course.instructor && <span>{course.instructor}</span>}
                    {course.deadline && <span>Hạn {course.deadline}</span>}
                  </div>
                  {enrollment && (
                    <div className="mt-4">
                      <div className="mb-1 flex justify-between text-xs text-slate-500">
                        <label htmlFor={`progress-${enrollment.id}`}>Tiến độ</label>
                        <strong className="text-slate-700">{draftProgress}%</strong>
                      </div>
                      <input
                        id={`progress-${enrollment.id}`}
                        aria-label={`Tiến độ ${course.title}`}
                        type="range"
                        min="0"
                        max={enrollment.progress === 100 ? 100 : 90}
                        step="10"
                        value={draftProgress}
                        disabled={isSaving || enrollment.progress === 100}
                        onChange={(event) => setProgressDrafts((current) => ({ ...current, [enrollment.id]: Number(event.target.value) }))}
                        className="w-full accent-emerald-600 disabled:opacity-50"
                      />
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <p className="text-xs text-slate-500">Kéo để chỉnh, sau đó lưu tiến độ.</p>
                        {hasProgressChanges && (
                          <Button size="sm" theme="staff" disabled={isSaving} onClick={() => void updateProgress(enrollment, draftProgress)}>
                            {isSaving ? 'Đang lưu…' : 'Lưu tiến độ'}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="mt-4 flex gap-2 border-t border-slate-100 pt-4">
                    {enrollment ? (
                      <Button
                        onClick={() => void updateProgress(enrollment, enrollment.progress === 100 ? 0 : 100)}
                        theme="staff"
                        className="flex-1"
                        disabled={isSaving || hasProgressChanges}
                      >
                        {enrollment.progress === 100
                          ? <><PlayCircle className="h-4 w-4" />Học lại</>
                          : <><CheckCircle2 className="h-4 w-4" />Đánh dấu hoàn thành</>}
                      </Button>
                    ) : (
                      <Button onClick={() => void enroll(course)} theme="staff" className="flex-1">
                        <PlayCircle className="h-4 w-4" />Đăng ký học
                      </Button>
                    )}
                    {course.resource_url && (
                      <a href={course.resource_url} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 px-3 text-slate-600 hover:bg-slate-50" aria-label={`Mở tài liệu ${course.title}`}>
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
