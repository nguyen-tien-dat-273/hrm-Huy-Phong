import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Building2, BriefcaseBusiness, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, LayoutGrid, List, Network, Pencil, Plus, Search,
  ShieldCheck, Trash2, UserCog, UsersRound,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { Avatar } from '@/components/ui/Avatar';
import { OrgChart } from '@/components/org/OrgChart';
import { PositionChart } from '@/components/org/PositionChart';
import { PermissionFunctionList } from '@/components/PermissionFunctionList';
import { StaffFunctionSummary } from '@/components/StaffFunctionSummary';
import { FunctionPermissionPicker } from '@/components/FunctionPermissionPicker';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { ADMIN_FUNCTIONS, ADMIN_PERMISSIONS, PERMISSION_LABELS, isFullAdmin, type AdminFunctionCode, type AdminPermission } from '@/lib/permissions';
import type {
  EmploymentStatus, JobPosition, OrganizationUnit, OrganizationUnitType, Profile,
} from '@/types';

const UNIT_TYPES: Record<OrganizationUnitType, string> = {
  group: 'Tập đoàn/Nhóm',
  company: 'Pháp nhân/Công ty',
  branch: 'Chi nhánh',
  department: 'Phòng ban',
  team: 'Bộ phận/Nhóm',
};

const EMPLOYMENT_STATUSES: Record<EmploymentStatus, string> = {
  onboarding: 'Đang tiếp nhận',
  probation: 'Thử việc',
  active: 'Chính thức',
  suspended: 'Tạm hoãn',
  terminated: 'Đã nghỉ việc',
};

type Tab = 'units' | 'positions' | 'assignments';
/** Cùng một cây, hai cách nhìn: 'chart' để thấy hình dạng bộ máy, 'list' để
 *  thao tác nhanh trên nhiều đơn vị. Không tách thành hai tab riêng vì cả hai
 *  đều dùng chung bộ lọc, ô tìm kiếm và panel chi tiết bên phải. */
type UnitView = 'chart' | 'list';

/** Sinh ma vi tri tu ten, de nguoi khai khong phai tu nghi ra ma. */
function positionCodeFrom(title: string, taken: string[]): string {
  const base = title
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 30) || 'VI-TRI';
  if (!taken.includes(base)) return base;
  for (let i = 2; i < 100; i += 1) {
    if (!taken.includes(`${base}-${i}`)) return `${base}-${i}`;
  }
  return `${base}-${Date.now().toString().slice(-4)}`;
}

