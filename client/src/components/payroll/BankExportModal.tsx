// ============================================================================
// FR06.04.04 — Xuất file chi lương cho ngân hàng (VietinBank / BIDV …).
// ----------------------------------------------------------------------------
// Bố cục cột, nội dung chuyển khoản và việc bỏ dấu đều là DỮ LIỆU của mẫu
// (payroll_bank_templates) — ngân hàng đổi file mẫu thì sửa dòng mẫu, không
// sửa code. Chỉ xuất khi BGĐ đã ký duyệt chi (BR-PAY-010); database kiểm lại
// và ghi nhật ký mỗi lần xuất.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Download, TriangleAlert } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { useToast } from '@/contexts/ToastContext';
import { formatVND } from '@/lib/utils';
import { Skeleton } from '@/components/ui/Skeleton';
import { stripVietnamese } from '@/lib/tableExport';
import { fetchBankAccounts, fetchBankTemplates, recordBankExport } from '@/lib/payrollData';
import type { BankExportField, EmployeeBankAccount, PayrollBankTemplate, PayrollRun, Profile } from '@/types';

export interface BankExportRow {
  profile: Pick<Profile, 'id' | 'name' | 'employee_code'>;
  net: number;
}

interface BankExportModalProps {
  open: boolean;
  run: PayrollRun;
  rows: BankExportRow[];
  onClose: () => void;
  onExported: () => void;
}

