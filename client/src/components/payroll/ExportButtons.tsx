import { useState } from 'react';
import { FileSpreadsheet, Printer } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/contexts/ToastContext';
import { exportExcel, type ExportOptions } from '@/lib/tableExport';
import { signOffLines } from '@/lib/payrollSignOff';
import { printTable, type PrintSignOff } from '@/lib/tablePrint';

export function ExportButtons<T>({
  options,
  signOff,
  disabled = false,
  square = false,
  className = '',
}: {
  options: () => ExportOptions<T>;
  /** Chữ ký điện tử + con dấu in ở chân bản in (chứng từ lương). */
  signOff?: () => PrintSignOff;
  disabled?: boolean;
  square?: boolean;
  className?: string;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const run = async (mode: 'excel' | 'print') => {
    setBusy(true);
    try {
      const built = options();
      await (mode === 'excel' ? exportExcel(signOff ? { ...built, footerLines: signOffLines(signOff()) } : built) : printTable(built, signOff?.()));
    } catch (error) {
      toast((mode === 'excel' ? 'Xuất dữ liệu' : 'In') + ' thất bại: ' + (error instanceof Error ? error.message : String(error)), 'error');
    }
    setBusy(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 no-print">
      <Button
        variant="outline"
        size={square ? 'xs' : 'sm'}
        square={square}
        onClick={() => void run('excel')}
        disabled={busy || disabled}
        className={`text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40 ${square ? '!min-h-0 !h-8 text-xs px-2.5' : ''} ${className}`}
      >
        <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> Xuất Excel
      </Button>
      <Button
        variant="outline"
        size={square ? 'xs' : 'sm'}
        square={square}
        onClick={() => void run('print')}
        disabled={busy || disabled}
        className={square ? '!min-h-0 !h-8 text-xs px-2.5' : ''}
      >
        <Printer className="h-3.5 w-3.5" /> In
      </Button>
    </div>
  );
}
