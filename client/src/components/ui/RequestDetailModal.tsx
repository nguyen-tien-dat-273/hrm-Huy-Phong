// Chi tiết một đơn từ (nghỉ phép, đi muộn, làm thêm, hủy phép…) kèm In và Xuất Excel.
// Mọi loại đơn dùng chung hộp này: chỉ cần đưa danh sách "mục – nội dung".
import { useState } from 'react';
import { FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/contexts/ToastContext';
import { exportExcel } from '@/lib/tableExport';
import { printTables } from '@/lib/tablePrint';
import { exportRequestFormDoc, printRequestForm, type RequestForm } from '@/lib/requestForm';

export interface RequestDetail {
  /** Tên loại đơn, vd. "Đơn nghỉ phép". */
  title: string;
  /** Tên người làm đơn — dùng đặt tên file. */
  applicant: string;
  status: string;
  fields: { label: string; value: string }[];
  signers?: { role: string; name?: string | null; signedAt?: string | null }[];
  /** Bố cục giấy khi in / xuất Word. */
  form?: RequestForm;
}

export function RequestDetailModal({ detail, onClose }: { detail: RequestDetail | null; onClose: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  if (!detail) return null;

  const rows = [...detail.fields.map((f) => [f.label, f.value || '—']), ['Trạng thái', detail.status]];
  const slug = `${detail.title}-${detail.applicant}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');

  const print = async () => {
    try {
      if (detail.form) { await printRequestForm(detail.form); return; }
      await printTables({
        title: detail.title,
        tables: [{ header: ['Mục', 'Nội dung'], rows }],
        landscape: false,
        signOff: { signers: detail.signers ?? [{ role: 'Người làm đơn' }, { role: 'Người duyệt' }] },
      });
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Không in được đơn.', 'error');
    }
  };

  const word = () => {
    if (detail.form) exportRequestFormDoc(detail.form, slug);
  };

  const excel = async () => {
    setBusy(true);
    try {
      await exportExcel({
        filename: slug,
        sheetName: 'Chi tiết đơn',
        title: detail.title.toUpperCase(),
        columns: [
          { header: 'Mục', value: (row: string[]) => row[0], width: 24 },
          { header: 'Nội dung', value: (row: string[]) => row[1], width: 50 },
        ],
        rows,
      });
    } catch {
      toast('Không xuất được file Excel.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal square open onClose={onClose} title={detail.title} size="md">
      <dl className="divide-y divide-slate-300 border border-slate-300 dark:divide-slate-700 dark:border-slate-700">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[9rem_1fr] gap-3 px-3 py-2.5 text-sm">
            <dt className="font-bold text-slate-600 dark:text-slate-400">{label}</dt>
            <dd className="whitespace-pre-line font-semibold text-slate-900 dark:text-slate-100">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => void excel()} disabled={busy}><FileSpreadsheet className="h-4 w-4" />Xuất Excel</Button>
        {detail.form && <Button variant="outline" onClick={word}><FileText className="h-4 w-4" />Xuất Word</Button>}
        <Button onClick={() => void print()}><Printer className="h-4 w-4" />In đơn</Button>
      </div>
    </Modal>
  );
}
