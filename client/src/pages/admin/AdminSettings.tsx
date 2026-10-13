// ============================================================================
// Cấu hình hệ thống.
// ----------------------------------------------------------------------------
// Nguyên tắc của trang này: MỌI Ô Ở ĐÂY PHẢI CÓ NƠI TIÊU THỤ THẬT. Bản đầu
// tiên ghi localStorage và không chỗ nào đọc lại, tệ nhất là công tắc "Xác
// thực hai yếu tố" báo "Đã lưu" trong khi hệ thống không hề có 2FA. Nó đã bị
// gỡ thay vì để tiếp tục nói dối về bảo mật.
//
// Nguyên tắc thứ hai: CHỈ GIỮ THỨ DÙNG CHUNG NHIỀU MODULE. Thuế suất, tỷ lệ
// bảo hiểm, trần đóng và ngày công chuẩn từng nằm ở đây nhưng đã chuyển sang
// tab "Tham số lương" trong Bảng lương, vì hai lý do:
//
//   - Chỉ `lib/payroll.ts` đọc chúng. Thiết lập phục vụ đúng một module thì
//     thuộc về module đó.
//   - HỞ QUYỀN. Trang này mở cho quyền lẻ `settings`, còn Bảng lương yêu cầu
//     Admin/CEO. Để chung nghĩa là người bị cấm XEM bảng lương vẫn SỬA được
//     thuế suất của cả công ty — trái với luật mà `lib/permissions.ts` đặt ra.
//
// Nơi tiêu thụ của từng giá trị còn lại:
//   orgName             → tên trên thanh bên và tiêu đề tab
//   contactEmail, phone → khối liên hệ ở Hồ sơ cá nhân và Phiếu lương
//   standardHoursPerDay và defaultAnnualLeave → trang "Thiết lập công & chấm
//                         công" trong nhóm Thời gian & Nghỉ phép
//   requireTaskApproval → điều kiện hiện nút check-out (lib/assignments)
//   autoNotify          → có bắn thông báo chuông hay không (lib/assignments)
//
//   Phiếu lương của nhân viên có thể xem ở dạng tạm tính trong kỳ đang chạy,
//   nhưng chỉ phiếu thuộc chính tài khoản đó được phép đọc; khi Admin duyệt,
//   phiếu được đóng băng thành số chính thức.
// ============================================================================

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { PermissionFunctionList } from '@/components/PermissionFunctionList';
import { StaffFunctionSummary } from '@/components/StaffFunctionSummary';
import { FunctionPermissionPicker } from '@/components/FunctionPermissionPicker';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useSettings } from '@/contexts/SettingsContext';
import { saveSettings, type AppSettings } from '@/lib/settings';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { PERMISSION_FUNCTIONS } from '@/config/permissionCoverage';
import { ADMIN_FUNCTIONS, ADMIN_PERMISSIONS, PERMISSION_LABELS, isFullAdmin, type AdminFunctionCode, type AdminPermission } from '@/lib/permissions';
import {
  Bell, CalendarCheck, CheckCircle2, Clock, Loader2, Pencil, Plus, Shield, Trash2,
} from 'lucide-react';

interface AccessRole {
  code: string;
  name: string;
  description: string | null;
  permissions: string[];
  is_system: boolean;
  is_active: boolean;
  sort_order: number;
  function_permissions?: string[];
}

const PERMISSION_GROUPS: { label: string; permissions: AdminPermission[] }[] = [
  { label: 'Nhân sự & hệ thống', permissions: ['users', 'settings'] },
  { label: 'Công việc & thời gian', permissions: ['projects', 'attendance', 'leave'] },
  { label: 'Báo cáo & phát triển', permissions: ['reports', 'training'] },
];

