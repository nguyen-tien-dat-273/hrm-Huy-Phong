import { useEffect, useState } from 'react';
import { Download, Eye, FileText, Plus, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { formatFileSize } from '@/lib/documents';
import { deleteEmployeeDocument, EMPLOYEE_DOCUMENT_TYPE_LABELS, getEmployeeDocumentUrl, listEmployeeDocuments, uploadEmployeeDocument } from '@/lib/employeeDocuments';
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

export function EmployeeDocumentVault({ employee, actorId, canManage }: { employee: Pick<Profile, 'id' | 'name'>; actorId: string; canManage: boolean }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [documents, setDocuments] = useState<EmployeeDocument[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ type: 'CV' as EmployeeDocumentType, title: '', number: '', issueDate: '', expiryDate: '', note: '', file: null as File | null });
  const load = async () => { const result = await listEmployeeDocuments(employee.id); setDocuments(result.data); setError(result.error || ''); };
  useEffect(() => { void load(); }, [employee.id]);

  const openDocument = async (doc: EmployeeDocument, download = false) => {
    const result = await getEmployeeDocumentUrl(doc, download);
    if (!result.url) return toast(result.error || 'Không mở được tài liệu.', 'error');
    window.open(result.url, '_blank', 'noopener,noreferrer');
  };
  const remove = async (doc: EmployeeDocument) => {
    if (!await confirm({ title: `Xóa “${doc.title}”?`, message: 'File sẽ bị xóa khỏi kho hồ sơ và không thể khôi phục.', confirmLabel: 'Xóa tài liệu', danger: true })) return;
    const result = await deleteEmployeeDocument(doc);
    if (result.error) return toast(result.error, 'error');
    toast('Đã xóa tài liệu.', 'success'); void load();
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.file) return toast('Vui lòng chọn file.', 'warning');
    setSaving(true);
    const result = await uploadEmployeeDocument({ employeeId: employee.id, uploadedBy: actorId, file: form.file, documentType: form.type, title: form.title, documentNumber: form.number, issueDate: form.issueDate, expiryDate: form.expiryDate, note: form.note });
    setSaving(false);
    if (result.error) return toast(result.error, 'error');
    toast('Đã lưu vào kho hồ sơ.', 'success'); setOpen(false); setForm({ type: 'CV', title: '', number: '', issueDate: '', expiryDate: '', note: '', file: null }); void load();
  };

  return <section className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
      <h4 className="font-bold text-slate-900">Hồ sơ cần chuẩn bị khi nhận việc</h4>
      <p className="mt-1 text-xs text-slate-600">Hoàn thiện trong tuần đầu tiên nhận việc.</p>
      <ol className="mt-3 grid gap-2 sm:grid-cols-2">
        {REQUIRED_ONBOARDING_DOCUMENTS.map((item, index) => (
          <li key={item} className="flex gap-2 text-sm text-slate-700">
            <span className="font-semibold text-amber-700">{index + 1}.</span><span>{item}</span>
          </li>
        ))}
      </ol>
    </div>
    <div className="flex items-center justify-between gap-3"><div><h4 className="font-bold text-slate-900">Kho hồ sơ tài liệu</h4><p className="text-xs text-slate-500">{documents.length} tài liệu lưu tập trung theo nhân viên</p></div>{canManage && <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Thêm tài liệu</Button>}</div>
    {error ? <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Kho hồ sơ chưa sẵn sàng: {error}</p> : documents.length === 0 ? <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white p-5 text-center text-sm text-slate-500"><FileText className="mx-auto mb-2 h-6 w-6 text-slate-400" />Chưa có tài liệu nào.</div> : <div className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">{documents.map((doc) => <div key={doc.id} className="flex items-center gap-3 p-3"><FileText className="h-5 w-5 shrink-0 text-indigo-500" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-800">{doc.title}</p><p className="text-xs text-slate-500">{EMPLOYEE_DOCUMENT_TYPE_LABELS[doc.document_type]} · {formatFileSize(doc.size_bytes)}{doc.expiry_date ? ` · Hết hạn ${new Date(doc.expiry_date).toLocaleDateString('vi-VN')}` : ''}</p></div><button onClick={() => void openDocument(doc)} title="Xem" className="p-2 text-slate-400 hover:text-indigo-600"><Eye className="h-4 w-4" /></button><button onClick={() => void openDocument(doc, true)} title="Tải xuống" className="p-2 text-slate-400 hover:text-indigo-600"><Download className="h-4 w-4" /></button>{canManage && <button onClick={() => void remove(doc)} title="Xóa" className="p-2 text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}</div>)}</div>}
    <Modal open={open} onClose={() => setOpen(false)} title={`Thêm hồ sơ - ${employee.name}`}>
      <form onSubmit={submit} className="space-y-4"><Select label="Loại tài liệu" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as EmployeeDocumentType })}>{Object.entries(EMPLOYEE_DOCUMENT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select><Input label="Tên tài liệu" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required placeholder="Ví dụ: Hợp đồng lao động 2026" /><Input label="Số hiệu giấy tờ" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} /><div className="grid grid-cols-2 gap-3"><Input label="Ngày cấp" type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} /><Input label="Ngày hết hạn" type="date" min={form.issueDate || undefined} value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} /></div><Input label="File (tối đa 10 MB)" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp" onChange={(e) => setForm({ ...form, file: e.target.files?.[0] || null })} required /><Textarea label="Ghi chú" rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /><div className="flex gap-3"><Button type="button" variant="outline" onClick={() => setOpen(false)} className="flex-1">Hủy</Button><Button type="submit" disabled={saving} className="flex-1"><Upload className="h-4 w-4" />{saving ? 'Đang tải...' : 'Lưu hồ sơ'}</Button></div></form>
    </Modal>
  </section>;
}
