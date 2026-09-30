import { useEffect, useState } from 'react';
import { Building2, CheckCircle2, ClipboardCheck, ExternalLink, Flag, Link2, MapPin, Pencil, Plus, Search, Target, Trash2, UserMinus, UserPlus } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { describeDbError } from '@/lib/dbError';
import { supabase } from '@/lib/supabase';
import { notifyUser, notifyUsers } from '@/lib/assignments';
import { hasAdminFunction, isFullAdmin, type AdminFunctionCode } from '@/lib/permissions';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { KpiReviewBoard } from '@/components/kpi/KpiReviewBoard';
import { KpiTemplateEditor } from '@/components/kpi/KpiTemplateEditor';
import { KpiSchemeBoard } from '@/components/kpi/KpiSchemeBoard';
import type { Profile } from '@/types';

type Section = 'lifecycle' | 'performance' | 'locations' | 'flags';
interface Lifecycle { id: string; user_id: string; process_type: 'ONBOARDING' | 'OFFBOARDING'; title: string; start_date: string; target_date: string | null; status: string; mentor_id: string | null }
interface Checklist { id: string; process_id: string; title: string; owner_id: string | null; due_date: string | null; completed: boolean }
interface Cycle { id: string; name: string; start_date: string; end_date: string; status: string }
interface Location { id: string; name: string; address: string | null; latitude: number | null; longitude: number | null; radius_meters: number; wifi_bssid: string | null; is_active: boolean }
interface OrganizationUnit { id: string; code: string; name: string; unit_type: string; parent_id: string | null; is_active: boolean }
interface LocationAssignment { unit_id: string; location_id: string; is_primary: boolean }
interface FeatureFlag { key: string; name: string; description: string | null; enabled: boolean }

const meta: Record<Section, { title: string; desc: string }> = {
  lifecycle: { title: 'Onboarding & Offboarding', desc: 'Checklist hội nhập 30–60–90 ngày và quy trình bàn giao khi nghỉ việc.' },
  performance: { title: 'KPI & đánh giá', desc: 'Bộ tiêu chí, cơ chế theo người và kết quả chấm điểm.' },
  locations: { title: 'Địa điểm chấm công', desc: 'Cấu hình chi nhánh, bán kính GPS và Wi-Fi dự phòng cho check-in.' },
  flags: { title: 'Feature Flags', desc: 'Bật hoặc tắt an toàn các chức năng mới trước khi áp dụng toàn công ty.' },
};

const emptyProcess = { user_id: '', process_type: 'ONBOARDING', title: '', start_date: new Date().toISOString().slice(0, 10), target_date: '', mentor_id: '' };
const emptyItem = { process_id: '', title: '', owner_id: '', due_date: '' };
const emptyCycle = { name: '', start_date: '', end_date: '', status: 'DRAFT' };
const emptyLocation = { name: '', address: '', maps_url: '', latitude: '', longitude: '', radius_meters: '200', wifi_bssid: '', unit_ids: [] as string[] };

