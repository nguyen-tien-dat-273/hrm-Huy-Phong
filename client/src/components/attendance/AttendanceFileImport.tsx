import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { supabase } from '@/lib/supabase';
import type { AttendanceDeviceMapping, Profile } from '@/types';

interface Props {
  deviceId: string;
  profiles: Profile[];
  mappings: AttendanceDeviceMapping[];
  onImported: () => void | Promise<void>;
}

type SheetRow = Record<string, unknown>;

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
  .replace(/[^a-z0-9]/g, '');

const CODE_KEYS = ['manhanvien', 'manv', 'machamcong', 'deviceuserid', 'userid', 'employeeid', 'employeecode', 'id'];
const DATETIME_KEYS = ['thoigian', 'ngaygio', 'datetime', 'punchedat', 'checktime', 'timestamp'];
const DATE_KEYS = ['ngay', 'date', 'workdate', 'ngaychamcong'];
const TIME_KEYS = ['gio', 'time', 'checkin', 'giovao'];

function valueFor(row: SheetRow, keys: string[]) {
  const entry = Object.entries(row).find(([key]) => keys.includes(normalize(key)));
  return entry?.[1];
}

function parseLocalDate(value: unknown, timeValue?: unknown): Date | null {
  const text = `${String(value ?? '').trim()} ${String(timeValue ?? '').trim()}`.trim();
  const vi = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (vi) {
    const date = new Date(Number(vi[3]), Number(vi[2]) - 1, Number(vi[1]), Number(vi[4] || 0), Number(vi[5] || 0), Number(vi[6] || 0));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const localDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function AttendanceFileImport({ deviceId, profiles, mappings, onImported }: Props) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const importFile = async (file: File) => {
    setBusy(true);
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<SheetRow>(sheet, { defval: '' });
      if (!rows.length) throw new Error('File không có dòng dữ liệu nào.');

      const profileByCode = new Map(profiles.filter((p) => p.employee_code).map((p) => [normalize(p.employee_code), p.id]));
      mappings.filter((m) => m.device_id === deviceId).forEach((m) => profileByCode.set(normalize(m.device_user_id), m.profile_id));
      const earliest = new Map<string, { user_id: string; date: string; check_in_time: string }>();
      let skipped = 0;

      rows.forEach((row) => {
        const code = normalize(valueFor(row, CODE_KEYS));
        const userId = profileByCode.get(code);
        const directDateTime = valueFor(row, DATETIME_KEYS);
        const timestamp = directDateTime
          ? parseLocalDate(directDateTime)
          : parseLocalDate(valueFor(row, DATE_KEYS), valueFor(row, TIME_KEYS));
        if (!userId || !timestamp) { skipped += 1; return; }
        const date = localDateKey(timestamp);
        const key = `${userId}|${date}`;
        const current = earliest.get(key);
        if (!current || timestamp.toISOString() < current.check_in_time) earliest.set(key, { user_id: userId, date, check_in_time: timestamp.toISOString() });
      });

      const items = [...earliest.values()];
      if (!items.length) throw new Error('Không đọc được mã nhân viên và thời gian. Hãy dùng cột “Mã nhân viên” và “Thời gian”, hoặc “Ngày” + “Giờ”.');
      const ok = await confirm({
        title: `Nhập ${items.length} ngày công?`,
        message: `${file.name}: đọc ${rows.length} dòng, nhận ${items.length} người-ngày${skipped ? `, bỏ qua ${skipped} dòng thiếu mã/giờ hoặc chưa ánh xạ` : ''}. Dữ liệu chỉ ghi giờ vào và phải checkout trước khi quản lý duyệt.`,
        confirmLabel: 'Nhập file',
      });
      if (!ok) return;

      const { data, error } = await supabase.rpc('import_attendance_file', {
        target_device: deviceId,
        source_file_name: file.name,
        source_rows: items.map((item) => ({ user_id: item.user_id, work_date: item.date, check_in_time: item.check_in_time })),
        received_count: rows.length,
        skipped_count: skipped,
      });
      if (error) {
        const missingRpc = error.code === 'PGRST202' || error.message.includes('import_attendance_file');
        if (!missingRpc) throw error;

        // Đường lùi cho môi trường đang chờ migration: vẫn nhập được dữ liệu
        // nhưng tuyệt đối để CHƯA DUYỆT và yêu cầu checkout như luồng mới.
        const userIds = [...new Set(items.map((item) => item.user_id))];
        const dates = items.map((item) => item.date).sort();
        const existingRes = await supabase
          .from('attendance')
          .select('id,user_id,date,check_in_time,check_out_time')
          .in('user_id', userIds)
          .gte('date', dates[0])
          .lte('date', dates[dates.length - 1]);
        if (existingRes.error) throw existingRes.error;
        const existingByKey = new Map<string, { id: string; check_in_time: string | null; check_out_time: string | null }>();
        (existingRes.data || []).forEach((item) => {
          const key = `${item.user_id}|${item.date}`;
          if (!existingByKey.has(key)) existingByKey.set(key, item);
        });
        const inserts = items.filter((item) => !existingByKey.has(`${item.user_id}|${item.date}`)).map((item) => ({
          ...item,
          check_out_time: null,
          status: 'completed',
          approved_by_lead: false,
          check_in_method: 'DEVICE',
          anomaly_flags: [],
        }));
        if (inserts.length) {
          const insertRes = await supabase.from('attendance').insert(inserts);
          if (insertRes.error) throw insertRes.error;
        }
        let updated = 0;
        for (const item of items) {
          const current = existingByKey.get(`${item.user_id}|${item.date}`);
          if (!current || (current.check_in_time && item.check_in_time >= current.check_in_time)) continue;
          const updateRes = await supabase.from('attendance').update({
            check_in_time: item.check_in_time,
            approved_by_lead: false,
          }).eq('id', current.id);
          if (updateRes.error) throw updateRes.error;
          updated += 1;
        }
        toast(`Đã thêm ${inserts.length} ngày công, cập nhật ${updated} giờ vào. Hãy chạy migration mới để bật nhật ký lô nhập.`, 'warning');
      } else {
        const result = (data || {}) as { inserted?: number; updated?: number; skipped?: number };
        toast(`Đã thêm ${result.inserted || 0} ngày công, cập nhật ${result.updated || 0} giờ vào${result.skipped ? `, bỏ qua ${result.skipped} dòng` : ''}.`, 'success');
      }
      await onImported();
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : 'Lỗi dữ liệu không xác định.';
      toast(`Không nhập được file: ${message}`, 'error');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <>
      <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} />
      <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={busy || !deviceId}>
        <Upload className="h-4 w-4" />{busy ? 'Đang nhập…' : 'Nhập file chấm công'}
      </Button>
    </>
  );
}
