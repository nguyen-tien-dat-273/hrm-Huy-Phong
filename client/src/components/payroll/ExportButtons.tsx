// Ba lối xuất của một màn danh sách (UI_02): Excel, CSV, In / PDF.
import { useState } from 'react';
import { FileDown, FileSpreadsheet, Printer } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/contexts/ToastContext';
import { exportCsv, exportExcel, type ExportOptions } from '@/lib/tableExport';

export function ExportButtons<T>({ options, disabled = false }: { options: () => ExportOptions<T>; disabled?: boolean }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const run = async (format: 'xlsx' | 'csv') => {
    setBusy(true);
    try {
      const built = options();
      if (format === 'xlsx') await exportExcel(built);
      else exportCsv(built);
    } catch (error) {
      toast('Xuất dữ liệu thất bại: ' + (error instanceof Error ? error.message : String(error)), 'error');
    }
    setBusy(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 no-print">
      <Button variant="outline" size="sm" onClick={() => void run('xlsx')} disabled={busy || disabled}>
        <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
      </Button>
      <Button variant="outline" size="sm" onClick={() => void run('csv')} disabled={busy || disabled}>
        <FileDown className="h-3.5 w-3.5" /> CSV
      </Button>
      {/* PDF: hộp in của trình duyệt có "Lưu thành PDF"; CSS in đã dọn khung. */}
      <Button variant="outline" size="sm" onClick={() => window.print()} disabled={disabled}>
        <Printer className="h-3.5 w-3.5" /> In / PDF
      </Button>
    </div>
  );
}