export function AdminNexusCenter({ section }: { section: Section }) {
  const { profile } = useAuth();
  // 'locations' không còn route trỏ tới (màn "Điểm chấm công" đã bỏ khỏi menu
  // — chỉ còn dùng dữ liệu từ máy chấm công) nên không còn mã quyền riêng;
  // giữ lại mã nghiệp vụ cho 3 mục còn route, 'locations' chỉ full admin mới
  // đụng được (dead code, không ai vào được qua route nữa).
  const functionCode: AdminFunctionCode | null = (
    { lifecycle: 'admin.employee_lifecycle', performance: 'admin.performance_manage', locations: null, flags: 'admin.feature_flags' } as const
  )[section];
  const canManage = isFullAdmin(profile) || (functionCode !== null && hasAdminFunction(profile, functionCode));
  const { toast } = useToast();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [processes, setProcesses] = useState<Lifecycle[]>([]);
  const [items, setItems] = useState<Checklist[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [units, setUnits] = useState<OrganizationUnit[]>([]);
  const [locationAssignments, setLocationAssignments] = useState<LocationAssignment[]>([]);
  const [assignmentSupported, setAssignmentSupported] = useState(true);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [modal, setModal] = useState<'process' | 'item' | 'cycle' | 'location' | null>(null);
  const [processForm, setProcessForm] = useState(emptyProcess);
  const [itemForm, setItemForm] = useState(emptyItem);
  const [cycleForm, setCycleForm] = useState(emptyCycle);
  const [locationForm, setLocationForm] = useState(emptyLocation);
  const [saving, setSaving] = useState(false);
  const [resolvingMap, setResolvingMap] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    const [results, unitsResult, assignmentsResult] = await Promise.all([
      Promise.all([
      supabase.from('profiles').select('*').eq('is_active', true).order('name'),
      supabase.from('employee_lifecycle_processes').select('*').order('created_at', { ascending: false }),
      supabase.from('employee_checklist_items').select('*').order('order_index'),
      supabase.from('performance_cycles').select('*').order('start_date', { ascending: false }),
      supabase.from('work_locations').select('*').order('name'),
      supabase.from('feature_flags').select('*').order('name'),
      ]),
      supabase.from('organization_units').select('id,code,name,unit_type,parent_id,is_active').eq('is_active', true).order('name'),
      supabase.from('organization_unit_work_locations').select('unit_id,location_id,is_primary'),
    ]);
    const featureError = results.slice(1).find((result) => result.error)?.error;
    if (featureError) setError(`Các capability Nexus HRM chưa được khởi tạo trên Supabase. Hãy chạy migration 20260908170000_nexus_hrm_capabilities.sql. Chi tiết: ${describeDbError(featureError)}`);
    setProfiles((results[0].data || []) as Profile[]); setProcesses((results[1].data || []) as Lifecycle[]); setItems((results[2].data || []) as Checklist[]); setCycles((results[3].data || []) as Cycle[]); setLocations((results[4].data || []) as Location[]); setFlags((results[5].data || []) as FeatureFlag[]);
    setUnits((unitsResult.data || []) as OrganizationUnit[]);
    setAssignmentSupported(!assignmentsResult.error);
    setLocationAssignments((assignmentsResult.data || []) as LocationAssignment[]);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);
  useRealtimeSync([
    { table: 'employee_lifecycle_processes' }, { table: 'employee_checklist_items' },
    { table: 'performance_cycles' },
    { table: 'work_locations' }, { table: 'feature_flags' },
    { table: 'organization_units' }, { table: 'organization_unit_work_locations' },
  ], () => load(), { channelKey: `nexus-${section}` });

  const person = (id: string | null) => profiles.find((item) => item.id === id);
  const save = async (event: React.FormEvent) => {
    if (!canManage) return;
    event.preventDefault(); setSaving(true); let result;
    const savedModal = modal;
    if (modal === 'process') { const payload = { ...processForm, target_date: processForm.target_date || null, mentor_id: processForm.mentor_id || null, created_by: profile?.id }; result = editingId ? await supabase.from('employee_lifecycle_processes').update(payload).eq('id', editingId) : await supabase.from('employee_lifecycle_processes').insert(payload); }
    else if (modal === 'item') result = await supabase.from('employee_checklist_items').insert({ ...itemForm, owner_id: itemForm.owner_id || null, due_date: itemForm.due_date || null, order_index: items.filter((item) => item.process_id === itemForm.process_id).length });
    else if (modal === 'cycle') result = editingId ? await supabase.from('performance_cycles').update(cycleForm).eq('id', editingId) : await supabase.from('performance_cycles').insert(cycleForm);
    else {
      const payload = { name: locationForm.name, address: locationForm.address || null, latitude: locationForm.latitude ? Number(locationForm.latitude) : null, longitude: locationForm.longitude ? Number(locationForm.longitude) : null, radius_meters: Number(locationForm.radius_meters), wifi_bssid: locationForm.wifi_bssid || null };
      const locationResult = editingId
        ? await supabase.from('work_locations').update(payload).eq('id', editingId).select('id').single()
        : await supabase.from('work_locations').insert(payload).select('id').single();
      result = locationResult;
      const savedLocationId = locationResult.data?.id || editingId;
      if (!locationResult.error && savedLocationId && assignmentSupported) {
        const { error: clearAssignmentsError } = await supabase.from('organization_unit_work_locations').delete().eq('location_id', savedLocationId);
        if (clearAssignmentsError) result = { error: clearAssignmentsError };
        else if (locationForm.unit_ids.length > 0) {
          const { error: assignError } = await supabase.from('organization_unit_work_locations').insert(locationForm.unit_ids.map((unit_id, index) => ({ unit_id, location_id: savedLocationId, is_primary: index === 0 })));
          if (assignError) result = { error: assignError };
        }
      }
    }
    setSaving(false); if (result.error) { toast('Không thể lưu: ' + describeDbError(result.error), 'error'); return; }
    if (savedModal === 'process' && processForm.user_id) {
      await notifyUser(processForm.user_id, processForm.process_type === 'ONBOARDING' ? 'Đã tạo lộ trình hội nhập' : 'Đã tạo quy trình nghỉ việc', processForm.title, 'lifecycle_assigned');
      if (processForm.mentor_id && processForm.mentor_id !== processForm.user_id) await notifyUser(processForm.mentor_id, 'Bạn được giao phụ trách quy trình nhân sự', processForm.title, 'lifecycle_mentor');
    } else if (savedModal === 'item' && itemForm.process_id) {
      const targetProcess = processes.find((item) => item.id === itemForm.process_id);
      await notifyUsers([...new Set([targetProcess?.user_id, itemForm.owner_id].filter((id): id is string => Boolean(id)))], 'Checklist nhân sự có công việc mới', itemForm.title, 'lifecycle_task');
    }
    toast(editingId ? 'Đã cập nhật dữ liệu.' : 'Đã lưu dữ liệu.', 'success'); setModal(null); setEditingId(null); setProcessForm(emptyProcess); setItemForm(emptyItem); setCycleForm(emptyCycle); setLocationForm(emptyLocation); await load();
  };

  const openEditProcess = (item: Lifecycle) => { setEditingId(item.id); setProcessForm({ user_id: item.user_id, process_type: item.process_type, title: item.title, start_date: item.start_date, target_date: item.target_date || '', mentor_id: item.mentor_id || '' }); setModal('process'); };
  const openEditCycle = (item: Cycle) => { setEditingId(item.id); setCycleForm({ name: item.name, start_date: item.start_date, end_date: item.end_date, status: item.status }); setModal('cycle'); };
  const openEditLocation = (item: Location) => { setEditingId(item.id); setLocationForm({ name: item.name, address: item.address || '', maps_url: locationMapsUrl(item) || '', latitude: item.latitude == null ? '' : String(item.latitude), longitude: item.longitude == null ? '' : String(item.longitude), radius_meters: String(item.radius_meters), wifi_bssid: item.wifi_bssid || '', unit_ids: locationAssignments.filter((assignment) => assignment.location_id === item.id).map((assignment) => assignment.unit_id) }); setModal('location'); };

  const applyGoogleMapsUrl = async () => {
    const mapsUrl = locationForm.maps_url.trim();
    if (!mapsUrl || resolvingMap) return;
    setResolvingMap(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const response = await fetch('/api/google-maps-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionData.session?.access_token || ''}` },
        body: JSON.stringify({ url: mapsUrl }),
      });
      const data = await response.json() as { latitude?: number; longitude?: number; address?: string; error?: string };
      if (!response.ok || data.latitude == null || data.longitude == null) throw new Error(data.error || 'Không đọc được tọa độ từ link Google Maps.');
      setLocationForm((current) => ({
        ...current,
        latitude: String(data.latitude),
        longitude: String(data.longitude),
        address: data.address || current.address,
      }));
      toast(data.address ? 'Đã tự động điền địa chỉ và tọa độ.' : 'Đã tự động điền tọa độ.', 'success');
    } catch (mapError) {
      toast(mapError instanceof Error ? mapError.message : 'Không xử lý được link Google Maps.', 'error');
    } finally {
      setResolvingMap(false);
    }
  };

  const removeRecord = async (table: string, idColumn: string, id: string, label: string) => {
    if (!canManage) return;
    if (!await confirm({ title: `Xóa “${label}”?`, message: 'Dữ liệu liên quan có thể được xóa theo. Hãy kiểm tra trước khi xác nhận.', confirmLabel: 'Xóa', danger: true })) return;
    const { error: removeError } = await supabase.from(table).delete().eq(idColumn, id);
    if (removeError) toast('Không thể xóa: ' + describeDbError(removeError), 'error'); else { toast('Đã xóa dữ liệu.', 'success'); await load(); }
  };

  const toggleChecklist = async (item: Checklist) => { if (!canManage) return; const { error: updateError } = await supabase.from('employee_checklist_items').update({ completed: !item.completed, completed_at: !item.completed ? new Date().toISOString() : null }).eq('id', item.id); if (updateError) toast(describeDbError(updateError), 'error'); else await load(); };
  const toggleFlag = async (flag: FeatureFlag) => { if (!canManage) return; const { error: updateError } = await supabase.from('feature_flags').update({ enabled: !flag.enabled, updated_by: profile?.id, updated_at: new Date().toISOString() }).eq('key', flag.key); if (updateError) toast(describeDbError(updateError), 'error'); else { toast(`${flag.name}: ${!flag.enabled ? 'đã bật' : 'đã tắt'}.`, 'success'); await load(); } };

  const keyword = query.trim().toLowerCase();
  const visibleProcesses = processes.filter((item) => !keyword || `${item.title} ${person(item.user_id)?.name || ''}`.toLowerCase().includes(keyword));
  const visibleCycles = cycles.filter((item) => !keyword || item.name.toLowerCase().includes(keyword));
  const visibleLocations = locations.filter((item) => !keyword || `${item.name} ${item.address || ''}`.toLowerCase().includes(keyword));
  const assignedUnitNames = (locationId: string) => locationAssignments.filter((assignment) => assignment.location_id === locationId).map((assignment) => units.find((unit) => unit.id === assignment.unit_id)?.name).filter((name): name is string => Boolean(name));
  const gpsFlag = flags.find((flag) => flag.key === 'geofence_attendance');

  if (loading) return <Card><CardContent><p className="py-16 text-center text-sm text-slate-400">Đang tải capability Nexus HRM…</p></CardContent></Card>;
  if (error) return <Card><ErrorState message={error} onRetry={load} /></Card>;
  const info = meta[section];

  return <div className="space-y-5">


    {section !== 'flags' && <Card><CardContent className="flex items-center gap-3 py-3"><Search className="h-4 w-4 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm trong module..." className="w-full bg-transparent text-sm outline-none" /></CardContent></Card>}

    {section === 'lifecycle' && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{visibleProcesses.map((process) => { const processItems = items.filter((item) => item.process_id === process.id); const done = processItems.filter((item) => item.completed).length; return <Card key={process.id}><CardHeader><div className="flex items-center justify-between gap-3"><CardTitle className="flex items-center gap-2">{process.process_type === 'ONBOARDING' ? <UserPlus className="w-5 h-5 text-emerald-600" /> : <UserMinus className="w-5 h-5 text-rose-600" />}{process.title}</CardTitle><div className="flex items-center gap-1"><Badge className={process.process_type === 'ONBOARDING' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}>{process.process_type === 'ONBOARDING' ? 'Hội nhập' : 'Nghỉ việc'}</Badge><Button variant="secondary" onClick={() => openEditProcess(process)} aria-label="Sửa quy trình"><Pencil className="h-4 w-4" /></Button><Button variant="danger" onClick={() => void removeRecord('employee_lifecycle_processes', 'id', process.id, process.title)} aria-label="Xóa quy trình"><Trash2 className="h-4 w-4" /></Button></div></div></CardHeader><CardContent><p className="text-sm font-medium text-slate-700">{person(process.user_id)?.name || 'Nhân viên'}</p><p className="text-xs text-slate-400 mt-1">Mentor: {person(process.mentor_id)?.name || 'Chưa gán'} · Mục tiêu: {fmt(process.target_date)}</p><div className="mt-4 h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-indigo-600" style={{ width: `${processItems.length ? done / processItems.length * 100 : 0}%` }} /></div><p className="text-xs text-slate-500 mt-1.5">{done}/{processItems.length} mục hoàn thành</p><div className="mt-4 space-y-2">{processItems.map((item) => <div key={item.id} className="flex items-center gap-1"><button onClick={() => void toggleChecklist(item)} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-2 text-left hover:bg-slate-50"><CheckCircle2 className={`w-4 h-4 ${item.completed ? 'text-emerald-600' : 'text-slate-300'}`} /><span className={`truncate text-sm ${item.completed ? 'line-through text-slate-400' : 'text-slate-700'}`}>{item.title}</span><span className="ml-auto text-xs text-slate-400">{fmt(item.due_date)}</span></button><Button variant="danger" onClick={() => void removeRecord('employee_checklist_items', 'id', item.id, item.title)} aria-label="Xóa checklist"><Trash2 className="h-4 w-4" /></Button></div>)}</div></CardContent></Card>})}{visibleProcesses.length === 0 && <Card className="lg:col-span-2"><EmptyState icon={<UserPlus className="w-7 h-7" />} title="Không có quy trình phù hợp" description="Tạo quy trình mới hoặc đổi từ khóa tìm kiếm." /></Card>}</div>}

    {section === 'performance' && canManage && <KpiSchemeBoard />}
    {section === 'performance' && canManage && <KpiTemplateEditor actorId={profile?.id ?? null} />}
    {section === 'performance' && canManage && <KpiReviewBoard profiles={profiles} actorId={profile?.id ?? null} />}


    {section === 'locations' && <>
      {gpsFlag && <Card className="border-indigo-100 bg-indigo-50/50"><CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${gpsFlag.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}><MapPin className="h-5 w-5" /></span><div><p className="font-semibold text-slate-800">Kiểm soát GPS {gpsFlag.enabled ? 'đang bật' : 'đang tắt'}</p><p className="mt-0.5 text-sm text-slate-600">{gpsFlag.enabled ? 'Nhân viên phải cho phép Vị trí trên trình duyệt và đứng trong điểm được gán theo đơn vị.' : 'Đang cho phép chấm công không giới hạn theo vị trí.'}</p></div></div><Button variant={gpsFlag.enabled ? 'secondary' : 'outline'} onClick={() => void toggleFlag(gpsFlag)}>{gpsFlag.enabled ? 'Tắt kiểm soát GPS' : 'Bật kiểm soát GPS'}</Button></CardContent></Card>}
      {!assignmentSupported && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Chưa có bảng gán điểm theo đơn vị. Hãy chạy migration <code className="font-semibold">20260921170000_organization_attendance_locations.sql</code>; hiện tại hệ thống vẫn giữ cơ chế dùng chung các điểm chấm công.</div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{visibleLocations.map((location) => { const mapsUrl = locationMapsUrl(location); const locationUnits = assignedUnitNames(location.id); return <Card key={location.id}><CardContent><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><span className="w-10 h-10 shrink-0 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center"><Building2 className="w-5 h-5" /></span><div className="min-w-0"><p className="font-semibold text-slate-800">{location.name}</p><p className="truncate text-xs text-slate-500">{location.address || 'Chưa cập nhật địa chỉ'}</p></div></div><div className="flex items-center gap-1"><Badge className={location.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}>{location.is_active ? 'Hoạt động' : 'Tạm tắt'}</Badge><Button variant="secondary" onClick={() => openEditLocation(location)} aria-label="Sửa địa điểm"><Pencil className="h-4 w-4" /></Button><Button variant="danger" onClick={() => void removeRecord('work_locations', 'id', location.id, location.name)} aria-label="Xóa địa điểm"><Trash2 className="h-4 w-4" /></Button></div></div><div className="grid grid-cols-2 gap-3 mt-4"><Metric label="Bán kính GPS" value={`${location.radius_meters} m`} /><Metric label="Wi-Fi BSSID" value={location.wifi_bssid || 'Chưa cấu hình'} /></div><div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Đơn vị được phép</p><p className="mt-1 text-sm text-slate-700">{locationUnits.length ? locationUnits.join(', ') : 'Dùng chung cho mọi đơn vị'}</p></div>{mapsUrl ? <a href={mapsUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100"><MapPin className="h-4 w-4" />Xem trên Google Maps<ExternalLink className="h-3.5 w-3.5" /></a> : <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">Chưa có tọa độ để mở bản đồ.</p>}</CardContent></Card>; })}{visibleLocations.length === 0 && <Card className="lg:col-span-2"><EmptyState icon={<MapPin className="w-7 h-7" />} title="Không tìm thấy địa điểm chấm công" /></Card>}</div>
    </>}

    {section === 'flags' && <Card><CardContent className="divide-y divide-slate-100">{flags.map((flag) => <div key={flag.key} className="py-4 first:pt-0 last:pb-0 flex items-center justify-between gap-4"><div className="flex items-start gap-3"><span className={`w-10 h-10 rounded-xl flex items-center justify-center ${flag.enabled ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}><Flag className="w-5 h-5" /></span><div><p className="font-medium text-slate-800">{flag.name}</p><p className="text-sm text-slate-500 mt-0.5">{flag.description}</p><code className="text-[11px] text-slate-400">{flag.key}</code></div></div><button onClick={() => void toggleFlag(flag)} className={`w-12 h-7 rounded-full p-1 transition-colors ${flag.enabled ? 'bg-indigo-600' : 'bg-slate-200'}`} aria-label={`${flag.enabled ? 'Tắt' : 'Bật'} ${flag.name}`}><span className={`block w-5 h-5 bg-white rounded-full shadow transition-transform ${flag.enabled ? 'translate-x-5' : ''}`} /></button></div>)}</CardContent></Card>}

    <Modal open={modal === 'process'} onClose={() => setModal(null)} title="Tạo quy trình nhân sự"><form onSubmit={save} className="space-y-4"><Select label="Nhân viên" value={processForm.user_id} onChange={(e) => setProcessForm({ ...processForm, user_id: e.target.value })} required><option value="">Chọn nhân viên</option>{profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select><Select label="Loại quy trình" value={processForm.process_type} onChange={(e) => setProcessForm({ ...processForm, process_type: e.target.value })}><option value="ONBOARDING">Onboarding</option><option value="OFFBOARDING">Offboarding</option></Select><Input label="Tên quy trình" value={processForm.title} onChange={(e) => setProcessForm({ ...processForm, title: e.target.value })} required /><div className="grid grid-cols-2 gap-3"><Input label="Ngày bắt đầu" type="date" value={processForm.start_date} onChange={(e) => setProcessForm({ ...processForm, start_date: e.target.value })} /><Input label="Ngày mục tiêu" type="date" value={processForm.target_date} onChange={(e) => setProcessForm({ ...processForm, target_date: e.target.value })} /></div><Select label="Mentor / người phụ trách" value={processForm.mentor_id} onChange={(e) => setProcessForm({ ...processForm, mentor_id: e.target.value })}><option value="">Chưa gán</option>{profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select><Actions saving={saving} close={() => setModal(null)} /></form></Modal>
    <Modal open={modal === 'item'} onClose={() => setModal(null)} title="Thêm mục checklist"><form onSubmit={save} className="space-y-4"><Select label="Quy trình" value={itemForm.process_id} onChange={(e) => setItemForm({ ...itemForm, process_id: e.target.value })} required><option value="">Chọn quy trình</option>{processes.map((item) => <option key={item.id} value={item.id}>{item.title} · {person(item.user_id)?.name}</option>)}</Select><Input label="Công việc cần hoàn thành" value={itemForm.title} onChange={(e) => setItemForm({ ...itemForm, title: e.target.value })} required /><Select label="Người phụ trách" value={itemForm.owner_id} onChange={(e) => setItemForm({ ...itemForm, owner_id: e.target.value })}><option value="">Chưa gán</option>{profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select><Input label="Hạn hoàn thành" type="date" value={itemForm.due_date} onChange={(e) => setItemForm({ ...itemForm, due_date: e.target.value })} /><Actions saving={saving} close={() => setModal(null)} /></form></Modal>
    <Modal open={modal === 'cycle'} onClose={() => setModal(null)} title="Tạo chu kỳ đánh giá"><form onSubmit={save} className="space-y-4"><Input label="Tên chu kỳ" value={cycleForm.name} onChange={(e) => setCycleForm({ ...cycleForm, name: e.target.value })} required /><div className="grid grid-cols-2 gap-3"><Input label="Bắt đầu" type="date" value={cycleForm.start_date} onChange={(e) => setCycleForm({ ...cycleForm, start_date: e.target.value })} required /><Input label="Kết thúc" type="date" value={cycleForm.end_date} onChange={(e) => setCycleForm({ ...cycleForm, end_date: e.target.value })} required /></div><Select label="Trạng thái" value={cycleForm.status} onChange={(e) => setCycleForm({ ...cycleForm, status: e.target.value })}><option value="DRAFT">Bản nháp</option><option value="ACTIVE">Đang diễn ra</option><option value="CLOSED">Đã đóng</option></Select><Actions saving={saving} close={() => setModal(null)} /></form></Modal>
    <Modal open={modal === 'location'} onClose={() => setModal(null)} title={editingId ? 'Sửa địa điểm chấm công' : 'Thêm địa điểm chấm công'}>
      <form onSubmit={save} className="space-y-4">
        <Input label="Tên địa điểm" value={locationForm.name} onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })} required />
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3">
          <Input label="Link Google Maps" type="url" value={locationForm.maps_url} onChange={(e) => setLocationForm({ ...locationForm, maps_url: e.target.value })} onBlur={() => void applyGoogleMapsUrl()} placeholder="https://maps.app.goo.gl/..." />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">Dán link rồi chuyển sang ô khác; hệ thống tự điền địa chỉ và tọa độ. Địa chỉ tham khảo từ OpenStreetMap.</p>
            <Button type="button" size="sm" variant="outline" onMouseDown={(event) => event.preventDefault()} onClick={() => void applyGoogleMapsUrl()} disabled={!locationForm.maps_url || resolvingMap}><Link2 className="h-4 w-4" />{resolvingMap ? 'Đang tra cứu…' : 'Tra cứu lại'}</Button>
          </div>
        </div>
        <Input label="Địa chỉ" value={locationForm.address} onChange={(e) => setLocationForm({ ...locationForm, address: e.target.value })} />
        <div className="grid grid-cols-2 gap-3"><Input label="Vĩ độ" type="number" step="any" value={locationForm.latitude} onChange={(e) => setLocationForm({ ...locationForm, latitude: e.target.value })} /><Input label="Kinh độ" type="number" step="any" value={locationForm.longitude} onChange={(e) => setLocationForm({ ...locationForm, longitude: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3"><Input label="Bán kính (m)" type="number" min="20" value={locationForm.radius_meters} onChange={(e) => setLocationForm({ ...locationForm, radius_meters: e.target.value })} /><Input label="Wi-Fi BSSID" value={locationForm.wifi_bssid} onChange={(e) => setLocationForm({ ...locationForm, wifi_bssid: e.target.value })} placeholder="AA:BB:CC:DD:EE:FF" /></div>
        <fieldset className="rounded-xl border border-slate-200 p-3">
          <legend className="px-1 text-sm font-semibold text-slate-700">Đơn vị được phép chấm công</legend>
          {units.length > 0 ? <div className="mt-2 grid max-h-44 gap-2 overflow-y-auto sm:grid-cols-2">{units.map((unit) => <label key={unit.id} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"><input type="checkbox" checked={locationForm.unit_ids.includes(unit.id)} onChange={(event) => setLocationForm({ ...locationForm, unit_ids: event.target.checked ? [...locationForm.unit_ids, unit.id] : locationForm.unit_ids.filter((id) => id !== unit.id) })} className="mt-0.5 h-4 w-4 accent-indigo-600" /><span><span className="font-medium">{unit.name}</span><span className="ml-1 text-xs text-slate-400">({unit.code})</span></span></label>)}</div> : <p className="mt-2 text-sm text-slate-500">Chưa có đơn vị hoạt động trong cơ cấu tổ chức.</p>}
          <p className="mt-2 text-xs text-slate-500">Không chọn đơn vị = địa điểm dùng chung cho mọi nhân viên. Nếu chọn, nhân viên thuộc đơn vị đó (hoặc đơn vị cha) mới được dùng điểm này.</p>
        </fieldset>
        <Actions saving={saving || resolvingMap} close={() => setModal(null)} />
      </form>
    </Modal>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-400">{label}</p><p className="text-sm font-medium text-slate-700 mt-0.5">{value}</p></div>; }
function Actions({ saving, close }: { saving: boolean; close: () => void }) { return <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="secondary" onClick={close}>Hủy</Button><Button type="submit" disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu dữ liệu'}</Button></div>; }
function fmt(value: string | null) { return value ? new Date(`${value}T00:00:00`).toLocaleDateString('vi-VN') : '—'; }

function locationMapsUrl(location: Pick<Location, 'latitude' | 'longitude' | 'address'>) {
  if (location.latitude != null && location.longitude != null) return `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`;
  if (location.address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.address)}`;
  return null;
}
