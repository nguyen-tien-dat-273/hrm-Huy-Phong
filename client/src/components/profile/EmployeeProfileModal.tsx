import { useEffect, useState, type ReactNode } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmployeeDocumentVault } from '@/components/profile/EmployeeDocumentVault';
import { displayIdentifier } from '@/lib/identity';
import { formatDate, formatTenure } from '@/lib/utils';
import type { Profile } from '@/types';
import { Tabs } from '@/components/ui/Tabs';

type ProfileTab = 'info' | 'contracts' | 'documents';

const TABS: Array<{ key: ProfileTab; label: string }> = [
  { key: 'info', label: 'Thông tin' },
  { key: 'contracts', label: 'Hợp đồng' },
  { key: 'documents', label: 'Thông tin giấy tờ' },
];

const STATUS_BADGE: Record<string, string> = {
  probation: 'bg-amber-100 text-amber-800',
  onboarding: 'bg-amber-100 text-amber-800',
  terminated: 'bg-red-100 text-red-800',
};

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`rounded-none border border-slate-200 p-3 ${wide ? 'sm:col-span-2' : ''}`}>
      <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-600">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-slate-800">{children}</dd>
    </div>
  );
}

/**
 * FR01.01.04: hồ sơ một nhân sự dạng tab (Thông tin, Tài liệu, ...).
 * Trang gọi truyền sẵn tên đơn vị/vị trí/quản lý và các nút thao tác để
 * component không phải tải lại danh mục cơ cấu tổ chức.
 */
export function EmployeeProfileModal({
  user,
  onClose,
  unitName,
  positionName,
  managerName,
  statusLabel,
  actorId,
  canManage,
  statusAction,
  actions,
}: {
  user: Profile | null;
  onClose: () => void;
  unitName: string;
  positionName: string;
  managerName: string;
  statusLabel: string;
  actorId?: string;
  canManage: boolean;
  /** Nút cạnh trạng thái, VD "Chuyển chính thức". */
  statusAction?: ReactNode;
  /** Nút cuối modal: Phiếu lương, Cấp lại mật khẩu, Sửa, Xóa. */
  actions?: ReactNode;
}) {
  const [tab, setTab] = useState<ProfileTab>('info');
  useEffect(() => { setTab('info'); }, [user?.id]);

  return (
    <Modal open={!!user} onClose={onClose} title={`Hồ sơ nhân sự${user?.employee_code ? ` · ${user.employee_code}` : ''}`} size="xl">
      {user && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start gap-4 rounded-none bg-gradient-to-br from-slate-50 to-indigo-50 p-4">
            <Avatar name={user.name} url={user.avatar_url} size="lg" />
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-lg font-bold text-slate-900">{user.name}</h3>
              <p className="text-sm text-slate-600">{positionName} · {user.department || unitName}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Badge className={STATUS_BADGE[user.employment_status || 'active'] || 'bg-emerald-100 text-emerald-800'}>{statusLabel}</Badge>
                {!user.is_active && <Badge className="bg-slate-200 text-slate-600">Tài khoản đã vô hiệu</Badge>}
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-600">Ngày vào</p>
              <p className="text-sm font-bold text-slate-800">{user.hire_date ? formatDate(user.hire_date) : 'Chưa cập nhật'}</p>
              {user.hire_date && <p className="mt-0.5 text-xs text-slate-600">Thâm niên: {formatTenure(user.hire_date)}</p>}
            </div>
          </div>

          <Tabs items={TABS} value={tab} onChange={setTab} />

          {tab === 'info' && (
            <div className="space-y-4">
              <dl className="grid gap-3 sm:grid-cols-2">
                <Field label="Tài khoản / Email">{displayIdentifier(user.email)}</Field>
                <Field label="Điện thoại">{user.phone || 'Chưa cập nhật'}</Field>
                <Field label="Tài khoản & Trạng thái">
                  <span className="flex flex-wrap items-center justify-between gap-1">
                    <span>
                      <span className={user.is_active ? 'text-emerald-600' : 'text-slate-600'}>{user.is_active ? 'Hoạt động' : 'Đã vô hiệu'}</span>
                      <span className="mx-1 text-slate-600">·</span>{statusLabel}
                    </span>
                    {statusAction}
                  </span>
                </Field>
                <Field label="Phép năm">{user.annual_leave_quota} ngày</Field>
                <Field label="Quê quán">{user.hometown || 'Chưa cập nhật'}</Field>
                <Field label="Nơi ở hiện tại">{user.current_address || 'Chưa cập nhật'}</Field>
                <Field label="Học vấn" wide>{[user.school_name, user.major, user.graduation_year].filter(Boolean).join(' · ') || 'Chưa cập nhật'}</Field>
              </dl>
              <section className="rounded-none border border-slate-200 bg-white p-4">
                <h4 className="text-sm font-bold text-slate-900">Công việc tại tổ chức</h4>
                <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                  <div><p className="text-xs text-slate-600">Đơn vị</p><p className="font-semibold text-slate-800">{unitName}</p></div>
                  <div><p className="text-xs text-slate-600">Vị trí</p><p className="font-semibold text-slate-800">{positionName}</p></div>
                  <div><p className="text-xs text-slate-600">Quản lý trực tiếp</p><p className="font-semibold text-slate-800">{managerName}</p></div>
                </div>
              </section>
            </div>
          )}

          {tab === 'contracts' && actorId && (
            <EmployeeDocumentVault employee={user} actorId={actorId} canManage={canManage} mode="contracts" />
          )}

          {tab === 'documents' && actorId && (
            <EmployeeDocumentVault employee={user} actorId={actorId} canManage={canManage} />
          )}

          {actions && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">{actions}</div>}
        </div>
      )}
    </Modal>
  );
}
