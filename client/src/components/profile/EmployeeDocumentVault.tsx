import { useEffect, useState } from 'react';
import { Download, Eye, FileSignature, FileText, Plus, Trash2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { formatFileSize } from '@/lib/documents';
import { deleteEmployeeDocument, EMPLOYEE_DOCUMENT_TYPE_LABELS, getEmployeeDocumentUrl, listEmployeeDocuments, uploadEmployeeDocument } from '@/lib/employeeDocuments';
import { getTodayString } from '@/lib/utils';
import type { EmployeeDocument, EmployeeDocumentType, Profile } from '@/types';

const REQUIRED_ONBOARDING_DOCUMENTS = [
  'Sơ yếu lý lịch và CV',
  'Thông tin cư trú bản in từ VNeID',
  'Bản sao căn cước công dân',
  'Bản sao giấy khai sinh',
  'Bản sao văn bằng, chứng chỉ',
  'Thông tin tài khoản VietinBank và BIDV (bắt buộc với nhân viên chính thức)',
  'Thông tin người liên hệ khẩn cấp (họ tên, số điện thoại, quan hệ)',
];

/** Hợp đồng sắp hết hạn khi còn ≤ 30 ngày. */
const CONTRACT_EXPIRY_WARNING_DAYS = 30;

type VaultMode = 'documents' | 'contracts';

function contractStatus(doc: EmployeeDocument): { label: string; className: string } {
  if (!doc.expiry_date) return { label: 'Không xác định thời hạn', className: 'bg-emerald-100 text-emerald-800' };
  const today = getTodayString();
  if (doc.expiry_date < today) return { label: 'Hết hạn', className: 'bg-red-100 text-red-800' };
  const daysLeft = Math.ceil((new Date(doc.expiry_date).getTime() - new Date(today).getTime()) / 86_400_000);
  if (daysLeft <= CONTRACT_EXPIRY_WARNING_DAYS) return { label: `Sắp hết hạn · còn ${daysLeft} ngày`, className: 'bg-amber-100 text-amber-800' };
  return { label: 'Còn hiệu lực', className: 'bg-emerald-100 text-emerald-800' };
}

const formatVnDate = (value: string) => new Date(value).toLocaleDateString('vi-VN');

/**
 * Kho giấy tờ của một nhân sự (bảng employee_documents).
 * - `documents`: thông tin giấy tờ (CV, CCCD, bằng cấp...), không gồm hợp đồng.
 * - `contracts`: chỉ hợp đồng lao động, kèm trạng thái hiệu lực.
 */
export function EmployeeDocumentVault({ employee, actorId, canManage, mode = 'documents' }: {
  employee: Pick<Profile, 'id' | 'name'>;
  actorId: string;
  canManage: boolean;
  mode?: VaultMode;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const isContracts = mode === 'contracts';
  const defaultType: EmployeeDocumentType = isContracts ? 'CONTRACT' : 'CV';
  const typeOptions = Object.entries(EMPLOYEE_DOCUMENT_TYPE_LABELS).filter(([value]) => value !== 'CONTRACT');
  const emptyForm = { type: defaultType as EmployeeDocumentType, title: '', number: '', issueDate: '', expiryDate: '', note: '', file: null as File | null };
  const [documents, setDocuments] = useState<EmployeeDocument[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const load = async () => {
    const result = await listEmployeeDocuments(employee.id);
    setDocuments(result.data.filter((doc) => (doc.document_type === 'CONTRACT') === isContracts));
    setError(result.error || '');
  };
  useEffect(() => { void load(); }, [employee.id, mode]);

  const openDocument = async (doc: EmployeeDocument, download = false) => {
    const result = await getEmployeeDocumentUrl(doc, download);
    if (!result.url) return toast(result.error || 'Không mở được tài liệu.', 'error');
    window.open(result.url, '_blank', 'noopener,noreferrer');
  };
  const remove = async (doc: EmployeeDocument) => {
    if (!await confirm({ title: `Xóa “${doc.title}”?`, message: 'File sẽ bị xóa khỏi kho hồ sơ và không thể khôi phục.', confirmLabel: isContracts ? 'Xóa hợp đồng' : 'Xóa giấy tờ', danger: true })) return;
    const result = await deleteEmployeeDocument(doc);
    if (result.error) return toast(result.error, 'error');
    toast(isContracts ? 'Đã xóa hợp đồng.' : 'Đã xóa giấy tờ.', 'success'); void load();
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.file) return toast('Vui lòng chọn file.', 'warning');
    if (isContracts && !form.issueDate) return toast('Nhập ngày ký / ngày hiệu lực của hợp đồng.', 'warning');
    setSaving(true);
    const result = await uploadEmployeeDocument({ employeeId: employee.id, uploadedBy: actorId, file: form.file, documentType: isContracts ? 'CONTRACT' : form.type, title: form.title, documentNumber: form.number, issueDate: form.issueDate, expiryDate: form.expiryDate, note: form.note });
    setSaving(false);
    if (result.error) return toast(result.error, 'error');
    toast(isContracts ? 'Đã lưu hợp đồng.' : 'Đã lưu vào kho hồ sơ.', 'success'); setOpen(false); setForm(emptyForm); void load();
  };

  const DocIcon = isContracts ? FileSignature : FileText;

  return <section className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
    {!isContracts && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
      <h4 className="font-bold text-slate-900">Hồ sơ cần chuẩn bị khi nhận việc</h4>
      <p className="mt-1 text-xs text-slate-600">Hoàn thiện trong tuần đầu tiên nhận việc.</p>
      <ol className="mt-3 grid gap-2 sm:grid-cols-2">
        {REQUIRED_ONBOARDING_DOCUMENTS.map((item, index) => (
          <li key={item} className="flex gap-2 text-sm text-slate-700">
            <span className="font-semibold text-amber-700">{index + 1}.</span><span>{item}</span>
          </li>
        ))}
      </ol>
    </div>}
    <div className="flex items-center justify-between gap-3">
      <div>
        <h4 className="font-bold text-slate-900">{isContracts ? 'Hợp đồng lao động' : 'Thông tin giấy tờ'}</h4>
        <p className="text-xs text-slate-500">{documents.length} {isContracts ? 'hợp đồng' : 'giấy tờ lưu tập trung theo nhân viên'}</p>
      </div>
      {canManage && <Button size="sm" onClick={() => { setForm(emptyForm); setOpen(true); }}><Plus className="h-4 w-4" />{isContracts ? 'Thêm hợp đồng' : 'Thêm giấy tờ'}</Button>}
    </div>
    {error ? <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Kho hồ sơ chưa sẵn sàng: {error}</p>
      : documents.length === 0 ? <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white p-5 text-center text-sm text-slate-500"><DocIcon className="mx-auto mb-2 h-6 w-6 text-slate-400" />{isContracts ? 'Chưa có hợp đồng nào.' : 'Chưa có giấy tờ nào.'}</div>
      : <div className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">{documents.map((doc) => {
        const status = isContracts ? contractStatus(doc) : null;
        return <div key={doc.id} className="flex items-center gap-3 p-3">
          <DocIcon className="h-5 w-5 shrink-0 text-indigo-500" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-800">{doc.title}</p>
            {isContracts
              ? <p className="text-xs text-slate-500">
                  {doc.document_number ? `Số ${doc.document_number} · ` : ''}
                  {doc.issue_date ? `Hiệu lực ${formatVnDate(doc.issue_date)}` : 'Chưa có ngày hiệu lực'}
                  {doc.expiry_date ? ` → ${formatVnDate(doc.expiry_date)}` : ''}
                </p>
              : <p className="text-xs text-slate-500">{EMPLOYEE_DOCUMENT_TYPE_LABELS[doc.document_type]} · {formatFileSize(doc.size_bytes)}{doc.expiry_date ? ` · Hết hạn ${formatVnDate(doc.expiry_date)}` : ''}</p>}
            {status && <Badge className={`mt-1 ${status.className}`}>{status.label}</Badge>}
          </div>
          <button onClick={() => void openDocument(doc)} title="Xem" className="p-2 text-slate-400 hover:text-indigo-600"><Eye className="h-4 w-4" /></button>
          <button onClick={() => void openDocument(doc, true)} title="Tải xuống" className="p-2 text-slate-400 hover:text-indigo-600"><Download className="h-4 w-4" /></button>
          {canManage && <button onClick={() => void remove(doc)} title="Xóa" className="p-2 text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
        </div>;
      })}</div>}
    <Modal open={open} onClose={() => setOpen(false)} title={`${isContracts ? 'Thêm hợp đồng' : 'Thêm giấy tờ'} - ${employee.name}`}>
      <form onSubmit={submit} className="space-y-4">
        {!isContracts && <Select label="Loại giấy tờ" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as EmployeeDocumentType })}>{typeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>}
        <Input label={isContracts ? 'Tên hợp đồng' : 'Tên giấy tờ'} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required placeholder={isContracts ? 'Ví dụ: Hợp đồng lao động 12 tháng' : 'Ví dụ: Căn cước công dân'} />
        <Input label={isContracts ? 'Số hợp đồng' : 'Số hiệu giấy tờ'} value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <Input label={isContracts ? 'Ngày hiệu lực' : 'Ngày cấp'} type="date" value={form.issueDate} required={isContracts} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} />
          <Input label="Ngày hết hạn" type="date" min={form.issueDate || undefined} value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
        </div>
        {isContracts && <p className="-mt-2 text-xs text-slate-500">Bỏ trống ngày hết hạn nếu là hợp đồng không xác định thời hạn.</p>}
        <Input label="File (tối đa 10 MB)" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp" onChange={(e) => setForm({ ...form, file: e.target.files?.[0] || null })} required />
        <Textarea label="Ghi chú" rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        <div className="flex gap-3"><Button type="button" variant="outline" onClick={() => setOpen(false)} className="flex-1">Hủy</Button><Button type="submit" disabled={saving} className="flex-1"><Upload className="h-4 w-4" />{saving ? 'Đang tải...' : 'Lưu'}</Button></div>
      </form>
    </Modal>
  </section>;
}
