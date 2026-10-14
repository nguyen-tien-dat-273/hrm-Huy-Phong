import { useEffect, useState } from 'react';
import { Download, ExternalLink, FileText, FolderOpen, Search, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuth } from '@/contexts/AuthContext';
import { describeDbError } from '@/lib/dbError';
import { isFullAdmin } from '@/lib/permissions';
import { formatFileSize, uploadContentType, validateFile } from '@/lib/documents';
import { EMPLOYEE_DOCUMENT_TYPE_LABELS } from '@/lib/employeeDocuments';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import type { EmployeeDocument, Profile } from '@/types';

interface Candidate { id: string; full_name: string; email: string | null; phone: string | null; cv_url: string | null; stage: string; created_at: string }
interface CandidateDocument { id: string; candidate_id: string; title: string; storage_path: string; file_name: string; mime_type: string | null; size_bytes: number; created_at: string }
type Space = 'candidates' | 'employees';

const STAGE_LABEL: Record<string, string> = { APPLIED: 'Đã ứng tuyển', HR_SCREENING: 'HR sàng lọc', MANAGER_SCREENING: 'Trưởng bộ phận xem', INTERVIEW_1: 'Phỏng vấn vòng 1', INTERVIEW_2: 'Phỏng vấn vòng 2', TEST: 'Làm bài test', OFFER: 'Đã gửi offer', HIRED: 'Đã nhận việc', REJECTED: 'Không đạt', WITHDRAWN: 'Đã rút' };

