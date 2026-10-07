import { useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, Clipboard, Cpu, KeyRound, Link2, Plus, RefreshCw, Trash2, TriangleAlert, Wifi, Zap } from 'lucide-react';
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

const EMPTY_DEVICE = { name: '', model: '', serial_number: '', location_id: '', timezone: 'Asia/Ho_Chi_Minh' };

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
  const [deviceForm, setDeviceForm] = useState(EMPTY_DEVICE);
  const [mappingUserId, setMappingUserId] = useState('');
  const [mappingProfileId, setMappingProfileId] = useState('');
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  const selected = devices.find((item) => item.id === selectedId) || devices[0];
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

  const createDevice = async () => {
    if (!deviceForm.name.trim()) return;
    setBusy(true);
    const { data, error: createError } = await supabase.from('attendance_devices').insert({
      name: deviceForm.name.trim(),
      model: deviceForm.model.trim() || null,
      serial_number: deviceForm.serial_number.trim() || null,
      location_id: deviceForm.location_id || null,
      timezone: deviceForm.timezone,
    }).select().single();
    setBusy(false);
    if (createError) return toast(`Không tạo được thiết bị: ${describeDbError(createError)}`, 'error');
    setDeviceModal(false);
    setDeviceForm(EMPTY_DEVICE);
    toast('Đã tạo máy chấm công.', 'success');
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
      token_label: `Bridge ${selected.name}`,
    });
    setBusy(false);
    if (tokenError) return toast(`Không tạo được token: ${describeDbError(tokenError)}`, 'error');
    setIssuedToken(String(data));
  };

  const revokeTokens = async () => {
    if (!selected) return;
    const ok = await confirm({ title: 'Thu hồi mọi token?', message: 'Bridge đang chạy sẽ ngừng đồng bộ cho tới khi bạn tạo và cấu hình token mới.', confirmLabel: 'Thu hồi', danger: true });
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
          <p className="mt-1 text-sm text-slate-500">Ronald Jack/ZKTeco · bridge nội bộ · đồng bộ an toàn qua HTTPS</p>
        </div>
        <div className="flex gap-2">
          <AttendanceFileImport deviceId={selected?.id || ''} profiles={profiles} mappings={mappings} onImported={loadData} />
          <Button variant="outline" onClick={loadData}><RefreshCw className="h-4 w-4" />Làm mới</Button>
          <Button onClick={() => setDeviceModal(true)}><Plus className="h-4 w-4" />Thêm máy</Button>
        </div>
      </div>

      {devices.length === 0 ? (
        <Card><CardContent className="py-12"><EmptyState icon={<Cpu className="h-9 w-9" />} title="Chưa có máy chấm công" description="Thêm máy Ronald Jack đầu tiên để tạo token cho bridge trong mạng LAN." /></CardContent></Card>
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
                <CardHeader><CardTitle className="flex items-center gap-2"><Wifi className="h-5 w-5 text-indigo-600" />Trạng thái bridge</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-xl bg-slate-50 p-4 text-sm">
                    <div className="flex items-center justify-between"><span className="text-slate-500">Đồng bộ gần nhất</span><strong className="text-slate-800">{selected.last_sync_at ? formatDateTime(selected.last_sync_at) : 'Chưa đồng bộ'}</strong></div>
                    <div className="mt-2 flex items-center justify-between"><span className="text-slate-500">Thông báo</span><span className="max-w-64 text-right text-slate-700">{selected.last_sync_message || '—'}</span></div>
                    <div className="mt-2 flex items-center justify-between"><span className="text-slate-500">Serial</span><span className="text-slate-700">{selected.serial_number || '—'}</span></div>
                    <div className="mt-2 flex items-center justify-between"><span className="text-slate-500">Bridge báo danh</span><BridgeHeartbeat lastSeenAt={selected.last_seen_at} /></div>
                  </div>
                  <p className="text-xs leading-5 text-slate-500">Bridge phải chạy trên máy tính cùng mạng LAN với máy chấm công. IP và Comm Key chỉ lưu trên máy tính đó.</p>
                  {selected.sync_requested_at && (
                    <div className="flex items-start gap-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900">
                      <Activity className="mt-0.5 h-4 w-4 shrink-0 animate-pulse" />
                      <span>Đã gửi lệnh lúc {formatDateTime(selected.sync_requested_at)} — đang chờ bridge nhận. Bridge hỏi lệnh mỗi 20 giây.</span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={requestSync} disabled={busy}><Zap className="h-4 w-4" />Đồng bộ ngay</Button>
                    <Button variant="outline" onClick={issueToken} disabled={busy}><KeyRound className="h-4 w-4" />Tạo token bridge</Button>
                    <Button variant="outline" onClick={revokeTokens}>Thu hồi token</Button>
                    <Button variant="danger" onClick={deleteDevice}><Trash2 className="h-4 w-4" />Xóa máy</Button>
                  </div>
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
                    <p className="text-sm text-slate-500">Bridge chưa đồng bộ lần nào. Bấm “Đồng bộ ngay”, hoặc chạy <code className="rounded bg-slate-100 px-1">pnpm attendance:sync</code> trên máy chạy bridge.</p>
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
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Mã máy</th><th className="px-4 py-3">Nhân viên</th><th className="px-4 py-3">Mã HRM</th><th className="w-12 px-3 py-3" /></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedMappings.map((mapping) => <tr key={mapping.id}><td className="px-4 py-3 font-mono font-semibold text-indigo-700">{mapping.device_user_id}</td><td className="px-4 py-3 font-medium text-slate-800">{mapping.profile?.name}</td><td className="px-4 py-3 text-slate-500">{mapping.profile?.employee_code || '—'}</td><td className="px-3 py-3"><button onClick={() => deleteMapping(mapping.id)} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Xóa ánh xạ"><Trash2 className="h-4 w-4" /></button></td></tr>)}
                      {selectedMappings.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">Mã máy trùng mã nhân viên sẽ tự nhận. Chỉ cần thêm các trường hợp khác mã.</td></tr>}
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

      <Modal open={deviceModal} onClose={() => setDeviceModal(false)} title="Thêm máy chấm công">
        <div className="space-y-4">
          <Input label="Tên thiết bị" required value={deviceForm.name} onChange={(event) => setDeviceForm({ ...deviceForm, name: event.target.value })} placeholder="Máy cửa chính" />
          <div className="grid gap-4 sm:grid-cols-2"><Input label="Model" value={deviceForm.model} onChange={(event) => setDeviceForm({ ...deviceForm, model: event.target.value })} placeholder="X628-C" /><Input label="Serial (nếu có)" value={deviceForm.serial_number} onChange={(event) => setDeviceForm({ ...deviceForm, serial_number: event.target.value })} /></div>
          <Select label="Địa điểm" value={deviceForm.location_id} onChange={(event) => setDeviceForm({ ...deviceForm, location_id: event.target.value })}><option value="">Chưa gắn địa điểm</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</Select>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDeviceModal(false)}>Hủy</Button><Button onClick={createDevice} disabled={busy || !deviceForm.name.trim()}>Tạo thiết bị</Button></div>
        </div>
      </Modal>

      <Modal open={!!issuedToken} onClose={() => setIssuedToken(null)} title="Token bridge — chỉ hiển thị một lần">
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /><p className="text-sm text-emerald-900">Sao chép token vào biến <code>ATTENDANCE_BRIDGE_TOKEN</code> trên máy tính bridge. Token mới hết hạn sau 90 ngày; token cũ còn hiệu lực tối đa 7 ngày để chuyển cấu hình. HRM không thể hiển thị lại token này.</p></div>
          <div className="flex items-center gap-2 rounded-xl bg-slate-950 p-3"><code className="min-w-0 flex-1 break-all text-xs text-emerald-300">{issuedToken}</code><button onClick={() => { navigator.clipboard.writeText(issuedToken || ''); toast('Đã sao chép token.', 'success'); }} className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white"><Clipboard className="h-4 w-4" /></button></div>
          <Button className="w-full" onClick={() => setIssuedToken(null)}>Tôi đã lưu token</Button>
        </div>
      </Modal>
    </div>
  );
}

// Bridge chet va may cham cong tat la hai chuyen khac nhau, truoc day nhin
// giong het nhau tren man hinh. Moc bao danh nay tach duoc hai truong hop.
function BridgeHeartbeat({ lastSeenAt }: { lastSeenAt: string | null }) {
  if (!lastSeenAt) return <span className="text-slate-500">Chưa thấy bridge</span>;
  const minutes = Math.round((Date.now() - new Date(lastSeenAt).getTime()) / 60_000);
  if (minutes <= 2) return <span className="font-semibold text-emerald-700">Đang chạy</span>;
  if (minutes < 60) return <span className="font-semibold text-amber-700">{minutes} phút trước</span>;
  return <span className="font-semibold text-red-700">{formatDateTime(lastSeenAt)}</span>;
}

function StatusBadge({ status }: { status: AttendanceDevice['last_sync_status'] }) {
  if (status === 'SUCCESS') return <Badge className="bg-emerald-50 text-emerald-700">Ổn định</Badge>;
  if (status === 'PARTIAL') return <Badge className="bg-amber-50 text-amber-700">Cần ánh xạ</Badge>;
  if (status === 'ERROR') return <Badge className="bg-red-50 text-red-700">Lỗi</Badge>;
  return <Badge className="bg-slate-100 text-slate-600">Chưa chạy</Badge>;
}
