// ============================================================================
// Hạn mức phép năm từng người.
// ----------------------------------------------------------------------------
// Trước đây `profiles.annual_leave_quota` chỉ có DEFAULT 12 và KHÔNG giao diện
// nào sửa được, dù mô tả quyền `leave` có ghi "đặt hạn mức phép năm". Mọi công
// ty cho khác 12 ngày đều phải vào thẳng database.
//
// Ghi qua RPC `set_annual_leave_quota` chứ không UPDATE thẳng `profiles`: policy
// UPDATE của bảng đó đòi quyền `users`, mà mở rộng nó cho quyền `leave` là mở cả
// cột `role`/`permissions`. Xem migration 20260811150000.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Loader2, RotateCcw, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useAppSettings } from '@/contexts/SettingsContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { calculateLedgerBalance } from '@/lib/leave';
import type { LeaveLedgerEntry, LeaveRequest, Profile } from '@/types';

export function LeaveQuotaPanel() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { defaultAnnualLeave } = useAppSettings();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [ledger, setLedger] = useState<LeaveLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  /** Id người đang lưu — khóa riêng dòng đó, không khóa cả bảng. */
  const [savingId, setSavingId] = useState<string | null>(null);
  /** Giá trị đang gõ theo từng người, chưa ghi xuống database. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const year = new Date().getFullYear();

  const load = async (silent = false) => {
    if (!silent) setLoading(true);

    const [profileRes, leaveRes, ledgerRes] = await Promise.all([
      supabase
        .from('profiles_leave_quota')
        .select('*')
        .eq('is_active', true)
        .order('name'),
      // Chỉ cần phép năm đã duyệt/chờ duyệt trong năm nay để tính số dư.
      supabase
        .from('leave_requests')
        .select('*')
        .eq('leave_type', 'annual')
        .gte('start_date', `${year}-01-01`)
        .lte('start_date', `${year}-12-31`),
      supabase.from('leave_ledger').select('*').eq('leave_year', year).eq('leave_type', 'annual'),
    ]);

    const error = profileRes.error || leaveRes.error;
    setLoadError(error ? describeDbError(error) : null);
    setProfiles((profileRes.data || []) as Profile[]);
    setRequests(((leaveRes.data || []) as LeaveRequest[]).filter((leave) => !leave.is_cancelled));
    setLedger(ledgerRes.error ? [] : (ledgerRes.data || []) as LeaveLedgerEntry[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRealtimeSync([{ table: 'leave_ledger' }, { table: 'leave_requests' }], () => load(true), {
    channelKey: 'leave-quota',
  });

  const rows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return profiles
      .filter(
        (p) =>
          !keyword ||
          p.name.toLowerCase().includes(keyword) ||
          (p.department ?? '').toLowerCase().includes(keyword),
      )
      .map((p) => {
        const mine = requests.filter((r) => r.user_id === p.id);
        return { profile: p, balance: calculateLedgerBalance(ledger.filter((entry) => entry.user_id === p.id), mine, p.annual_leave_quota, year) };
      });
  }, [profiles, requests, ledger, search, year]);

  const saveQuota = async (target: Profile, raw: string) => {
    const quota = Number(raw);
    if (raw.trim() === '' || !Number.isInteger(quota) || quota < 0 || quota > 365) {
      toast('Hạn mức phải là số nguyên từ 0 đến 365.', 'error');
      return;
    }
    if (quota === target.annual_leave_quota) return;

    setSavingId(target.id);
    const { error } = await supabase.rpc('set_annual_leave_quota', {
      target_user: target.id,
      quota,
    });
    setSavingId(null);

    if (error) {
      toast(describeDbError(error), 'error');
      return;
    }

    setDrafts((prev) => {
      const next = { ...prev };
      delete next[target.id];
      return next;
    });
    toast(`Đã đặt ${quota} ngày phép/năm cho ${target.name}`, 'success');
    void load(true);
  };

  /** Đưa toàn bộ nhân sự về mức mặc định trong Cấu hình. */
  const applyDefaultToAll = async () => {
    const targets = profiles.filter((p) => p.annual_leave_quota !== defaultAnnualLeave);
    if (targets.length === 0) {
      toast(`Tất cả đã ở mức ${defaultAnnualLeave} ngày.`, 'success');
      return;
    }

    const ok = await confirm({
      title: `Đặt ${defaultAnnualLeave} ngày phép cho tất cả?`,
      message: `${targets.length} người đang có hạn mức khác sẽ được đưa về ${defaultAnnualLeave} ngày/năm. Số phép đã dùng không đổi.`,
      confirmLabel: 'Áp dụng',
    });
    if (!ok) return;

    setSavingId('all');
    // Tuần tự thay vì Promise.all: mỗi lệnh là một RPC riêng, chạy dồn dập dễ
    // chạm giới hạn kết nối khi công ty đông người.
    let failed = 0;
    for (const p of targets) {
      const { error } = await supabase.rpc('set_annual_leave_quota', {
        target_user: p.id,
        quota: defaultAnnualLeave,
      });
      if (error) failed++;
    }
    setSavingId(null);

    if (failed > 0) toast(`${targets.length - failed} người đã cập nhật, ${failed} lỗi.`, 'warning');
    else toast(`Đã áp dụng ${defaultAnnualLeave} ngày cho ${targets.length} người`, 'success');
    void load(true);
  };

  if (loading) return <div className="p-5"><TableSkeleton /></div>;
  if (loadError) return <ErrorState message={loadError} onRetry={load} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <Input
            placeholder="Tìm theo tên hoặc phòng ban…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="outline" onClick={applyDefaultToAll} disabled={savingId === 'all'}>
          <RotateCcw className="w-4 h-4" />
          {savingId === 'all' ? 'Đang áp dụng…' : `Đặt tất cả về ${defaultAnnualLeave} ngày`}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={<CalendarCheck className="w-8 h-8" />}
              title="Không tìm thấy nhân sự"
              description="Thử từ khóa khác, hoặc kiểm tra lại danh sách người dùng đang hoạt động."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-slate-500 border-b border-slate-100">
                    <th className="px-5 py-3">Nhân sự</th>
                    <th className="px-3 py-3 text-center w-32">Hạn mức / năm</th>
                    <th className="px-3 py-3 text-center w-24">Đã dùng</th>
                    <th className="px-3 py-3 text-center w-24">Chờ duyệt</th>
                    <th className="px-3 py-3 text-center w-24">Còn lại</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {rows.map(({ profile: p, balance }) => {
                    const draft = drafts[p.id] ?? String(p.annual_leave_quota);
                    const changed = Number(draft) !== p.annual_leave_quota;
                    return (
                      <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar name={p.name} url={p.avatar_url} size="sm" />
                            <div className="min-w-0">
                              <p className="font-medium text-slate-800 truncate">{p.name}</p>
                              {p.department && (
                                <p className="text-xs text-slate-400 truncate">{p.department}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-center gap-1.5">
                            <input
                              type="number"
                              min={0}
                              max={365}
                              value={draft}
                              onChange={(e) => setDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void saveQuota(p, draft);
                              }}
                              className="w-16 h-9 px-2 rounded-xl border border-slate-200 text-sm text-center text-slate-800 focus:outline-none focus:border-blue-500"
                            />
                            {savingId === p.id ? (
                              <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                            ) : (
                              changed && (
                                <Button size="sm" theme="admin" onClick={() => void saveQuota(p, draft)}>
                                  Lưu
                                </Button>
                              )
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center text-slate-600">{balance.used}</td>
                        <td className="px-3 py-3 text-center text-amber-600">
                          {balance.pending || '—'}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span
                            className={`font-semibold ${
                              balance.remaining === 0 ? 'text-red-600' : 'text-emerald-600'
                            }`}
                          >
                            {balance.remaining}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-slate-500">
        Số liệu tính cho năm {year}. Sau khi áp dụng migration, số dư lấy từ sổ phát sinh
        cấp phép, sử dụng, hoàn phép và điều chỉnh; nghỉ ốm/không lương không trừ hạn mức phép năm.
      </p>
    </div>
  );
}