export function BankExportModal({ open, run, rows, onClose, onExported }: BankExportModalProps) {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<PayrollBankTemplate[]>([]);
  const [accounts, setAccounts] = useState<EmployeeBankAccount[]>([]);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void Promise.all([fetchBankTemplates(), fetchBankAccounts()]).then(([templateRows, accountRows]) => {
      const active = templateRows.filter((template) => template.is_active);
      setTemplates(active);
      setAccounts(accountRows);
      setCode((current) => current || active[0]?.code || '');
      setLoading(false);
    });
  }, [open]);

  const template = templates.find((row) => row.code === code) ?? null;
  const accountByUser = useMemo(() => new Map(accounts.map((row) => [row.user_id, row])), [accounts]);
  const payable = rows.filter((row) => row.net > 0);
  const ready = payable.filter((row) => accountByUser.has(row.profile.id));
  const missing = payable.filter((row) => !accountByUser.has(row.profile.id));
  const total = ready.reduce((sum, row) => sum + Math.round(row.net), 0);

  const mm = run.month_start.slice(5, 7);
  const yyyy = run.month_start.slice(0, 4);

  const cellOf = (field: BankExportField, row: BankExportRow, index: number, account: EmployeeBankAccount): string | number => {
    const text = (value: string) => (template?.strip_diacritics ? stripVietnamese(value) : value);
    switch (field) {
      case 'seq': return index + 1;
      case 'employee_code': return row.profile.employee_code ?? '';
      case 'account_holder': return text(account.account_holder).toUpperCase();
      case 'account_number': return account.account_number;
      case 'bank_name': return text(account.bank_name);
      case 'bank_code': return account.bank_code;
      case 'branch': return text(account.branch ?? '');
      case 'amount': return Math.round(row.net);
      case 'description': return text((template?.description_template ?? '')
        .replace(/\{MM\}/g, mm).replace(/\{YYYY\}/g, yyyy)
        .replace(/\{EMPLOYEE_CODE\}/g, row.profile.employee_code ?? '')
        .replace(/\{NAME\}/g, row.profile.name));
      default: return '';
    }
  };

  const handleExport = async () => {
    if (!template || ready.length === 0) return;
    setBusy(true);
    try {
      const XLSX = await import('xlsx');
      const sheet: (string | number)[][] = [
        template.columns.map((column) => column.header),
        ...ready.map((row, index) => {
          const account = accountByUser.get(row.profile.id) as EmployeeBankAccount;
          return template.columns.map((column) => cellOf(column.field, row, index, account));
        }),
      ];
      const worksheet = XLSX.utils.aoa_to_sheet(sheet);
      worksheet['!cols'] = template.columns.map((column) => ({
        wch: column.field === 'description' ? 40 : column.field === 'seq' ? 6 : column.field === 'account_holder' ? 24 : 18,
      }));
      worksheet['!rows'] = [{ hpt: 26 }, ...ready.map(() => ({ hpt: 20 }))];
      worksheet['!views'] = [{ state: 'frozen', ySplit: 1 }];

      // Number formatting for amount
      const amountColIdx = template.columns.findIndex((c) => c.field === 'amount');
      if (amountColIdx !== -1) {
        for (let R = 1; R <= ready.length; R++) {
          const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: amountColIdx })];
          if (cell && typeof cell.v === 'number') {
            cell.z = '#,##0';
          }
        }
      }

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, template.sheet_name.slice(0, 31));
      XLSX.writeFile(workbook, `chi-luong-${template.code.toLowerCase()}-${yyyy}-${mm}.xlsx`);
    } catch (error) {
      setBusy(false);
      toast('Không tạo được file: ' + (error instanceof Error ? error.message : String(error)), 'error');
      return;
    }
    const error = await recordBankExport(run.id, template.code, ready.length, total);
    setBusy(false);
    if (error) {
      toast('Đã tạo file nhưng chưa ghi được nhật ký xuất: ' + error, 'warning');
    } else {
      toast(`Đã xuất ${ready.length} dòng chi lương (${formatVND(total)}) theo mẫu ${template.name}.`, 'success');
    }
    onExported();
  };

  return (
    <Modal square open={open} onClose={busy ? () => undefined : onClose} title={`File chi lương tháng ${mm}/${yyyy}`} size="lg">
      {loading ? (
        <div className="space-y-4" role="status" aria-busy="true">
          <span className="sr-only">Đang tải mẫu ngân hàng…</span>
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-36 !rounded-md" />
            <Skeleton className="h-11 w-full" />
          </div>
          <Skeleton className="h-28 w-full" />
        </div>
      ) : templates.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">Chưa có mẫu file ngân hàng nào đang dùng.</p>
      ) : (
        <div className="space-y-4">
          <Select className="!rounded-none" label="Mẫu file ngân hàng" required value={code} onChange={(event) => setCode(event.target.value)}>
            {templates.map((row) => <option key={row.code} value={row.code}>{row.name}</option>)}
          </Select>
          {template?.note && <p className="text-xs leading-relaxed text-slate-500">{template.note}</p>}

          <div className="grid grid-cols-3 gap-2 rounded-none bg-slate-50 p-3 text-xs">
            <div><p className="font-bold uppercase tracking-wider text-slate-400">Số dòng</p><p className="text-sm font-bold text-slate-800">{ready.length}</p></div>
            <div><p className="font-bold uppercase tracking-wider text-slate-400">Tổng chuyển</p><p className="text-sm font-bold text-indigo-700">{formatVND(total)}</p></div>
            <div><p className="font-bold uppercase tracking-wider text-slate-400">Cột</p><p className="text-sm font-bold text-slate-800">{template?.columns.length ?? 0}</p></div>
          </div>

          {missing.length > 0 && (
            <div className="flex items-start gap-2 rounded-none border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>
                {missing.length} người chưa khai tài khoản nhận lương nên KHÔNG có trong file:{' '}
                <strong>{missing.map((row) => row.profile.name).join(', ')}</strong>. Khai ở Cơ chế lương → chọn người → Tài khoản nhận lương.
              </span>
            </div>
          )}

          {template && ready.length > 0 && (
            <div className="max-h-64 overflow-auto rounded-xl border border-slate-300 dark:border-slate-700 shadow-sm">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-[#fdf2f4] dark:bg-[#201114] border-b-2 border-[#bf1f2b] dark:border-[#e66a76] shadow-[inset_0_-2px_0_#bf1f2b] dark:shadow-[inset_0_-2px_0_#e66a76]">
                  <tr>{template.columns.map((column) => (
                    <th key={column.header} className="px-3 py-2 text-left font-black text-[#5c0f16] dark:text-[#fde8ea] uppercase tracking-wider text-[11px] border-l border-[#eed5d8] dark:border-[#4a1c22] first:border-l-0">
                      {column.header}
                    </th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-slate-300 dark:divide-slate-800 bg-white dark:bg-slate-900">
                  {ready.slice(0, 50).map((row, index) => {
                    const account = accountByUser.get(row.profile.id) as EmployeeBankAccount;
                    return (
                      <tr key={row.profile.id} className="group hover:bg-slate-100/80 dark:hover:bg-slate-800/60 transition-colors">
                        {template.columns.map((column) => {
                          const value = cellOf(column.field, row, index, account);
                          return (
                            <td key={column.header} className="whitespace-nowrap px-3 py-2 text-slate-900 dark:text-slate-100 font-semibold border-l border-slate-300 dark:border-slate-700 first:border-l-0">
                              {column.field === 'amount' ? formatVND(Number(value)) : value}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Đóng</Button>
            <Button onClick={() => void handleExport()} disabled={busy || !template || ready.length === 0}>
              <Download className="h-4 w-4" /> {busy ? 'Đang xuất…' : 'Tải file Excel'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
