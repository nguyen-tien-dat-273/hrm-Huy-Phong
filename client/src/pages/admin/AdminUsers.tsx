import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserPlus, FileSpreadsheet, Search, Shield, Trash2, Edit3, KeyRound, Copy, Check, ShieldAlert, ShieldCheck, AtSign, Grid2X2, List, Mail, Phone, Building2, Wallet, UserRound } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { StaffFunctionSummary } from '@/components/StaffFunctionSummary';
import { EffectivePermissions } from '@/components/EffectivePermissions';
import { EmployeeImportModal } from '@/components/EmployeeImportModal';
import { EmployeeDocumentVault } from '@/components/profile/EmployeeDocumentVault';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useAuth } from '@/contexts/AuthContext';
import { displayIdentifier, isInternalEmail, validateIdentifier } from '@/lib/identity';
import { supabase } from '@/lib/supabase';
import {
  ADMIN_PERMISSIONS,
  PERMISSION_FUNCTIONS,
  PERMISSION_LABELS,
  isFullAdmin,
  type AdminPermission,
} from '@/lib/permissions';
import type { Profile, SystemRole } from '@/types';

const roleConfig: Record<SystemRole, { label: string; color: string }> = {
  admin: { label: 'Admin', color: 'bg-blue-100 text-blue-700' },
  ceo: { label: 'CEO', color: 'bg-violet-100 text-violet-700' },
  teamlead: { label: 'Trưởng nhóm', color: 'bg-amber-100 text-amber-700' },
  staff: { label: 'Nhân viên', color: 'bg-emerald-100 text-emerald-700' },
};

const fallbackAccessRoles: AccessRole[] = [
  { code: 'staff', name: 'Nhân viên', description: null, permissions: [], function_permissions: [], is_system: true, is_active: true, sort_order: 10 },
  { code: 'teamlead', name: 'Trưởng nhóm', description: null, permissions: ['projects', 'attendance', 'leave'], function_permissions: [], is_system: true, is_active: true, sort_order: 20 },
  { code: 'admin', name: 'Admin', description: null, permissions: [...ADMIN_PERMISSIONS], function_permissions: [], is_system: true, is_active: true, sort_order: 30 },
  { code: 'ceo', name: 'CEO', description: null, permissions: [...ADMIN_PERMISSIONS], function_permissions: [], is_system: true, is_active: true, sort_order: 40 },
];


/** Mật khẩu tạm vừa sinh ra, hiển thị đúng một lần để admin bàn giao. */
interface IssuedCredential {
  name: string;
  /** Email dùng cho Supabase Auth (có thể là email nội bộ `@ppms.local`). */
  email: string;
  tempPassword: string;
  kind: 'create' | 'reset';
}

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

