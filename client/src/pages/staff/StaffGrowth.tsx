import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock3, Rocket } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { describeDbError } from '@/lib/dbError';
import { supabase } from '@/lib/supabase';

type ChecklistStatus = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED';
interface Process { id: string; user_id: string; mentor_id: string | null; title: string; process_type: string; target_date: string | null; status: string }
interface Item { id: string; process_id: string; owner_id: string | null; title: string; due_date: string | null; completed: boolean; status?: ChecklistStatus }
interface History { id: string; process_id: string; checklist_item_id: string | null; actor_id: string | null; action: string; old_values: Record<string, unknown> | null; new_values: Record<string, unknown> | null; created_at: string }

const statusLabels: Record<ChecklistStatus, string> = { OPEN: 'Chưa thực hiện', IN_PROGRESS: 'Đang thực hiện', COMPLETED: 'Hoàn thành' };

export function StaffGrowth() {
  const { profile } = useAuth();
  const profileId = profile?.id;
  const { toast } = useToast();
  const [processes, setProcesses] = useState<Process[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [history, setHistory] = useState<History[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!profileId) return;
    setLoading(true); setError('');
    const { data, error: loadError } = await supabase.from('employee_lifecycle_processes').select('*, employee_checklist_items(*)').order('created_at', { ascending: false });
    if (loadError) {
      setError(`Không tải được checklist hội nhập/nghỉ việc. ${describeDbError(loadError)}`);
      setLoading(false);
      return;
    }
    const rows = (data || []) as (Process & { employee_checklist_items?: Item[] })[];
    setProcesses(rows);
    setItems(rows.flatMap((process) => process.employee_checklist_items || []));
    const processIds = rows.map((process) => process.id);
    if (processIds.length) {
      const { data: events } = await supabase.from('employee_lifecycle_history').select('id,process_id,checklist_item_id,actor_id,action,old_values,new_values,created_at').in('process_id', processIds).order('created_at', { ascending: false }).limit(100);
      setHistory((events || []) as History[]);
    } else setHistory([]);
    setLoading(false);
  }, [profileId]);

  useEffect(() => { void load(); }, [load]);
  useRealtimeSync(profile ? [
    { table: 'employee_lifecycle_processes' },
    { table: 'employee_checklist_items' },
    { table: 'employee_lifecycle_history' },
  ] : [], () => load(), { enabled: !!profile, channelKey: `staff-growth-${profile?.id || 'none'}` });

  const setStatus = async (item: Item, status: ChecklistStatus) => {
    if (item.owner_id !== profile?.id) return toast('Chỉ người phụ trách mới có thể cập nhật checklist.', 'warning');
    const { error: updateError } = await supabase.from('employee_checklist_items').update({ status }).eq('id', item.id);
    if (updateError) toast('Không cập nhật được trạng thái: ' + describeDbError(updateError), 'error');
    else await load();
  };

  if (loading) return <Card><CardContent><p className="py-14 text-center text-sm text-slate-400">Đang tải checklist hội nhập/nghỉ việc…</p></CardContent></Card>;
  if (error) return <Card><ErrorState message={error} onRetry={load} /></Card>;

  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold text-slate-800">Hội nhập & nghỉ việc</h1><p className="mt-1 text-sm text-slate-500">Theo dõi công việc, người phụ trách, hạn hoàn thành và lịch sử cập nhật.</p></div>
    {!processes.length ? <Card><CardContent><EmptyState title="Chưa có checklist được giao" description="Khi quản lý tạo quy trình hội nhập, nghỉ việc hoặc giao việc cho bạn, nội dung sẽ xuất hiện ở đây." /></CardContent></Card> : processes.map((process) => {
      const list = items.filter((item) => item.process_id === process.id);
      const completed = list.filter((item) => (item.status || (item.completed ? 'COMPLETED' : 'OPEN')) === 'COMPLETED').length;
      const percent = list.length ? Math.round(completed / list.length * 100) : 0;
      const relation = process.user_id === profile?.id ? 'Quy trình của bạn' : process.mentor_id === profile?.id ? 'Bạn là người hướng dẫn' : 'Bạn được giao phụ trách checklist';
      const processHistory = history.filter((event) => event.process_id === process.id).slice(0, 8);
      return <Card key={process.id}>
        <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><CardTitle className="flex items-center gap-2"><Rocket className="h-5 w-5 text-indigo-600" />{process.title}</CardTitle><Badge className={process.process_type === 'ONBOARDING' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}>{process.process_type === 'ONBOARDING' ? 'Hội nhập' : 'Nghỉ việc'}</Badge></div><p className="text-xs text-slate-500">{relation} · Trạng thái quy trình: {process.status === 'COMPLETED' ? 'Hoàn thành' : process.status === 'CANCELLED' ? 'Đã hủy' : 'Đang thực hiện'}{process.target_date ? ` · Hạn quy trình ${process.target_date}` : ''}</p></CardHeader>
        <CardContent>
          <div className="flex items-center justify-between text-xs text-slate-500"><span>Tiến độ checklist</span><strong>{completed}/{list.length} việc · {percent}%</strong></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${percent}%` }} /></div>
          <div className="mt-4 space-y-2">{list.map((item) => {
            const status = item.status || (item.completed ? 'COMPLETED' : 'OPEN');
            const isOwner = item.owner_id === profile?.id;
            const overdue = item.due_date && item.due_date < new Date().toISOString().slice(0, 10) && status !== 'COMPLETED';
            return <div key={item.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 p-3">
              <CheckCircle2 className={`h-5 w-5 shrink-0 ${status === 'COMPLETED' ? 'text-emerald-600' : 'text-slate-300'}`} />
              <div className="min-w-0 flex-1"><p className={`text-sm font-medium ${status === 'COMPLETED' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{item.title}</p><p className={`mt-1 flex items-center gap-1 text-xs ${overdue ? 'text-rose-600' : 'text-slate-400'}`}><Clock3 className="h-3 w-3" />{isOwner ? 'Bạn phụ trách' : 'Người phụ trách khác'} · Hạn: {item.due_date || 'Chưa đặt hạn'}{overdue ? ' · Quá hạn' : ''}</p></div>
              {isOwner ? <select aria-label={`Trạng thái ${item.title}`} value={status} onChange={(event) => void setStatus(item, event.target.value as ChecklistStatus)} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700">{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <Badge className={status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-700' : status === 'IN_PROGRESS' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}>{statusLabels[status]}</Badge>}
            </div>;
          })}</div>
          {processHistory.length > 0 && <details className="mt-4 rounded-xl bg-slate-50 px-3 py-2"><summary className="cursor-pointer text-xs font-semibold text-slate-600">Lịch sử thực hiện ({processHistory.length} gần nhất)</summary><div className="mt-3 space-y-2">{processHistory.map((event) => { const value = event.new_values || event.old_values; const itemTitle = String(value?.title || 'Quy trình'); const detail = event.action === 'CHECKLIST_UPDATED' && value?.status ? ` → ${statusLabels[value.status as ChecklistStatus] || value.status}` : ''; const label = event.action === 'CHECKLIST_CREATED' ? 'Tạo việc' : event.action === 'CHECKLIST_UPDATED' ? 'Cập nhật' : event.action === 'PROCESS_CREATED' ? 'Tạo quy trình' : event.action === 'CHECKLIST_DELETED' ? 'Xóa việc' : 'Cập nhật quy trình'; return <div key={event.id} className="flex justify-between gap-3 text-xs text-slate-500"><span>{label}: {itemTitle}{detail} · {event.actor_id === profile?.id ? 'Bạn' : 'Quản lý/nhân sự'}</span><time className="shrink-0">{new Date(event.created_at).toLocaleString('vi-VN')}</time></div>; })}</div></details>}
        </CardContent>
      </Card>;
    })}
  </div>;
}
