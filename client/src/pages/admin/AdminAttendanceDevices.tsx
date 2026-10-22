import { useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, Clipboard, Cpu, KeyRound, Link2, Pencil, Plus, RefreshCw, Trash2, TriangleAlert, Wifi, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useToast } from '@/contexts/ToastContext';
import { describeDbError } from '@/lib/dbError';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/utils';
import type { AttendanceDevice, AttendanceDeviceEvent, AttendanceDeviceMapping, AttendanceDeviceSyncRun, Profile } from '@/types';
import { AttendanceFileImport } from '@/components/attendance/AttendanceFileImport';
import { AttendanceImportHistory } from '@/components/attendance/AttendanceImportHistory';

type WorkLocation = { id: string; name: string; address: string | null };

const EMPTY_DEVICE = {
  name: '', model: '', serial_number: '', location_id: '', timezone: 'Asia/Ho_Chi_Minh',
  device_code: '', device_number: '', ip_address: '', port: '4370', connection_type: 'TCP',
  baud_rate: '115200', comm_password: '', direction: 'BOTH', use_web_address: false,
  web_address: '', registration_number: '', license: '', is_active: true, sync_mode: 'ADMS',
};
type DeviceForm = typeof EMPTY_DEVICE;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const DIRECTION_LABEL: Record<string, string> = { IN: 'Vào', OUT: 'Ra', BOTH: 'Vào/Ra' };

const toForm = (device: AttendanceDevice): DeviceForm => ({
  name: device.name,
  model: device.model ?? '',
  serial_number: device.serial_number ?? '',
  location_id: device.location_id ?? '',
  timezone: device.timezone,
  device_code: device.device_code ?? '',
  device_number: device.device_number == null ? '' : String(device.device_number),
  ip_address: device.ip_address ?? '',
  port: String(device.port ?? 4370),
  connection_type: device.connection_type ?? 'TCP',
  baud_rate: String(device.baud_rate ?? 115200),
  comm_password: device.comm_password ?? '',
  direction: device.direction ?? 'BOTH',
  use_web_address: !!device.use_web_address,
  web_address: device.web_address ?? '',
  registration_number: device.registration_number ?? '',
  license: device.license ?? '',
  is_active: device.is_active,
  sync_mode: device.sync_mode ?? 'BRIDGE',
});

const blankToNull = (value: string) => value.trim() || null;