export function AdminUsers() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { users, loading, createUser, updateUser, deleteUser, resetUserPassword, profile: currentUser, loadUsers } = useAuth();
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('Tất cả');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [viewingUser, setViewingUser] = useState<Profile | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<Profile | null>(null);
  const [issued, setIssued] = useState<IssuedCredential | null>(null);
  const [copied, setCopied] = useState(false);
  const [accessRoles, setAccessRoles] = useState<AccessRole[]>([]);
  const [organizationUnits, setOrganizationUnits] = useState<{ id: string; code: string; name: string; is_active: boolean }[]>([]);
  const [jobPositions, setJobPositions] = useState<{ id: string; code: string; title: string; unit_id: string; is_active: boolean }[]>([]);
  const [form, setForm] = useState({
    name: '',
    identifier: '',
    role: 'staff' as SystemRole,
    access_role_code: 'staff',
    department: '',
    employee_code: '',
    phone: '', hometown: '', permanent_address: '', current_address: '',
    education_level: '' as Profile['education_level'] | '', school_name: '', major: '', graduation_year: '',
    permissions: [] as AdminPermission[],
  });
  const [submitting, setSubmitting] = useState(false);
  const fullAdmin = isFullAdmin(currentUser);
  const canAdminister = (user: Profile) => fullAdmin || user.role === 'staff';

  useEffect(() => {
    let active = true;
    void Promise.all([
      supabase.from('system_access_roles').select('*').eq('is_active', true).order('sort_order').order('name'),
      supabase.from('system_access_role_functions').select('access_role_code,function_code'),
    ]).then(([rolesResult, functionsResult]) => {
      const byRole = new Map<string, string[]>();
      (functionsResult.data || []).forEach((row) => byRole.set(row.access_role_code, [...(byRole.get(row.access_role_code) || []), row.function_code]));
      if (active) setAccessRoles(((rolesResult.data || []) as AccessRole[]).map((role) => ({ ...role, function_permissions: byRole.get(role.code) || [] })));
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      supabase.from('organization_units').select('id,code,name,is_active').order('name'),
      supabase.from('job_positions').select('id,code,title,unit_id,is_active').order('title'),
    ]).then(([unitResult, positionResult]) => {
      if (!active) return;
      setOrganizationUnits((unitResult.data || []) as { id: string; code: string; name: string; is_active: boolean }[]);
      setJobPositions((positionResult.data || []) as { id: string; code: string; title: string; unit_id: string; is_active: boolean }[]);
    });
    return () => { active = false; };
  }, []);

  const accessRoleFor = (user: Profile) =>
    accessRoles.find((role) => role.code === user.access_role_code)
      ?? accessRoles.find((role) => role.code === user.role);
  const roleLabel = (user: Profile) => accessRoleFor(user)?.name ?? roleConfig[user.role]?.label ?? user.role;
  const selectedAccessRole = accessRoles.find((role) => role.code === form.access_role_code)
    ?? fallbackAccessRoles.find((role) => role.code === form.access_role_code);
  const selectAccessRole = (code: string) => {
    const legacyRole = (['admin', 'ceo', 'teamlead', 'staff'] as string[]).includes(code) ? code as SystemRole : 'staff';
    setForm((current) => ({ ...current, access_role_code: code, role: legacyRole }));
  };
  const unitName = (unitId: string | null | undefined) => organizationUnits.find((unit) => unit.id === unitId)?.name || 'Chưa gán đơn vị';
  const positionName = (positionId: string | null | undefined) => jobPositions.find((position) => position.id === positionId)?.title || 'Chưa gán vị trí';
  const managerName = (managerId: string | null | undefined) => users.find((user) => user.id === managerId)?.name || 'Chưa gán quản lý';
  const openOrganizationAssignment = (user: Profile) => {
    setModalOpen(false);
    navigate(`/admin/organization?tab=assignments&user=${encodeURIComponent(user.id)}`);
  };


  const departments = Array.from(
    new Set(users.map((user) => user.department).filter((value): value is string => Boolean(value))),
  ).sort((a, b) => a.localeCompare(b, 'vi'));

  const normalizedSearch = search.trim().toLowerCase();
  const filtered = users.filter((user) => {
    const matchesSearch = !normalizedSearch
      || user.name.toLowerCase().includes(normalizedSearch)
      || user.email.toLowerCase().includes(normalizedSearch)
      || (user.department || '').toLowerCase().includes(normalizedSearch)
      || (user.employee_code || '').toLowerCase().includes(normalizedSearch)
      || (user.phone || '').toLowerCase().includes(normalizedSearch)
      || (user.hometown || '').toLowerCase().includes(normalizedSearch)
      || roleLabel(user).toLowerCase().includes(normalizedSearch);
    const matchesDepartment = department === 'Tất cả' || user.department === department;
    return matchesSearch && matchesDepartment;
  });

  const openPayslip = (user: Profile) => {
    navigate(`/admin/payroll?user=${encodeURIComponent(user.id)}`);
  };

  const openCreate = () => {
    setEditingUser(null);
    setForm({ name: '', identifier: '', role: 'staff', access_role_code: 'staff', department: '', employee_code: '', phone: '', hometown: '', permanent_address: '', current_address: '', education_level: '', school_name: '', major: '', graduation_year: '', permissions: [] });
    setModalOpen(true);
  };

  const openEdit = (user: Profile) => {
    setEditingUser(user);
    setForm({
      name: user.name,
      identifier: displayIdentifier(user.email),
      role: user.role,
      access_role_code: user.access_role_code || user.role,
      department: user.department || '',
      employee_code: user.employee_code || '',
      phone: user.phone || '',
      hometown: user.hometown || '',
      permanent_address: user.permanent_address || '',
      current_address: user.current_address || '',
      education_level: user.education_level || '',
      school_name: user.school_name || '',
      major: user.major || '',
      graduation_year: user.graduation_year?.toString() || '',
      permissions: (user.permissions ?? []).filter((p): p is AdminPermission =>
        (ADMIN_PERMISSIONS as readonly string[]).includes(p),
      ),
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!editingUser) {
      const invalid = validateIdentifier(form.identifier);
      if (invalid) {
        toast(invalid, 'error');
        return;
      }
    }

    setSubmitting(true);

    if (editingUser) {
      const current = (editingUser.permissions ?? []).filter((code): code is AdminPermission =>
        (ADMIN_PERMISSIONS as readonly string[]).includes(code),
      );
      const permissionsChanged = current.length !== form.permissions.length
        || current.some((code) => !form.permissions.includes(code));
      // Rut ra bien vi can dung o ca hai cho: quyet dinh co gui len khong, va
      // doan loi trung khoa co phai do ma nhan vien khong.
      const nextCode = form.employee_code.trim();
      const codeChanged = fullAdmin && nextCode !== (editingUser.employee_code || '');
      const { error } = await updateUser(editingUser.id, {
        name: form.name,
        role: fullAdmin ? form.role : 'staff',
        access_role_code: fullAdmin ? form.access_role_code : 'staff',
        // Khi đã thuộc cơ cấu, phòng ban lấy từ organization_units; không cho
        // form hồ sơ ghi đè bằng một chuỗi tự do gây lệch dữ liệu.
        ...(editingUser.unit_id ? {} : { department: form.department || null }),
        // Ma nhan vien la khoa doi chieu voi may cham cong, va co unique index
        // tren lower(employee_code). Chi Admin/CEO duoc sua, va chi gui khi
        // that su doi — gui lai gia tri cu cho moi lan luu la tu dam vao
        // chinh minh khi database so sanh khong phan biet hoa thuong.
        ...(codeChanged ? { employee_code: nextCode || null } : {}),
        phone: form.phone.trim() || null,
        hometown: form.hometown.trim() || null,
        permanent_address: form.permanent_address.trim() || null,
        current_address: form.current_address.trim() || null,
        education_level: form.education_level || null,
        school_name: form.school_name.trim() || null,
        major: form.major.trim() || null,
        graduation_year: form.graduation_year ? Number(form.graduation_year) : null,
        // Quyền lẻ CHỈ gửi đi khi người dùng thực sự đổi nó ở form này.
        //
        // Trước đây mọi lần lưu đều gửi `[]` cho ai không phải staff, nên sửa
        // số điện thoại cho một trưởng nhóm là xóa sạch quyền riêng đã cấp cho
        // họ bên Phân công nhân sự — mất im lặng, không báo gì.
        ...(permissionsChanged ? { permissions: form.permissions } : {}),
      });
      if (error) {
        toast(codeChanged && /đã tồn tại|duplicate|unique/i.test(error)
          ? `Mã nhân viên “${nextCode}” đã thuộc về người khác. Mỗi mã chỉ gán được cho một người.`
          : 'Cập nhật thất bại: ' + error, 'error');
      } else {
        toast('Cập nhật người dùng thành công!', 'success');
        setModalOpen(false);
      }
    } else {
      const { error, tempPassword, email } = await createUser({
        name: form.name,
        identifier: form.identifier,
        role: fullAdmin ? form.role : 'staff',
        access_role_code: fullAdmin ? form.access_role_code : 'staff',
        department: form.department,
        permissions: fullAdmin && form.role === 'staff' ? form.permissions : [],
      });
      if (error) {
        toast('Tạo người dùng thất bại: ' + error, 'error');
      } else {
        toast('Tạo người dùng thành công!', 'success');
        setModalOpen(false);
        if (tempPassword) {
          setCopied(false);
          setIssued({ name: form.name, email: email ?? form.identifier, tempPassword, kind: 'create' });
        }
      }
    }
    setSubmitting(false);
  };

  const handleResetPassword = async () => {
    if (!resetTarget) return;
    setSubmitting(true);
    const { error, tempPassword } = await resetUserPassword(resetTarget.id);
    setSubmitting(false);

    if (error) {
      toast('Cấp mật khẩu tạm thất bại: ' + error, 'error');
      return;
    }
    toast('Đã cấp mật khẩu tạm mới.', 'success');
    if (tempPassword) {
      setCopied(false);
      setIssued({ name: resetTarget.name, email: resetTarget.email, tempPassword, kind: 'reset' });
    }
    setResetTarget(null);
  };

  const copyCredential = async () => {
    if (!issued) return;
    const label = isInternalEmail(issued.email) ? 'Tên đăng nhập' : 'Email';
    const text = `${label}: ${displayIdentifier(issued.email)}\nMật khẩu tạm: ${issued.tempPassword}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Trình duyệt chặn truy cập clipboard. Vui lòng copy thủ công.', 'warning');
    }
  };

  const handleDelete = async (user: Profile) => {
    if (currentUser && user.id === currentUser.id) {
      toast('Không thể xóa tài khoản đang đăng nhập.', 'warning');
      return;
    }
    const ok = await confirm({
      title: `Xóa người dùng "${user.name}"?`,
      message: (
        <>
          Tài khoản <strong className="text-slate-700">{displayIdentifier(user.email)}</strong> sẽ mất
          quyền truy cập ngay lập tức. Không thể hoàn tác.
        </>
      ),
      confirmLabel: 'Xóa người dùng',
      danger: true,
    });
    if (!ok) return;
    const { error, partial } = await deleteUser(user.id);
    if (error) {
      toast('Xóa thất bại: ' + error, 'error');
    } else if (partial) {
      // Chỉ xóa được hồ sơ — người này hết đăng nhập được, nhưng email vẫn bị giữ.
      toast(
        `Đã xóa hồ sơ của ${user.name}, người này không đăng nhập được nữa. Tài khoản gốc chưa xóa hẳn (thiếu service_role key), nên "${displayIdentifier(user.email)}" chưa dùng lại được cho tài khoản mới.`,
        'warning',
      );
    } else {
      toast('Đã xóa người dùng', 'success');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">Danh bạ nhân sự</h2>
          <p className="text-sm text-slate-500 mt-1">Quản lý hồ sơ, vai trò, phòng ban và quyền truy cập ({users.length} nhân sự)</p>
        </div>
        {/* `flex-wrap`: ba nut nay cong lai ~390px, rong hon man 375px cua
            dien thoai. Khong cho xuong dong thi chung day ca trang tran
            ngang - khung ngoai da co flex-wrap nhung cum nay thi chua. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm" aria-label="Kiểu hiển thị">
            <button type="button" onClick={() => setViewMode('grid')} aria-label="Xem dạng lưới" className={`p-2 rounded-lg transition-colors ${viewMode === 'grid' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400 hover:text-slate-700'}`}>
              <Grid2X2 className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => setViewMode('list')} aria-label="Xem dạng danh sách" className={`p-2 rounded-lg transition-colors ${viewMode === 'list' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400 hover:text-slate-700'}`}>
              <List className="w-4 h-4" />
            </button>
          </div>
          {fullAdmin && (
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <FileSpreadsheet className="w-4 h-4" />
              Import Excel
            </Button>
          )}
          <Button onClick={openCreate} theme="admin">
            <UserPlus className="w-4 h-4" />
            Thêm nhân sự
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card space-y-3">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm theo tên, mã nhân viên, quê quán, phòng ban..." className="w-full h-11 pl-10 pr-3.5 rounded-xl border border-slate-200 bg-slate-50/60 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Lọc phòng ban">
          {['Tất cả', ...departments].map((item) => (
            <button key={item} type="button" onClick={() => setDepartment(item)} className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold border transition-colors ${department === item ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:text-indigo-600'}`}>
              {item}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">Đang tải danh bạ...</div>
      ) : filtered.length === 0 ? (
        <Card><EmptyState title="Không tìm thấy nhân sự" description="Thử thay đổi từ khóa hoặc bộ lọc phòng ban." /></Card>
      ) : viewMode === 'grid' ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filtered.map((user) => (
            <article key={user.id} className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-lifted">
              <div className="flex items-start gap-3">
                <Avatar name={user.name} url={user.avatar_url} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-bold text-slate-900">{user.name}</h3>
                      <p className="mt-0.5 truncate text-xs text-slate-500">{roleLabel(user)}</p>
                    </div>
                    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${user.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${user.is_active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                      {user.is_active ? 'Hoạt động' : 'Vô hiệu'}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[11px] font-semibold text-indigo-600">{user.department || 'Chưa phân phòng ban'}</p>
                </div>
              </div>

              <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                <p className="flex items-center gap-2 truncate text-xs text-slate-500"><Mail className="h-3.5 w-3.5 shrink-0" />{displayIdentifier(user.email)}</p>
                <p className="flex items-center gap-2 truncate text-xs text-slate-500"><Phone className="h-3.5 w-3.5 shrink-0" />{user.phone || 'Chưa có số điện thoại'}</p>
              </div>

              <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
                <button type="button" onClick={() => setViewingUser(user)} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100">Xem hồ sơ</button>
                {isFullAdmin(currentUser) && (
                  <button type="button" onClick={() => openPayslip(user)} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90"><Wallet className="h-3.5 w-3.5" /> Phiếu lương</button>
                )}
              </div>
              <div className="mt-2 flex justify-end gap-1 border-t border-slate-100 pt-2">
                {canAdminister(user) && <button onClick={() => setResetTarget(user)} title="Cấp mật khẩu tạm mới" className="p-2 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"><KeyRound className="w-4 h-4" /></button>}
                {canAdminister(user) && <button onClick={() => openEdit(user)} title="Chỉnh sửa" className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50"><Edit3 className="w-4 h-4" /></button>}
                {canAdminister(user) && <button onClick={() => handleDelete(user)} title="Xóa" className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Card><CardContent className="p-0"><div className="divide-y divide-slate-100">
          {filtered.map((user) => (
            <div key={user.id} className="flex flex-col gap-3 p-4 transition-colors hover:bg-slate-50 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar name={user.name} url={user.avatar_url} size="md" />
                <div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{user.name}</p><p className="truncate text-xs text-slate-500">{displayIdentifier(user.email)}</p></div>
              </div>
              <div className="flex items-center gap-2 sm:w-48"><Building2 className="h-4 w-4 text-slate-400" /><span className="truncate text-xs text-slate-600">{user.department || 'Chưa phân phòng ban'}</span></div>
              <Badge className={roleConfig[user.role]?.color ?? 'bg-slate-100 text-slate-700'}>{user.role === 'admin' && <Shield className="w-3 h-3" />}{roleLabel(user)}</Badge>
              <span className={`text-xs font-semibold ${user.is_active ? 'text-emerald-600' : 'text-slate-400'}`}>{user.is_active ? 'Hoạt động' : 'Vô hiệu'}</span>
              <div className="flex items-center gap-1 sm:justify-end">
                <button onClick={() => setViewingUser(user)} title="Xem hồ sơ" className="p-2 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"><UserRound className="w-4 h-4" /></button>
                {canAdminister(user) && <button onClick={() => setResetTarget(user)} title="Cấp mật khẩu tạm mới" className="p-2 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"><KeyRound className="w-4 h-4" /></button>}
                {canAdminister(user) && <button onClick={() => openEdit(user)} title="Chỉnh sửa" className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50"><Edit3 className="w-4 h-4" /></button>}
                {canAdminister(user) && <button onClick={() => handleDelete(user)} title="Xóa" className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>}
              </div>
            </div>
          ))}
        </div></CardContent></Card>
      )}

      <Modal open={!!viewingUser} onClose={() => setViewingUser(null)} title="Hồ sơ nhân sự" size="xl">
        {viewingUser && (
          <div className="space-y-5">
            <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-slate-50 to-indigo-50 p-4">
              <Avatar name={viewingUser.name} url={viewingUser.avatar_url} size="lg" />
              <div className="min-w-0"><h3 className="truncate text-lg font-bold text-slate-900">{viewingUser.name}</h3><p className="text-sm text-slate-500">{viewingUser.employee_code || 'Đang cấp mã'} · {roleLabel(viewingUser)} · {viewingUser.department || 'Chưa phân phòng ban'}</p></div>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-3"><dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Tài khoản / Email</dt><dd className="mt-1 break-all text-sm font-medium text-slate-800">{displayIdentifier(viewingUser.email)}</dd></div>
              <div className="rounded-xl border border-slate-200 p-3"><dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Điện thoại</dt><dd className="mt-1 text-sm font-medium text-slate-800">{viewingUser.phone || 'Chưa cập nhật'}</dd></div>
              <div className="rounded-xl border border-slate-200 p-3"><dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Trạng thái</dt><dd className={`mt-1 text-sm font-semibold ${viewingUser.is_active ? 'text-emerald-600' : 'text-slate-500'}`}>{viewingUser.is_active ? 'Đang hoạt động' : 'Đã vô hiệu'}</dd></div>
              <div className="rounded-xl border border-slate-200 p-3"><dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Phép năm</dt><dd className="mt-1 text-sm font-medium text-slate-800">{viewingUser.annual_leave_quota} ngày</dd></div>
              <div className="rounded-xl border border-slate-200 p-3"><dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Quê quán</dt><dd className="mt-1 text-sm font-medium text-slate-800">{viewingUser.hometown || 'Chưa cập nhật'}</dd></div>
              <div className="rounded-xl border border-slate-200 p-3"><dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Nơi ở hiện tại</dt><dd className="mt-1 text-sm font-medium text-slate-800">{viewingUser.current_address || 'Chưa cập nhật'}</dd></div>
              <div className="rounded-xl border border-slate-200 p-3 sm:col-span-2"><dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Học vấn</dt><dd className="mt-1 text-sm font-medium text-slate-800">{[viewingUser.school_name, viewingUser.major, viewingUser.graduation_year].filter(Boolean).join(' · ') || 'Chưa cập nhật'}</dd></div>
            </dl>
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">Cơ cấu tổ chức</p>
              <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
                <div><p className="text-xs text-slate-500">Đơn vị</p><p className="font-semibold text-slate-800">{unitName(viewingUser.unit_id)}</p></div>
                <div><p className="text-xs text-slate-500">Vị trí</p><p className="font-semibold text-slate-800">{positionName(viewingUser.position_id)}</p></div>
                <div><p className="text-xs text-slate-500">Quản lý trực tiếp</p><p className="font-semibold text-slate-800">{managerName(viewingUser.manager_id)}</p></div>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => openOrganizationAssignment(viewingUser)} className="mt-3">
                <Building2 className="h-4 w-4" /> Mở Cơ cấu tổ chức
              </Button>
            </div>
            {currentUser && <EmployeeDocumentVault employee={viewingUser} actorId={currentUser.id} canManage={canAdminister(viewingUser)} />}
            <div className="flex flex-wrap justify-end gap-2">
              {isFullAdmin(currentUser) && <Button variant="outline" onClick={() => openPayslip(viewingUser)}><Wallet className="w-4 h-4" />Phiếu lương</Button>}
              {canAdminister(viewingUser) && <Button onClick={() => { const user = viewingUser; setViewingUser(null); openEdit(user); }}><Edit3 className="w-4 h-4" />Chỉnh sửa hồ sơ</Button>}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingUser ? 'Cập nhật hồ sơ nhân sự' : 'Thêm người dùng mới'} size={editingUser ? 'xl' : 'md'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Họ tên"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            placeholder="Nguyễn Văn A"
          />
          <Input
            label="Tên đăng nhập hoặc email"
            type="text"
            value={form.identifier}
            onChange={(e) => setForm({ ...form, identifier: e.target.value })}
            required
            disabled={!!editingUser}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="nguyenvana"
          />
          {!editingUser && (
            <>
              <div className="flex items-start gap-3 text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm leading-relaxed">
                <AtSign className="w-4.5 h-4.5 text-slate-500 flex-shrink-0 mt-0.5" />
                <span>
                  Nhập <strong>tên đăng nhập</strong> nếu nhân viên không có email — không cần hộp thư thật.
                  Nhập <strong>email thật</strong> nếu muốn liên lạc qua email sau này.
                </span>
              </div>
              <div className="flex items-start gap-3 text-blue-700 bg-blue-50 border border-blue-200 rounded-xl p-3.5 text-sm leading-relaxed">
                <KeyRound className="w-4.5 h-4.5 text-blue-600 flex-shrink-0 mt-0.5" />
                <span>
                  Hệ thống sẽ tự sinh <strong>mật khẩu tạm</strong> và hiển thị một lần sau khi tạo.
                  Nhân viên bắt buộc đổi mật khẩu ở lần đăng nhập đầu tiên.
                </span>
              </div>
            </>
          )}
          {fullAdmin ? (
            <Select
              label="Vai trò (phân quyền)"
              value={form.access_role_code}
              onChange={(e) => selectAccessRole(e.target.value)}
            >
              {(accessRoles.length ? accessRoles : fallbackAccessRoles).map((role) => (
                <option key={role.code} value={role.code}>{role.name}</option>
              ))}
            </Select>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              Tài khoản được ủy quyền chỉ có thể tạo và cập nhật <strong>Nhân viên</strong>. Admin/CEO quản lý vai trò và quyền truy cập.
            </div>
          )}
          <Input
            label={editingUser?.unit_id ? 'Phòng ban (theo cơ cấu)' : 'Phòng ban tạm thời'}
            value={editingUser?.unit_id ? unitName(editingUser.unit_id) : form.department}
            onChange={(e) => setForm({ ...form, department: e.target.value })}
            disabled={!!editingUser?.unit_id}
            placeholder="Sẽ đồng bộ sau khi gán cơ cấu"
          />
          {!editingUser?.unit_id && <p className="-mt-2 text-xs text-slate-500">Phòng ban chính thức được lấy từ Cơ cấu tổ chức → Phân công nhân sự.</p>}

          {editingUser && <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
            <div><p className="text-sm font-bold text-slate-800">Thông tin cá nhân & học vấn</p><p className="mt-0.5 text-xs text-slate-500">HR cập nhật tại một nơi; dữ liệu được dùng lại cho các nghiệp vụ nhân sự.</p></div>
            <div className="grid gap-4 sm:grid-cols-2"><div>
                <Input
                  label="Mã nhân viên"
                  value={fullAdmin ? form.employee_code : (editingUser.employee_code || 'Hệ thống tự cấp')}
                  onChange={fullAdmin ? (e) => setForm({ ...form, employee_code: e.target.value }) : undefined}
                  disabled={!fullAdmin}
                  placeholder={fullAdmin ? 'Để trống nếu chưa cấp mã' : undefined}
                />
                {fullAdmin && <p className="mt-1.5 text-xs text-slate-500">Đặt trùng mã trên máy chấm công thì ngày công tự khớp về đúng người, khỏi khai ánh xạ.</p>}
              </div><Input label="Số điện thoại" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /><Input label="Quê quán" value={form.hometown} onChange={(e) => setForm({ ...form, hometown: e.target.value })} /><Input label="Nơi ở hiện tại" value={form.current_address} onChange={(e) => setForm({ ...form, current_address: e.target.value })} /></div>
            <Input label="Địa chỉ thường trú" value={form.permanent_address} onChange={(e) => setForm({ ...form, permanent_address: e.target.value })} />
            <div className="grid gap-4 sm:grid-cols-2"><Select label="Trình độ học vấn" value={form.education_level || ''} onChange={(e) => setForm({ ...form, education_level: e.target.value as Profile['education_level'] | '' })}><option value="">Chưa cập nhật</option><option value="HIGH_SCHOOL">THPT</option><option value="VOCATIONAL">Trung cấp / Nghề</option><option value="COLLEGE">Cao đẳng</option><option value="UNIVERSITY">Đại học</option><option value="POSTGRADUATE">Sau đại học</option><option value="OTHER">Khác</option></Select><Input label="Trường / Cơ sở đào tạo" value={form.school_name} onChange={(e) => setForm({ ...form, school_name: e.target.value })} /><Input label="Chuyên ngành" value={form.major} onChange={(e) => setForm({ ...form, major: e.target.value })} /><Input label="Năm tốt nghiệp" type="number" min="1950" max="2100" value={form.graduation_year} onChange={(e) => setForm({ ...form, graduation_year: e.target.value })} /></div>
          </div>}

          {editingUser ? (
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Cơ cấu tổ chức & tuyến quản lý</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    Đây là dữ liệu dùng chung với module Cơ cấu tổ chức. Chỉnh tại một nơi để chấm công,
                    phê duyệt và báo cáo không bị lệch dữ liệu.
                  </p>
                </div>
                <Building2 className="h-5 w-5 shrink-0 text-indigo-500" />
              </div>
              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                <div className="rounded-xl bg-white/80 p-2.5"><dt className="text-slate-400">Đơn vị</dt><dd className="mt-0.5 font-semibold text-slate-700">{unitName(editingUser.unit_id)}</dd></div>
                <div className="rounded-xl bg-white/80 p-2.5"><dt className="text-slate-400">Vị trí</dt><dd className="mt-0.5 font-semibold text-slate-700">{positionName(editingUser.position_id)}</dd></div>
                <div className="rounded-xl bg-white/80 p-2.5"><dt className="text-slate-400">Quản lý trực tiếp</dt><dd className="mt-0.5 font-semibold text-slate-700">{managerName(editingUser.manager_id)}</dd></div>
              </dl>
              <Button type="button" variant="outline" size="sm" onClick={() => openOrganizationAssignment(editingUser)} className="mt-3">
                <Building2 className="h-4 w-4" /> Mở phân công trong Cơ cấu tổ chức
              </Button>
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-sm leading-relaxed text-slate-600">
              <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
              <span>Sau khi tạo tài khoản, hãy mở <strong>Cơ cấu tổ chức → Phân công nhân sự</strong> để gán đơn vị, vị trí và quản lý trực tiếp. Đây là luồng chuẩn duy nhất cho dữ liệu tổ chức.</span>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Quyền vào khu quản trị
            </label>
            <p className="mb-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">
              Quyền hiệu lực được tổng hợp từ <strong>vai trò nghiệp vụ</strong>, <strong>mẫu quyền theo vị trí</strong> trong Cơ cấu tổ chức và quyền lẻ (nếu có). Không cần cấp trùng ở nhiều nơi.
            </p>
            {editingUser && (
              <div className="mb-3">
                <EffectivePermissions profile={editingUser} />
              </div>
            )}
            <StaffFunctionSummary />
            {form.access_role_code === 'teamlead' ? (
              <div className="flex items-start gap-3 text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-sm leading-relaxed">
                <ShieldCheck className="w-4.5 h-4.5 text-amber-600 flex-shrink-0 mt-0.5" />
                <span>
                  <strong>Trưởng nhóm</strong> quản lý thành viên, giao việc và theo dõi nghỉ phép
                  phép / ca — <strong>chỉ trong dự án được giao làm lead</strong>. Sau khi tạo, hãy vào
                  trang <strong>Quản lý Dự án</strong> để chỉ định họ làm trưởng nhóm của dự án.
                </span>
              </div>
            ) : selectedAccessRole && form.access_role_code !== 'staff' ? (
              <div className="flex items-start gap-3 text-blue-700 bg-blue-50 border border-blue-200 rounded-xl p-3.5 text-sm leading-relaxed">
                <ShieldCheck className="w-4.5 h-4.5 text-blue-600 flex-shrink-0 mt-0.5" />
                <span>
                  Vai trò <strong>{selectedAccessRole.name}</strong> được cấp sẵn:{' '}
                  {selectedAccessRole.permissions.length
                    ? selectedAccessRole.permissions.map((permission) => PERMISSION_LABELS[permission as AdminPermission]?.label ?? permission).join(', ')
                    : 'chỉ khu nhân viên'}.
                  {' '}Có thể chỉnh mẫu quyền tại <strong>Cấu hình hệ thống</strong>.
                  {selectedAccessRole.permissions.length > 0 && <span className="mt-1 block text-xs text-blue-600">Bao phủ {selectedAccessRole.permissions.reduce((total, permission) => total + (PERMISSION_FUNCTIONS[permission as AdminPermission]?.length || 0), 0)} chức năng module và {(selectedAccessRole.function_permissions || []).length} chức năng nâng cao đã gán.</span>}
                </span>
              </div>
            ) : fullAdmin ? (
              // Quyen den tu VI TRI trong Co cau to chuc, khong cap le o day.
              //
              // Truoc day man nay co 7 o tich quyen, dung bo quyen ma mau
              // quyen theo vi tri da cap. Hai cho cung cap mot quyen thi go o
              // mot cho khong go duoc quyen do - nguoi go tuong xong roi ma
              // thuc te van con. Gio chi con MOT cho cap: vi tri.
              <div className="space-y-3">
                <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
                  <p className="flex items-start gap-2 text-xs leading-relaxed text-indigo-900">
                    <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-600" />
                    <span>
                      Quyền quản trị cấp theo <strong>vị trí</strong>, không cấp riêng cho từng
                      tài khoản. Gán người này vào một vị trí ở{' '}
                      <strong>Cơ cấu tổ chức → Phân công nhân sự</strong>, và đặt quyền cho vị
                      trí đó ở <strong>Cơ cấu tổ chức → Vị trí</strong>.
                    </span>
                  </p>
                  {editingUser && (
                    <p className="mt-2 border-t border-indigo-200/70 pt-2 text-xs text-indigo-800">
                      Vị trí hiện tại:{' '}
                      <strong>{positionName(editingUser.position_id)}</strong>
                      {' · '}
                      <Link to={`/admin/organization?tab=positions&company=${editingUser.unit_id ?? ''}`} className="underline">
                        Mở Cơ cấu tổ chức
                      </Link>
                    </p>
                  )}
                </div>

                {/* Quyen le cap trong ban cu: van con hieu luc nen phai HIEN
                    RA cho go duoc, thay vi an di roi de no am tham cap quyen
                    ma khong man hinh nao noi toi. */}
                {form.permissions.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <p className="flex items-start gap-2 text-xs leading-relaxed text-amber-900">
                      <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                      <span>
                        Tài khoản này còn <strong>{form.permissions.length} quyền lẻ</strong> cấp
                        từ bản cũ:{' '}
                        {form.permissions.map((permission) => PERMISSION_LABELS[permission].label).join(', ')}.
                        Chúng vẫn đang có hiệu lực. Chuyển các quyền này sang vị trí rồi gỡ đi để
                        chỉ còn một nơi cấp quyền.
                      </span>
                    </p>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, permissions: [] })}
                      className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-800 transition hover:bg-amber-100"
                    >
                      Gỡ hết quyền lẻ
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
                Không cấp quyền quản trị cho tài khoản mới. Admin/CEO có thể bổ sung quyền sau.
              </p>
            )}
          </div>

          {editingUser && currentUser && editingUser.id === currentUser.id && (
            <div className="flex items-start gap-3 text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-sm leading-relaxed">
              <ShieldAlert className="w-4.5 h-4.5 text-amber-600 flex-shrink-0 mt-0.5" />
              <span>
                Đây là tài khoản bạn đang đăng nhập. Không thể tự đổi vai trò hoặc quyền của
                chính mình — nhờ một quản trị viên khác thực hiện.
              </span>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)} className="flex-1">Hủy</Button>
            <Button type="submit" disabled={submitting} theme="admin" className="flex-1">
              {submitting ? 'Đang lưu...' : editingUser ? 'Lưu thay đổi' : 'Tạo mới'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
        title={`Cấp mật khẩu tạm - ${resetTarget?.name || ''}`}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm leading-relaxed">
            <ShieldAlert className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-0.5">Mật khẩu hiện tại sẽ bị vô hiệu ngay lập tức</p>
              <p className="text-amber-600">
                Hệ thống sinh một mật khẩu tạm mới cho <strong>{displayIdentifier(resetTarget?.email ?? '')}</strong> và
                hiển thị một lần để bạn bàn giao. Người dùng phải đổi mật khẩu ở lần đăng nhập kế tiếp.
              </p>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setResetTarget(null)} className="flex-1">Hủy</Button>
            <Button type="button" onClick={handleResetPassword} disabled={submitting} theme="admin" className="flex-1">
              {submitting ? 'Đang xử lý...' : 'Cấp mật khẩu tạm'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!issued}
        onClose={() => setIssued(null)}
        title={issued?.kind === 'create' ? 'Tài khoản đã được tạo' : 'Đã cấp mật khẩu tạm mới'}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm leading-relaxed">
            <ShieldAlert className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <span>
              Mật khẩu này chỉ hiển thị <strong>một lần duy nhất</strong>. Hãy copy và gửi cho{' '}
              <strong>{issued?.name}</strong> qua kênh liên lạc an toàn trước khi đóng cửa sổ này.
            </span>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 divide-y divide-slate-200">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                {issued && isInternalEmail(issued.email) ? 'Tên đăng nhập' : 'Email'}
              </span>
              <span className="text-sm font-medium text-slate-800 break-all">
                {displayIdentifier(issued?.email ?? '')}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Mật khẩu tạm</span>
              <span className="text-base font-mono font-semibold text-slate-900 tracking-wide">
                {issued?.tempPassword}
              </span>
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <Button type="button" variant="outline" onClick={copyCredential} className="flex-1">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Đã copy' : 'Copy thông tin'}
            </Button>
            <Button type="button" onClick={() => setIssued(null)} theme="admin" className="flex-1">
              Đã bàn giao xong
            </Button>
          </div>
        </div>
      </Modal>

      <EmployeeImportModal
        open={importOpen}
        profiles={users}
        onClose={() => setImportOpen(false)}
        onImported={() => void loadUsers()}
      />
    </div>
  );
}
