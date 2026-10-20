import { useEffect, useState } from 'react';
import { Download, ExternalLink, FileText, Search } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuth } from '@/contexts/AuthContext';
import { describeDbError } from '@/lib/dbError';
import { isFullAdmin } from '@/lib/permissions';
import { formatFileSize } from '@/lib/documents';
import { EMPLOYEE_DOCUMENT_TYPE_LABELS } from '@/lib/employeeDocuments';
import { supabase } from '@/lib/supabase';
import type { EmployeeDocument, Profile } from '@/types';

/**
 * F01.04: kho giấy tờ nhân viên. Kho hồ sơ ứng viên đã bỏ cùng luồng ứng
 * viên (migration 20261020100001).
 */
export function AdminDocumentRepository() {
  const { profile } = useAuth();
  const fullAdmin = isFullAdmin(profile);
  const [query, setQuery] = useState('');
  const [employees, setEmployees] = useState<Pick<Profile, 'id' | 'name' | 'department' | 'employee_code'>[]>([]);
  const [employeeDocs, setEmployeeDocs] = useState<EmployeeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true); setError('');
      const employeeQuery = supabase.from('profiles_directory').select('id,name,department,employee_code').eq('is_active', true).order('name');
      if (!fullAdmin) employeeQuery.eq('department', profile?.department || '__no_department__');
      const [people, docs] = await Promise.all([
        employeeQuery,
        supabase.from('employee_documents').select('*').order('created_at', { ascending: false }),
      ]);
      if (!active) return;
      const firstError = people.error || docs.error;
      if (firstError) setError(describeDbError(firstError));
      setEmployees((people.data || []) as typeof employees);
      setEmployeeDocs((docs.data || []) as EmployeeDocument[]);
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

  const openFile = async (doc: EmployeeDocument, download = false) => {
    const { data, error: urlError } = await supabase.storage.from('employee-documents').createSignedUrl(doc.storage_path, 60, { download: download ? doc.file_name : false });
    if (urlError || !data?.signedUrl) { setError(urlError ? describeDbError(urlError) : 'Không tạo được liên kết tài liệu.'); return; }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  return <section className="space-y-5">
    <header><p className="text-xs font-bold uppercase tracking-[.18em] text-indigo-600">Tổ chức & nhân sự</p><h1 className="mt-1 text-2xl font-bold text-slate-900">Kho hồ sơ giấy tờ</h1><p className="mt-1 text-sm text-slate-500">Tra cứu hồ sơ và giấy tờ nhân viên theo quyền được cấp.</p></header>
    <Card><CardContent className="flex items-center gap-3 py-4"><Search className="h-4 w-4 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm nhân viên hoặc tài liệu…" className="w-full text-sm outline-none placeholder:text-slate-400" /></CardContent></Card>
    {error && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Không tải được một phần kho hồ sơ: {error}</div>}
    {loading ? <p className="py-8 text-center text-sm text-slate-500">Đang tải hồ sơ…</p> : filteredDocs.length === 0 ? <EmptyState icon={<FileText className="h-7 w-7" />} title="Chưa tìm thấy tài liệu nhân viên" /> : <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="divide-y divide-slate-100">{filteredDocs.map((doc) => { const employee = employeeById.get(doc.employee_id)!; return <div key={doc.id} className="flex flex-wrap items-center gap-3 p-4"><FileText className="h-5 w-5 shrink-0 text-indigo-500" /><div className="min-w-0 flex-1"><p className="font-semibold text-slate-800">{doc.title}</p><p className="mt-1 text-xs text-slate-500">{employee.name} · {employee.employee_code || 'Chưa cấp mã'} · {employee.department || 'Chưa có phòng ban'}</p><p className="mt-1 text-xs text-slate-500">{EMPLOYEE_DOCUMENT_TYPE_LABELS[doc.document_type]} · {doc.file_name} · {formatFileSize(doc.size_bytes)}</p></div>{doc.expiry_date && <Badge className="bg-amber-50 text-amber-700">Hết hạn {new Date(doc.expiry_date).toLocaleDateString('vi-VN')}</Badge>}<button title="Mở tài liệu" onClick={() => void openFile(doc)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-indigo-700"><ExternalLink className="h-4 w-4" /></button><button title="Tải tài liệu" onClick={() => void openFile(doc, true)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-indigo-700"><Download className="h-4 w-4" /></button></div>; })}</div></div>}
  </section>;
}
