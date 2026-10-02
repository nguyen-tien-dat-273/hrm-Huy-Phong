import { useEffect, useState } from 'react';
import { CheckCircle2, Rocket, Target } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { describeDbError } from '@/lib/dbError';
import { supabase } from '@/lib/supabase';

interface Process { id: string; user_id: string; mentor_id: string | null; title: string; process_type: string; target_date: string | null; status: string }
interface Item { id: string; process_id: string; owner_id: string | null; title: string; due_date: string | null; completed: boolean }
interface Goal { id: string; title: string; description: string | null; target_value: number; current_value: number; weight: number; status: string; cycle?: { name: string } }

export function StaffGrowth() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [processes, setProcesses] = useState<Process[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    if (!profile) return;
    setLoading(true); setError('');
    const [processResult] = await Promise.all([
      // RLS chỉ trả những quy trình mà người dùng là nhân viên, mentor hoặc
      // người phụ trách ít nhất một checklist. Không lọc user_id ở client vì
      // sẽ làm mentor/người được giao việc nhận thông báo nhưng mở ra trang rỗng.
      supabase.from('employee_lifecycle_processes').select('*, employee_checklist_items(*)').order('created_at', { ascending: false }),
    ]);
    const firstError = processResult.error;
    if (firstError) setError(`Tính năng phát triển cá nhân chưa được khởi tạo. ${describeDbError(firstError)}`);
    const rawProcesses = (processResult.data || []) as (Process & { employee_checklist_items?: Item[] })[];
    setProcesses(rawProcesses); setItems(rawProcesses.flatMap((process) => process.employee_checklist_items || [])); setLoading(false);
  };
  useEffect(() => { void load(); }, [profile?.id]);
  useRealtimeSync(profile ? [
    { table: 'employee_lifecycle_processes' },
    { table: 'employee_checklist_items' },
  ] : [], () => load(), { enabled: !!profile, channelKey: `staff-growth-${profile?.id || 'none'}` });

  const toggleItem = async (item: Item) => {
    if (item.owner_id !== profile?.id) {
      toast('Chỉ người được giao công việc này mới có thể đánh dấu hoàn thành.', 'warning');
      return;
    }
    const { error: updateError } = await supabase.from('employee_checklist_items').update({ completed: !item.completed, completed_at: !item.completed ? new Date().toISOString() : null }).eq('id', item.id);
    if (updateError) toast('Không cập nhật được checklist: ' + describeDbError(updateError), 'error'); else await load();
  };

  if (loading) return <Card><CardContent><p className="py-14 text-center text-sm text-slate-400">Đang tải lộ trình phát triển…</p></CardContent></Card>;
  if (error) return <Card><ErrorState message={error} onRetry={load} /></Card>;
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold text-slate-800">Lộ trình & mục tiêu</h1><p className="text-sm text-slate-500 mt-1">Theo dõi quy trình của bạn và các công việc bạn được giao phụ trách.</p></div>
    <div className="space-y-5">
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Rocket className="w-5 h-5 text-indigo-600" />Checklist nhân sự</CardTitle></CardHeader><CardContent>{processes.map((process) => { const list = items.filter((item) => item.process_id === process.id); const relation = process.user_id === profile?.id ? 'Quy trình của bạn' : process.mentor_id === profile?.id ? 'Bạn là người hướng dẫn' : 'Bạn có công việc phụ trách'; return <div key={process.id} className="mb-5 last:mb-0"><div className="flex items-center justify-between gap-3"><div><p className="font-medium text-slate-800">{process.title}</p><p className="mt-1 text-xs text-slate-500">{relation}</p></div><Badge className={process.process_type === 'ONBOARDING' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}>{process.process_type === 'ONBOARDING' ? 'Onboarding' : 'Offboarding'}</Badge></div><div className="mt-3 space-y-2">{list.map((item) => { const canComplete = item.owner_id === profile?.id; return <button key={item.id} type="button" onClick={() => void toggleItem(item)} disabled={!canComplete} title={canComplete ? 'Đánh dấu hoàn thành' : 'Bạn chỉ có quyền theo dõi mục này'} className={`w-full flex items-center gap-2 rounded-lg p-2 text-left ${canComplete ? 'hover:bg-slate-50' : 'cursor-default opacity-70'}`}><CheckCircle2 className={`w-4 h-4 ${item.completed ? 'text-emerald-600' : 'text-slate-300'}`} /><span className={`text-sm ${item.completed ? 'line-through text-slate-400' : 'text-slate-700'}`}>{item.title}</span>{canComplete && <span className="ml-auto text-xs font-medium text-indigo-600">Việc của bạn</span>}</button>; })}</div></div>})}{processes.length === 0 && <EmptyState title="Chưa có checklist" description="Checklist hội nhập, bàn giao hoặc công việc bạn phụ trách sẽ xuất hiện tại đây." />}</CardContent></Card>
      
    </div>
  </div>;
}