/** Công tắc bật/tắt — trước đây khối markup này được dán lặp ba lần. */
function Toggle({
  icon, title, desc, checked, onChange, tone = 'indigo',
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  tone?: 'indigo' | 'amber';
}) {
  const iconTone = tone === 'amber'
    ? 'bg-amber-50 text-amber-700 border-amber-100'
    : 'bg-indigo-50 text-indigo-700 border-indigo-100';
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="flex items-center gap-3">
        <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border ${iconTone}`}>
          {icon}
        </div>
        <div>
          <p className="text-sm font-medium text-slate-800">{title}</p>
          <p className="text-xs leading-relaxed text-slate-500">{desc}</p>
        </div>
      </div>
      <label className="relative inline-flex flex-shrink-0 cursor-pointer items-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <div className="peer h-6 w-11 rounded-full bg-slate-200 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-indigo-600 peer-checked:after:translate-x-5" />
      </label>
    </div>
  );
}

export function AdminSettings() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { profile } = useAuth();
  const { settings, loading, reload } = useSettings();

  // Bản nháp cục bộ: người dùng chỉnh thoải mái rồi mới bấm Lưu.
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [roles, setRoles] = useState<AccessRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [roleFunctionsSupported, setRoleFunctionsSupported] = useState(true);
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<AccessRole | null>(null);
  const [roleForm, setRoleForm] = useState({ code: '', name: '', description: '', permissions: [] as AdminPermission[], function_permissions: [] as AdminFunctionCode[] });
  const canManageRoles = isFullAdmin(profile);

  const loadRoles = async () => {
    setRolesLoading(true);
    const { data } = await supabase.from('system_access_roles').select('*').order('sort_order').order('name');
    const { data: functionRows, error: functionError } = await supabase.from('system_access_role_functions').select('access_role_code,function_code');
    setRoleFunctionsSupported(!functionError);
    const functionsByRole = new Map<string, string[]>();
    (functionRows || []).forEach((row) => functionsByRole.set(row.access_role_code, [...(functionsByRole.get(row.access_role_code) || []), row.function_code]));
    setRoles(((data || []) as AccessRole[]).map((role) => ({ ...role, function_permissions: functionsByRole.get(role.code) || [] })));
    setRolesLoading(false);
  };

  useEffect(() => { void loadRoles(); }, []);

  const toggleRolePermission = (permission: AdminPermission) => {
    setRoleForm((current) => ({
      ...current,
      permissions: current.permissions.includes(permission)
        ? current.permissions.filter((item) => item !== permission)
        : [...current.permissions, permission],
    }));
  };

  const openNewRole = () => {
    setEditingRole(null);
    setRoleForm({ code: '', name: '', description: '', permissions: [], function_permissions: [] });
    setRoleModalOpen(true);
  };

  const openEditRole = (role: AccessRole) => {
    setEditingRole(role);
    setRoleForm({ code: role.code, name: role.name, description: role.description || '', permissions: role.permissions.filter((item): item is AdminPermission => (ADMIN_PERMISSIONS as readonly string[]).includes(item)), function_permissions: (role.function_permissions || []).filter((item): item is AdminFunctionCode => item.startsWith('admin.')) });
    setRoleModalOpen(true);
  };

  const saveRole = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageRoles) return;
    const code = roleForm.code.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{1,49}$/.test(code)) {
      toast('Mã vai trò phải viết thường, không dấu, dùng chữ số hoặc dấu gạch dưới.', 'error');
      return;
    }
    if (!roleForm.name.trim()) {
      toast('Tên vai trò không được để trống.', 'error');
      return;
    }
    setSaving(true);
    const payload = { code, name: roleForm.name.trim(), description: roleForm.description.trim() || null, permissions: roleForm.permissions, is_active: true };
    const result = editingRole
      ? await supabase.from('system_access_roles').update({ name: payload.name, description: payload.description, permissions: payload.permissions, updated_at: new Date().toISOString() }).eq('code', editingRole.code)
      : await supabase.from('system_access_roles').insert(payload);
    let saveError = result.error;
    if (!saveError && roleFunctionsSupported) {
      const clear = await supabase.from('system_access_role_functions').delete().eq('access_role_code', code);
      if (clear.error) saveError = clear.error;
      else if (roleForm.function_permissions.length > 0) {
        const inserted = await supabase.from('system_access_role_functions').insert(roleForm.function_permissions.map((function_code) => ({ access_role_code: code, function_code })));
        saveError = inserted.error;
      }
    }
    setSaving(false);
    if (saveError) {
      toast('Không lưu được vai trò: ' + describeDbError(saveError), 'error');
      return;
    }
    toast(editingRole ? 'Đã cập nhật vai trò.' : 'Đã thêm vai trò mới.', 'success');
    if (!roleFunctionsSupported && roleForm.function_permissions.length > 0) {
      toast('Vai trò đã lưu quyền module. Muốn lưu chức năng nâng cao, hãy chạy migration phân quyền chức năng trước.', 'warning');
    }
    setRoleModalOpen(false);
    await loadRoles();
  };

  const removeRole = async (role: AccessRole) => {
    if (!canManageRoles || role.is_system) return;
    const accepted = await confirm({ title: `Xóa vai trò “${role.name}”?`, message: 'Nhân sự đang dùng vai trò này sẽ được chuyển về vai trò Nhân viên.', confirmLabel: 'Xóa vai trò', danger: true });
    if (!accepted) return;
    // Chuyển hồ sơ về Nhân viên trước khi xoá để không để lại mã vai trò mồ côi.
    const { error: reassignmentError } = await supabase
      .from('profiles')
      .update({ access_role_code: 'staff' })
      .eq('access_role_code', role.code);
    if (reassignmentError) {
      toast('Không thể chuyển nhân sự về vai trò Nhân viên: ' + describeDbError(reassignmentError), 'error');
      return;
    }
    const { error } = await supabase.from('system_access_roles').delete().eq('code', role.code);
    if (error) toast('Không thể xóa vai trò: ' + describeDbError(error), 'error');
    else { toast('Đã xóa vai trò.', 'success'); await loadRoles(); }
  };

  // Cấu hình tải xong (hoặc bị người khác sửa qua realtime) thì nạp vào nháp —
  // nhưng KHÔNG đè khi người dùng đang sửa dở, tránh mất thao tác đang gõ.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched) setDraft(settings);
  }, [settings, touched]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(settings), [draft, settings]);

  const update = (patch: Partial<AppSettings>) => {
    setTouched(true);
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const save = async () => {
    if (!draft.orgName.trim()) {
      toast('Tên tổ chức không được để trống.', 'error');
      return;
    }

    setSaving(true);
    const { error } = await saveSettings(draft, profile?.id ?? null);
    setSaving(false);

    if (error) {
      toast(`Lưu cấu hình thất bại: ${error}`, 'error');
      return;
    }

    setTouched(false);
    await reload();
    toast('Đã lưu cấu hình cho toàn hệ thống', 'success');
  };

  const revert = () => {
    setTouched(false);
    setDraft(settings);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        Đang tải cấu hình…
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6 pb-28">
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Thông tin tổ chức</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Input
              label="Tên tổ chức"
              value={draft.orgName}
              onChange={(e) => update({ orgName: e.target.value })}
            />
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Hiển thị trên thanh bên và tiêu đề tab trình duyệt. Trang đăng nhập vẫn giữ tên sản
              phẩm vì chưa đăng nhập thì chưa đọc được cấu hình.
            </p>
          </div>
          <div>
            <Input
              label="Email liên hệ nhân sự"
              type="email"
              placeholder="hr@congty.vn"
              value={draft.contactEmail}
              onChange={(e) => update({ contactEmail: e.target.value })}
            />
          </div>
          <div>
            <Input
              label="Số điện thoại nhân sự"
              placeholder="028 1234 5678"
              value={draft.phone}
              onChange={(e) => update({ phone: e.target.value })}
            />
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Hai mục trên hiện ở trang <strong>Hồ sơ cá nhân</strong> và <strong>Phiếu lương</strong>{' '}
              của nhân viên — những chỗ hệ thống bảo họ "liên hệ HR". Để trống thì khối liên hệ tự ẩn.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Vai trò nghiệp vụ</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              Tạo vai trò theo vị trí thực tế; nhân sự được gán vai trò sẽ kế thừa quyền tương ứng.
            </p>
          </div>
          {canManageRoles && (
            <Button theme="admin" onClick={openNewRole} className="shrink-0">
              <Plus className="h-4 w-4" /> Thêm vai trò
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {rolesLoading ? (
            <div className="flex items-center gap-2 py-5 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Đang tải vai trò…</div>
          ) : roles.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              Chưa có dữ liệu vai trò. Hãy chạy migration <code>system_access_roles</code> trên Supabase.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {roles.map((role) => (
                <div key={role.code} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-900">{role.name}</h3>
                      <Badge className="bg-slate-100 text-slate-600">{role.code}</Badge>
                      <Badge className={role.is_system ? 'bg-indigo-50 text-indigo-700' : 'bg-emerald-50 text-emerald-700'}>
                        {role.is_system ? 'Mặc định hệ thống' : 'Tùy chỉnh'}
                      </Badge>
                    </div>
                    {role.description && <p className="mt-1 text-sm text-slate-500">{role.description}</p>}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {role.permissions.length === 0 ? <span className="text-xs text-slate-400">Chỉ khu nhân viên</span> : role.permissions.map((permission) => (
                        <span key={permission} className="rounded-full bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600">
                          {PERMISSION_LABELS[permission as AdminPermission]?.label ?? permission}
                        </span>
                      ))}
                    </div>
                    {(role.permissions.length > 0 || (role.function_permissions?.length || 0) > 0) && <p className="mt-2 text-[11px] text-slate-400">Bao phủ {role.permissions.reduce((total, permission) => total + (PERMISSION_FUNCTIONS[permission as AdminPermission]?.length || 0), 0)} chức năng module và {(role.function_permissions?.length || 0)} chức năng nâng cao.</p>}
                  </div>
                  {canManageRoles && (
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" onClick={() => openEditRole(role)} aria-label={`Sửa ${role.name}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {!role.is_system && (
                        <Button variant="ghost" onClick={() => void removeRole(role)} aria-label={`Xóa ${role.name}`} className="text-red-600 hover:bg-red-50 hover:text-red-700">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quy tắc vận hành</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Toggle
            icon={<Clock className="h-5 w-5" />}
            title="Bắt buộc duyệt công việc trước khi Check-out"
            desc="Bật: nhân viên phải được quản lý xác nhận hết việc trong ngày mới check-out được."
            checked={draft.requireTaskApproval}
            onChange={(v) => update({ requireTaskApproval: v })}
          />
          <Toggle
            icon={<Bell className="h-5 w-5" />}
            tone="amber"
            title="Gửi thông báo tự động"
            desc="Thông báo chuông khi giao việc, gửi duyệt, duyệt ca và duyệt nghỉ phép."
            checked={draft.autoNotify}
            onChange={(v) => update({ autoNotify: v })}
          />
        </CardContent>
      </Card>

      {/* Bảo mật: nêu đúng cơ chế đang chạy. Trước đây chỗ này là công tắc 2FA
          giả — bật lên báo "Đã lưu" mà hệ thống không có 2FA nào cả. */}
      <Card>
        <CardHeader>
          <CardTitle>Bảo mật</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-700">
              <Shield className="h-5 w-5" />
            </div>
            <ul className="space-y-1.5 text-sm leading-relaxed text-slate-600">
              <li className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
                Mật khẩu do Supabase Auth quản lý, băm bằng bcrypt — hệ thống không lưu bản rõ.
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
                Không có đăng ký công khai: admin cấp tài khoản kèm mật khẩu tạm, người dùng
                bắt buộc đổi ở lần đăng nhập đầu.
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
                Mật khẩu tối thiểu 8 ký tự, có cả chữ và số.
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
                Dữ liệu lương chỉ Admin/CEO xem toàn bộ; nhân viên chỉ truy cập được dữ liệu của
                chính mình. Phiếu đã duyệt được đóng băng, còn kỳ đang xử lý hiển thị rõ là tạm tính.
              </li>
              <li className="flex gap-2">
                <CalendarCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
                Phân quyền được thi hành ở tầng database (RLS), không chỉ ẩn nút trên giao diện.
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <Modal open={roleModalOpen} onClose={() => setRoleModalOpen(false)} title={editingRole ? 'Chỉnh sửa vai trò' : 'Thêm vai trò nghiệp vụ'} size="lg">
        <form onSubmit={saveRole} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Mã vai trò"
              value={roleForm.code}
              onChange={(e) => setRoleForm((current) => ({ ...current, code: e.target.value }))}
              disabled={!!editingRole}
              required
              placeholder="hr_manager"
            />
            <Input
              label="Tên hiển thị"
              value={roleForm.name}
              onChange={(e) => setRoleForm((current) => ({ ...current, name: e.target.value }))}
              required
              placeholder="Quản lý nhân sự"
            />
          </div>
          <Textarea
            label="Mô tả"
            rows={3}
            value={roleForm.description}
            onChange={(e) => setRoleForm((current) => ({ ...current, description: e.target.value }))}
            placeholder="Vai trò này phụ trách những nghiệp vụ nào?"
          />
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-slate-700">Quyền module</legend>
            <StaffFunctionSummary />
            <div className="space-y-4">
              {PERMISSION_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">{group.label}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {group.permissions.map((permission) => {
                      const checked = roleForm.permissions.includes(permission);
                      return (
                        <label key={permission} className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition-colors ${checked ? 'border-indigo-300 bg-indigo-50/60' : 'border-slate-200 hover:bg-slate-50'}`}>
                          <input type="checkbox" checked={checked} onChange={() => toggleRolePermission(permission)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                          <span className="min-w-0"><span className="block text-sm font-medium text-slate-800">{PERMISSION_LABELS[permission].label}</span><span className="block text-xs text-slate-500">{PERMISSION_LABELS[permission].desc}</span><PermissionFunctionList permission={permission} /></span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <FunctionPermissionPicker selected={roleForm.function_permissions} onChange={(function_permissions) => setRoleForm((current) => ({ ...current, function_permissions, permissions: Array.from(new Set([...current.permissions, ...function_permissions.map((code) => ADMIN_FUNCTIONS[code].module)])) }))} disabled={!canManageRoles || !roleFunctionsSupported} />
            {!roleFunctionsSupported && <p className="mt-2 text-xs text-amber-700">Chức năng nâng cao chưa khả dụng vì migration phân quyền chức năng chưa được chạy trên Supabase.</p>}
          </fieldset>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setRoleModalOpen(false)} className="flex-1">Hủy</Button>
            <Button type="submit" theme="admin" disabled={saving} className="flex-1">{saving ? 'Đang lưu…' : 'Lưu vai trò'}</Button>
          </div>
        </form>
      </Modal>

      {/* Một thanh lưu duy nhất — trước đây mỗi thẻ một nút "Lưu thay đổi" mà
          cả ba đều lưu toàn bộ, khiến người dùng tưởng lưu riêng từng phần. */}
      {dirty && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/90 px-4 py-3 shadow-lg backdrop-blur-md print:hidden">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 lg:pl-64">
            <p className="text-sm text-slate-600">Có thay đổi chưa lưu</p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={revert} disabled={saving}>
                Hoàn tác
              </Button>
              <Button theme="admin" onClick={save} disabled={saving}>
                {saving ? 'Đang lưu…' : 'Lưu thay đổi'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