export function AdminOrganization() {
  const { profile, users, loadUsers } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [units, setUnits] = useState<OrganizationUnit[]>([]);
  const [positions, setPositions] = useState<JobPosition[]>([]);
  const [positionPermissions, setPositionPermissions] = useState<Record<string, string[]>>({});
  /** unit_id -> danh sach nguoi phu trach, nguoi chinh dung dau. */
  const [unitManagers, setUnitManagers] = useState<Record<string, string[]>>({});
  const [positionFunctionPermissions, setPositionFunctionPermissions] = useState<Record<string, string[]>>({});
  const [positionPermissionsSupported, setPositionPermissionsSupported] = useState(true);
  const [positionFunctionPermissionsSupported, setPositionFunctionPermissionsSupported] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => {
    const requested = searchParams.get('tab');
    return requested === 'positions' || requested === 'assignments' ? requested : 'units';
  });
  const [search, setSearch] = useState('');
  const [unitModal, setUnitModal] = useState(false);
  const [positionModal, setPositionModal] = useState(false);
  const [editingUnit, setEditingUnit] = useState<OrganizationUnit | null>(null);
  const [editingPosition, setEditingPosition] = useState<JobPosition | null>(null);
  const [assignmentModal, setAssignmentModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [unitScope, setUnitScope] = useState<'all' | 'attention'>('all');
  /** An don vi da ngung hoat dong khoi so do. Mac dinh HIEN, vi giau di mot don
      vi vua bam xoa se lam nguoi dung tuong no da mat han. */
  const [hideInactive, setHideInactive] = useState(false);
  const [unitView, setUnitView] = useState<UnitView>('chart');
  /** Tab Vị trí cũng có hai kiểu xem: tuyến báo cáo, hoặc danh sách phẳng. */
  const [positionView, setPositionView] = useState<UnitView>('chart');
  /**
   * Doanh nghiệp đang mở. Giữ trong URL để tải lại trang hay gửi link cho
   * người khác vẫn vào đúng doanh nghiệp đó, thay vì luôn nhảy về cái đầu.
   */
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(
    () => searchParams.get('company'),
  );
  const [collapsedUnits, setCollapsedUnits] = useState<Set<string>>(new Set());
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [unitForm, setUnitForm] = useState({
    code: '', name: '', unit_type: 'department' as OrganizationUnitType, parent_id: '',
    /** Nguoi phu trach. Phan tu DAU TIEN la nguoi phu trach chinh. */
    manager_ids: [] as string[],
    /** Vi tri tao moi ngay trong form nay, de khoi phai sang tab Vi tri. */
    new_positions: [] as { code: string; title: string; permissions: AdminPermission[] }[],
    /**
     * Dua luon nguoi phu trach vao lam THANH VIEN cua don vi.
     *
     * Dat nguoi phu trach chi ghi `manager_id`, khong dat `profiles.unit_id`.
     * Hai thu khac nhau that, nhung trong dau nguoi dung thi "da gan vao so
     * do" la xong - roi sang Co che luong thay don vi bao 0 nguoi va khong
     * hieu vi sao. O nay lam ca hai viec trong mot lan bam.
     */
    move_managers_in: false,
  });
  /** Bang noi organization_unit_managers da ton tai chua. */
  const [multiManagerSupported, setMultiManagerSupported] = useState(true);
  const [positionForm, setPositionForm] = useState({ code: '', title: '', unit_id: '', reports_to_position_id: '', is_manager: false, permissions: [] as string[], function_permissions: [] as AdminFunctionCode[] });
  const [assignmentForm, setAssignmentForm] = useState({ user_id: '', employee_code: '', unit_id: '', position_id: '', manager_id: '', hire_date: '', employment_status: 'active' as EmploymentStatus });

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    const [unitResult, positionResult, positionPermissionResult, positionFunctionResult, managerResult] = await Promise.all([
      supabase.from('organization_units').select('*').order('name'),
      supabase.from('job_positions').select('*').order('title'),
      supabase.from('job_position_permissions').select('position_id,permission_code'),
      supabase.from('job_position_function_permissions').select('position_id,function_code'),
      supabase.from('organization_unit_managers').select('unit_id,user_id,is_primary'),
    ]);
    const error = unitResult.error || positionResult.error;
    setLoadError(error ? describeDbError(error) : null);
    setUnits((unitResult.data || []) as OrganizationUnit[]);
    const permissionMap: Record<string, string[]> = {};
    for (const item of (positionPermissionResult.data || []) as { position_id: string; permission_code: string }[]) {
      permissionMap[item.position_id] = [...(permissionMap[item.position_id] || []), item.permission_code];
    }
    setPositionPermissions(permissionMap);
    const functionPermissionMap: Record<string, string[]> = {};
    for (const item of (positionFunctionResult.data || []) as { position_id: string; function_code: string }[]) {
      functionPermissionMap[item.position_id] = [...(functionPermissionMap[item.position_id] || []), item.function_code];
    }
    setPositionFunctionPermissions(functionPermissionMap);
    setPositionPermissionsSupported(!positionPermissionResult.error);
    setPositionFunctionPermissionsSupported(!positionFunctionResult.error);
    setPositions(((positionResult.data || []) as JobPosition[]).map((position) => ({ ...position, permissions: permissionMap[position.id] || [] })));

    // Chua chay migration 20261001100000 thi lui ve mot nguoi phu trach duy
    // nhat doc tu `manager_id`, phan con lai cua trang chay nhu cu.
    setMultiManagerSupported(!managerResult.error);
    const managerMap: Record<string, string[]> = {};
    if (managerResult.error) {
      for (const unit of (unitResult.data || []) as OrganizationUnit[]) {
        if (unit.manager_id) managerMap[unit.id] = [unit.manager_id];
      }
    } else {
      const rows = (managerResult.data || []) as { unit_id: string; user_id: string; is_primary: boolean }[];
      // Nguoi phu trach CHINH dung dau: ca form lan cho hien thi deu lay
      // phan tu dau tien lam nguoi dai dien.
      for (const row of [...rows].sort((a, b) => Number(b.is_primary) - Number(a.is_primary))) {
        managerMap[row.unit_id] = [...(managerMap[row.unit_id] || []), row.user_id];
      }
    }
    setUnitManagers(managerMap);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);
  useRealtimeSync([{ table: 'organization_units' }, { table: 'job_positions' }, { table: 'job_position_permissions' }, { table: 'job_position_function_permissions' }, { table: 'profiles' }], () => {
    void load(true);
    void loadUsers();
  }, { channelKey: 'organization-structure' });

  const unitById = useMemo(() => new Map(units.map((unit) => [unit.id, unit])), [units]);
  const positionById = useMemo(() => new Map(positions.map((position) => [position.id, position])), [positions]);
  const userById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const keyword = search.trim().toLowerCase();


  const unitDepth = (unit: OrganizationUnit) => {
    let depth = 0;
    let parent = unit.parent_id;
    const visited = new Set<string>();
    while (parent && !visited.has(parent) && depth < 5) {
      visited.add(parent);
      depth += 1;
      parent = unitById.get(parent)?.parent_id || null;
    }
    return depth;
  };

  const positionCountByUnit = useMemo(() => {
    const counts = new Map<string, number>();
    positions.forEach((position) => counts.set(position.unit_id, (counts.get(position.unit_id) || 0) + 1));
    return counts;
  }, [positions]);
  const employeeCountByUnit = useMemo(() => {
    const counts = new Map<string, number>();
    users.forEach((user) => {
      if (user.unit_id) counts.set(user.unit_id, (counts.get(user.unit_id) || 0) + 1);
    });
    return counts;
  }, [users]);
  const childUnitsByParent = useMemo(() => {
    const children = new Map<string | null, OrganizationUnit[]>();
    units.forEach((unit) => {
      const parentId = unit.parent_id && unitById.has(unit.parent_id) ? unit.parent_id : null;
      const group = children.get(parentId) || [];
      group.push(unit);
      children.set(parentId, group);
    });
    children.forEach((group) => group.sort((a, b) => a.name.localeCompare(b.name, 'vi')));
    return children;
  }, [units, unitById]);
  const attentionUnitIds = useMemo(() => new Set(units
    .filter((unit) => !unit.manager_id || !unit.is_active || (positionCountByUnit.get(unit.id) || 0) === 0)
    .map((unit) => unit.id)), [units, positionCountByUnit]);

  /**
   * Doanh nghiệp = đơn vị ở cấp gốc.
   *
   * Cố ý KHÔNG lọc theo `unit_type in ('group','company')`. Dữ liệu thật hay có
   * đơn vị gốc khai nhầm loại (Huy Phong Group đang khai là "Phòng ban"), lọc
   * cứng theo loại sẽ làm cả trang trống trơn mà không nói vì sao. Thay vào đó
   * nhận mọi đơn vị gốc rồi nhắc riêng cái nào khai sai loại.
   */
  /**
   * Doanh nghiep = don vi goc VA khai dung loai phap nhan.
   *
   * Truoc day moi don vi goc deu duoc coi la doanh nghiep, nen mot phong ban
   * tao thieu don vi cha se hien ngang hang voi Huy Phong Group - nhin vao
   * tuong cong ty co ba phap nhan. Nhung cung khong loc bo chung di: an mot
   * don vi khoi man hinh duy nhat quan ly no thi khong con duong nao sua.
   */
  const rootUnits = useMemo(() => childUnitsByParent.get(null) || [], [childUnitsByParent]);

  const companies = useMemo(
    () => rootUnits.filter((unit) => unit.unit_type === 'company' || unit.unit_type === 'group'),
    [rootUnits],
  );

  /** Don vi goc nhung khong phai phap nhan: hoac tao thieu cha, hoac khai nham loai. */
  const orphanUnits = useMemo(
    () => rootUnits.filter((unit) => unit.unit_type !== 'company' && unit.unit_type !== 'group'),
    [rootUnits],
  );

  /**
   * Chưa bấm chọn thì KHÔNG có doanh nghiệp nào đang mở.
   *
   * Trước đây tự rơi về doanh nghiệp đầu tiên, nên sơ đồ hiện ngay và người
   * dùng không nhận ra mình đang nhìn cây của ai — nguy hiểm khi có nhiều
   * pháp nhân, vì thao tác thêm/sửa sẽ rơi vào đơn vị mình không định chọn.
   */
  const activeCompany = useMemo(
    () => companies.find((unit) => unit.id === activeCompanyId) ?? null,
    [companies, activeCompanyId],
  );

  /**
   * Các đơn vị BÊN TRONG doanh nghiệp đang mở — không tính chính nó.
   *
   * Tên doanh nghiệp đã nằm ở dòng định vị phía trên, nên vẽ lại nó thành một
   * ô trong sơ đồ chỉ đẩy cả cây xuống một tầng mà không thêm thông tin gì.
   * Bộ đếm và danh sách cũng theo cùng phạm vi để con số khớp với thứ đang
   * hiện trên màn.
   */
  const unitIdsInCompany = useMemo(() => {
    const result = new Set<string>();
    if (!activeCompany) return result;
    const walk = (unit: OrganizationUnit) => {
      if (result.has(unit.id)) return;
      result.add(unit.id);
      (childUnitsByParent.get(unit.id) || []).forEach(walk);
    };
    (childUnitsByParent.get(activeCompany.id) || []).forEach(walk);
    return result;
  }, [activeCompany, childUnitsByParent]);

  /**
   * Ba tab deu nam BEN TRONG doanh nghiep dang mo.
   *
   * Truoc day Vi tri va Phan cong nhan su la danh sach phang toan he thong:
   * dang dung trong Huy Phong Group van thay vi tri cua phap nhan khac, va
   * nut "Them vi tri" thi mac dinh gan vao don vi dau tien tim duoc. Voi
   * nhieu phap nhan, do la duong dan thang toi viec khai nham cong ty.
   */
  const scopedUnitIds = useMemo(() => {
    // Ke ca chinh don vi goc: vi tri cap cong ty (Giam doc, Marketing...)
    // gan thang vao phap nhan chu khong vao phong ban nao.
    const result = new Set(unitIdsInCompany);
    if (activeCompany) result.add(activeCompany.id);
    return result;
  }, [unitIdsInCompany, activeCompany]);

  const visiblePositions = positions.filter((position) => scopedUnitIds.has(position.unit_id)).filter((position) => !keyword
    || position.title.toLowerCase().includes(keyword)
    || position.code.toLowerCase().includes(keyword)
    || (unitById.get(position.unit_id)?.name || '').toLowerCase().includes(keyword));
  const visibleUsers = users.filter((user) => !!user.unit_id && scopedUnitIds.has(user.unit_id)).filter((user) => !keyword
    || user.name.toLowerCase().includes(keyword)
    || (user.employee_code || '').toLowerCase().includes(keyword)
    || (unitById.get(user.unit_id || '')?.name || user.department || '').toLowerCase().includes(keyword));

  /**
   * Chua chon doanh nghiep thi chi co mot man: danh sach doanh nghiep. Giu
   * `tab` nguyen trong state de bam vao lai van tro ve dung tab cu.
   */
  const effectiveTab: Tab = activeCompany ? tab : 'units';

  // Cac o chon trong modal cung chi liet ke don vi/vi tri CUA doanh nghiep
  // dang mo, de khong the gan nham mot vi tri sang phap nhan khac.
  /**
   * Danh sách đơn vị cho ô chọn, xếp theo CÂY chứ không theo bảng chữ cái.
   *
   * Danh sách phẳng xếp theo tên không cho biết cái nào nằm trong cái nào:
   * "giám đốc" và "Huy Phong Group" hiện ngang nhau trong khi cái trước là
   * con của cái sau. Người chọn không có cách nào biết mình đang gắn vị trí
   * vào cấp nào, và đó chính là thứ duy nhất ô này quyết định.
   */
  const unitOptions = useMemo(() => {
    const rows: { unit: OrganizationUnit; depth: number }[] = [];
    const walk = (unit: OrganizationUnit, depth: number) => {
      if (!unit.is_active || !scopedUnitIds.has(unit.id)) return;
      rows.push({ unit, depth });
      (childUnitsByParent.get(unit.id) || []).forEach((child) => walk(child, depth + 1));
    };
    if (activeCompany) walk(activeCompany, 0);
    return rows;
  }, [activeCompany, childUnitsByParent, scopedUnitIds]);

  /** Thụt đầu dòng bằng khoảng trắng cứng — thẻ <option> không nhận CSS padding. */
  const unitOptionLabel = (row: { unit: OrganizationUnit; depth: number }) =>
    `${'\u00a0\u00a0\u00a0\u00a0'.repeat(row.depth)}${row.depth > 0 ? '└ ' : ''}${row.unit.name}`;
  const companyPositions = positions.filter((position) => scopedUnitIds.has(position.unit_id));

  const companyHeadcount = (unit: OrganizationUnit) => {
    let total = 0;
    const walk = (node: OrganizationUnit) => {
      total += employeeCountByUnit.get(node.id) || 0;
      (childUnitsByParent.get(node.id) || []).forEach(walk);
    };
    walk(unit);
    return total;
  };

  const includedUnitIds = useMemo(() => {
    const directMatches = new Set(units.filter((unit) => {
      const managerName = unit.manager_id ? userById.get(unit.manager_id)?.name || '' : '';
      const matchesKeyword = !keyword
        || unit.name.toLowerCase().includes(keyword)
        || unit.code.toLowerCase().includes(keyword)
        || UNIT_TYPES[unit.unit_type].toLowerCase().includes(keyword)
        || managerName.toLowerCase().includes(keyword);
      if (hideInactive && !unit.is_active) return false;
      return matchesKeyword && (unitScope === 'all' || attentionUnitIds.has(unit.id));
    }).map((unit) => unit.id));
    const withAncestors = new Set(directMatches);
    directMatches.forEach((unitId) => {
      let parentId = unitById.get(unitId)?.parent_id;
      const visited = new Set<string>();
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        withAncestors.add(parentId);
        parentId = unitById.get(parentId)?.parent_id;
      }
    });
    return withAncestors;
  }, [units, keyword, unitScope, attentionUnitIds, unitById, userById, hideInactive]);

  const orderedUnits = useMemo(() => {
    const result: OrganizationUnit[] = [];
    const visited = new Set<string>();
    const visit = (unit: OrganizationUnit) => {
      if (visited.has(unit.id) || !includedUnitIds.has(unit.id)) return;
      if (!unitIdsInCompany.has(unit.id)) return;
      visited.add(unit.id);
      result.push(unit);
      if (!collapsedUnits.has(unit.id) || keyword) {
        (childUnitsByParent.get(unit.id) || []).forEach(visit);
      }
    };
    (childUnitsByParent.get(null) || []).forEach(visit);
    units.forEach(visit);
    return result;
  }, [units, childUnitsByParent, includedUnitIds, collapsedUnits, keyword, unitIdsInCompany]);
  const chartTree = useMemo(() => {
    const visited = new Set<string>();
    const childrenById = new Map<string, OrganizationUnit[]>();
    const keep = (list: OrganizationUnit[]) => list.filter((unit) => includedUnitIds.has(unit.id));

    const visit = (unit: OrganizationUnit): boolean => {
      if (visited.has(unit.id)) return false;
      visited.add(unit.id);
      childrenById.set(unit.id, keep(childUnitsByParent.get(unit.id) || []).filter(visit));
      return true;
    };

    const roots = keep(activeCompany ? childUnitsByParent.get(activeCompany.id) || [] : []).filter(visit);
    return { roots, childrenById };
  }, [childUnitsByParent, includedUnitIds, activeCompany]);

  const selectedUnit = (() => {
    const picked = selectedUnitId ? unitById.get(selectedUnitId) : undefined;
    if (picked && unitIdsInCompany.has(picked.id)) return picked;
    // Không chọn gì thì lấy đơn vị đầu tiên trong doanh nghiệp. Doanh nghiệp
    // rỗng thì trả undefined để panel biến mất, nhường cả bề ngang cho ô trống.
    return orderedUnits[0];
  })();

  const saveUnit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    const payload = {
      code: unitForm.code.trim().toUpperCase(),
      name: unitForm.name.trim(),
      unit_type: unitForm.unit_type,
      parent_id: unitForm.parent_id || null,
      // Nguoi dau danh sach la nguoi phu trach chinh. Cot nay van duoc giu
      // dong bo vi so do to chuc va ham RLS `manages_employee` deu doc no.
      manager_id: unitForm.manager_ids[0] || null,
    };
    const result = editingUnit
      ? await supabase.from('organization_units').update(payload).eq('id', editingUnit.id).select('id').maybeSingle()
      : await supabase.from('organization_units').insert(payload).select('id').maybeSingle();
    const error = result.error;
    if (error) { setSubmitting(false); return toast('Không tạo được đơn vị: ' + describeDbError(error), 'error'); }

    // Gan vi tri vao don vi ngay trong form nay.
    //
    // `job_positions.unit_id` la mot cot BEN VI TRI, nen doi chu so huu cua
    // mot vi tri chinh la ghi lai cot do. Lam o day de khoi phai sang tab Vi
    // tri sua tung cai mot - noi ma nguoi dung khong co ly do gi de doan la
    // phai vao.
    const unitId = result.data?.id ?? editingUnit?.id ?? null;

    // --- Nguoi phu trach ---------------------------------------------------
    if (unitId && multiManagerSupported) {
      const { error: wipeError } = await supabase
        .from('organization_unit_managers').delete().eq('unit_id', unitId);
      if (!wipeError && unitForm.manager_ids.length > 0) {
        const { error: addError } = await supabase.from('organization_unit_managers').insert(
          unitForm.manager_ids.map((userId, index) => ({
            unit_id: unitId, user_id: userId, is_primary: index === 0,
          })),
        );
        if (addError) {
          setSubmitting(false);
          return toast('Đã lưu đơn vị nhưng không lưu được người phụ trách: ' + describeDbError(addError), 'error');
        }
      }
    }

    // --- Dua nguoi phu trach vao lam thanh vien ----------------------------
    // Goi lai RPC phan cong voi DUNG gia tri hien co cua tung nguoi, chi doi
    // don vi. RPC nay ghi de moi truong, nen truyen null cho vi tri hay ngay
    // vao lam la xoa mat du lieu that cua ho.
    if (unitId && unitForm.move_managers_in) {
      const moving = unitForm.manager_ids
        .map((id) => users.find((user) => user.id === id))
        .filter((user): user is Profile => !!user && user.unit_id !== unitId);

      for (const person of moving) {
        const { error: moveError } = await supabase.rpc('assign_employee_organization', {
          target_user: person.id,
          target_employee_code: person.employee_code || null,
          target_unit: unitId,
          // Vi tri cu thuoc don vi KHAC thi bo di, neu khong nguoi nay se
          // dung don vi moi ma giu chuc danh cua phong cu.
          target_position: positions.find((item) => item.id === person.position_id)?.unit_id === unitId
            ? person.position_id : null,
          target_manager: person.manager_id || null,
          target_hire_date: person.hire_date || null,
          target_employment_status: person.employment_status || 'active',
        });
        if (moveError) {
          setSubmitting(false);
          return toast('Đã lưu đơn vị nhưng không đưa được người phụ trách vào: ' + describeDbError(moveError), 'error');
        }
      }
      if (moving.length > 0) {
        toast(`Đã đưa ${moving.length} người phụ trách vào ${payload.name}.`, 'success');
      }
    }

    // --- Vi tri tao moi ngay trong form ------------------------------------
    if (unitId) {
      const fresh = unitForm.new_positions
        .map((item) => ({
          code: item.code.trim().toUpperCase() || positionCodeFrom(item.title, positions.map((entry) => entry.code)),
          title: item.title.trim(),
          permissions: item.permissions,
        }))
        .filter((item) => item.title.length > 1);

      if (fresh.length > 0) {
        // `select()` de lay lai id: quyen cua vi tri nam o bang khac, khong
        // co id thi khong gan quyen duoc.
        const { data: created, error: posError } = await supabase.from('job_positions').insert(
          fresh.map((item) => ({
            code: item.code,
            title: item.title,
            unit_id: unitId,
            is_manager: false,
            is_active: true,
          })),
        ).select('id, code');

        if (posError) {
          setSubmitting(false);
          return toast('Đã lưu đơn vị nhưng không tạo được vị trí: ' + describeDbError(posError), 'error');
        }

        const rows = (created || []) as { id: string; code: string }[];
        const grants = fresh.flatMap((item) => {
          const id = rows.find((row) => row.code === item.code)?.id;
          if (!id) return [];
          return item.permissions.map((permission) => ({ position_id: id, permission_code: permission }));
        });
        if (grants.length > 0 && positionPermissionsSupported) {
          const { error: grantError } = await supabase.from('job_position_permissions').insert(grants);
          if (grantError) {
            setSubmitting(false);
            return toast('Đã tạo vị trí nhưng không gán được quyền: ' + describeDbError(grantError), 'error');
          }
        }
      }
    }


    setSubmitting(false);
    toast(editingUnit ? 'Đã cập nhật đơn vị.' : 'Đã thêm đơn vị vào cơ cấu tổ chức.', 'success');
    setUnitModal(false);
    setEditingUnit(null);
    setUnitForm({ code: '', name: '', unit_type: 'department', parent_id: '', manager_ids: [], new_positions: [], move_managers_in: false });
    void load();
  };

  const savePosition = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    const payload = {
      code: positionForm.code.trim().toUpperCase(),
      title: positionForm.title.trim(),
      unit_id: positionForm.unit_id,
      reports_to_position_id: positionForm.reports_to_position_id || null,
      is_manager: positionForm.is_manager,
    };
    const positionResult = editingPosition
      ? await supabase.from('job_positions').update(payload).eq('id', editingPosition.id).select('id').single()
      : await supabase.from('job_positions').insert(payload).select('id').single();
    let error = positionResult.error;
    const savedPositionId = positionResult.data?.id || editingPosition?.id;
    if (!error && savedPositionId && isFullAdmin(profile)) {
      if (positionPermissionsSupported) {
        const clearResult = await supabase.from('job_position_permissions').delete().eq('position_id', savedPositionId);
        error = clearResult.error;
        if (!error && positionForm.permissions.length > 0) {
          const permissionResult = await supabase.from('job_position_permissions').insert(
            positionForm.permissions.map((permission_code) => ({ position_id: savedPositionId, permission_code })),
          );
          error = permissionResult.error;
        }
      }
      if (!error && positionFunctionPermissionsSupported) {
        const clearFunctions = await supabase.from('job_position_function_permissions').delete().eq('position_id', savedPositionId);
        error = clearFunctions.error;
        if (!error && positionForm.function_permissions.length > 0) {
          const functionResult = await supabase.from('job_position_function_permissions').insert(
            positionForm.function_permissions.map((function_code) => ({ position_id: savedPositionId, function_code })),
          );
          error = functionResult.error;
        }
      }
    }
    setSubmitting(false);
    if (error) return toast('Không tạo được vị trí: ' + describeDbError(error), 'error');
    toast(editingPosition ? 'Đã cập nhật vị trí/chức danh.' : 'Đã thêm vị trí/chức danh.', 'success');
    setPositionModal(false);
    setEditingPosition(null);
    setPositionForm({ code: '', title: '', unit_id: '', reports_to_position_id: '', is_manager: false, permissions: [], function_permissions: [] });
    void load();
  };

  /**
   * Nhung nguoi dang PHU TRACH mot don vi nhung chua phai thanh vien don vi do.
   *
   * So do to chuc da noi ro ai quan ly phong nao, nhung `manager_id` va
   * `profiles.unit_id` la hai cot khac nhau - dat nguoi phu trach khong dat
   * don vi cho ho. Hau qua thay o Co che luong: moi nguoi dung chung mot
   * nhom "Huy Phong Group" thay vi nam trong phong cua minh, va khoan luong
   * khai cho tung phong khong ap cho ai ca.
   */
  const managersOutsideTheirUnit = useMemo(() => {
    const out: { person: Profile; unit: OrganizationUnit }[] = [];
    for (const unit of units) {
      if (!unit.is_active || !unitIdsInCompany.has(unit.id)) continue;
      const ids = unitManagers[unit.id] ?? (unit.manager_id ? [unit.manager_id] : []);
      for (const id of ids) {
        const person = users.find((user) => user.id === id);
        if (person && person.unit_id !== unit.id) out.push({ person, unit });
      }
    }
    // Mot nguoi phu trach NHIEU don vi thi chi gan vao don vi dau tien gap:
    // `unit_id` la mot cot don, khong the o hai cho.
    const seen = new Set<string>();
    return out.filter(({ person }) => !seen.has(person.id) && seen.add(person.id));
  }, [units, users, unitManagers, unitIdsInCompany]);

  const assignManagersToTheirUnits = async () => {
    const moving = managersOutsideTheirUnit;
    if (moving.length === 0) return;
    const accepted = await confirm({
      title: `Đưa ${moving.length} người phụ trách vào đơn vị của họ?`,
      message: moving
        .map(({ person, unit }) => `• ${person.name} → ${unit.name}`)
        .join('\n')
        + '\n\nSau bước này họ mới nhận khoản lương khai cho đơn vị đó.',
      confirmLabel: 'Gán vào đơn vị',
    });
    if (!accepted) return;

    setSubmitting(true);
    for (const { person, unit } of moving) {
      const { error } = await supabase.rpc('assign_employee_organization', {
        target_user: person.id,
        target_employee_code: person.employee_code || null,
        target_unit: unit.id,
        // Chuc danh cu thuoc don vi khac thi bo: de lai se thanh nguoi dung o
        // phong moi ma giu chuc danh cua phong cu.
        target_position: positions.find((item) => item.id === person.position_id)?.unit_id === unit.id
          ? person.position_id : null,
        target_manager: person.manager_id || null,
        target_hire_date: person.hire_date || null,
        target_employment_status: person.employment_status || 'active',
      });
      if (error) {
        setSubmitting(false);
        return toast(`Dừng ở ${person.name}: ${describeDbError(error)}`, 'error');
      }
    }
    setSubmitting(false);
    toast(`Đã gán ${moving.length} người vào đơn vị của họ.`, 'success');
    await load();
  };

  const inactiveInCompany = useMemo(
    () => units.filter((unit) => !unit.is_active && unitIdsInCompany.has(unit.id)).length,
    [units, unitIdsInCompany],
  );

  const attentionInCompany = useMemo(
    () => [...unitIdsInCompany].filter((id) => attentionUnitIds.has(id)).length,
    [unitIdsInCompany, attentionUnitIds],
  );

  const backToCompanies = () => {
    setActiveCompanyId(null);
    setSelectedUnitId(null);
    const next = new URLSearchParams(searchParams);
    next.delete('company');
    setSearchParams(next, { replace: true });
  };

  const chooseCompany = (unitId: string) => {
    setActiveCompanyId(unitId);
    // Để trống: panel chi tiết chỉ dành cho đơn vị BÊN TRONG doanh nghiệp.
    setSelectedUnitId(null);
    const next = new URLSearchParams(searchParams);
    next.set('company', unitId);
    setSearchParams(next, { replace: true });
  };

  /**
   * Thêm đơn vị mới: mặc định gắn vào doanh nghiệp đang mở.
   *
   * Trước đây `parent_id` để trống, nghĩa là mọi đơn vị tạo ra đều thành một
   * doanh nghiệp mới ở cấp gốc — không phải điều người dùng muốn khi họ đang
   * đứng trong một doanh nghiệp và bấm "Thêm đơn vị".
   */
  const openNewUnit = () => {
    setEditingUnit(null);
    setUnitForm({
      new_positions: [], manager_ids: [], move_managers_in: false,
      code: '', name: '',
      unit_type: activeCompany ? 'department' : 'company',
      parent_id: activeCompany?.id ?? '',
    });
    setUnitModal(true);
  };

  /** Tạo doanh nghiệp mới: đơn vị cấp gốc, không có cha. */
  const openNewCompany = () => {
    setEditingUnit(null);
    setUnitForm({ code: '', name: '', unit_type: 'company', parent_id: '', manager_ids: [], new_positions: [], move_managers_in: false });
    setUnitModal(true);
  };

  const openEditUnit = (unit: OrganizationUnit) => {
    setEditingUnit(unit);
    setUnitForm({
      code: unit.code, name: unit.name, unit_type: unit.unit_type,
      parent_id: unit.parent_id || '',
      manager_ids: unitManagers[unit.id] ?? (unit.manager_id ? [unit.manager_id] : []),
      new_positions: [],
      move_managers_in: false,
    });
    setUnitModal(true);
  };

  const openChildUnit = (parent: OrganizationUnit) => {
    const childType: OrganizationUnitType = parent.unit_type === 'group' ? 'company'
      : parent.unit_type === 'company' ? 'branch'
        : parent.unit_type === 'branch' ? 'department' : 'team';
    setEditingUnit(null);
    setUnitForm({ code: '', name: '', unit_type: childType, parent_id: parent.id, manager_ids: [], new_positions: [], move_managers_in: false });
    setUnitModal(true);
  };

  const toggleUnit = (unitId: string) => {
    setCollapsedUnits((current) => {
      const next = new Set(current);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  };

  const expandAllUnits = () => setCollapsedUnits(new Set());
  const collapseAllUnits = () => setCollapsedUnits(new Set(units.map((unit) => unit.id)));

  const openNewPosition = () => {
    setEditingPosition(null);
    // Vi tri cap cong ty gan thang vao phap nhan dang mo; con muon gan vao
    // phong ban thi doi lai trong o "Thuoc don vi".
    setPositionForm({ code: '', title: '', unit_id: activeCompany?.id ?? '', reports_to_position_id: '', is_manager: false, permissions: [], function_permissions: [] });
    setPositionModal(true);
  };

  const openEditPosition = (position: JobPosition) => {
    setEditingPosition(position);
    setPositionForm({ code: position.code, title: position.title, unit_id: position.unit_id, reports_to_position_id: position.reports_to_position_id || '', is_manager: position.is_manager, permissions: positionPermissions[position.id] || [], function_permissions: (positionFunctionPermissions[position.id] || []).filter((item): item is AdminFunctionCode => item.startsWith('admin.')) });
    setPositionModal(true);
  };

  /** Dua mot don vi goc vao lam con cua mot phap nhan. */
  const moveIntoCompany = async (unit: OrganizationUnit, companyId: string) => {
    const company = unitById.get(companyId);
    const accepted = await confirm({
      title: `Chuyển “${unit.name}” vào ${company?.name ?? 'doanh nghiệp'}?`,
      message: 'Đơn vị này và toàn bộ cấp dưới của nó sẽ nằm trong sơ đồ của doanh nghiệp đó.',
      confirmLabel: 'Chuyển vào',
    });
    if (!accepted) return;
    const { error } = await supabase
      .from('organization_units')
      .update({ parent_id: companyId })
      .eq('id', unit.id);
    if (error) toast('Không chuyển được đơn vị: ' + describeDbError(error), 'error');
    else { toast('Đã chuyển đơn vị.', 'success'); await load(); }
  };

  /** Don vi goc nay dung la mot cong ty, chi khai nham loai. */
  const promoteToCompany = async (unit: OrganizationUnit) => {
    const accepted = await confirm({
      title: `Đổi “${unit.name}” thành pháp nhân?`,
      message: 'Đơn vị sẽ thành một doanh nghiệp riêng, có sơ đồ tổ chức của riêng nó.',
      confirmLabel: 'Đổi thành pháp nhân',
    });
    if (!accepted) return;
    const { error } = await supabase
      .from('organization_units')
      .update({ unit_type: 'company' })
      .eq('id', unit.id);
    if (error) toast('Không đổi được loại đơn vị: ' + describeDbError(error), 'error');
    else { toast('Đã đổi thành pháp nhân.', 'success'); await load(); }
  };

  const removeUnit = async (unit: OrganizationUnit) => {
    // Liet ke CU THE cai gi dang chan, thay vi chi noi "co du lieu lien quan".
    //
    // Nguoi dung bam Xoa, he thong ngung hoat dong, so do ve y het nhu cu ->
    // ho ket luan la nut xoa hong. Phai noi ro con gi phai don truoc thi moi
    // xoa han duoc.
    const childUnits = units.filter((item) => item.parent_id === unit.id);
    const unitPositions = positions.filter((item) => item.unit_id === unit.id);
    const unitUsers = users.filter((item) => item.unit_id === unit.id);
    const blockers = [
      childUnits.length > 0 ? `${childUnits.length} đơn vị con (${childUnits.map((item) => item.name).join(', ')})` : null,
      unitPositions.length > 0 ? `${unitPositions.length} vị trí` : null,
      unitUsers.length > 0 ? `${unitUsers.length} nhân sự` : null,
    ].filter(Boolean) as string[];
    const hasDependencies = blockers.length > 0;
    const accepted = await confirm({
      title: hasDependencies ? `Ngừng hoạt động “${unit.name}”?` : `Xóa đơn vị “${unit.name}”?`,
      message: hasDependencies
        ? `Không xóa hẳn được vì bên dưới còn ${blockers.join(', ')}. Đơn vị sẽ được đánh dấu `
          + 'ngừng hoạt động và vẫn hiện trong sơ đồ (có nhãn xám) để lịch sử lương và chấm công '
          + 'không mất. Muốn xóa hẳn thì chuyển hết những thứ trên sang đơn vị khác rồi xóa lại.'
        : 'Đơn vị chưa có dữ liệu liên quan và sẽ bị xóa hẳn.',
      confirmLabel: hasDependencies ? 'Ngừng hoạt động' : 'Xóa đơn vị', danger: true,
    });
    if (!accepted) return;
    const result = hasDependencies
      ? await supabase.from('organization_units').update({ is_active: false }).eq('id', unit.id)
      : await supabase.from('organization_units').delete().eq('id', unit.id);
    if (result.error) toast('Không xử lý được đơn vị: ' + describeDbError(result.error), 'error');
    else {
      toast(
        hasDependencies
          ? `Đã ngừng hoạt động “${unit.name}”. Vẫn hiện trong sơ đồ kèm nhãn xám — bật "Ẩn đơn vị ngừng hoạt động" để giấu đi.`
          : 'Đã xóa đơn vị.',
        'success',
      );
      await load();
    }
  };

  const removePosition = async (position: JobPosition) => {
    const hasDependencies = positions.some((item) => item.reports_to_position_id === position.id)
      || users.some((item) => item.position_id === position.id);
    const accepted = await confirm({
      title: hasDependencies ? `Ngừng hoạt động “${position.title}”?` : `Xóa vị trí “${position.title}”?`,
      message: hasDependencies ? 'Vị trí đang được sử dụng nên sẽ được ngừng hoạt động để bảo toàn lịch sử.' : 'Vị trí chưa được sử dụng và sẽ bị xóa.',
      confirmLabel: hasDependencies ? 'Ngừng hoạt động' : 'Xóa vị trí', danger: true,
    });
    if (!accepted) return;
    const result = hasDependencies
      ? await supabase.from('job_positions').update({ is_active: false }).eq('id', position.id)
      : await supabase.from('job_positions').delete().eq('id', position.id);
    if (result.error) toast('Không xử lý được vị trí: ' + describeDbError(result.error), 'error');
    else { toast(hasDependencies ? 'Đã ngừng hoạt động vị trí.' : 'Đã xóa vị trí.', 'success'); await load(); }
  };

  const openAssignment = (user?: Profile) => {
    const target = user || visibleUsers[0];
    setAssignmentForm({
      user_id: target?.id || '',
      employee_code: target?.employee_code || '',
      unit_id: target?.unit_id || '',
      position_id: target?.position_id || '',
      manager_id: target?.manager_id || '',
      hire_date: target?.hire_date || '',
      employment_status: target?.employment_status || 'active',
    });
    setAssignmentModal(true);
  };

  // Cho phép Admin Users mở thẳng đúng nhân sự trong luồng Cơ cấu tổ chức.
  // Sau khi nhận deep-link, xóa query để refresh không mở lại modal lần nữa.
  useEffect(() => {
    const requestedUserId = searchParams.get('user');
    if (!requestedUserId || users.length === 0) return;
    const target = userById.get(requestedUserId);
    if (!target) return;
    setTab('assignments');
    openAssignment(target);
    const next = new URLSearchParams(searchParams);
    next.delete('user');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, userById, users.length]);

  const chooseEmployee = (userId: string) => {
    const user = userById.get(userId);
    setAssignmentForm({
      user_id: userId,
      employee_code: user?.employee_code || '',
      unit_id: user?.unit_id || '',
      position_id: user?.position_id || '',
      manager_id: user?.manager_id || '',
      hire_date: user?.hire_date || '',
      employment_status: user?.employment_status || 'active',
    });
  };

  const assignEmployee = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.rpc('assign_employee_organization', {
      target_user: assignmentForm.user_id,
      target_employee_code: assignmentForm.employee_code || null,
      target_unit: assignmentForm.unit_id || null,
      target_position: assignmentForm.position_id || null,
      target_manager: assignmentForm.manager_id || null,
      target_hire_date: assignmentForm.hire_date || null,
      target_employment_status: assignmentForm.employment_status,
    });
    setSubmitting(false);
    if (error) return toast('Không cập nhật được phân công: ' + describeDbError(error), 'error');
    toast('Đã cập nhật vị trí và tuyến quản lý của nhân sự.', 'success');
    setAssignmentModal(false);
    await loadUsers();
  };

  const positionOptions = companyPositions.filter((position) => !assignmentForm.unit_id || position.unit_id === assignmentForm.unit_id);
  const assignmentUnitLineage = useMemo(() => {
    const ids = new Set<string>();
    let current = assignmentForm.unit_id ? unitById.get(assignmentForm.unit_id) : undefined;
    while (current && !ids.has(current.id)) {
      ids.add(current.id);
      current = current.parent_id ? unitById.get(current.parent_id) : undefined;
    }
    return ids;
  }, [assignmentForm.unit_id, unitById]);
  const managerOptions = users.filter((user) => user.is_active
    && user.id !== assignmentForm.user_id
    && Boolean(user.unit_id && assignmentUnitLineage.has(user.unit_id)));
  const canManagePositionPermissions = isFullAdmin(profile);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {/* Dang dung trong mot doanh nghiep thi ba con so nay phai la cua
            doanh nghiep do, khong phai tong toan he thong - neu khong nguoi
            dung doi chieu voi danh sach ben duoi se thay lech ma khong hieu. */}
        {[
          { label: activeCompany ? `Đơn vị trong ${activeCompany.name}` : 'Doanh nghiệp', value: activeCompany ? unitIdsInCompany.size : companies.length, icon: Network, color: 'text-indigo-600 bg-indigo-50' },
          { label: 'Vị trí/chức danh', value: activeCompany ? companyPositions.length : positions.length, icon: BriefcaseBusiness, color: 'text-violet-600 bg-violet-50' },
          { label: 'Nhân sự đã gán đơn vị', value: activeCompany ? companyHeadcount(activeCompany) : users.filter((user) => user.unit_id).length, icon: UsersRound, color: 'text-emerald-600 bg-emerald-50' },
        ].map((item) => (
          <Card key={item.label}><CardContent className="flex items-center gap-4">
            <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${item.color}`}><item.icon className="h-5 w-5" /></span>
            <div><p className="text-2xl font-extrabold text-slate-900">{item.value}</p><p className="text-xs font-medium text-slate-500">{item.label}</p></div>
          </CardContent></Card>
        ))}
      </div>

      <Card>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Ba tab la ba goc nhin cua CUNG mot doanh nghiep, nen chi
                hien sau khi da chon doanh nghiep. */}
            {activeCompany ? (
              <div className="inline-flex rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Quản lý cơ cấu">
                {([
                  ['units', 'Cây tổ chức'], ['positions', 'Vị trí'], ['assignments', 'Phân công nhân sự'],
                ] as const).map(([value, label]) => (
                  <button key={value} type="button" role="tab" aria-selected={effectiveTab === value} onClick={() => setTab(value)} className={`rounded-lg px-3 py-2 text-xs font-bold transition ${effectiveTab === value ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{label}</button>
                ))}
              </div>
            ) : (
              <div>
                <h3 className="text-sm font-bold text-slate-800">Doanh nghiệp</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Chọn một doanh nghiệp để làm việc với cây tổ chức, vị trí và nhân sự của riêng nó.
                </p>
              </div>
            )}
            <Button theme="admin" onClick={() => effectiveTab === 'units' ? openNewUnit() : effectiveTab === 'positions' ? openNewPosition() : openAssignment()}>
              <Plus className="h-4 w-4" />{effectiveTab === 'units' ? (activeCompany ? 'Thêm đơn vị' : 'Thêm doanh nghiệp') : effectiveTab === 'positions' ? 'Thêm vị trí' : 'Gán nhân sự'}
            </Button>
          </div>
          <div className="relative mt-4">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={activeCompany ? `Tìm trong ${activeCompany.name}...` : 'Tìm doanh nghiệp...'} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/60 pl-10 pr-4 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" />
          </div>
        </CardContent>
      </Card>

      {loading ? <div className="space-y-3">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20" />)}</div>
        : loadError ? <ErrorState message={loadError} onRetry={() => load()} />
          : effectiveTab === 'units' ? (
            <div className="space-y-3">
              {/* --- Hai màn tách hẳn: danh sách doanh nghiệp, rồi sơ đồ của
                      doanh nghiệp được chọn. Không xổ sơ đồ ngay dưới danh
                      sách — nhìn hai thứ cùng lúc rất dễ tưởng mình đang sửa
                      doanh nghiệp này trong khi thao tác rơi vào cái kia. --- */}
              {!activeCompany ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">Chọn doanh nghiệp</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Bấm vào một doanh nghiệp để xem và dựng sơ đồ tổ chức bên trong.
                    </p>
                  </div>

                  {companies.length === 0 ? (
                    <p className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                      Chưa có doanh nghiệp nào. Tạo pháp nhân trước, sau đó dựng chi nhánh và phòng
                      ban bên trong.
                    </p>
                  ) : (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {companies.map((company) => {
                        const children = childUnitsByParent.get(company.id) || [];
                        return (
                          /* Vung bam mo so do va nut sua/xoa phai la hai nut
                             ANH EM, khong long nhau: button trong button vua
                             sai HTML vua lam ca the an theo nut ben trong. */
                          <div
                            key={company.id}
                            className="group relative rounded-xl border-2 border-slate-200 transition hover:border-indigo-400 hover:shadow-md"
                          >
                            <button
                              type="button"
                              onClick={() => chooseCompany(company.id)}
                              className="block w-full p-4 text-left"
                            >
                              <span className="flex items-center gap-2.5 pr-16">
                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
                                  <Building2 className="h-5 w-5" />
                                </span>
                                <span className="min-w-0">
                                  <strong className="block truncate text-sm text-slate-900">{company.name}</strong>
                                  <span className="block truncate text-[11px] text-slate-500">
                                    {company.code} · {UNIT_TYPES[company.unit_type]}
                                  </span>
                                </span>
                              </span>
                              <span className="mt-3 flex gap-4 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
                                <span><strong className="text-slate-800">{companyHeadcount(company)}</strong> nhân sự</span>
                                <span><strong className="text-slate-800">{children.length}</strong> đơn vị trực thuộc</span>
                              </span>
                            </button>
                            <div className="absolute right-2.5 top-2.5 flex gap-1 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => openEditUnit(company)}
                                aria-label={`Sửa ${company.name}`}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() => void removeUnit(company)}
                                aria-label={`Xóa ${company.name}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* ---- Don vi goc nhung khong phai phap nhan ----
                      Khong an di: day la man hinh duy nhat sua duoc chung.
                      Nhung cung khong xep chung voi doanh nghiep, vi nhin vao
                      se tuong cong ty co them mot phap nhan nua. */}
                  {orphanUnits.length > 0 && (
                    <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/60 p-3.5">
                      <p className="flex items-start gap-1.5 text-xs font-bold text-amber-800">
                        <CircleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
                        {orphanUnits.length} đơn vị chưa thuộc doanh nghiệp nào
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-amber-700">
                        Được tạo mà không chọn đơn vị cấp trên nên đang đứng riêng, không nằm trong
                        sơ đồ nào. Chuyển vào đúng doanh nghiệp, hoặc đổi thành pháp nhân nếu đây
                        thực sự là một công ty.
                      </p>
                      <div className="mt-3 space-y-2">
                        {orphanUnits.map((unit) => (
                          <div key={unit.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2.5">
                            <span className="min-w-0 flex-1">
                              <strong className="block truncate text-xs text-slate-900">{unit.name}</strong>
                              <span className="block truncate text-[11px] text-slate-500">
                                {unit.code} · {UNIT_TYPES[unit.unit_type]}
                              </span>
                            </span>
                            <Select
                              aria-label={`Chuyển ${unit.name} vào doanh nghiệp`}
                              value=""
                              onChange={(event) => event.target.value && void moveIntoCompany(unit, event.target.value)}
                              className="h-9 w-auto min-w-[10rem] text-xs"
                            >
                              <option value="">Chuyển vào…</option>
                              {companies.map((company) => (
                                <option key={company.id} value={company.id}>{company.name}</option>
                              ))}
                            </Select>
                            <Button size="sm" variant="secondary" onClick={() => void promoteToCompany(unit)}>
                              Đổi thành pháp nhân
                            </Button>
                            <Button size="sm" variant="danger" onClick={() => void removeUnit(unit)} aria-label={`Xóa ${unit.name}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                      {companies.length === 0 && (
                        <p className="mt-2.5 text-[11px] leading-relaxed text-amber-700">
                          Chưa có pháp nhân nào để chuyển vào — đổi một đơn vị ở trên thành pháp nhân,
                          hoặc bấm <strong>Thêm doanh nghiệp</strong>.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* Dòng định vị: luôn thấy đang đứng trong doanh nghiệp nào. */}
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex min-w-0 items-center gap-3">
                      <Button type="button" size="sm" variant="ghost" onClick={backToCompanies}>
                        <ChevronLeft className="h-4 w-4" />Doanh nghiệp
                      </Button>
                      <span className="h-5 w-px bg-slate-200" />
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                          <Building2 className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <strong className="block truncate text-sm text-slate-900">{activeCompany.name}</strong>
                          <span className="block truncate text-[11px] text-slate-500">
                            {activeCompany.code} · {companyHeadcount(activeCompany)} nhân sự
                          </span>
                        </span>
                      </span>
                    </div>
                    <Button type="button" size="sm" variant="secondary" onClick={() => openEditUnit(activeCompany)}>
                      <Pencil className="h-4 w-4" />Sửa doanh nghiệp
                    </Button>
                  </div>

                  {activeCompany.unit_type !== 'company' && activeCompany.unit_type !== 'group' && (
                    <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800">
                      <CircleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      <span>
                        <strong>{activeCompany.name}</strong> đang khai loại là{' '}
                        <strong>{UNIT_TYPES[activeCompany.unit_type]}</strong>, không phải pháp nhân.
                        Đổi ở <em>Sửa doanh nghiệp → Loại</em> thành Pháp nhân/Công ty để các cấp con
                        bên dưới được gợi ý đúng (chi nhánh → phòng ban → bộ phận).
                      </span>
                    </p>
                  )}

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setUnitScope('all')} className={`rounded-lg px-3 py-2 text-xs font-bold transition ${unitScope === 'all' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>Tất cả ({unitIdsInCompany.size})</button>
                  <button type="button" onClick={() => setUnitScope('attention')} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition ${unitScope === 'attention' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}><CircleAlert className="h-3.5 w-3.5" />Cần bổ sung ({attentionInCompany})</button>
                  {/* Du lieu de gan da nam san trong so do - khong bat nguoi
                      dung mo tung don vi ra tich lai tung nguoi. */}
                  {managersOutsideTheirUnit.length > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={submitting}
                      onClick={() => void assignManagersToTheirUnits()}
                    >
                      <UsersRound className="h-3.5 w-3.5" />
                      Gán {managersOutsideTheirUnit.length} người phụ trách vào đơn vị
                    </Button>
                  )}

                  {/* Don vi da ngung hoat dong van ve trong so do kem nhan xam.
                      O nay de giau chung di khi khong con muon nhin. */}
                  {inactiveInCompany > 0 && (
                    <label className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">
                      <input
                        type="checkbox"
                        checked={hideInactive}
                        onChange={(event) => setHideInactive(event.target.checked)}
                        className="h-3.5 w-3.5 rounded border-slate-300"
                      />
                      Ẩn {inactiveInCompany} đơn vị ngừng hoạt động
                    </label>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Kiểu xem cơ cấu">
                    {([['chart', 'Sơ đồ', LayoutGrid], ['list', 'Danh sách', List]] as const).map(([value, label, Icon]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={unitView === value}
                        onClick={() => setUnitView(value)}
                        className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-bold transition ${unitView === value ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                      >
                        <Icon className="h-3.5 w-3.5" />{label}
                      </button>
                    ))}
                  </div>
                  <Button type="button" size="sm" variant="ghost" onClick={expandAllUnits}>Mở tất cả</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={collapseAllUnits}>Thu gọn</Button>
                </div>
              </div>

              {/* So do chiem TRON be ngang, panel chi tiet xuong duoi.
                  Truoc day panel an 1/3 man hinh ke ca khi khong dung toi,
                  nen khung con 595px trong khi cay rong 1952px - co het co
                  cung khong vua, va do chinh la thu nguoi dung muon thay. */}
              {/* `minmax(0,1fr)` la bat buoc, khong phai trang tri: o luoi
                  mac dinh `min-width: auto` nen KHONG co nho hon noi dung ben
                  trong. Thieu no, the so do no rong 1874px theo be ngang cua
                  cay va day ca trang tran ngang - van de bi doi len mot cap
                  chu khong mat di. */}
              <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
                <Card><CardContent className="p-0">
                  {orderedUnits.length === 0 ? <EmptyState icon={<Building2 className="h-8 w-8" />} title={unitIdsInCompany.size === 0 ? 'Doanh nghiệp này chưa có đơn vị nào' : 'Không tìm thấy đơn vị phù hợp'} description={unitIdsInCompany.size === 0 ? `Bấm "Thêm đơn vị" để tạo chi nhánh hoặc phòng ban đầu tiên trong ${activeCompany?.name ?? 'doanh nghiệp'}.` : 'Thử đổi từ khóa hoặc chọn bộ lọc Tất cả.'} /> : unitView === 'chart' ? (
                    <OrgChart
                      roots={chartTree.roots}
                      childrenOf={(unitId) => chartTree.childrenById.get(unitId) || []}
                      typeLabel={(unit) => UNIT_TYPES[unit.unit_type]}
                      managerName={(unit) => (unit.manager_id ? userById.get(unit.manager_id)?.name || null : null)}
                      employeeCount={(unitId) => employeeCountByUnit.get(unitId) || 0}
                      needsAttention={(unitId) => attentionUnitIds.has(unitId)}
                      selectedId={selectedUnit?.id ?? null}
                      onSelect={setSelectedUnitId}
                      collapsed={collapsedUnits}
                      onToggle={toggleUnit}
                      onAddChild={openChildUnit}
                      onRemove={(unit) => void removeUnit(unit)}
                      rootLabel={activeCompany?.name}
                    />
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {orderedUnits.map((unit) => {
                        const manager = unit.manager_id ? userById.get(unit.manager_id) : undefined;
                        const children = childUnitsByParent.get(unit.id) || [];
                        const isCollapsed = collapsedUnits.has(unit.id);
                        const isSelected = selectedUnit?.id === unit.id;
                        const needsAttention = attentionUnitIds.has(unit.id);
                        return <div key={unit.id} className={`group flex items-center gap-2 px-3 py-3 transition ${isSelected ? 'bg-indigo-50/70' : 'hover:bg-slate-50/80'}`} style={{ paddingLeft: `${12 + Math.min(unitDepth(unit), 5) * 20}px` }}>
                          <button type="button" onClick={() => toggleUnit(unit.id)} disabled={children.length === 0} aria-label={children.length ? `${isCollapsed ? 'Mở' : 'Thu gọn'} ${unit.name}` : undefined} aria-expanded={children.length ? !isCollapsed : undefined} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-indigo-600 disabled:opacity-30">
                            {children.length === 0 ? <span className="h-1.5 w-1.5 rounded-full bg-slate-300" /> : isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </button>
                          <button type="button" onClick={() => setSelectedUnitId(unit.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${unit.is_active ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-400'}`}><Building2 className="h-5 w-5" /></span>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-2"><strong className="truncate text-sm text-slate-900">{unit.name}</strong><Badge className="bg-slate-100 text-slate-600">{UNIT_TYPES[unit.unit_type]}</Badge>{needsAttention && <CircleAlert className="h-4 w-4 text-amber-500" aria-label="Cần bổ sung thông tin" />}{!unit.is_active && <Badge className="bg-red-50 text-red-600">Ngừng hoạt động</Badge>}</span>
                              <span className="mt-1 block truncate text-xs text-slate-500">{unit.code} · {manager ? `Phụ trách: ${manager.name}` : 'Chưa gán người phụ trách'}</span>
                            </span>
                            <span className="hidden shrink-0 items-center gap-3 text-right sm:flex">
                              <span><strong className="block text-sm text-slate-800">{employeeCountByUnit.get(unit.id) || 0}</strong><small className="text-[10px] text-slate-400">nhân sự</small></span>
                              <span><strong className="block text-sm text-slate-800">{positionCountByUnit.get(unit.id) || 0}</strong><small className="text-[10px] text-slate-400">vị trí</small></span>
                            </span>
                          </button>
                          <div className="hidden shrink-0 gap-1 group-hover:flex sm:flex">
                            <Button size="sm" variant="ghost" onClick={() => openChildUnit(unit)} aria-label={`Thêm đơn vị con vào ${unit.name}`} title="Thêm đơn vị con"><Plus className="h-4 w-4" /></Button>
                            <Button size="sm" variant="secondary" onClick={() => openEditUnit(unit)} aria-label={`Sửa ${unit.name}`}><Pencil className="h-4 w-4" /></Button>
                            <Button size="sm" variant="danger" onClick={() => void removeUnit(unit)} aria-label={`Xóa ${unit.name}`}><Trash2 className="h-4 w-4" /></Button>
                          </div>
                        </div>;
                      })}
                    </div>
                  )}
                </CardContent></Card>

                {selectedUnit && <Card><CardContent className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Chi tiết đơn vị</p><h3 className="mt-1 text-lg font-extrabold text-slate-900">{selectedUnit.name}</h3><p className="text-xs text-slate-500">{selectedUnit.code} · {UNIT_TYPES[selectedUnit.unit_type]}</p></div>
                    {!selectedUnit.is_active && <Badge className="bg-red-50 text-red-600">Ngừng hoạt động</Badge>}
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:max-w-md">
                    {[['Nhân sự', employeeCountByUnit.get(selectedUnit.id) || 0], ['Vị trí', positionCountByUnit.get(selectedUnit.id) || 0], ['Đơn vị con', (childUnitsByParent.get(selectedUnit.id) || []).length]].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-3 text-center"><strong className="block text-xl text-slate-900">{value}</strong><span className="text-[11px] text-slate-500">{label}</span></div>)}
                  </div>
                  <dl className="space-y-3 text-sm">
                    <div><dt className="text-xs font-semibold text-slate-400">Đơn vị cấp trên</dt><dd className="mt-1 font-semibold text-slate-700">{selectedUnit.parent_id ? unitById.get(selectedUnit.parent_id)?.name || 'Không còn tồn tại' : 'Đơn vị gốc'}</dd></div>
                    <div><dt className="text-xs font-semibold text-slate-400">Người phụ trách</dt><dd className={`mt-1 font-semibold ${selectedUnit.manager_id ? 'text-slate-700' : 'text-amber-600'}`}>{selectedUnit.manager_id ? userById.get(selectedUnit.manager_id)?.name || 'Không còn hoạt động' : 'Chưa gán'}</dd></div>
                  </dl>
                  {/* ---- Danh sach nhan su trong don vi ----
                       Truoc day chi co con SO "Nhan su: 3". Con so do khong
                       tra loi duoc cau hoi thuc te: ai dang o trong phong
                       nay. Va khi no bang 0 thi cung khong noi duoc la chua
                       ai duoc gan, hay la nguoi o cac to truc thuoc. */}
                  {(() => {
                    const direct = users.filter((user) => user.unit_id === selectedUnit.id);
                    // Nguoi nam trong cac don vi con, dem rieng: khoan luong
                    // khai cho don vi nay KHONG ap cho ho, nen gop chung mot
                    // con so se lam nguoi dung tuong nguoc lai.
                    const childIds = new Set<string>();
                    const walk = (unit: OrganizationUnit) => {
                      (childUnitsByParent.get(unit.id) || []).forEach((child) => {
                        childIds.add(child.id);
                        walk(child);
                      });
                    };
                    walk(selectedUnit);
                    const nested = users.filter((user) => user.unit_id && childIds.has(user.unit_id));

                    return (
                      <div className="rounded-xl border border-slate-200">
                        <p className="flex items-center gap-2 border-b border-slate-100 px-3.5 py-2.5 text-xs font-bold text-slate-700">
                          <UsersRound className="h-3.5 w-3.5" />
                          Nhân sự thuộc {selectedUnit.name}
                          <span className="font-normal text-slate-400">({direct.length})</span>
                        </p>

                        {direct.length === 0 ? (
                          <p className="px-3.5 py-3 text-xs leading-relaxed text-slate-500">
                            Chưa ai được gán vào đơn vị này. Gán ở{' '}
                            <button
                              type="button"
                              onClick={() => setTab('assignments')}
                              className="font-semibold text-indigo-600 underline hover:text-indigo-700"
                            >
                              Phân công nhân sự
                            </button>
                            . Đặt người phụ trách ở sơ đồ không tính là gán vào đơn vị.
                          </p>
                        ) : (
                          <ul className="divide-y divide-slate-50">
                            {direct.map((person) => (
                              <li key={person.id} className="flex items-center gap-2.5 px-3.5 py-2.5">
                                <Avatar name={person.name} url={person.avatar_url} size="sm" />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-semibold text-slate-800">
                                    {person.name}
                                  </span>
                                  <span className="block truncate text-[11px] text-slate-500">
                                    {positionById.get(person.position_id || '')?.title || 'Chưa gán vị trí'}
                                    {person.employee_code ? ` · ${person.employee_code}` : ''}
                                  </span>
                                </span>
                                {selectedUnit.manager_id === person.id && (
                                  <Badge className="bg-indigo-50 text-indigo-700">Phụ trách</Badge>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openAssignment(person)}
                                  aria-label={`Sửa phân công của ${person.name}`}
                                  className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600"
                                >
                                  <UserCog className="h-4 w-4" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}

                        {nested.length > 0 && (
                          <p className="border-t border-slate-100 px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-500">
                            Thêm <strong className="text-slate-700">{nested.length} người</strong> ở các
                            đơn vị trực thuộc. Khoản lương khai cho{' '}
                            <strong className="text-slate-700">{selectedUnit.name}</strong> không áp cho
                            họ — phải khai ở đúng đơn vị của họ.
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  {attentionUnitIds.has(selectedUnit.id) && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><strong className="mb-1 block">Cần hoàn thiện</strong>{!selectedUnit.manager_id && <p>• Gán người phụ trách đơn vị.</p>}{(positionCountByUnit.get(selectedUnit.id) || 0) === 0 && <p>• Khai báo ít nhất một vị trí/chức danh.</p>}{!selectedUnit.is_active && <p>• Đơn vị đang ngừng hoạt động.</p>}</div>}
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEditUnit(selectedUnit)}><Pencil className="h-4 w-4" />Chỉnh sửa</Button>
                    <Button size="sm" theme="admin" onClick={() => openChildUnit(selectedUnit)}><Plus className="h-4 w-4" />Thêm cấp dưới</Button>
                  </div>
                  {/* Xóa để riêng một hàng, không xếp cạnh hai nút dùng thường
                      xuyên — bấm nhầm ở đây là mất một nhánh tổ chức. */}
                  <Button size="sm" variant="danger" className="w-full" onClick={() => void removeUnit(selectedUnit)}>
                    <Trash2 className="h-4 w-4" />Xóa đơn vị này
                  </Button>
                </CardContent></Card>}
              </div>
                </>
              )}
            </div>
          ) : effectiveTab === 'positions' ? (
            <div className="space-y-3">
              {/* Sơ đồ ĐƠN VỊ không trả lời được "ai cấp trên của ai" — phòng
                  ban vốn ngang hàng nhau. Thứ bậc nằm ở vị trí, qua trường
                  "Báo cáo cho vị trí", nên nó phải có sơ đồ riêng. */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <p className="text-xs leading-relaxed text-slate-500">
                  Vị trí là nơi gắn <strong className="text-slate-700">quyền sử dụng hệ thống</strong>.
                  Đặt <em>Báo cáo cho vị trí</em> để dựng tuyến cấp trên – cấp dưới.
                </p>
                <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Kiểu xem vị trí">
                  {([['chart', 'Tuyến báo cáo', LayoutGrid], ['list', 'Danh sách', List]] as const).map(([value, label, Icon]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={positionView === value}
                      onClick={() => setPositionView(value)}
                      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-bold transition ${positionView === value ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      <Icon className="h-3.5 w-3.5" />{label}
                    </button>
                  ))}
                </div>
              </div>

              {positionView === 'chart' ? (
                <Card><CardContent className="p-0">
                  <PositionChart
                    positions={visiblePositions}
                    unitNameById={new Map(units.map((unit) => [unit.id, unit.name]))}
                    holderCount={(positionId) => users.filter((user) => user.position_id === positionId).length}
                    permissionCount={(positionId) => (positionPermissions[positionId]?.length ?? 0)}
                    selectedId={editingPosition?.id ?? null}
                    onSelect={(positionId) => {
                      const found = positions.find((item) => item.id === positionId);
                      if (found) openEditPosition(found);
                    }}
                  />
                </CardContent></Card>
              ) : (
            <Card><CardContent className="p-0">
              {visiblePositions.length === 0 ? <EmptyState icon={<BriefcaseBusiness className="h-8 w-8" />} title="Chưa có vị trí/chức danh" description="Khai báo vị trí sau khi đã có đơn vị tổ chức." /> : (
                <div className="divide-y divide-slate-100">{visiblePositions.map((position) => <div key={position.id} className="flex flex-wrap items-center gap-3 px-5 py-4 hover:bg-slate-50/70"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600"><BriefcaseBusiness className="h-5 w-5" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-slate-900">{position.title}</strong>{position.is_manager && <Badge className="bg-amber-50 text-amber-700">Quản lý</Badge>}{(positionPermissions[position.id]?.length || 0) > 0 && <Badge className="bg-indigo-50 text-indigo-700">{positionPermissions[position.id].length} quyền module</Badge>}{(positionFunctionPermissions[position.id]?.length || 0) > 0 && <Badge className="bg-violet-50 text-violet-700">{positionFunctionPermissions[position.id].length} chức năng nâng cao</Badge>}{!position.is_active && <Badge className="bg-red-50 text-red-600">Ngừng hoạt động</Badge>}</div><p className="mt-1 text-xs text-slate-500">{position.code} · {unitById.get(position.unit_id)?.name || 'Đơn vị không còn tồn tại'}{position.reports_to_position_id ? ` · Báo cáo cho ${positionById.get(position.reports_to_position_id)?.title || 'vị trí cấp trên'}` : ''}</p></div><div className="flex gap-1"><Button variant="secondary" onClick={() => openEditPosition(position)} aria-label={`Sửa ${position.title}`}><Pencil className="h-4 w-4" /></Button><Button variant="danger" onClick={() => void removePosition(position)} aria-label={`Xóa ${position.title}`}><Trash2 className="h-4 w-4" /></Button></div></div>)}</div>
              )}
            </CardContent></Card>
              )}
            </div>
          ) : (
            <Card><CardContent className="p-0">
              {visibleUsers.length === 0 ? <EmptyState title="Không tìm thấy nhân sự" /> : <div className="divide-y divide-slate-100">{visibleUsers.map((user) => <button key={user.id} type="button" onClick={() => openAssignment(user)} className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-slate-50"><Avatar name={user.name} url={user.avatar_url} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-slate-900">{user.name}</strong>{user.employee_code && <Badge className="bg-indigo-50 text-indigo-700">{user.employee_code}</Badge>}</div><p className="mt-1 text-xs text-slate-500">{positionById.get(user.position_id || '')?.title || 'Chưa gán vị trí'} · {unitById.get(user.unit_id || '')?.name || user.department || 'Chưa gán đơn vị'}</p></div><div className="hidden text-right sm:block"><p className="text-xs font-semibold text-slate-600">{EMPLOYMENT_STATUSES[user.employment_status || 'active']}</p><p className="mt-1 text-[11px] text-slate-400">QL: {userById.get(user.manager_id || '')?.name || 'Chưa gán'}</p></div><UserCog className="h-4 w-4 text-slate-400" /></button>)}</div>}
            </CardContent></Card>
          )}

      <Modal open={unitModal} onClose={() => { setUnitModal(false); setEditingUnit(null); }} title={editingUnit ? 'Sửa đơn vị tổ chức' : 'Thêm đơn vị tổ chức'}>
        <form onSubmit={saveUnit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3"><Input label="Mã đơn vị" value={unitForm.code} onChange={(event) => setUnitForm({ ...unitForm, code: event.target.value })} placeholder="VD: HP-HCM" required /><Select label="Loại đơn vị" value={unitForm.unit_type} onChange={(event) => setUnitForm({ ...unitForm, unit_type: event.target.value as OrganizationUnitType })}>{Object.entries(UNIT_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></div>
          <Input label="Tên đơn vị" value={unitForm.name} onChange={(event) => setUnitForm({ ...unitForm, name: event.target.value })} required />
          <Select label="Đơn vị cấp trên" value={unitForm.parent_id} onChange={(event) => setUnitForm({ ...unitForm, parent_id: event.target.value })}><option value="">Không có (đơn vị gốc)</option>{units.filter((unit) => unit.is_active && unit.id !== editingUnit?.id).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</Select>
          {/* ---- Người phụ trách: chọn được nhiều người ---- */}
          <fieldset className="rounded-xl border border-slate-200 p-3">
            <legend className="px-1 text-sm font-semibold text-slate-700">Người phụ trách</legend>
            <p className="text-xs leading-relaxed text-slate-500">
              {multiManagerSupported
                ? 'Chọn được nhiều người. Người đầu tiên là phụ trách chính — tên hiện trên sơ đồ tổ chức. Tất cả đều xem được chấm công và duyệt đơn của đơn vị này.'
                : 'Chưa chạy migration 20261001100000 nên tạm thời chỉ chọn được một người.'}
            </p>
            <div className="mt-2 max-h-44 space-y-1 overflow-y-auto">
              {users.filter((user) => user.is_active).map((user) => {
                const index = unitForm.manager_ids.indexOf(user.id);
                const checked = index >= 0;
                return (
                  <label key={user.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => setUnitForm({
                        ...unitForm,
                        manager_ids: event.target.checked
                          // Chua co ai thi nguoi vua tich thanh phu trach chinh.
                          ? (multiManagerSupported ? [...unitForm.manager_ids, user.id] : [user.id])
                          : unitForm.manager_ids.filter((id) => id !== user.id),
                      })}
                      className="h-4 w-4 accent-indigo-600"
                    />
                    <span className="min-w-0 flex-1 truncate">{user.name}</span>
                    {index === 0 && (
                      <Badge className="bg-indigo-50 text-indigo-700">Phụ trách chính</Badge>
                    )}
                    {index > 0 && (
                      <button
                        type="button"
                        onClick={() => setUnitForm({
                          ...unitForm,
                          manager_ids: [user.id, ...unitForm.manager_ids.filter((id) => id !== user.id)],
                        })}
                        className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                      >
                        Đặt làm chính
                      </button>
                    )}
                  </label>
                );
              })}
            </div>

            {/* Chi hien khi THUC SU co nguoi can dua vao - khong bay mot o
                tich khong lam gi cho don vi da day du thanh vien. */}
            {(() => {
              const outside = unitForm.manager_ids
                .map((id) => users.find((user) => user.id === id))
                .filter((user): user is Profile => !!user && user.unit_id !== editingUnit?.id);
              if (outside.length === 0) return null;
              const elsewhere = outside.filter((user) => !!user.unit_id);
              return (
                <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 text-xs leading-relaxed text-indigo-900">
                  <input
                    type="checkbox"
                    checked={unitForm.move_managers_in}
                    onChange={(event) => setUnitForm({ ...unitForm, move_managers_in: event.target.checked })}
                    className="mt-0.5 h-4 w-4 accent-indigo-600"
                  />
                  <span>
                    Đưa <strong>{outside.length} người phụ trách</strong> vào luôn làm thành viên
                    đơn vị này.
                    <span className="mt-1 block text-indigo-800">
                      Đặt người phụ trách chỉ ghi tên lên sơ đồ, không tính họ là nhân sự của đơn
                      vị — nên khoản lương khai cho đơn vị sẽ không áp cho họ.
                    </span>
                    {elsewhere.length > 0 && (
                      <span className="mt-1 block font-semibold text-amber-700">
                        {elsewhere.length} người đang thuộc đơn vị khác ({elsewhere.map((user) => unitById.get(user.unit_id || '')?.name || '?').join(', ')}).
                        Chuyển sang đây là họ thôi nhận khoản lương của đơn vị cũ.
                      </span>
                    )}
                  </span>
                </label>
              );
            })()}
          </fieldset>

          {/* ---- Vi tri cua don vi: mot khoi duy nhat ----
               Truoc day la HAI khoi canh nhau - mot de tao vi tri moi, mot de
               keo vi tri da ton tai ve day. Nguoi dung doc hai cai tieu de
               gan giong nhau roi phai tu doan cai nao lam gi. Gio gop lam mot:
               ben tren la nhung vi tri dang co, ben duoi go them vi tri moi. */}
          <fieldset className="rounded-xl border border-slate-200 p-3">
            <legend className="px-1 text-sm font-semibold text-slate-700">Vị trí trong đơn vị</legend>

            {editingUnit && positions.filter((item) => item.unit_id === editingUnit.id).length > 0 && (
              <div className="mb-3 space-y-1">
                {positions.filter((item) => item.unit_id === editingUnit.id).map((position) => (
                  <div key={position.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-sm">
                    <BriefcaseBusiness className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{position.title}</span>
                    <code className="hidden font-mono text-[11px] text-slate-400 sm:block">{position.code}</code>
                    {(positionPermissions[position.id]?.length || 0) > 0 && (
                      <Badge className="bg-indigo-50 text-indigo-700">
                        {positionPermissions[position.id].length} quyền
                      </Badge>
                    )}
                    <button
                      type="button"
                      onClick={() => { setUnitModal(false); openEditPosition(position); }}
                      aria-label={`Sửa ${position.title}`}
                      className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs leading-relaxed text-slate-500">
              Gõ tên vị trí rồi tích quyền cho nó — lưu đơn vị là tạo luôn. Mã sinh tự động.
            </p>

            <div className="mt-2 space-y-3">
              {unitForm.new_positions.map((item, index) => (
                <div key={index} className="rounded-xl border border-slate-200 p-2.5">
                  <div className="flex items-center gap-2">
                    <input
                      value={item.title}
                      onChange={(event) => setUnitForm({
                        ...unitForm,
                        new_positions: unitForm.new_positions.map((entry, i) => (
                          i === index ? { ...entry, title: event.target.value } : entry
                        )),
                      })}
                      placeholder="VD: Trưởng phòng Kho vận"
                      className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-indigo-500"
                    />
                    <code className="hidden w-28 shrink-0 truncate font-mono text-[11px] text-slate-400 sm:block">
                      {item.title.trim() ? positionCodeFrom(item.title, positions.map((entry) => entry.code)) : ''}
                    </code>
                    <button
                      type="button"
                      onClick={() => setUnitForm({
                        ...unitForm,
                        new_positions: unitForm.new_positions.filter((_, i) => i !== index),
                      })}
                      aria-label={`Bỏ vị trí thứ ${index + 1}`}
                      className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Quyen khai ngay tai day: vi tri la NOI DUY NHAT cap quyen
                      quan tri, tao xong ma khong cap thi phai nho quay lai. */}
                  <fieldset disabled={!canManagePositionPermissions || !positionPermissionsSupported} className="mt-2">
                    <p className="text-[11px] font-semibold text-slate-500">Quyền vào khu quản trị</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {ADMIN_PERMISSIONS.map((permission) => {
                        const on = item.permissions.includes(permission);
                        return (
                          <button
                            key={permission}
                            type="button"
                            onClick={() => setUnitForm({
                              ...unitForm,
                              new_positions: unitForm.new_positions.map((entry, i) => (
                                i === index
                                  ? {
                                    ...entry,
                                    permissions: on
                                      ? entry.permissions.filter((code) => code !== permission)
                                      : [...entry.permissions, permission],
                                  }
                                  : entry
                              )),
                            })}
                            aria-pressed={on}
                            title={PERMISSION_LABELS[permission].desc}
                            className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ${
                              on ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            {PERMISSION_LABELS[permission].label}
                          </button>
                        );
                      })}
                    </div>
                    {item.permissions.length === 0 && (
                      <p className="mt-1 text-[11px] text-slate-400">
                        Không tích gì thì vị trí này chỉ dùng khu nhân viên.
                      </p>
                    )}
                  </fieldset>
                </div>
              ))}
            </div>

            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="mt-2"
              onClick={() => setUnitForm({
                ...unitForm,
                new_positions: [...unitForm.new_positions, { code: '', title: '', permissions: [] }],
              })}
            >
              <Plus className="h-3.5 w-3.5" />Thêm vị trí
            </Button>
          </fieldset>


          <div className="flex gap-3 pt-2"><Button type="button" variant="outline" className="flex-1" onClick={() => setUnitModal(false)}>Hủy</Button><Button type="submit" theme="admin" className="flex-1" disabled={submitting}>{submitting ? 'Đang lưu…' : editingUnit ? 'Lưu thay đổi' : 'Tạo đơn vị'}</Button></div>
        </form>
      </Modal>

      <Modal open={positionModal} onClose={() => { setPositionModal(false); setEditingPosition(null); }} title={editingPosition ? 'Sửa vị trí chức danh' : 'Thêm vị trí chức danh'}>
        <form onSubmit={savePosition} className="space-y-4">
          <div className="grid grid-cols-2 gap-3"><Input label="Mã vị trí" value={positionForm.code} onChange={(event) => setPositionForm({ ...positionForm, code: event.target.value })} placeholder="VD: SALES-MGR" required /><Input label="Tên vị trí" value={positionForm.title} onChange={(event) => setPositionForm({ ...positionForm, title: event.target.value })} required /></div>
          <Select label="Thuộc đơn vị" value={positionForm.unit_id} onChange={(event) => setPositionForm({ ...positionForm, unit_id: event.target.value })} required><option value="">Chọn đơn vị</option>{unitOptions.map((row) => <option key={row.unit.id} value={row.unit.id}>{unitOptionLabel(row)}</option>)}</Select>
          <Select label="Báo cáo cho vị trí" value={positionForm.reports_to_position_id} onChange={(event) => setPositionForm({ ...positionForm, reports_to_position_id: event.target.value })}><option value="">Không có</option>{companyPositions.filter((position) => position.is_active && position.id !== editingPosition?.id).map((position) => <option key={position.id} value={position.id}>{position.title} · {unitById.get(position.unit_id)?.name}</option>)}</Select>
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm font-medium text-slate-700"><input type="checkbox" checked={positionForm.is_manager} onChange={(event) => setPositionForm({ ...positionForm, is_manager: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-indigo-600" /><ShieldCheck className="h-4 w-4 text-indigo-500" />Đây là vị trí quản lý</label>
          <fieldset disabled={!canManagePositionPermissions || !positionPermissionsSupported} className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
            <legend className="px-1 text-sm font-semibold text-slate-700">Quyền module mặc định</legend>
            <StaffFunctionSummary />
            <div className="mt-2 grid gap-2 sm:grid-cols-2">{ADMIN_PERMISSIONS.map((permission) => <label key={permission} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-white/70"><input type="checkbox" checked={positionForm.permissions.includes(permission)} onChange={(event) => setPositionForm({ ...positionForm, permissions: event.target.checked ? [...positionForm.permissions, permission] : positionForm.permissions.filter((item) => item !== permission) })} className="mt-0.5 h-4 w-4 accent-indigo-600" /><span className="min-w-0"><span className="font-medium">{PERMISSION_LABELS[permission].label}</span><span className="block text-xs text-slate-500">{PERMISSION_LABELS[permission].desc}</span><PermissionFunctionList permission={permission} compact /></span></label>)}</div>
            <FunctionPermissionPicker selected={positionForm.function_permissions} onChange={(function_permissions) => setPositionForm({ ...positionForm, function_permissions, permissions: Array.from(new Set([...positionForm.permissions, ...function_permissions.map((code) => ADMIN_FUNCTIONS[code].module)])) })} disabled={!canManagePositionPermissions || !positionFunctionPermissionsSupported} />
            {!canManagePositionPermissions && <p className="mt-2 text-xs text-amber-700">Chỉ Admin/CEO mới được thay đổi mẫu quyền theo vị trí.</p>}
            {!positionPermissionsSupported && <p className="mt-2 text-xs text-amber-700">Hãy chạy migration mẫu quyền theo vị trí trên Supabase để bật chức năng này.</p>}
            {!positionFunctionPermissionsSupported && <p className="mt-2 text-xs text-amber-700">Để gán chức năng nâng cao, hãy chạy migration quyền chức năng linh hoạt trên Supabase.</p>}
          </fieldset>
          <div className="flex gap-3 pt-2"><Button type="button" variant="outline" className="flex-1" onClick={() => setPositionModal(false)}>Hủy</Button><Button type="submit" theme="admin" className="flex-1" disabled={submitting}>{submitting ? 'Đang lưu…' : editingPosition ? 'Lưu thay đổi' : 'Tạo vị trí'}</Button></div>
        </form>
      </Modal>

      <Modal open={assignmentModal} onClose={() => setAssignmentModal(false)} title="Phân công nhân sự">
        <form onSubmit={assignEmployee} className="space-y-4">
          <Select label="Nhân sự" value={assignmentForm.user_id} onChange={(event) => chooseEmployee(event.target.value)} required><option value="">Chọn nhân sự</option>{users.filter((user) => user.is_active).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</Select>
          <div className="grid grid-cols-2 gap-3"><Input label="Mã nhân viên" value={assignmentForm.employee_code} onChange={(event) => setAssignmentForm({ ...assignmentForm, employee_code: event.target.value })} /><Input label="Ngày vào làm" type="date" value={assignmentForm.hire_date} onChange={(event) => setAssignmentForm({ ...assignmentForm, hire_date: event.target.value })} /></div>
          <Select label="Đơn vị" value={assignmentForm.unit_id} onChange={(event) => setAssignmentForm({ ...assignmentForm, unit_id: event.target.value, position_id: '', manager_id: '' })}><option value="">Chưa gán</option>{unitOptions.map((row) => <option key={row.unit.id} value={row.unit.id}>{unitOptionLabel(row)}</option>)}</Select>
          <Select label="Vị trí/chức danh" value={assignmentForm.position_id} onChange={(event) => setAssignmentForm({ ...assignmentForm, position_id: event.target.value })}><option value="">Chưa gán</option>{positionOptions.filter((position) => position.is_active).map((position) => <option key={position.id} value={position.id}>{position.title}</option>)}</Select>
          <div>
            <Select label="Quản lý trực tiếp" value={assignmentForm.manager_id} onChange={(event) => setAssignmentForm({ ...assignmentForm, manager_id: event.target.value })}><option value="">Chưa gán</option>{managerOptions.map((user) => <option key={user.id} value={user.id}>{user.name} · {unitById.get(user.unit_id || '')?.name}</option>)}</Select>
            <p className="mt-1 text-xs text-slate-500">Chỉ hiển thị người đang hoạt động ở cùng đơn vị hoặc đơn vị cấp trên.</p>
          </div>
          <Select label="Trạng thái nhân sự" value={assignmentForm.employment_status} onChange={(event) => setAssignmentForm({ ...assignmentForm, employment_status: event.target.value as EmploymentStatus })}>{Object.entries(EMPLOYMENT_STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
          <div className="flex gap-3 pt-2"><Button type="button" variant="outline" className="flex-1" onClick={() => setAssignmentModal(false)}>Hủy</Button><Button type="submit" theme="admin" className="flex-1" disabled={submitting || !assignmentForm.user_id}>{submitting ? 'Đang lưu…' : 'Lưu phân công'}</Button></div>
        </form>
      </Modal>
    </div>
  );
}
