import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/contexts/ToastContext';
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
      const userIds = [...new Set(items.map((item) => item.user_id))];
      const dates = items.map((item) => item.date).sort();
      const { data: existing, error: existingError } = await supabase.from('attendance').select('id,user_id,date,check_in_time').in('user_id', userIds).gte('date', dates[0]).lte('date', dates[dates.length - 1]);
      if (existingError) throw existingError;
      const existingByKey = new Map<string, { id: string; check_in_time: string | null }>();
      (existing || []).forEach((item) => {
        const key = `${item.user_id}|${item.date}`;
        if (!existingByKey.has(key)) existingByKey.set(key, item);
      });

      const inserts = items.filter((item) => !existingByKey.has(`${item.user_id}|${item.date}`)).map((item) => ({
        ...item, check_out_time: null, status: 'completed', approved_by_lead: true, check_in_method: 'DEVICE', anomaly_flags: [],
      }));
      if (inserts.length) {
        const { error } = await supabase.from('attendance').insert(inserts);
        if (error) throw error;
      }

      const updates = items.filter((item) => {
        const current = existingByKey.get(`${item.user_id}|${item.date}`);
        return current && (!current.check_in_time || item.check_in_time < current.check_in_time);
      });
      for (const item of updates) {
        const current = existingByKey.get(`${item.user_id}|${item.date}`)!;
        const { error } = await supabase.from('attendance').update({ check_in_time: item.check_in_time }).eq('id', current.id);
        if (error) throw error;
      }

      toast(`Đã ghi nhận ${inserts.length} ngày công mới${updates.length ? `, cập nhật ${updates.length} giờ vào sớm hơn` : ''}${skipped ? `. Bỏ qua ${skipped} dòng thiếu mã/giờ hoặc chưa ánh xạ` : ''}.`, 'success');
      await onImported();
    } catch (error) {
      toast(`Không nhập được file: ${error instanceof Error ? error.message : 'Lỗi dữ liệu không xác định.'}`, 'error');
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
