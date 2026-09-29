// ============================================================================
// RC2.1 — Import Excel danh sách hồ sơ nhân sự.
// ----------------------------------------------------------------------------
// Luồng cố ý gồm ba bước, không rút ngắn: tải mẫu → chọn file và XEM TRƯỚC →
// xác nhận ghi.
//
// Bước xem trước không phải để trang trí. File Excel do người khác gửi tới hầu
// như luôn có ô thừa dấu cách, ngày sai định dạng, hoặc một dòng của người đã
// nghỉ. Ghi thẳng vào hồ sơ nhân sự là cách nhanh nhất để hỏng dữ liệu cả công
// ty trong một cú bấm, và không có nút hoàn tác nào.
//
// Xem trước liệt kê ĐÚNG những trường sẽ đổi, kèm giá trị cũ → giá trị mới.
// Dòng nào không ghi được thì nêu lý do ngay tại dòng đó.
// ============================================================================

import { useRef, useState } from 'react';
import { ArrowRight, Download, FileSpreadsheet, TriangleAlert, Upload } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/contexts/ToastContext';
import { describeDbError } from '@/lib/dbError';
import { supabase } from '@/lib/supabase';
import {
  buildImportPreview, fieldLabel, IMPORT_COLUMNS,
  type ImportPreview,
} from '@/lib/employeeImport';
import type { Profile } from '@/types';

interface EmployeeImportModalProps {
  open: boolean;
  profiles: Profile[];
  onClose: () => void;
  onImported: () => void;
}

