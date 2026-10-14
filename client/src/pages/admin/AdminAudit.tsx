// ============================================================================
// Nhật ký thao tác.
// ----------------------------------------------------------------------------
// Đọc bảng `audit_logs` — bảng CHỈ THÊM, ghi bằng trigger ở database nên không
// đường nào lách được và không ai sửa/xoá được lịch sử (kể cả admin, vì bảng
// không có policy UPDATE/DELETE nào).
//
// RLS chỉ cho admin/CEO đọc, KHÔNG mở theo quyền lẻ: nhật ký chứa số lương của
// tất cả mọi người. Trang này tự chặn thêm bằng quyền chức năng `admin.audit`.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import {
  ClipboardList, Coins, Search, ShieldAlert, ShieldCheck, SlidersHorizontal, UserCog, UserX,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { hasAdminFunction } from '@/lib/permissions';
import { formatDateTime } from '@/lib/utils';
import type { AuditLog } from '@/types';

const PAGE_SIZE = 50;

/** Nhãn + màu cho từng loại hành động. Khớp mã `action` do trigger sinh ra. */
const ACTION_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  'salary.create':              { label: 'Thiết lập lương', color: 'bg-amber-100 text-amber-700',     icon: <Coins className="w-3.5 h-3.5" /> },
  'salary.update':              { label: 'Đổi lương',       color: 'bg-amber-100 text-amber-700',     icon: <Coins className="w-3.5 h-3.5" /> },
  'salary.delete':              { label: 'Xoá lương',       color: 'bg-red-100 text-red-700',         icon: <Coins className="w-3.5 h-3.5" /> },
  'profile.role_change':        { label: 'Đổi vai trò',     color: 'bg-violet-100 text-violet-700',   icon: <UserCog className="w-3.5 h-3.5" /> },
  'profile.permissions_change': { label: 'Đổi quyền',       color: 'bg-violet-100 text-violet-700',   icon: <ShieldCheck className="w-3.5 h-3.5" /> },
  'profile.active_change':      { label: 'Khoá / mở khoá',  color: 'bg-orange-100 text-orange-700',   icon: <ShieldAlert className="w-3.5 h-3.5" /> },
  'profile.quota_change':       { label: 'Đổi hạn mức phép',color: 'bg-emerald-100 text-emerald-700', icon: <UserCog className="w-3.5 h-3.5" /> },
  'user.delete':                { label: 'Xoá tài khoản',   color: 'bg-red-100 text-red-700',         icon: <UserX className="w-3.5 h-3.5" /> },
  'settings.update':            { label: 'Đổi cấu hình',    color: 'bg-blue-100 text-blue-700',       icon: <SlidersHorizontal className="w-3.5 h-3.5" /> },

  // M06 — ghi bằng trigger / RPC ở database (migration 20261013*_m06_*).
  'salary.component_create':        { label: 'Thêm khoản lương',      color: 'bg-amber-100 text-amber-700',     icon: <Coins className="w-3.5 h-3.5" /> },
  'salary.component_update':        { label: 'Sửa khoản lương',       color: 'bg-amber-100 text-amber-700',     icon: <Coins className="w-3.5 h-3.5" /> },
  'salary.component_deactivate':    { label: 'Ngừng khoản lương',     color: 'bg-orange-100 text-orange-700',   icon: <Coins className="w-3.5 h-3.5" /> },
  'salary.component_activate':      { label: 'Kích hoạt khoản lương', color: 'bg-amber-100 text-amber-700',     icon: <Coins className="w-3.5 h-3.5" /> },
  'salary.component_delete':        { label: 'Xoá khoản lương',       color: 'bg-red-100 text-red-700',         icon: <Coins className="w-3.5 h-3.5" /> },
  'salary.component_delete_blocked':{ label: 'Chặn xoá khoản lương',  color: 'bg-orange-100 text-orange-700',   icon: <ShieldAlert className="w-3.5 h-3.5" /> },
  'salary.catalog_seed':            { label: 'Khởi tạo danh mục',     color: 'bg-amber-100 text-amber-700',     icon: <Coins className="w-3.5 h-3.5" /> },
  'salary.params_create':           { label: 'Lưu tham số lương',     color: 'bg-blue-100 text-blue-700',       icon: <SlidersHorizontal className="w-3.5 h-3.5" /> },
  'salary.params_update':           { label: 'Sửa tham số lương',     color: 'bg-blue-100 text-blue-700',       icon: <SlidersHorizontal className="w-3.5 h-3.5" /> },
  'salary.params_delete':           { label: 'Xoá tham số lương',     color: 'bg-red-100 text-red-700',         icon: <SlidersHorizontal className="w-3.5 h-3.5" /> },
  'salary.template_create':         { label: 'Tạo mẫu bảng lương',    color: 'bg-blue-100 text-blue-700',       icon: <SlidersHorizontal className="w-3.5 h-3.5" /> },
  'salary.template_update':         { label: 'Sửa mẫu bảng lương',    color: 'bg-blue-100 text-blue-700',       icon: <SlidersHorizontal className="w-3.5 h-3.5" /> },
  'salary.template_item_save':      { label: 'Khai công thức khối',   color: 'bg-blue-100 text-blue-700',       icon: <SlidersHorizontal className="w-3.5 h-3.5" /> },
  'salary.template_item_end':       { label: 'Bỏ khoản khỏi mẫu',     color: 'bg-blue-100 text-blue-700',       icon: <SlidersHorizontal className="w-3.5 h-3.5" /> },
  'salary.template_assign':         { label: 'Gán mẫu cho khối',      color: 'bg-blue-100 text-blue-700',       icon: <SlidersHorizontal className="w-3.5 h-3.5" /> },
  'salary.template_seed':           { label: 'Nạp gợi ý BR-PAY',      color: 'bg-blue-100 text-blue-700',       icon: <SlidersHorizontal className="w-3.5 h-3.5" /> },
  'salary.scheme_submit':           { label: 'Trình cơ chế lương',    color: 'bg-amber-100 text-amber-700',     icon: <Coins className="w-3.5 h-3.5" /> },
  'salary.scheme_approve':          { label: 'BGĐ duyệt cơ chế',      color: 'bg-emerald-100 text-emerald-700', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
  'salary.scheme_reject':           { label: 'BGĐ từ chối cơ chế',    color: 'bg-red-100 text-red-700',         icon: <ShieldAlert className="w-3.5 h-3.5" /> },
  'salary.run_lock':                { label: 'Khoá kỳ lương (2FA)',   color: 'bg-violet-100 text-violet-700',   icon: <ShieldCheck className="w-3.5 h-3.5" /> },
  'salary.run_withdraw':            { label: 'Rút lại kỳ lương',      color: 'bg-orange-100 text-orange-700',   icon: <Coins className="w-3.5 h-3.5" /> },
  'salary.run_approve':             { label: 'BGĐ duyệt chi lương',   color: 'bg-emerald-100 text-emerald-700', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
  'salary.run_reject':              { label: 'BGĐ từ chối chi lương', color: 'bg-red-100 text-red-700',         icon: <ShieldAlert className="w-3.5 h-3.5" /> },
  'salary.run_paid':                { label: 'Chi trả & phát hành',   color: 'bg-emerald-100 text-emerald-700', icon: <Coins className="w-3.5 h-3.5" /> },
  'salary.bank_export':             { label: 'Xuất file ngân hàng',   color: 'bg-blue-100 text-blue-700',       icon: <Coins className="w-3.5 h-3.5" /> },
  'salary.bank_account_insert':     { label: 'Khai tài khoản lương',  color: 'bg-amber-100 text-amber-700',     icon: <UserCog className="w-3.5 h-3.5" /> },
  'salary.bank_account_update':     { label: 'Đổi tài khoản lương',   color: 'bg-orange-100 text-orange-700',   icon: <UserCog className="w-3.5 h-3.5" /> },
  'salary.adjustment_insert':       { label: 'Thêm điều chỉnh',       color: 'bg-amber-100 text-amber-700',     icon: <Coins className="w-3.5 h-3.5" /> },
  'salary.adjustment_update':       { label: 'Sửa điều chỉnh',        color: 'bg-amber-100 text-amber-700',     icon: <Coins className="w-3.5 h-3.5" /> },
  'salary.adjustment_delete':       { label: 'Xoá điều chỉnh',        color: 'bg-red-100 text-red-700',         icon: <Coins className="w-3.5 h-3.5" /> },
};

const FILTERS = [
  { key: 'all',      label: 'Tất cả' },
  { key: 'salary',   label: 'Lương' },
  { key: 'profile',  label: 'Quyền & tài khoản' },
  { key: 'settings', label: 'Cấu hình' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

export function AdminAudit() {
  const { profile } = useAuth();
  const allowed = hasAdminFunction(profile, 'admin.audit');

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);

  const load = async (silent = false) => {
    if (!allowed) { setLoading(false); return; }
    if (!silent) setLoading(true);

    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    setLoadError(error ? describeDbError(error) : null);
    setLogs((data || []) as AuditLog[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit, allowed]);

  useRealtimeSync([{ table: 'audit_logs' }], () => load(true), {
    enabled: allowed,
    channelKey: 'audit',
  });

  const shown = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return logs.filter((l) => {
      const matchFilter = filter === 'all' || l.action.startsWith(`${filter}.`)
        || (filter === 'profile' && l.action === 'user.delete');
      if (!matchFilter) return false;
      if (!keyword) return true;
      return (
        l.summary.toLowerCase().includes(keyword) ||
        (l.actor_name ?? '').toLowerCase().includes(keyword) ||
        (l.target_name ?? '').toLowerCase().includes(keyword)
      );
    });
  }, [logs, filter, search]);

  if (!allowed) {
    return (
      <div className="max-w-xl">
        <Card>
          <CardContent className="flex items-start gap-3 pt-6">
            <ShieldAlert className="w-6 h-6 text-amber-500 flex-shrink-0" />
            <div>
              <p className="font-medium text-slate-800">Chỉ Quản trị viên và Ban giám đốc</p>
              <p className="text-sm text-slate-500 mt-1">
                Nhật ký chứa thông tin lương của toàn công ty nên không mở theo quyền lẻ.
                Hàng rào thật nằm ở database (RLS), không chỉ ở màn hình này.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
        <ClipboardList className="w-5 h-5 text-slate-500 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-slate-600">
          Ghi tự động ở tầng database — mọi thay đổi lương, quyền và cấu hình đều để lại vết,
          kể cả khi thực hiện ngoài giao diện này. <strong>Không ai sửa hay xoá được</strong> nhật ký.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`h-9 px-4 rounded-xl text-sm font-medium transition-colors ${
                filter === f.key
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <Input
            placeholder="Tìm theo nội dung hoặc tên…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-5"><TableSkeleton /></div>
          ) : loadError ? (
            <ErrorState message={loadError} onRetry={load} />
          ) : shown.length === 0 ? (
            <EmptyState
              icon={<ClipboardList className="w-8 h-8" />}
              title="Chưa có thao tác nào được ghi"
              description="Nhật ký sẽ có dòng đầu tiên ngay khi ai đó sửa lương, đổi quyền hoặc đổi cấu hình."
            />
          ) : (
            <div className="divide-y divide-slate-50">
              {shown.map((log) => {
                const cfg = ACTION_CONFIG[log.action] ?? {
                  label: log.action,
                  color: 'bg-slate-100 text-slate-700',
                  icon: <ClipboardList className="w-3.5 h-3.5" />,
                };
                return (
                  <div key={log.id} className="flex flex-wrap items-start gap-3 px-5 py-4 hover:bg-slate-50/70 transition-colors">
                    <Avatar name={log.actor_name || '?'} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <Badge className={cfg.color}>
                          <span className="inline-flex items-center gap-1">{cfg.icon}{cfg.label}</span>
                        </Badge>
                        <span className="text-sm font-medium text-slate-800">
                          {log.actor_name || 'Không rõ'}
                        </span>
                        {log.target_name && log.target_user_id !== log.actor_id && (
                          <span className="text-xs text-slate-400">→ {log.target_name}</span>
                        )}
                      </div>
                      <p className="text-sm text-slate-600 break-words">{log.summary}</p>
                    </div>
                    <span className="text-xs text-slate-400 whitespace-nowrap">
                      {formatDateTime(log.created_at)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Nạp thêm khi số dòng trả về chạm đúng giới hạn — còn nữa mới hiện nút. */}
      {!loading && logs.length >= limit && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
            Xem thêm {PAGE_SIZE} dòng
          </Button>
        </div>
      )}
    </div>
  );
}
