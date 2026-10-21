// Tài khoản nhận lương của một nhân sự — nguồn cho file chi lương ngân hàng.

import { useEffect, useState } from 'react';
import { CreditCard, UserRound } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/contexts/ToastContext';
import { stripVietnamese } from '@/lib/tableExport';
import { saveBankAccount } from '@/lib/payrollData';
import type { EmployeeBankAccount, Profile } from '@/types';

export function BankAccountCard({ person, account, canManage, onSaved }: {
  person: Profile; account: EmployeeBankAccount | null; canManage: boolean; onSaved: () => void;
}) {
  const { toast } = useToast();
  const blank = () => ({
    bank_code: account?.bank_code ?? '',
    bank_name: account?.bank_name ?? '',
    account_number: account?.account_number ?? '',
    account_holder: account?.account_holder ?? stripVietnamese(person.name).toUpperCase(),
    branch: account?.branch ?? '',
  });
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setForm(blank()); }, [person.id, account?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const issues = {
    bank_code: /^[A-Z][A-Z0-9_]*$/.test(form.bank_code) ? undefined : 'Viết hoa không dấu, VD: VIETINBANK, BIDV.',
    bank_name: form.bank_name.trim() ? undefined : 'Bắt buộc.',
    account_number: /^\d{6,20}$/.test(form.account_number) ? undefined : 'Từ 6 đến 20 chữ số.',
    account_holder: form.account_holder.trim() ? undefined : 'Bắt buộc.',
  };
  const invalid = Object.values(issues).some(Boolean);
  const touched = JSON.stringify(form) !== JSON.stringify(blank());

  const save = async () => {
    if (invalid) return;
    setSaving(true);
    const error = await saveBankAccount({
      user_id: person.id,
      bank_code: form.bank_code,
      bank_name: form.bank_name.trim(),
      account_number: form.account_number,
      account_holder: form.account_holder.trim(),
      branch: form.branch.trim() || null,
    });
    setSaving(false);
    if (error) return toast('Không lưu được tài khoản: ' + error, 'error');
    toast('Đã lưu tài khoản nhận lương.', 'success');
    onSaved();
  };

  return (
    <Card className="!rounded-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CreditCard className="h-4 w-4 text-slate-400" /> Tài khoản nhận lương</CardTitle>
      </CardHeader>
      <CardContent>
        {!account && !canManage ? (
          <p className="text-sm text-slate-500"><UserRound className="mr-1 inline h-4 w-4" />Chưa khai tài khoản.</p>
        ) : (
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => { event.preventDefault(); void save(); }}
          >
            <Input className="!rounded-none" label="Mã ngân hàng" required disabled={!canManage} value={form.bank_code}
              onChange={(event) => setForm({ ...form, bank_code: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })}
              error={touched ? issues.bank_code : undefined} />
            <Input className="!rounded-none" label="Tên ngân hàng" required disabled={!canManage} value={form.bank_name}
              onChange={(event) => setForm({ ...form, bank_name: event.target.value })}
              error={touched ? issues.bank_name : undefined} />
            <Input className="!rounded-none" label="Số tài khoản" required inputMode="numeric" disabled={!canManage} value={form.account_number}
              onChange={(event) => setForm({ ...form, account_number: event.target.value.replace(/\D/g, '') })}
              error={touched ? issues.account_number : undefined} />
            <Input className="!rounded-none" label="Chủ tài khoản" required disabled={!canManage} value={form.account_holder}
              onChange={(event) => setForm({ ...form, account_holder: event.target.value })}
              error={touched ? issues.account_holder : undefined} />
            <Input className="!rounded-none" label="Chi nhánh" disabled={!canManage} value={form.branch}
              onChange={(event) => setForm({ ...form, branch: event.target.value })} />
            {canManage && (
              <div className="flex items-end justify-end gap-2">
                <Button type="button" variant="outline" disabled={!touched || saving} onClick={() => setForm(blank())}>Huỷ</Button>
                <Button type="submit" disabled={!touched || invalid || saving}>{saving ? 'Đang lưu…' : 'Lưu'}</Button>
              </div>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