export function EmployeeImportModal({ open, profiles, onClose, onImported }: EmployeeImportModalProps) {
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [written, setWritten] = useState(0);

  const reset = () => {
    setFileName('');
    setPreview(null);
    setWritten(0);
    if (fileInput.current) fileInput.current.value = '';
  };

  const downloadTemplate = async () => {
    const XLSX = await import('xlsx');
    const headers = IMPORT_COLUMNS.map((column) => column.header);
    // Dòng gợi ý đi kèm mẫu: người dùng thấy ngay định dạng mong đợi thay vì
    // phải đoán rồi import hỏng một lượt mới biết.
    const hints = IMPORT_COLUMNS.map((column) => column.hint);

    const sheet = XLSX.utils.aoa_to_sheet([headers, hints]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Hồ sơ nhân sự');
    XLSX.writeFile(book, 'mau-import-ho-so-nhan-su.xlsx');
  };

  const readFile = async (file: File) => {
    setBusy(true);
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const book = XLSX.read(buffer, { type: 'array' });
      const first = book.SheetNames[0];
      if (!first) {
        toast('File không có sheet nào.', 'error');
        return;
      }
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[first], { defval: '' });

      // Bỏ dòng gợi ý của file mẫu nếu người dùng giữ nguyên nó.
      const body = rows.filter((row) => {
        const code = String(row['Mã nhân viên'] ?? '').trim();
        const email = String(row['Email / Tên đăng nhập'] ?? '').trim();
        return !(code === '' && email === '') || Object.values(row).some((v) => String(v ?? '').trim());
      }).filter((row) => String(row['Ngày vào làm'] ?? '').trim() !== 'dd/mm/yyyy');

      setFileName(file.name);
      setPreview(buildImportPreview(body, profiles));
    } catch (error) {
      toast('Không đọc được file: ' + (error instanceof Error ? error.message : String(error)), 'error');
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!preview || !supabase) return;
    setBusy(true);
    setWritten(0);

    // Ghi tuần tự để đếm được đúng số dòng đã xong. Lỗi giữa chừng thì DỪNG và
    // nói rõ đã ghi tới đâu — im lặng bỏ qua sẽ để lại một danh sách nửa cũ
    // nửa mới mà không ai biết.
    for (let index = 0; index < preview.writable.length; index += 1) {
      const row = preview.writable[index];
      const { error } = await supabase
        .from('profiles')
        .update(row.changes)
        .eq('id', row.matched!.id);

      if (error) {
        setBusy(false);
        toast(
          `Dừng ở dòng ${row.line} (${row.matched!.name}): ${describeDbError(error)}. `
          + `Đã ghi xong ${index} dòng trước đó.`,
          'error',
        );
        onImported();
        return;
      }
      setWritten(index + 1);
    }

    setBusy(false);
    toast(`Đã cập nhật ${preview.writable.length} hồ sơ.`, 'success');
    onImported();
    reset();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Import hồ sơ nhân sự từ Excel"
      size="xl"
    >
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3">
          <FileSpreadsheet className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600" />
          <div className="min-w-0 text-sm leading-relaxed text-blue-900">
            <p>
              Import <strong>cập nhật hồ sơ đã có</strong>, không tạo tài khoản đăng nhập mới.
              Người chưa có tài khoản thì tạo ở trang này trước, rồi import lại.
            </p>
            <p className="mt-1 text-xs">
              Khớp theo <strong>Mã nhân viên</strong>, không có thì khớp theo email.
              Ô để trống nghĩa là <strong>không đổi</strong> — không phải xoá.
            </p>
          </div>
        </div>

        {/* ---- Bước 1: mẫu ---- */}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => void downloadTemplate()}>
            <Download className="h-4 w-4" /> Tải file mẫu
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
            }}
          />
          <Button theme="admin" disabled={busy} onClick={() => fileInput.current?.click()}>
            <Upload className="h-4 w-4" /> {busy && !preview ? 'Đang đọc…' : 'Chọn file Excel'}
          </Button>
          {fileName && <span className="truncate text-xs text-slate-500">{fileName}</span>}
        </div>

        {/* ---- Bước 2: xem trước ---- */}
        {preview && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Summary label="Sẽ cập nhật" value={preview.writable.length} tone="indigo" />
              <Summary label="Không đổi gì" value={preview.unchanged.length} tone="slate" />
              <Summary label="Không ghi được" value={preview.rejected.length} tone="amber" />
            </div>

            {preview.rejected.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="flex items-center gap-2 text-xs font-bold text-amber-800">
                  <TriangleAlert className="h-4 w-4" />
                  {preview.rejected.length} dòng bị bỏ qua
                </p>
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                  {preview.rejected.slice(0, 20).map((row) => (
                    <li key={row.line} className="text-xs leading-relaxed text-amber-900">
                      <strong>Dòng {row.line}</strong>
                      {row.raw['Họ và tên'] && ` (${row.raw['Họ và tên']})`} — {row.problems.join(' ')}
                    </li>
                  ))}
                  {preview.rejected.length > 20 && (
                    <li className="text-xs text-amber-700">…và {preview.rejected.length - 20} dòng nữa.</li>
                  )}
                </ul>
              </div>
            )}

            {preview.writable.length > 0 && (
              <div className="rounded-xl border border-slate-200">
                <p className="border-b border-slate-100 px-4 py-2.5 text-xs font-bold text-slate-700">
                  Những thay đổi sẽ được ghi
                </p>
                <ul className="max-h-64 divide-y divide-slate-50 overflow-y-auto">
                  {preview.writable.map((row) => (
                    <li key={row.line} className="px-4 py-2.5">
                      <p className="text-xs font-semibold text-slate-800">
                        {row.matched!.name}
                        <span className="ml-1.5 font-normal text-slate-400">dòng {row.line}</span>
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {Object.entries(row.changes).map(([field, value]) => (
                          <li key={field} className="flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span className="text-slate-500">{fieldLabel(field)}:</span>
                            <span className="text-slate-400 line-through">
                              {String((row.matched as unknown as Record<string, unknown>)[field] ?? '—')}
                            </span>
                            <ArrowRight className="h-3 w-3 text-slate-300" />
                            <strong className="text-indigo-700">{String(value)}</strong>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {/* ---- Bước 3: ghi ---- */}
        <div className="flex items-center justify-end gap-2">
          {busy && preview && (
            <span className="mr-auto text-xs text-slate-500">
              Đang ghi {written}/{preview.writable.length}…
            </span>
          )}
          <Button variant="secondary" onClick={() => { reset(); onClose(); }} disabled={busy}>
            Hủy
          </Button>
          <Button
            theme="admin"
            onClick={() => void apply()}
            disabled={busy || !preview || preview.writable.length === 0}
          >
            {busy ? 'Đang ghi…' : `Cập nhật ${preview?.writable.length ?? 0} hồ sơ`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone: 'indigo' | 'slate' | 'amber' }) {
  const style = {
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-600',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
  }[tone];

  return (
    <div className={`rounded-xl border px-4 py-3 text-center ${style}`}>
      <strong className="block text-2xl font-bold tabular-nums">{value}</strong>
      <span className="text-[11px] font-semibold">{label}</span>
    </div>
  );
}
