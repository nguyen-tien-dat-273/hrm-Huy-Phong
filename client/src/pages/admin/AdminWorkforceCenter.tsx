import { useEffect, useMemo, useState } from 'react';
import { BriefcaseBusiness, Building2, CalendarClock, FileWarning, History, Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { describeDbError } from '@/lib/dbError';
import { supabase } from '@/lib/supabase';
import type { PostgrestError } from '@supabase/supabase-js';

type Section = 'workers' | 'orders' | 'partners' | 'documents';
type WorkerStatus = 'SCREENING' | 'TRAINING' | 'WAITING_INTERVIEW' | 'PASSED' | 'POST_PASS_TRAINING' | 'COE' | 'VISA' | 'WAITING_DEPARTURE' | 'WORKING_ABROAD' | 'RETURNED' | 'FAILED' | 'WITHDRAWN';

interface Company { id: string; name: string; prefecture: string | null; industry: string | null; contact_name: string | null; phone: string | null }
interface Union { id: string; name: string; region: string | null; contact_name: string | null; phone: string | null }
interface Order { id: string; code: string; company_id: string | null; union_id: string | null; industry: string; quantity: number; gender_requirement: string; salary_jpy: number | null; interview_date: string | null; status: string; note: string | null }
interface Worker { id: string; code: string; full_name: string; date_of_birth: string | null; gender: string | null; hometown: string | null; phone: string | null; program: string; industry: string | null; japanese_level: string; status: WorkerStatus; order_id: string | null; user_id: string | null; note: string | null }
/** Tài khoản để gán vào hồ sơ — chỉ cần đủ thông tin cho ô chọn. */
interface AccountOption { id: string; name: string; email: string; is_active: boolean }
interface WorkerDocument { id: string; worker_id: string; document_type: string; document_number: string; issue_date: string | null; expiry_date: string | null; note: string | null }
interface StatusLog { id: string; worker_id: string; status: WorkerStatus; changed_at: string; note: string | null }

const STATUS: Record<WorkerStatus, { label: string; color: string }> = {
  SCREENING: { label: 'Sơ tuyển', color: 'bg-slate-100 text-slate-700' },
  TRAINING: { label: 'Đào tạo', color: 'bg-sky-50 text-sky-700' },
  WAITING_INTERVIEW: { label: 'Chờ phỏng vấn', color: 'bg-indigo-50 text-indigo-700' },
  PASSED: { label: 'Trúng tuyển', color: 'bg-emerald-50 text-emerald-700' },
  POST_PASS_TRAINING: { label: 'Đào tạo sau trúng tuyển', color: 'bg-teal-50 text-teal-700' },
  COE: { label: 'Làm COE', color: 'bg-amber-50 text-amber-700' },
  VISA: { label: 'Chờ Visa', color: 'bg-orange-50 text-orange-700' },
  WAITING_DEPARTURE: { label: 'Chờ xuất cảnh', color: 'bg-rose-50 text-rose-700' },
  WORKING_ABROAD: { label: 'Đang làm việc tại Nhật', color: 'bg-green-50 text-green-700' },
  RETURNED: { label: 'Đã về nước', color: 'bg-stone-100 text-stone-700' },
  FAILED: { label: 'Trượt', color: 'bg-red-50 text-red-700' },
  WITHDRAWN: { label: 'Đã dừng', color: 'bg-slate-100 text-slate-500' },
};

const DOC_LABEL: Record<string, string> = { PASSPORT: 'Hộ chiếu', COE: 'COE', VISA: 'Visa', JAPANESE_CERTIFICATE: 'Chứng chỉ tiếng Nhật', HEALTH_CHECK: 'Khám sức khỏe', CONTRACT: 'Hợp đồng' };
const ORDER_STATUS: Record<string, { label: string; color: string }> = { RECRUITING: { label: 'Đang tuyển', color: 'bg-emerald-50 text-emerald-700' }, FILLED: { label: 'Đã đủ', color: 'bg-amber-50 text-amber-700' }, CLOSED: { label: 'Đã đóng', color: 'bg-slate-100 text-slate-600' } };

const emptyWorker = { code: '', full_name: '', date_of_birth: '', gender: 'MALE', hometown: '', phone: '', program: 'TECHNICAL_INTERN', industry: '', japanese_level: 'NONE', order_id: '', user_id: '', note: '' };
const emptyOrder = { code: '', company_id: '', union_id: '', industry: '', quantity: '1', gender_requirement: 'ANY', salary_jpy: '', interview_date: '', status: 'RECRUITING', note: '' };
const emptyPartner = { kind: 'company', name: '', area: '', industry: '', contact_name: '', phone: '' };
const emptyDocument = { worker_id: '', document_type: 'PASSPORT', document_number: '', issue_date: '', expiry_date: '', note: '' };

const sectionMeta: Record<Section, { title: string; desc: string }> = {
  workers: { title: 'Hồ sơ người lao động', desc: 'Quản lý thông tin và tiến trình tuyển chọn của người lao động.' },
  orders: { title: 'Đơn tuyển dụng', desc: 'Theo dõi nhu cầu tuyển, lịch phỏng vấn và số lượng tiếp nhận.' },
  partners: { title: 'Xí nghiệp & nghiệp đoàn', desc: 'Danh bạ đối tác tiếp nhận và đơn vị quản lý tại Nhật Bản.' },
  documents: { title: 'Hồ sơ giấy tờ', desc: 'Theo dõi hộ chiếu, COE, visa, hợp đồng và cảnh báo hết hạn.' },
};

export function AdminWorkforceCenter({ section }: { section: Section }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [unions, setUnions] = useState<Union[]>([]);
  const [documents, setDocuments] = useState<WorkerDocument[]>([]);
  const [logs, setLogs] = useState<StatusLog[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [modal, setModal] = useState<'worker' | 'order' | 'partner' | 'document' | null>(null);
  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null);
  const [workerForm, setWorkerForm] = useState(emptyWorker);
  const [orderForm, setOrderForm] = useState(emptyOrder);
  const [partnerForm, setPartnerForm] = useState(emptyPartner);
  const [documentForm, setDocumentForm] = useState(emptyDocument);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError('');
    const results = await Promise.all([
      supabase.from('overseas_workers').select('*').order('created_at', { ascending: false }),
      supabase.from('recruitment_orders').select('*').order('created_at', { ascending: false }),
      supabase.from('workforce_companies').select('*').order('name'),
      supabase.from('workforce_unions').select('*').order('name'),
      supabase.from('worker_documents').select('*').order('expiry_date', { ascending: true }),
      supabase.from('worker_status_logs').select('*').order('changed_at', { ascending: false }),
      // Danh sách tài khoản để gán vào hồ sơ. Không nằm trong `firstError` bên
      // dưới: thiếu nó thì chỉ mất ô chọn tài khoản, phần còn lại vẫn dùng được.
      supabase.from('profiles').select('id, name, email, is_active').eq('is_active', true).order('name'),
    ]);
    setAccounts((results[6].data || []) as AccountOption[]);
    const firstError = results.slice(0, 6).find((result) => result.error)?.error;
    if (firstError) setError(`Phân hệ tuyển dụng và hồ sơ lao động chưa được khởi tạo trên Supabase. Hãy chạy migration 20260908150000_workforce_mobility.sql. Chi tiết: ${describeDbError(firstError)}`);
    setWorkers((results[0].data || []) as Worker[]); setOrders((results[1].data || []) as Order[]);
    setCompanies((results[2].data || []) as Company[]); setUnions((results[3].data || []) as Union[]);
    setDocuments((results[4].data || []) as WorkerDocument[]); setLogs((results[5].data || []) as StatusLog[]);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const workerById = (id: string) => workers.find((worker) => worker.id === id);
  const companyById = (id: string | null) => companies.find((company) => company.id === id);
  const unionById = (id: string | null) => unions.find((item) => item.id === id);
  const orderById = (id: string | null) => orders.find((order) => order.id === id);
  const normalized = query.trim().toLocaleLowerCase('vi');
  const filteredWorkers = workers.filter((worker) => [worker.code, worker.full_name, worker.hometown, worker.industry].some((value) => value?.toLocaleLowerCase('vi').includes(normalized)));
  const filteredOrders = orders.filter((order) => [order.code, order.industry, companyById(order.company_id)?.name].some((value) => value?.toLocaleLowerCase('vi').includes(normalized)));
  const expiringCount = documents.filter((doc) => doc.expiry_date && daysLeft(doc.expiry_date) <= 30).length;
  const meta = sectionMeta[section];

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true);
    let historyError: PostgrestError | null = null;
    let result;
    if (modal === 'worker') {
      const payload = { ...workerForm, date_of_birth: workerForm.date_of_birth || null, hometown: workerForm.hometown || null, phone: workerForm.phone || null, industry: workerForm.industry || null, order_id: workerForm.order_id || null, user_id: workerForm.user_id || null, note: workerForm.note || null };
      result = editingId ? await supabase.from('overseas_workers').update(payload).eq('id', editingId).select('id,status').single() : await supabase.from('overseas_workers').insert(payload).select('id,status').single();
      if (!editingId && !result.error && result.data) {
        const history = await supabase.from('worker_status_logs').insert({ worker_id: result.data.id, status: result.data.status, note: 'Khởi tạo hồ sơ', changed_by: profile?.id });
        historyError = history.error;
      }
    } else if (modal === 'order') {
      const payload = { ...orderForm, company_id: orderForm.company_id || null, union_id: orderForm.union_id || null, quantity: Number(orderForm.quantity), salary_jpy: orderForm.salary_jpy ? Number(orderForm.salary_jpy) : null, interview_date: orderForm.interview_date || null, note: orderForm.note || null };
      result = editingId ? await supabase.from('recruitment_orders').update(payload).eq('id', editingId) : await supabase.from('recruitment_orders').insert(payload);
    } else if (modal === 'partner') {
      if (partnerForm.kind === 'company') {
        const payload = { name: partnerForm.name, prefecture: partnerForm.area || null, industry: partnerForm.industry || null, contact_name: partnerForm.contact_name || null, phone: partnerForm.phone || null };
        result = editingId ? await supabase.from('workforce_companies').update(payload).eq('id', editingId) : await supabase.from('workforce_companies').insert(payload);
      } else {
        const payload = { name: partnerForm.name, region: partnerForm.area || null, contact_name: partnerForm.contact_name || null, phone: partnerForm.phone || null };
        result = editingId ? await supabase.from('workforce_unions').update(payload).eq('id', editingId) : await supabase.from('workforce_unions').insert(payload);
      }
    } else {
      const payload = { ...documentForm, issue_date: documentForm.issue_date || null, expiry_date: documentForm.expiry_date || null, note: documentForm.note || null };
      result = editingId ? await supabase.from('worker_documents').update(payload).eq('id', editingId) : await supabase.from('worker_documents').insert(payload);
    }
    setSaving(false);
    if (result.error) { toast('Không thể lưu: ' + describeDbError(result.error), 'error'); return; }
    toast(editingId ? 'Đã cập nhật dữ liệu.' : 'Đã lưu dữ liệu.', 'success');
    if (historyError) toast('Dữ liệu đã lưu nhưng chưa ghi được lịch sử trạng thái: ' + describeDbError(historyError), 'warning');
    setModal(null); setEditingId(null); setWorkerForm(emptyWorker); setOrderForm(emptyOrder); setPartnerForm(emptyPartner); setDocumentForm(emptyDocument); await load();
  };

  const openCreate = () => { setEditingId(null); setWorkerForm(emptyWorker); setOrderForm(emptyOrder); setPartnerForm(emptyPartner); setDocumentForm(emptyDocument); setModal(section === 'workers' ? 'worker' : section === 'orders' ? 'order' : section === 'partners' ? 'partner' : 'document'); };
  /**
   * Danh sách tài khoản chọn được: bỏ những tài khoản đã gán cho hồ sơ khác.
   *
   * Một tài khoản chỉ thuộc một hồ sơ lao động — gán cho hai hồ sơ thì mở
   * trang Hồ sơ cá nhân ra không biết lấy hồ sơ nào.
   */
  const availableAccounts = accounts.filter((account) => (
    account.id === workerForm.user_id
    || !workers.some((item) => item.user_id === account.id && item.id !== editingId)
  ));

  /**
   * Chọn người trên hệ thống: điền tên VÀ gán tài khoản trong một thao tác.
   *
   * Trước đây hai việc này là hai trường rời nhau — gõ tên tay ở trên, chọn
   * tài khoản ở tận dưới cùng. Không gì buộc chúng nói cùng một người, nên hồ
   * sơ mang tên "Nguyễn Văn A" mà link sang tài khoản của người khác là
   * chuyện xảy ra được, và không ai phát hiện cho tới lúc người ta mở hồ sơ
   * của mình ra thấy giấy tờ của người lạ.
   */
  const pickAccount = (userId: string) => {
    const account = accounts.find((item) => item.id === userId);
    setWorkerForm((prev) => ({
      ...prev,
      user_id: userId,
      // Chon nguoi thi lay luon ten cua ho. Van sua duoc o o ben duoi vi ho so
      // lao dong dung TEN KHAI SINH, con ten tai khoan co the la ten goi.
      full_name: account ? account.name : prev.full_name,
    }));
  };

  const editWorker = (item: Worker) => { setEditingId(item.id); setWorkerForm({ code: item.code, full_name: item.full_name, date_of_birth: item.date_of_birth || '', gender: item.gender || 'MALE', hometown: item.hometown || '', phone: item.phone || '', program: item.program, industry: item.industry || '', japanese_level: item.japanese_level, order_id: item.order_id || '', user_id: item.user_id || '', note: item.note || '' }); setSelectedWorker(null); setModal('worker'); };
  const editOrder = (item: Order) => { setEditingId(item.id); setOrderForm({ code: item.code, company_id: item.company_id || '', union_id: item.union_id || '', industry: item.industry, quantity: String(item.quantity), gender_requirement: item.gender_requirement, salary_jpy: item.salary_jpy == null ? '' : String(item.salary_jpy), interview_date: item.interview_date || '', status: item.status, note: item.note || '' }); setModal('order'); };
  const editDocument = (item: WorkerDocument) => { setEditingId(item.id); setDocumentForm({ worker_id: item.worker_id, document_type: item.document_type, document_number: item.document_number, issue_date: item.issue_date || '', expiry_date: item.expiry_date || '', note: item.note || '' }); setModal('document'); };
  const editCompany = (item: Company) => { setEditingId(item.id); setPartnerForm({ kind: 'company', name: item.name, area: item.prefecture || '', industry: item.industry || '', contact_name: item.contact_name || '', phone: item.phone || '' }); setModal('partner'); };
  const editUnion = (item: Union) => { setEditingId(item.id); setPartnerForm({ kind: 'union', name: item.name, area: item.region || '', industry: '', contact_name: item.contact_name || '', phone: item.phone || '' }); setModal('partner'); };
  const remove = async (table: string, id: string, label: string) => { if (!await confirm({ title: `Xóa “${label}”?`, message: 'Nếu dữ liệu đang được sử dụng, hệ thống sẽ từ chối để bảo toàn liên kết.', confirmLabel: 'Xóa', danger: true })) return; const { error: removeError } = await supabase.from(table).delete().eq('id', id); if (removeError) toast('Không thể xóa: ' + describeDbError(removeError), 'error'); else { toast('Đã xóa dữ liệu.', 'success'); setSelectedWorker(null); await load(); } };

  const changeStatus = async (worker: Worker, status: WorkerStatus) => {
    if (status === worker.status) return;
    const { error: updateError } = await supabase.from('overseas_workers').update({ status, updated_at: new Date().toISOString() }).eq('id', worker.id);
    if (updateError) { toast('Không đổi được trạng thái: ' + describeDbError(updateError), 'error'); return; }
    const { error: historyError } = await supabase.from('worker_status_logs').insert({ worker_id: worker.id, status, changed_by: profile?.id });
    toast(`Đã chuyển ${worker.full_name} sang “${STATUS[status].label}”.`, historyError ? 'warning' : 'success');
    if (historyError) toast('Chưa ghi được lịch sử trạng thái: ' + describeDbError(historyError), 'warning');
    await load();
    setSelectedWorker((current) => current?.id === worker.id ? { ...current, status } : current);
  };

  if (loading) return <Card><CardContent><p className="py-16 text-center text-sm text-slate-400">Đang tải hồ sơ tuyển dụng…</p></CardContent></Card>;
  if (error) return <Card><ErrorState message={error} onRetry={load} /></Card>;

  return <div className="space-y-5">
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
      <div><h2 className="text-2xl font-bold text-slate-800">{meta.title}</h2><p className="text-sm text-slate-500 mt-1">{meta.desc}</p></div>
      <Button onClick={openCreate}><Plus className="w-4 h-4" />{section === 'workers' ? 'Thêm lao động' : section === 'orders' ? 'Tạo đơn tuyển' : section === 'partners' ? 'Thêm đối tác' : 'Thêm giấy tờ'}</Button>
    </div>

    <Card><CardContent className="flex items-center gap-3 py-4"><Search className="w-4 h-4 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm theo mã, tên hoặc ngành nghề…" className="w-full text-sm outline-none placeholder:text-slate-400" />{section === 'documents' && <Badge className={expiringCount ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}>{expiringCount} sắp/đã hết hạn</Badge>}</CardContent></Card>

    {section === 'workers' && <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase text-slate-500 border-b border-slate-200 bg-slate-50"><th className="px-4 py-3">Mã / Họ tên</th><th className="px-4 py-3">Ngành nghề</th><th className="px-4 py-3">Chương trình</th><th className="px-4 py-3">Tiếng Nhật</th><th className="px-4 py-3">Đơn tuyển</th><th className="px-4 py-3">Trạng thái</th></tr></thead><tbody>{filteredWorkers.map((worker) => <tr key={worker.id} className="border-b border-slate-100 hover:bg-indigo-50/40 cursor-pointer" onClick={() => setSelectedWorker(worker)}><td className="px-4 py-3"><p className="font-semibold text-indigo-700">{worker.full_name}</p><p className="text-xs text-slate-400">{worker.code} · {worker.hometown || '—'}</p></td><td className="px-4 py-3 text-slate-600">{worker.industry || '—'}</td><td className="px-4 py-3 text-xs text-slate-600">{programLabel(worker.program)}</td><td className="px-4 py-3"><Badge className="bg-slate-100 text-slate-700">{worker.japanese_level}</Badge></td><td className="px-4 py-3 text-xs text-slate-600">{orderById(worker.order_id)?.code || 'Chưa gán'}</td><td className="px-4 py-3"><Badge className={STATUS[worker.status].color}>{STATUS[worker.status].label}</Badge></td></tr>)}</tbody></table>{filteredWorkers.length === 0 && <EmptyState icon={<Users className="w-7 h-7" />} title="Chưa có hồ sơ người lao động" description="Thêm hồ sơ đầu tiên để theo dõi tiến trình tuyển chọn." />}</div></Card>}

    {section === 'orders' && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{filteredOrders.map((order) => <Card key={order.id}><CardContent><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-800">{order.code}</p><p className="text-sm text-slate-500 mt-1">{companyById(order.company_id)?.name || 'Chưa chọn xí nghiệp'}</p></div><div className="flex items-center gap-1"><Badge className={ORDER_STATUS[order.status]?.color}>{ORDER_STATUS[order.status]?.label}</Badge><Button variant="secondary" onClick={() => editOrder(order)} aria-label="Sửa đơn tuyển"><Pencil className="h-4 w-4" /></Button><Button variant="danger" onClick={() => void remove('recruitment_orders', order.id, order.code)} aria-label="Xóa đơn tuyển"><Trash2 className="h-4 w-4" /></Button></div></div><div className="grid grid-cols-2 gap-3 mt-4 text-sm"><Info label="Ngành nghề" value={order.industry} /><Info label="Số lượng" value={`${workers.filter((w) => w.order_id === order.id).length}/${order.quantity}`} /><Info label="Lương dự kiến" value={order.salary_jpy ? `${order.salary_jpy.toLocaleString('vi-VN')} JPY` : '—'} /><Info label="Phỏng vấn" value={formatDate(order.interview_date)} /></div><p className="text-xs text-slate-400 mt-4">Nghiệp đoàn: {unionById(order.union_id)?.name || '—'}</p></CardContent></Card>)}{filteredOrders.length === 0 && <Card className="lg:col-span-2"><EmptyState icon={<BriefcaseBusiness className="w-7 h-7" />} title="Chưa có đơn tuyển dụng" /></Card>}</div>}

    {section === 'partners' && <div className="grid grid-cols-1 lg:grid-cols-2 gap-5"><PartnerList title="Xí nghiệp tiếp nhận" icon={<Building2 className="w-5 h-5" />} items={companies.filter((item) => !normalized || `${item.name} ${item.prefecture || ''} ${item.industry || ''}`.toLocaleLowerCase('vi').includes(normalized)).map((item) => ({ id: item.id, title: item.name, sub: [item.prefecture, item.industry].filter(Boolean).join(' · '), contact: item.contact_name }))} onEdit={(id) => { const item = companies.find((value) => value.id === id); if (item) editCompany(item); }} onDelete={(id, label) => void remove('workforce_companies', id, label)} /><PartnerList title="Nghiệp đoàn" icon={<Users className="w-5 h-5" />} items={unions.filter((item) => !normalized || `${item.name} ${item.region || ''}`.toLocaleLowerCase('vi').includes(normalized)).map((item) => ({ id: item.id, title: item.name, sub: item.region || '', contact: item.contact_name }))} onEdit={(id) => { const item = unions.find((value) => value.id === id); if (item) editUnion(item); }} onDelete={(id, label) => void remove('workforce_unions', id, label)} /></div>}

    {section === 'documents' && (
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-slate-500 border-b border-slate-200 bg-slate-50"><th className="px-4 py-3">Lao động</th><th className="px-4 py-3">Loại giấy tờ</th><th className="px-4 py-3">Số giấy tờ</th><th className="px-4 py-3">Ngày cấp</th><th className="px-4 py-3">Ngày hết hạn</th><th className="px-4 py-3">Tình trạng</th><th className="px-4 py-3">Thao tác</th></tr></thead>
            <tbody>{documents
              .filter((doc) => !normalized || [workerById(doc.worker_id)?.full_name, doc.document_number, DOC_LABEL[doc.document_type]].some((value) => value?.toLocaleLowerCase('vi').includes(normalized)))
              .map((doc) => {
                const left = doc.expiry_date ? daysLeft(doc.expiry_date) : null;
                return <tr key={doc.id} className="border-b border-slate-100 hover:bg-indigo-50/40"><td className="px-4 py-3 font-medium text-slate-800">{workerById(doc.worker_id)?.full_name || '—'}</td><td className="px-4 py-3">{DOC_LABEL[doc.document_type]}</td><td className="px-4 py-3 font-mono text-xs">{doc.document_number}</td><td className="px-4 py-3 text-slate-500">{formatDate(doc.issue_date)}</td><td className="px-4 py-3 text-slate-500">{formatDate(doc.expiry_date)}</td><td className="px-4 py-3">{left === null ? <Badge className="bg-slate-100 text-slate-600">Không thời hạn</Badge> : <Badge className={left < 0 ? 'bg-red-50 text-red-700' : left <= 30 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}>{left < 0 ? `Quá hạn ${Math.abs(left)} ngày` : `Còn ${left} ngày`}</Badge>}</td><td className="px-4 py-3"><div className="flex gap-1"><Button variant="secondary" onClick={() => editDocument(doc)} aria-label="Sửa giấy tờ"><Pencil className="h-4 w-4" /></Button><Button variant="danger" onClick={() => void remove('worker_documents', doc.id, doc.document_number)} aria-label="Xóa giấy tờ"><Trash2 className="h-4 w-4" /></Button></div></td></tr>;
              })}</tbody>
          </table>
          {documents.length === 0 && <EmptyState icon={<FileWarning className="w-7 h-7" />} title="Chưa có giấy tờ" />}
        </div>
      </Card>
    )}

    <Modal open={modal === 'worker'} onClose={() => setModal(null)} title="Thêm hồ sơ lao động" size="lg"><form onSubmit={save} className="space-y-4"><div><Select label="Người trên hệ thống" value={workerForm.user_id} onChange={(e) => pickAccount(e.target.value)}><option value="">Chưa có tài khoản — tự gõ tên bên dưới</option>{availableAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.email}</option>)}</Select><p className="mt-1.5 text-xs leading-relaxed text-slate-500">Chọn người thì tên điền sẵn và hồ sơ nối luôn với tài khoản đó — họ mới xem được hồ sơ và giấy tờ của chính mình ở trang Hồ sơ cá nhân. Ứng viên chưa có tài khoản thì để trống và gõ tên tay.</p></div><div className="grid grid-cols-2 gap-3"><Input label="Mã lao động" value={workerForm.code} onChange={(e) => setWorkerForm({ ...workerForm, code: e.target.value })} required /><div><Input label="Họ và tên" value={workerForm.full_name} onChange={(e) => setWorkerForm({ ...workerForm, full_name: e.target.value })} required />{(() => {
      /* Ho so lao dong dung TEN KHAI SINH, ten tai khoan co the la ten goi,
         nen khong ep bang nhau. Nhung lech nhau thi phai noi - lech vi go
         nham khac han lech vi co y. */
      const linked = accounts.find((item) => item.id === workerForm.user_id);
      if (!linked || linked.name.trim() === workerForm.full_name.trim()) return null;
      return <p className="mt-1.5 text-xs leading-relaxed text-amber-700">Tài khoản đang nối tên là “{linked.name}”. Khác nhau vẫn lưu được nếu đây là tên khai sinh.</p>;
    })()}</div></div><div className="grid grid-cols-2 gap-3"><Input label="Ngày sinh" type="date" value={workerForm.date_of_birth} onChange={(e) => setWorkerForm({ ...workerForm, date_of_birth: e.target.value })} /><Select label="Giới tính" value={workerForm.gender} onChange={(e) => setWorkerForm({ ...workerForm, gender: e.target.value })}><option value="MALE">Nam</option><option value="FEMALE">Nữ</option></Select></div><div className="grid grid-cols-2 gap-3"><Input label="Quê quán" value={workerForm.hometown} onChange={(e) => setWorkerForm({ ...workerForm, hometown: e.target.value })} /><Input label="Số điện thoại" value={workerForm.phone} onChange={(e) => setWorkerForm({ ...workerForm, phone: e.target.value })} /></div><div className="grid grid-cols-2 gap-3"><Select label="Chương trình" value={workerForm.program} onChange={(e) => setWorkerForm({ ...workerForm, program: e.target.value })}><option value="TECHNICAL_INTERN">Thực tập sinh kỹ năng</option><option value="SPECIFIED_SKILLED">Kỹ năng đặc định</option><option value="ENGINEER">Kỹ sư</option></Select><Select label="Tiếng Nhật" value={workerForm.japanese_level} onChange={(e) => setWorkerForm({ ...workerForm, japanese_level: e.target.value })}>{['NONE','N5','N4','N3','JFT_BASIC'].map((v) => <option key={v} value={v}>{v}</option>)}</Select></div><Input label="Ngành nghề" value={workerForm.industry} onChange={(e) => setWorkerForm({ ...workerForm, industry: e.target.value })} /><Select label="Đơn tuyển dụng" value={workerForm.order_id} onChange={(e) => setWorkerForm({ ...workerForm, order_id: e.target.value })}><option value="">Chưa gán</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.code} · {order.industry}</option>)}</Select><Textarea label="Ghi chú" value={workerForm.note} onChange={(e) => setWorkerForm({ ...workerForm, note: e.target.value })} /><Actions saving={saving} onCancel={() => setModal(null)} /></form></Modal>
    <Modal open={modal === 'order'} onClose={() => setModal(null)} title="Tạo đơn tuyển dụng" size="lg"><form onSubmit={save} className="space-y-4"><div className="grid grid-cols-2 gap-3"><Input label="Mã đơn" value={orderForm.code} onChange={(e) => setOrderForm({ ...orderForm, code: e.target.value })} required /><Input label="Ngành nghề" value={orderForm.industry} onChange={(e) => setOrderForm({ ...orderForm, industry: e.target.value })} required /></div><div className="grid grid-cols-2 gap-3"><Select label="Xí nghiệp" value={orderForm.company_id} onChange={(e) => setOrderForm({ ...orderForm, company_id: e.target.value })}><option value="">Chọn xí nghiệp</option>{companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select><Select label="Nghiệp đoàn" value={orderForm.union_id} onChange={(e) => setOrderForm({ ...orderForm, union_id: e.target.value })}><option value="">Chọn nghiệp đoàn</option>{unions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></div><div className="grid grid-cols-2 gap-3"><Input label="Số lượng cần" type="number" min="1" value={orderForm.quantity} onChange={(e) => setOrderForm({ ...orderForm, quantity: e.target.value })} required /><Input label="Lương JPY" type="number" min="0" value={orderForm.salary_jpy} onChange={(e) => setOrderForm({ ...orderForm, salary_jpy: e.target.value })} /></div><div className="grid grid-cols-2 gap-3"><Select label="Yêu cầu giới tính" value={orderForm.gender_requirement} onChange={(e) => setOrderForm({ ...orderForm, gender_requirement: e.target.value })}><option value="ANY">Không yêu cầu</option><option value="MALE">Nam</option><option value="FEMALE">Nữ</option></Select><Input label="Ngày phỏng vấn" type="date" value={orderForm.interview_date} onChange={(e) => setOrderForm({ ...orderForm, interview_date: e.target.value })} /></div><Textarea label="Ghi chú" value={orderForm.note} onChange={(e) => setOrderForm({ ...orderForm, note: e.target.value })} /><Actions saving={saving} onCancel={() => setModal(null)} /></form></Modal>
    <Modal open={modal === 'partner'} onClose={() => setModal(null)} title="Thêm đối tác"><form onSubmit={save} className="space-y-4"><Select label="Loại đối tác" value={partnerForm.kind} onChange={(e) => setPartnerForm({ ...partnerForm, kind: e.target.value })}><option value="company">Xí nghiệp tiếp nhận</option><option value="union">Nghiệp đoàn</option></Select><Input label="Tên đối tác" value={partnerForm.name} onChange={(e) => setPartnerForm({ ...partnerForm, name: e.target.value })} required /><Input label={partnerForm.kind === 'company' ? 'Tỉnh/Thành' : 'Khu vực'} value={partnerForm.area} onChange={(e) => setPartnerForm({ ...partnerForm, area: e.target.value })} />{partnerForm.kind === 'company' && <Input label="Ngành nghề" value={partnerForm.industry} onChange={(e) => setPartnerForm({ ...partnerForm, industry: e.target.value })} />}<div className="grid grid-cols-2 gap-3"><Input label="Người liên hệ" value={partnerForm.contact_name} onChange={(e) => setPartnerForm({ ...partnerForm, contact_name: e.target.value })} /><Input label="Điện thoại" value={partnerForm.phone} onChange={(e) => setPartnerForm({ ...partnerForm, phone: e.target.value })} /></div><Actions saving={saving} onCancel={() => setModal(null)} /></form></Modal>
    <Modal open={modal === 'document'} onClose={() => setModal(null)} title="Thêm giấy tờ"><form onSubmit={save} className="space-y-4"><Select label="Lao động" value={documentForm.worker_id} onChange={(e) => setDocumentForm({ ...documentForm, worker_id: e.target.value })} required><option value="">Chọn lao động</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.code} · {worker.full_name}</option>)}</Select><Select label="Loại giấy tờ" value={documentForm.document_type} onChange={(e) => setDocumentForm({ ...documentForm, document_type: e.target.value })}>{Object.entries(DOC_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select><Input label="Số giấy tờ" value={documentForm.document_number} onChange={(e) => setDocumentForm({ ...documentForm, document_number: e.target.value })} required /><div className="grid grid-cols-2 gap-3"><Input label="Ngày cấp" type="date" value={documentForm.issue_date} onChange={(e) => setDocumentForm({ ...documentForm, issue_date: e.target.value })} /><Input label="Ngày hết hạn" type="date" value={documentForm.expiry_date} onChange={(e) => setDocumentForm({ ...documentForm, expiry_date: e.target.value })} /></div><Textarea label="Ghi chú" value={documentForm.note} onChange={(e) => setDocumentForm({ ...documentForm, note: e.target.value })} /><Actions saving={saving} onCancel={() => setModal(null)} /></form></Modal>

    <Modal open={!!selectedWorker} onClose={() => setSelectedWorker(null)} title={selectedWorker ? `${selectedWorker.code} · ${selectedWorker.full_name}` : 'Chi tiết lao động'} size="lg">{selectedWorker && <div className="space-y-5"><div className="grid grid-cols-2 md:grid-cols-4 gap-3"><Info label="Chương trình" value={programLabel(selectedWorker.program)} /><Info label="Ngành nghề" value={selectedWorker.industry || '—'} /><Info label="Tiếng Nhật" value={selectedWorker.japanese_level} /><Info label="Đơn tuyển" value={orderById(selectedWorker.order_id)?.code || 'Chưa gán'} /></div><Info label="Tài khoản đăng nhập" value={selectedWorker.user_id ? (accounts.find((account) => account.id === selectedWorker.user_id)?.email ?? 'Tài khoản đã bị xóa') : 'Chưa gán — người này chưa tự xem được hồ sơ của mình'} /><Select label="Cập nhật giai đoạn tiến trình" value={selectedWorker.status} onChange={(e) => void changeStatus(selectedWorker, e.target.value as WorkerStatus)}>{Object.entries(STATUS).map(([value, cfg]) => <option key={value} value={value}>{cfg.label}</option>)}</Select><div><h3 className="font-semibold text-slate-700 flex items-center gap-2"><History className="w-4 h-4" /> Timeline tiến trình</h3><div className="mt-3 space-y-3">{logs.filter((log) => log.worker_id === selectedWorker.id).map((log) => <div key={log.id} className="flex gap-3"><span className="mt-1.5 w-2.5 h-2.5 rounded-full bg-indigo-500 ring-4 ring-indigo-50" /><div><p className="text-sm font-medium text-slate-700">{STATUS[log.status]?.label || log.status}</p><p className="text-xs text-slate-400">{new Date(log.changed_at).toLocaleString('vi-VN')}{log.note ? ` · ${log.note}` : ''}</p></div></div>)}{logs.every((log) => log.worker_id !== selectedWorker.id) && <p className="text-sm text-slate-400">Chưa có lịch sử thay đổi.</p>}</div></div><div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><Button variant="secondary" onClick={() => editWorker(selectedWorker)}><Pencil className="h-4 w-4" />Sửa hồ sơ</Button><Button variant="danger" onClick={() => void remove('overseas_workers', selectedWorker.id, selectedWorker.full_name)}><Trash2 className="h-4 w-4" />Xóa hồ sơ</Button></div></div>}</Modal>
  </div>;
}

function PartnerList({ title, icon, items, onEdit, onDelete }: { title: string; icon: React.ReactNode; items: { id: string; title: string; sub: string; contact: string | null }[]; onEdit: (id: string) => void; onDelete: (id: string, label: string) => void }) {
  return <Card><CardContent><h3 className="font-semibold text-slate-700 flex items-center gap-2">{icon}{title}</h3><div className="mt-4 divide-y divide-slate-100">{items.map((item) => <div key={item.id} className="flex items-center gap-2 py-3 first:pt-0"><div className="min-w-0 flex-1"><p className="font-medium text-slate-800">{item.title}</p><p className="text-xs text-slate-500 mt-0.5">{item.sub || 'Chưa cập nhật khu vực'}{item.contact ? ` · Liên hệ: ${item.contact}` : ''}</p></div><Button variant="secondary" onClick={() => onEdit(item.id)} aria-label="Sửa đối tác"><Pencil className="h-4 w-4" /></Button><Button variant="danger" onClick={() => onDelete(item.id, item.title)} aria-label="Xóa đối tác"><Trash2 className="h-4 w-4" /></Button></div>)}{items.length === 0 && <p className="text-sm text-slate-400 py-8 text-center">Chưa có dữ liệu</p>}</div></CardContent></Card>;
}
function Info({ label, value }: { label: string; value: string }) { return <div><p className="text-xs text-slate-400">{label}</p><p className="text-sm font-medium text-slate-700 mt-0.5">{value}</p></div>; }
function Actions({ saving, onCancel }: { saving: boolean; onCancel: () => void }) { return <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="secondary" onClick={onCancel}>Hủy</Button><Button type="submit" disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu dữ liệu'}</Button></div>; }
function daysLeft(date: string) { return Math.ceil((new Date(`${date}T23:59:59`).getTime() - Date.now()) / 86400000); }
function formatDate(date: string | null) { return date ? new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN') : '—'; }
function programLabel(value: string) { return { TECHNICAL_INTERN: 'Thực tập sinh kỹ năng', SPECIFIED_SKILLED: 'Kỹ năng đặc định', ENGINEER: 'Kỹ sư' }[value] || value; }
