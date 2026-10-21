import { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/contexts/ToastContext';
import { exportExcel, type ExportOptions } from '@/lib/tableExport';

export function ExportButtons<T>({
  options,
  disabled = false,
  square = false,
  className = '',
}: {
  options: () => ExportOptions<T>;
  disabled?: boolean;
  square?: boolean;
  className?: string;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const built = options();
      await exportExcel(built);
    } catch (error) {
      toast('Xuất dữ liệu thất bại: ' + (error instanceof Error ? error.message : String(error)), 'error');
    }
    setBusy(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 no-print">
      <Button
        variant="outline"
        size={square ? 'xs' : 'sm'}
        square={square}
        onClick={() => void run()}
        disabled={busy || disabled}
        className={`text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40 ${square ? '!min-h-0 !h-8 text-xs px-2.5' : ''} ${className}`}
      >
        <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> Xuất Excel
      </Button>
    </div>
  );
}