export function AdminDocumentRepository() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const fullAdmin = isFullAdmin(profile);
  const [space, setSpace] = useState<Space>('employees');
  const [query, setQuery] = useState('');
  const [employees, setEmployees] = useState<Pick<Profile, 'id' | 'name' | 'department' | 'employee_code'>[]>([]);
  const [employeeDocs, setEmployeeDocs] = useState<EmployeeDocument[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateDocs, setCandidateDocs] = useState<CandidateDocument[]>([]);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [candidateFiles, setCandidateFiles] = useState<Record<string, File | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true); setError('');
      const employeeQuery = supabase.from('profiles_directory').select('id,name,department,employee_code').eq('is_active', true).order('name');
      if (!fullAdmin) employeeQuery.eq('department', profile?.department || '__no_department__');
      const [people, docs, applicantRows, applicantDocs] = await Promise.all([
        employeeQuery,
        supabase.from('employee_documents').select('*').order('created_at', { ascending: false }),
        fullAdmin ? supabase.from('recruitment_candidates').select('id,full_name,email,phone,cv_url,stage,created_at').order('created_at', { ascending: false }) : Promise.resolve({ data: [], error: null }),
        fullAdmin ? supabase.from('recruitment_candidate_documents').select('*').order('created_at', { ascending: false }) : Promise.resolve({ data: [], error: null }),
      ]);
      if (!active) return;
      const firstError = people.error || docs.error || applicantRows.error || applicantDocs.error;
      if (firstError) setError(describeDbError(firstError));
      setEmployees((people.data || []) as typeof employees);
      setEmployeeDocs((docs.data || []) as EmployeeDocument[]);
      setCandidates((applicantRows.data || []) as Candidate[]);
      setCandidateDocs((applicantDocs.data || []) as CandidateDocument[]);
      setLoading(false);
    };
    void load();
    return () => { active = false; };
  }, [fullAdmin, profile?.department]);

  const normalized = query.trim().toLocaleLowerCase('vi');
  const employeeById = new Map(employees.map((item) => [item.id, item]));
  const filteredDocs = employeeDocs.filter((doc) => {
    const employee = employeeById.get(doc.employee_id);
    return employee && (!normalized || [employee.name, employee.department, employee.employee_code, doc.title, doc.file_name, EMPLOYEE_DOCUMENT_TYPE_LABELS[doc.document_type]].some((value) => value?.toLocaleLowerCase('vi').includes(normalized)));
  });
  const filteredCandidates = candidates.filter((item) => !normalized || [item.full_name, item.email, item.phone, STAGE_LABEL[item.stage]].some((value) => value?.toLocaleLowerCase('vi').includes(normalized)));

  const openFile = async (doc: EmployeeDocument, download = false) => {
    const { data, error: urlError } = await supabase.storage.from('employee-documents').createSignedUrl(doc.storage_path, 60, { download: download ? doc.file_name : false });
    if (urlError || !data?.signedUrl) { setError(urlError ? describeDbError(urlError) : 'Không tạo được liên kết tài liệu.'); return; }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const openCandidateFile = async (doc: CandidateDocument) => {
    const { data, error: openError } = await supabase.storage.from('candidate-documents').createSignedUrl(doc.storage_path, 60);
    if (openError || !data?.signedUrl) return toast(openError ? describeDbError(openError) : 'Không mở được tài liệu.', 'error');
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const uploadCandidateFile = async (candidate: Candidate) => {
    const candidateFile = candidateFiles[candidate.id];
    if (!candidateFile) return toast('Chọn tệp cần tải lên trước.', 'warning');
    const invalid = validateFile(candidateFile);
    if (invalid) return toast(invalid, 'error');
    setUploadingFor(candidate.id);
    const storagePath = `${candidate.id}/${crypto.randomUUID()}-${candidateFile.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]/g, '-')}`;
    const mimeType = uploadContentType(candidateFile.name);
    const { error: uploadError } = await supabase.storage.from('candidate-documents').upload(storagePath, candidateFile, { contentType: mimeType });
    if (uploadError) { setUploadingFor(null); return toast(`Tải tệp thất bại: ${describeDbError(uploadError)}`, 'error'); }
    const { data, error: insertError } = await supabase.from('recruitment_candidate_documents').insert({ candidate_id: candidate.id, title: candidateFile.name, storage_path: storagePath, file_name: candidateFile.name, mime_type: mimeType, size_bytes: candidateFile.size, uploaded_by: profile?.id } as never).select('*').single();
    if (insertError) {
      await supabase.storage.from('candidate-documents').remove([storagePath]);
      setUploadingFor(null); return toast(`Lưu hồ sơ thất bại: ${describeDbError(insertError)}`, 'error');
    }
    setCandidateDocs((current) => [data as CandidateDocument, ...current]);
    setCandidateFiles((current) => ({ ...current, [candidate.id]: null })); setUploadingFor(null); toast('Đã lưu hồ sơ ứng viên.', 'success');
  };

  return <section className="space-y-5">
    <header><p className="text-xs font-bold uppercase tracking-[.18em] text-indigo-600">Tổ chức & nhân sự</p><h1 className="mt-1 text-2xl font-bold text-slate-900">Kho hồ sơ giấy tờ</h1><p className="mt-1 text-sm text-slate-500">Tra cứu tài liệu ứng viên và hồ sơ nhân viên theo quyền được cấp.</p></header>
    {fullAdmin && <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2">
      <button onClick={() => { setSpace('employees'); setQuery(''); }} className={`rounded-xl px-4 py-2 text-sm font-semibold ${space === 'employees' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><FolderOpen className="mr-2 inline h-4 w-4" />Hồ sơ nhân viên</button>
      <button onClick={() => { setSpace('candidates'); setQuery(''); }} className={`rounded-xl px-4 py-2 text-sm font-semibold ${space === 'candidates' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><FolderOpen className="mr-2 inline h-4 w-4" />Hồ sơ ứng viên</button>
    </div>}
    <Card><CardContent className="flex items-center gap-3 py-4"><Search className="h-4 w-4 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={space === 'employees' ? 'Tìm nhân viên hoặc tài liệu…' : 'Tìm ứng viên…'} className="w-full text-sm outline-none placeholder:text-slate-400" /></CardContent></Card>
    {error && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Không tải được một phần kho hồ sơ: {error}</div>}
    {loading ? <p className="py-8 text-center text-sm text-slate-500">Đang tải hồ sơ…</p> : space === 'employees' ? filteredDocs.length === 0 ? <EmptyState icon={<FileText className="h-7 w-7" />} title="Chưa tìm thấy tài liệu nhân viên" /> : <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="divide-y divide-slate-100">{filteredDocs.map((doc) => { const employee = employeeById.get(doc.employee_id)!; return <div key={doc.id} className="flex flex-wrap items-center gap-3 p-4"><FileText className="h-5 w-5 shrink-0 text-indigo-500" /><div className="min-w-0 flex-1"><p className="font-semibold text-slate-800">{doc.title}</p><p className="mt-1 text-xs text-slate-500">{employee.name} · {employee.employee_code || 'Chưa cấp mã'} · {employee.department || 'Chưa có phòng ban'}</p><p className="mt-1 text-xs text-slate-500">{EMPLOYEE_DOCUMENT_TYPE_LABELS[doc.document_type]} · {doc.file_name} · {formatFileSize(doc.size_bytes)}</p></div>{doc.expiry_date && <Badge className="bg-amber-50 text-amber-700">Hết hạn {new Date(doc.expiry_date).toLocaleDateString('vi-VN')}</Badge>}<button title="Mở tài liệu" onClick={() => void openFile(doc)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-indigo-700"><ExternalLink className="h-4 w-4" /></button><button title="Tải tài liệu" onClick={() => void openFile(doc, true)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-indigo-700"><Download className="h-4 w-4" /></button></div>; })}</div></div> : filteredCandidates.length === 0 ? <EmptyState icon={<FileText className="h-7 w-7" />} title="Chưa tìm thấy hồ sơ ứng viên" /> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filteredCandidates.map((item) => { const selectedFile = candidateFiles[item.id] || null; return <Card key={item.id}><CardContent className="space-y-3"><div className="flex items-start justify-between gap-3"><div><h2 className="font-bold text-slate-900">{item.full_name}</h2><p className="mt-1 text-xs text-slate-500">{item.email || 'Không có email'} · {item.phone || 'Không có số điện thoại'}</p></div><Badge className="bg-indigo-50 text-indigo-700">{STAGE_LABEL[item.stage] || item.stage}</Badge></div>{item.cv_url ? <a href={item.cv_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-700 underline"><FileText className="h-4 w-4" />Mở CV / hồ sơ đính kèm</a> : <p className="text-sm text-slate-400">Chưa có CV đính kèm.</p>}<div className="space-y-2 border-t border-slate-100 pt-3">{candidateDocs.filter((doc) => doc.candidate_id === item.id).map((doc) => <button key={doc.id} onClick={() => void openCandidateFile(doc)} className="flex w-full items-center gap-2 text-left text-xs font-semibold text-indigo-700 hover:underline"><FileText className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate">{doc.title}</span><span className="text-slate-400">{formatFileSize(doc.size_bytes)}</span></button>)}<label className="block text-xs font-semibold text-slate-600">Thêm tài liệu ứng viên<input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.webp" onChange={(event) => setCandidateFiles((current) => ({ ...current, [item.id]: event.target.files?.[0] || null }))} className="mt-1 block w-full text-xs file:mr-2 file:rounded-md file:border-0 file:bg-indigo-50 file:px-2 file:py-1 file:font-semibold file:text-indigo-700" /></label>{selectedFile && <Button size="sm" disabled={uploadingFor !== null} onClick={() => void uploadCandidateFile(item)}><Upload className="h-4 w-4" />{uploadingFor === item.id ? 'Đang tải…' : `Lưu ${selectedFile.name}`}</Button>}</div></CardContent></Card>; })}</div>}
  </section>;
}