export function AdminAttendanceDevices() {
  const toast = useToast().toast;
  const confirm = useConfirm();
  const [devices, setDevices] = useState<AttendanceDevice[]>([]);
  const [mappings, setMappings] = useState<AttendanceDeviceMapping[]>([]);
  const [events, setEvents] = useState<AttendanceDeviceEvent[]>([]);
  const [syncRuns, setSyncRuns] = useState<AttendanceDeviceSyncRun[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [locations, setLocations] = useState<WorkLocation[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deviceModal, setDeviceModal] = useState(false);
  const [deviceForm, setDeviceForm] = useState<DeviceForm>(EMPTY_DEVICE);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mappingUserId, setMappingUserId] = useState('');
  const [mappingProfileId, setMappingProfileId] = useState('');
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  const selected = devices.find((item) => item.id === selectedId) || devices[0];
  const adms = selected?.sync_mode === 'ADMS';
  const profileById = new Map(profiles.map((item) => [item.id, item]));
  const selectedMappings = mappings
    .filter((item) => item.device_id === selected?.id)
    .map((item) => ({ ...item, profile: item.profile ?? profileById.get(item.profile_id) }));
  const selectedEvents = events.filter((item) => item.device_id === selected?.id);
  const selectedRuns = syncRuns.filter((item) => item.device_id === selected?.id);
  const mappedProfileIds = new Set(selectedMappings.map((item) => item.profile_id));
  const availableProfiles = profiles.filter((item) => !mappedProfileIds.has(item.id));
  const unmappedCodes = useMemo(
    () => [...new Set(selectedEvents.filter((item) => item.processing_error === 'UNMAPPED_USER').map((item) => item.device_user_id))],
    [selectedEvents],
  );

  const loadData = async () => {
    setLoading(true);
    const [deviceRes, mappingRes, eventRes, profileRes, locationRes, runRes] = await Promise.all([
      supabase.from('attendance_devices').select('*, location:work_locations(id,name)').order('created_at'),
      supabase.from('attendance_device_mappings').select('*').order('device_user_id'),
      supabase.from('attendance_device_events').select('id,device_id,device_user_id,profile_id,punched_at,processing_error,received_at').not('processing_error', 'is', null).order('punched_at', { ascending: false }).limit(200),
      supabase.from('profiles_directory').select('*').eq('is_active', true).order('name'),
      supabase.from('work_locations').select('id,name,address').eq('is_active', true).order('name'),
      supabase.from('attendance_device_sync_runs').select('*').order('started_at', { ascending: false }).limit(50),
    ]);
    const firstError = deviceRes.error || mappingRes.error || eventRes.error || profileRes.error || locationRes.error;
    setError(firstError ? describeDbError(firstError) : null);
    const nextDevices = (deviceRes.data || []) as AttendanceDevice[];
    setDevices(nextDevices);
    setMappings((mappingRes.data || []) as AttendanceDeviceMapping[]);
    setEvents((eventRes.data || []) as AttendanceDeviceEvent[]);
    setProfiles((profileRes.data || []) as Profile[]);
    setLocations((locationRes.data || []) as WorkLocation[]);
    setSyncRuns((runRes.data || []) as AttendanceDeviceSyncRun[]);
    if (!selectedId && nextDevices[0]) setSelectedId(nextDevices[0].id);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const openCreate = () => {
    setEditingId(null);
    setDeviceForm(EMPTY_DEVICE);
    setDeviceModal(true);
  };

  const openEdit = () => {
    if (!selected) return;
    setEditingId(selected.id);
    setDeviceForm(toForm(selected));
    setDeviceModal(true);
  };

  const closeDeviceModal = () => {
    setDeviceModal(false);
    setEditingId(null);
  };

  const formError = (): string | null => {
    const ip = deviceForm.ip_address.trim();
    if (ip && !IPV4.test(ip) && deviceForm.connection_type !== 'SERIAL') return 'Địa chỉ IP phải có dạng 192.168.1.201.';
    const port = Number(deviceForm.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return 'Port phải là số từ 1 đến 65535.';
    const baud = Number(deviceForm.baud_rate);
    if (!Number.isInteger(baud) || baud <= 0) return 'Tốc độ truyền phải là số nguyên dương.';
    if (deviceForm.device_number.trim() && !/^\d+$/.test(deviceForm.device_number.trim())) return 'ID máy phải là số.';
    return null;
  };

  const saveDevice = async () => {
    if (!deviceForm.name.trim()) return;
    const invalid = formError();
    if (invalid) return toast(invalid, 'error');
    setBusy(true);
    const payload = {
      name: deviceForm.name.trim(),
      model: blankToNull(deviceForm.model),
      serial_number: blankToNull(deviceForm.serial_number),
      location_id: deviceForm.location_id || null,
      timezone: deviceForm.timezone,
      device_code: blankToNull(deviceForm.device_code),
      device_number: deviceForm.device_number.trim() ? Number(deviceForm.device_number) : null,
      ip_address: blankToNull(deviceForm.ip_address),
      port: Number(deviceForm.port),
      connection_type: deviceForm.connection_type,
      baud_rate: Number(deviceForm.baud_rate),
      comm_password: blankToNull(deviceForm.comm_password),
      direction: deviceForm.direction,
      use_web_address: deviceForm.use_web_address,
      web_address: deviceForm.use_web_address ? blankToNull(deviceForm.web_address) : null,
      registration_number: blankToNull(deviceForm.registration_number),
      license: blankToNull(deviceForm.license),
      is_active: deviceForm.is_active,
      sync_mode: deviceForm.sync_mode,
    };
    const query = editingId
      ? supabase.from('attendance_devices').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editingId)
      : supabase.from('attendance_devices').insert(payload);
    const { data, error: saveError } = await query.select().single();
    setBusy(false);
    if (saveError) {
      return toast(/column .* does not exist|schema cache/i.test(saveError.message || '')
        ? 'Chưa cập nhật cơ sở dữ liệu. Chạy supabase/paste-thong-tin-ket-noi-may.sql và supabase/paste-che-do-adms.sql trên Supabase.'
        : `Không lưu được thiết bị: ${describeDbError(saveError)}`, 'error');
    }
    closeDeviceModal();
    setDeviceForm(EMPTY_DEVICE);
    toast(editingId ? 'Đã lưu thông tin máy chấm công.' : 'Đã tạo máy chấm công.', 'success');
    await loadData();
    setSelectedId(data.id);
  };

  const deleteDevice = async () => {
    if (!selected) return;
    const ok = await confirm({
      title: 'Xóa máy chấm công?',
      message: `Xóa cấu hình “${selected.name}”, token, ánh xạ và log thô của máy. Ngày công đã tạo vẫn được giữ lại.`,
      confirmLabel: 'Xóa thiết bị',
      danger: true,
    });
    if (!ok) return;
    const { error: deleteError } = await supabase.from('attendance_devices').delete().eq('id', selected.id);
    if (deleteError) return toast(`Không xóa được: ${describeDbError(deleteError)}`, 'error');
    setSelectedId('');
    toast('Đã xóa cấu hình máy chấm công.', 'success');
    loadData();
  };

  const requestSync = async () => {
    if (!selected) return;
    setBusy(true);
    const { error: syncError } = await supabase.rpc('request_attendance_device_sync', { target_device: selected.id });
    setBusy(false);
    if (syncError) {
      // Migration chua chay thi bao dung viec can lam, dung de nguoi dung doan.
      return toast(/does not exist|schema cache/i.test(syncError.message || '')
        ? 'Chưa bật tính năng này. Chạy supabase/paste-cap-nhat-dong-bo.sql trên Supabase.'
        : `Không yêu cầu được đồng bộ: ${describeDbError(syncError)}`, 'error');
    }
    toast('Đã gửi lệnh. Bridge sẽ đọc máy trong vài chục giây.', 'success');
    loadData();
  };

  const issueToken = async () => {
    if (!selected) return;
    setBusy(true);
    const { data, error: tokenError } = await supabase.rpc('issue_attendance_device_token', {
      target_device: selected.id,
      token_label: `${adms ? 'ADMS' : 'Bridge'} ${selected.name}`,
    });
    setBusy(false);
    if (tokenError) return toast(`Không tạo được token: ${describeDbError(tokenError)}`, 'error');
    setIssuedToken(String(data));
  };

  const revokeTokens = async () => {
    if (!selected) return;
    const ok = await confirm({
      title: 'Thu hồi mọi token?',
      message: adms
        ? 'Máy sẽ ngừng đẩy được dữ liệu lên HRM cho tới khi bạn tạo token mới, đặt vào biến ATTENDANCE_BRIDGE_TOKEN trên máy chủ rồi triển khai lại. Dữ liệu vẫn nằm trong máy và sẽ gửi bù sau.'
        : 'Bridge đang chạy sẽ ngừng đồng bộ cho tới khi bạn tạo và cấu hình token mới.',
      confirmLabel: 'Thu hồi',
      danger: true,
    });
    if (!ok) return;
    const { data, error: revokeError } = await supabase.rpc('revoke_attendance_device_tokens', { target_device: selected.id });
    if (revokeError) return toast(`Thu hồi thất bại: ${describeDbError(revokeError)}`, 'error');
    toast(`Đã thu hồi ${data || 0} token.`, 'success');
  };

  const createMapping = async () => {
    if (!selected || !mappingUserId.trim() || !mappingProfileId) return;
    setBusy(true);
    const { error: mappingError } = await supabase.from('attendance_device_mappings').insert({
      device_id: selected.id,
      device_user_id: mappingUserId.trim(),
      profile_id: mappingProfileId,
    });
    setBusy(false);
    if (mappingError) return toast(`Không tạo được ánh xạ: ${describeDbError(mappingError)}`, 'error');
    setMappingUserId('');
    setMappingProfileId('');
    toast('Đã ánh xạ mã máy với nhân viên.', 'success');
    loadData();
  };

  const deleteMapping = async (id: string) => {
    const { error: mappingError } = await supabase.from('attendance_device_mappings').delete().eq('id', id);
    if (mappingError) return toast(`Không xóa được ánh xạ: ${describeDbError(mappingError)}`, 'error');
    loadData();
  };

  if (loading) return <div className="flex min-h-64 items-center justify-center"><RefreshCw className="h-6 w-6 animate-spin text-indigo-600" /></div>;
  if (error) return <ErrorState message={error} onRetry={loadData} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Máy chấm công</h1>
          <p className="mt-1 text-sm text-slate-500">Ronald Jack/ZKTeco · máy tự đẩy dữ liệu lên HRM, hoặc bridge nội bộ · qua HTTPS</p>
        </div>
        <div className="flex gap-2">
          <AttendanceFileImport deviceId={selected?.id || ''} profiles={profiles} mappings={mappings} onImported={loadData} />
          <Button variant="outline" onClick={loadData}><RefreshCw className="h-4 w-4" />Làm mới</Button>
          <Button onClick={openCreate}><Plus className="h-4 w-4" />Thêm máy</Button>
        </div>
      </div>

      {devices.length === 0 ? (
        <Card><CardContent className="py-12"><EmptyState icon={<Cpu className="h-9 w-9" />} title="Chưa có máy chấm công" description="Thêm máy Ronald Jack đầu tiên rồi tạo token để máy đẩy dữ liệu lên HRM." /></CardContent></Card>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {devices.map((device) => (
              <button key={device.id} onClick={() => setSelectedId(device.id)} className={`min-w-56 rounded-xl border p-3 text-left transition ${selected?.id === device.id ? 'border-indigo-300 bg-indigo-50 ring-2 ring-indigo-100' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                <div className="flex items-center justify-between gap-2"><span className="font-semibold text-slate-900">{device.name}</span><StatusBadge status={device.last_sync_status} /></div>
                <p className="mt-1 text-xs text-slate-500">{device.model || 'Chưa khai báo model'} · {device.location?.name || 'Chưa gắn địa điểm'}</p>
              </button>
            ))}
          </div>

          {selected && <div className="grid gap-5 xl:grid-cols-[1.05fr_1.4fr]">
            <div className="space-y-5">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Wifi className="h-5 w-5 text-indigo-600" />{adms ? 'Trạng thái kết nối' : 'Trạng thái bridge'}</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-xl bg-slate-50 p-4 text-sm">
                    <div className="flex items-center justify-between"><span className="text-slate-500">Đồng bộ gần nhất</span><strong className="text-slate-800">{selected.last_sync_at ? formatDateTime(selected.last_sync_at) : 'Chưa đồng bộ'}</strong></div>
                    <div className="mt-2 flex items-center justify-between"><span className="text-slate-500">Thông báo</span><span className="max-w-64 text-right text-slate-700">{selected.last_sync_message || '—'}</span></div>
                    <div className="mt-2 flex items-center justify-between"><span className="text-slate-500">Serial</span><span className="text-slate-700">{selected.serial_number || '—'}</span></div>
                    <div className="mt-2 flex items-center justify-between"><span className="text-slate-500">{adms ? 'Máy báo danh' : 'Bridge báo danh'}</span><DeviceHeartbeat lastSeenAt={selected.last_seen_at} adms={adms} /></div>
                  </div>
                  {adms ? (
                    <p className="text-xs leading-5 text-slate-500">Máy tự gọi lên HRM qua Internet, không cần máy tính nào trong văn phòng. Trên máy: <strong>Thiết lập liên kết › Cài đặt máy chủ đám mây</strong>, địa chỉ máy chủ <code className="rounded bg-slate-100 px-1">{window.location.hostname}</code>, cổng <code className="rounded bg-slate-100 px-1">443</code>, bật tên miền. Serial của máy phải có trong biến ATTENDANCE_DEVICE_SERIALS trên máy chủ. Máy gửi mỗi lần quét ngay khi có và báo danh mỗi phút.</p>
                  ) : (
                    <p className="text-xs leading-5 text-slate-500">Bridge phải chạy trên máy tính cùng mạng LAN với máy chấm công. IP, Port và Comm Key lấy từ mục “Thông tin kết nối”; đổi ở đây là bridge dùng ngay vòng đồng bộ sau.</p>
                  )}
                  {!adms && selected.sync_requested_at && (
                    <div className="flex items-start gap-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900">
                      <Activity className="mt-0.5 h-4 w-4 shrink-0 animate-pulse" />
                      <span>Đã gửi lệnh lúc {formatDateTime(selected.sync_requested_at)} — đang chờ bridge nhận. Bridge hỏi lệnh mỗi 20 giây.</span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {!adms && <Button onClick={requestSync} disabled={busy}><Zap className="h-4 w-4" />Đồng bộ ngay</Button>}
                    <Button variant="outline" onClick={issueToken} disabled={busy}><KeyRound className="h-4 w-4" />{adms ? 'Tạo token' : 'Tạo token bridge'}</Button>
                    <Button variant="outline" onClick={revokeTokens}>Thu hồi token</Button>
                    <Button variant="outline" onClick={openEdit}><Pencil className="h-4 w-4" />Sửa thông tin</Button>
                    <Button variant="danger" onClick={deleteDevice}><Trash2 className="h-4 w-4" />Xóa máy</Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Cpu className="h-5 w-5 text-indigo-600" />Thông tin kết nối</CardTitle></CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                    <InfoRow label="Mã máy" value={selected.device_code} />
                    <InfoRow label="ID máy" value={selected.device_number} />
                    <InfoRow label="Địa chỉ IP" value={selected.ip_address} />
                    <InfoRow label="Port" value={selected.port} />
                    <InfoRow label="Kiểu kết nối" value={selected.connection_type === 'SERIAL' ? 'Cổng COM' : selected.connection_type === 'UDP' ? 'UDP' : 'TCP/IP'} />
                    <InfoRow label="Tốc độ truyền" value={selected.baud_rate} />
                    <InfoRow label="Mật khẩu kết nối" value={selected.comm_password ? '••••••' : null} />
                    <InfoRow label="Trạng thái máy" value={DIRECTION_LABEL[selected.direction]} />
                    <InfoRow label="Model" value={selected.model} />
                    <InfoRow label="Serial" value={selected.serial_number} />
                    <InfoRow label="Số đăng ký" value={selected.registration_number} />
                    <InfoRow label="License" value={selected.license} />
                    <InfoRow label="Địa chỉ web" value={selected.use_web_address ? selected.web_address : null} />
                    <InfoRow label="Cho phép sử dụng" value={selected.is_active ? 'Có' : 'Không'} />
                  </dl>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><TriangleAlert className="h-5 w-5 text-amber-500" />Mã chưa ánh xạ</CardTitle></CardHeader>
                <CardContent>
                  {unmappedCodes.length === 0 ? <p className="text-sm text-slate-500">Không có mã lỗi ánh xạ.</p> : <div className="flex flex-wrap gap-2">{unmappedCodes.map((code) => <button key={code} onClick={() => setMappingUserId(code)} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 font-mono text-xs font-semibold text-amber-800">{code}</button>)}</div>}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5 text-indigo-600" />Lịch sử đồng bộ</CardTitle></CardHeader>
                <CardContent>
                  {selectedRuns.length === 0 ? (
                    adms
                      ? <p className="text-sm text-slate-500">Chưa nhận dữ liệu lần nào từ máy. Chấm công một lần trên máy rồi bấm “Làm mới”; mã không có trong danh sách nhân viên sẽ hiện ở “Mã chưa ánh xạ”.</p>
                      : <p className="text-sm text-slate-500">Bridge chưa đồng bộ lần nào. Bấm “Đồng bộ ngay”, hoặc chạy <code className="rounded bg-slate-100 px-1">pnpm attendance:sync</code> trên máy chạy bridge.</p>
                  ) : (
                    <ul className="space-y-2">
                      {selectedRuns.slice(0, 8).map((run) => (
                        <li key={run.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-slate-500">{formatDateTime(run.started_at)}</span>
                            <StatusBadge status={run.status === 'RUNNING' ? null : run.status} />
                          </div>
                          <p className="mt-1 text-slate-700">
                            nhận {run.received_count} · mới {run.inserted_count} · xử lý {run.processed_count}
                            {run.unmapped_count > 0 && <span className="text-amber-700"> · chưa ánh xạ {run.unmapped_count}</span>}
                          </p>
                          {run.message && <p className={`mt-1 break-words text-xs ${run.status === 'ERROR' ? 'font-semibold text-red-700' : 'text-slate-500'}`}>{run.message}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5 text-indigo-600" />Ánh xạ nhân viên</CardTitle></CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-[1fr_1.5fr_auto] sm:items-end">
                  <Input label="Mã người dùng trên máy" value={mappingUserId} onChange={(event) => setMappingUserId(event.target.value)} placeholder="VD: NV001" />
                  <Select label="Nhân viên HRM" value={mappingProfileId} onChange={(event) => setMappingProfileId(event.target.value)}>
                    <option value="">Chọn nhân viên</option>
                    {availableProfiles.map((person) => <option key={person.id} value={person.id}>{person.employee_code ? `${person.employee_code} · ` : ''}{person.name}</option>)}
                  </Select>
                  <Button onClick={createMapping} disabled={busy || !mappingUserId.trim() || !mappingProfileId}>Thêm</Button>
                </div>
                <div className="overflow-x-auto rounded-xl border-2 border-slate-400 dark:border-slate-600 shadow-sm">
                  <table className="w-full text-sm border-collapse">
                    <thead className="border-b-2 border-[#bf1f2b] dark:border-[#e66a76] bg-[#fdf2f4] dark:bg-[#201114] text-left text-xs font-black uppercase tracking-wider text-[#5c0f16] dark:text-[#fde8ea] shadow-[inset_0_-2px_0_#bf1f2b] dark:shadow-[inset_0_-2px_0_#e66a76]">
                      <tr>
                        <th className="px-4 py-3">Mã máy</th>
                        <th className="border-l border-[#eed5d8] dark:border-[#4a1c22] px-4 py-3">Nhân viên</th>
                        <th className="border-l border-[#eed5d8] dark:border-[#4a1c22] px-4 py-3">Mã HRM</th>
                        <th className="w-12 border-l border-[#eed5d8] dark:border-[#4a1c22] px-3 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-300 dark:divide-slate-700 bg-white dark:bg-slate-900 font-semibold">
                      {selectedMappings.map((mapping) => (
                        <tr key={mapping.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition-colors">
                          <td className="px-4 py-3 font-mono font-black text-indigo-700 dark:text-indigo-400 text-sm">{mapping.device_user_id}</td>
                          <td className="border-l border-slate-300 dark:border-slate-700 px-4 py-3 font-black text-slate-900 dark:text-slate-100 text-sm">{mapping.profile?.name}</td>
                          <td className="border-l border-slate-300 dark:border-slate-700 px-4 py-3 font-bold text-slate-600 dark:text-slate-400 text-sm">{mapping.profile?.employee_code || '—'}</td>
                          <td className="border-l border-slate-300 dark:border-slate-700 px-3 py-3">
                            <button onClick={() => deleteMapping(mapping.id)} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400 transition-colors" aria-label="Xóa ánh xạ">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {selectedMappings.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-sm font-bold text-slate-500">Mã máy trùng mã nhân viên sẽ tự nhận. Chỉ cần thêm các trường hợp khác mã.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>}
        </>
      )}

      {/* Nhập file là thao tác GHI ĐÈ dữ liệu chấm công hàng loạt, mà cái toast
          báo kết quả biến mất sau vài giây. Tháng sau có người thắc mắc công
          bị lệch thì phải tra được: file nào, ai nhập, lúc nào, bỏ bao nhiêu
          dòng. Tự ẩn khi chưa chạy migration hoặc chưa có lô nào. */}
      <AttendanceImportHistory profiles={profiles} />

      <Modal open={deviceModal} onClose={closeDeviceModal} title={editingId ? 'Sửa máy chấm công' : 'Thêm máy chấm công'} size="xl">
        <div className="space-y-5">
          <fieldset className="rounded-xl border border-slate-300 p-4 dark:border-slate-700">
            <legend className="px-2 text-sm font-bold text-slate-700 dark:text-slate-300">Thông tin kết nối</legend>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-4">
                <Input label="Mã máy" value={deviceForm.device_code} onChange={(event) => setDeviceForm({ ...deviceForm, device_code: event.target.value })} placeholder="MCC00001" />
                <Input label="ID máy" inputMode="numeric" value={deviceForm.device_number} onChange={(event) => setDeviceForm({ ...deviceForm, device_number: event.target.value })} placeholder="1" />
                <Input label="Địa chỉ IP" value={deviceForm.ip_address} onChange={(event) => setDeviceForm({ ...deviceForm, ip_address: event.target.value })} placeholder="192.168.1.201" />
                <Input label="Mật khẩu kết nối (Comm Key)" type="password" autoComplete="new-password" value={deviceForm.comm_password} onChange={(event) => setDeviceForm({ ...deviceForm, comm_password: event.target.value })} placeholder="0" />
                <Select label="Trạng thái máy" value={deviceForm.direction} onChange={(event) => setDeviceForm({ ...deviceForm, direction: event.target.value })}>
                  <option value="BOTH">Vào/Ra</option>
                  <option value="IN">Vào</option>
                  <option value="OUT">Ra</option>
                </Select>
                <Input label="Địa chỉ web" disabled={!deviceForm.use_web_address} value={deviceForm.web_address} onChange={(event) => setDeviceForm({ ...deviceForm, web_address: event.target.value })} placeholder="example.com.vn" />
                <Input label="Serial" value={deviceForm.serial_number} onChange={(event) => setDeviceForm({ ...deviceForm, serial_number: event.target.value })} placeholder="1313245000324" />
                <Input label="Số đăng ký" value={deviceForm.registration_number} onChange={(event) => setDeviceForm({ ...deviceForm, registration_number: event.target.value })} />
              </div>
              <div className="space-y-4">
                <Input label="Tên máy" required value={deviceForm.name} onChange={(event) => setDeviceForm({ ...deviceForm, name: event.target.value })} placeholder="Máy cửa chính" />
                <Select label="Kiểu kết nối" value={deviceForm.connection_type} onChange={(event) => setDeviceForm({ ...deviceForm, connection_type: event.target.value })}>
                  <option value="TCP">TCP/IP</option>
                  <option value="UDP">UDP</option>
                  <option value="SERIAL">Cổng COM</option>
                </Select>
                <Input label="Port" inputMode="numeric" value={deviceForm.port} onChange={(event) => setDeviceForm({ ...deviceForm, port: event.target.value })} placeholder="4370" />
                <Select label="Tốc độ truyền" value={deviceForm.baud_rate} onChange={(event) => setDeviceForm({ ...deviceForm, baud_rate: event.target.value })}>
                  {['9600', '19200', '38400', '57600', '115200'].map((rate) => <option key={rate} value={rate}>{rate}</option>)}
                </Select>
                <Input label="License" value={deviceForm.license} onChange={(event) => setDeviceForm({ ...deviceForm, license: event.target.value })} placeholder="1437" />
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                  <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={deviceForm.use_web_address} onChange={(event) => setDeviceForm({ ...deviceForm, use_web_address: event.target.checked })} />
                  Sử dụng địa chỉ web
                </label>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                  <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={deviceForm.is_active} onChange={(event) => setDeviceForm({ ...deviceForm, is_active: event.target.checked })} />
                  Cho phép sử dụng
                </label>
              </div>
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Model" value={deviceForm.model} onChange={(event) => setDeviceForm({ ...deviceForm, model: event.target.value })} placeholder="ZMM510_TFT" />
            <Select label="Địa điểm" value={deviceForm.location_id} onChange={(event) => setDeviceForm({ ...deviceForm, location_id: event.target.value })}><option value="">Chưa gắn địa điểm</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</Select>
            <Select label="Cách kết nối" value={deviceForm.sync_mode} onChange={(event) => setDeviceForm({ ...deviceForm, sync_mode: event.target.value })}>
              <option value="ADMS">Máy tự đẩy dữ liệu lên HRM (không cần máy tính trung gian)</option>
              <option value="BRIDGE">Bridge: máy tính trong mạng LAN đọc máy</option>
            </Select>
          </div>
          {deviceForm.sync_mode === 'ADMS' ? (
            <p className="text-xs leading-5 text-slate-500">Với cách này, IP, Port, Comm Key và tốc độ truyền chỉ để ghi chú, HRM không dùng chúng để kết nối. Điều cần chính xác là <strong>Serial</strong> của máy: nó phải có trong biến ATTENDANCE_DEVICE_SERIALS trên máy chủ. Máy khai là “Vào” hoặc “Ra” thì mọi lần quét được tính theo hướng đó. Bỏ tích “Cho phép sử dụng” sẽ ngừng nhận dữ liệu máy này.</p>
          ) : (
            <p className="text-xs leading-5 text-slate-500">Bridge tự lấy IP, Port, kiểu kết nối và Comm Key từ đây ở mỗi lần đồng bộ (ô nào để trống thì dùng file cấu hình trên máy chạy bridge). Máy khai là “Vào” hoặc “Ra” thì mọi lần quét được tính theo hướng đó. Bỏ tích “Cho phép sử dụng” sẽ ngừng đồng bộ máy này.</p>
          )}
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={closeDeviceModal}>Hủy</Button><Button onClick={saveDevice} disabled={busy || !deviceForm.name.trim()}>{editingId ? 'Lưu' : 'Tạo thiết bị'}</Button></div>
        </div>
      </Modal>

      <Modal open={!!issuedToken} onClose={() => setIssuedToken(null)} title={adms ? 'Token — chỉ hiển thị một lần' : 'Token bridge — chỉ hiển thị một lần'}>
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /><p className="text-sm text-emerald-900">
            {adms
              ? <>Đặt token vào biến <code>ATTENDANCE_BRIDGE_TOKEN</code> của môi trường Production trên máy chủ web rồi triển khai lại — biến chỉ có hiệu lực ở bản triển khai mới. </>
              : <>Sao chép token vào biến <code>ATTENDANCE_BRIDGE_TOKEN</code> trên máy tính bridge. </>}
            Token mới hết hạn sau 90 ngày; token cũ còn hiệu lực tối đa 7 ngày để chuyển cấu hình. HRM không thể hiển thị lại token này.</p></div>
          <div className="flex items-center gap-2 rounded-xl bg-slate-950 p-3"><code className="min-w-0 flex-1 break-all text-xs text-emerald-300">{issuedToken}</code><button onClick={() => { navigator.clipboard.writeText(issuedToken || ''); toast('Đã sao chép token.', 'success'); }} className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white"><Clipboard className="h-4 w-4" /></button></div>
          <Button className="w-full" onClick={() => setIssuedToken(null)}>Tôi đã lưu token</Button>
        </div>
      </Modal>
    </div>
  );
}

// Bridge chet va may cham cong tat la hai chuyen khac nhau, truoc day nhin
// giong het nhau tren man hinh. Moc bao danh nay tach duoc hai truong hop.
// May ADMS bao danh ~60 giay mot lan nen cung nguong 2 phut la du chac.
function DeviceHeartbeat({ lastSeenAt, adms }: { lastSeenAt: string | null; adms: boolean }) {
  if (!lastSeenAt) return <span className="text-slate-500">{adms ? 'Chưa thấy máy' : 'Chưa thấy bridge'}</span>;
  const minutes = Math.round((Date.now() - new Date(lastSeenAt).getTime()) / 60_000);
  if (minutes <= 2) return <span className="font-semibold text-emerald-700">{adms ? 'Đang kết nối' : 'Đang chạy'}</span>;
  if (minutes < 60) return <span className="font-semibold text-amber-700">{minutes} phút trước</span>;
  return <span className="font-semibold text-red-700">{formatDateTime(lastSeenAt)}</span>;
}

function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="break-words text-right font-semibold text-slate-800 dark:text-slate-200">{value === null || value === undefined || value === '' ? '—' : value}</dd>
    </>
  );
}

function StatusBadge({ status }: { status: AttendanceDevice['last_sync_status'] }) {
  if (status === 'SUCCESS') return <Badge className="bg-emerald-50 text-emerald-700">Ổn định</Badge>;
  if (status === 'PARTIAL') return <Badge className="bg-amber-50 text-amber-700">Cần ánh xạ</Badge>;
  if (status === 'ERROR') return <Badge className="bg-red-50 text-red-700">Lỗi</Badge>;
  return <Badge className="bg-slate-100 text-slate-600">Chưa chạy</Badge>;
}
