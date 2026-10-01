// ============================================================================
// Quy trình & biểu mẫu — bản dành cho nhân viên.
// ----------------------------------------------------------------------------
// Khu quản trị có màn quản lý quy trình (soạn, tải lên, ban hành, thay thế),
// nhưng người phải LÀM THEO quy trình lại không có chỗ nào đọc. Tài liệu ban
// hành mà không ai đọc được thì bằng không ban hành.
//
// Màn này CHỈ ĐỌC và chỉ hiện bản ĐANG HIỆU LỰC. Cố ý giấu bản nháp và bản
// đã bị thay thế: nhân viên mở nhầm một quy trình đã hết hiệu lực rồi làm
// theo còn tệ hơn là không tìm thấy gì.
// ============================================================================

import { useEffect, useState } from 'react';
import { BookOpen, Download, Search, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { formatDate } from '@/lib/utils';

const BUCKET = 'process-documents';

type Category = 'PROCESS' | 'POLICY' | 'GUIDE' | 'FORM';

const CATEGORY_LABEL: Record<Category, string> = {
  PROCESS: 'Quy trình',
  POLICY: 'Chính sách',
  GUIDE: 'Hướng dẫn',
  FORM: 'Biểu mẫu',
};

const CATEGORY_COLOR: Record<Category, string> = {
  PROCESS: 'bg-indigo-50 text-indigo-700',
  POLICY: 'bg-rose-50 text-rose-700',
  GUIDE: 'bg-cyan-50 text-cyan-700',
  FORM: 'bg-amber-50 text-amber-700',
};

interface ProcessDocument {
  id: string;
  code: string;
  title: string;
  version_label: string;
  category: Category;
  file_path: string | null;
  file_name: string | null;
  status: string;
  effective_from: string;
  summary: string | null;
}

export function StaffProcesses() {
  const { toast } = useToast();
  const [docs, setDocs] = useState<ProcessDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [supported, setSupported] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const load = async () => {
      if (!supabase) return;
      setLoading(true);
      const { data, error } = await supabase
        .from('process_documents')
        .select('id, code, title, version_label, category, file_path, file_name, status, effective_from, summary')
        .eq('status', 'ACTIVE')
        .order('category')
        .order('title');
      if (error) {
        setSupported(false);
        setLoading(false);
        return;
      }
      setDocs((data || []) as ProcessDocument[]);
      setLoading(false);
    };
    void load();
  }, []);

  const openFile = async (doc: ProcessDocument) => {
    if (!supabase || !doc.file_path) {
      return toast('Tài liệu này chưa đính kèm file.', 'warning');
    }
    // URL co han 5 phut: link file quy trinh noi bo khong nen gui ra ngoai
    // duoc, nen khong dung URL cong khai vinh vien.
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.file_path, 300);
    if (error || !data) return toast('Không mở được file: ' + describeDbError(error), 'error');
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  if (loading) return <Skeleton className="h-64" />;

  if (!supported) {
    return (
      <Card><CardContent>
        <p className="flex items-start gap-2.5 text-sm leading-relaxed text-amber-800">
          <TriangleAlert className="mt-0.5 h-5 w-5 flex-shrink-0" />
          Chưa đọc được thư viện quy trình. Báo quản trị viên kiểm tra lại.
        </p>
      </CardContent></Card>
    );
  }

  const keyword = search.trim().toLowerCase();
  const visible = docs.filter((doc) => !keyword
    || doc.title.toLowerCase().includes(keyword)
    || doc.code.toLowerCase().includes(keyword)
    || (doc.summary || '').toLowerCase().includes(keyword));

  const byCategory = (['PROCESS', 'POLICY', 'GUIDE', 'FORM'] as Category[])
    .map((category) => ({ category, items: visible.filter((doc) => doc.category === category) }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="space-y-4">
      <Card><CardContent>
        <p className="text-xs leading-relaxed text-slate-500">
          Chỉ hiện tài liệu <strong className="text-slate-700">đang hiệu lực</strong>. Bản nháp và
          bản đã bị thay thế không hiện ở đây, để không ai làm theo một quy trình đã hết hiệu lực.
        </p>
        <div className="relative mt-3">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Tìm theo tên, mã hoặc nội dung tóm tắt..."
            className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/60 pl-10 pr-4 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>
      </CardContent></Card>

      {visible.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-8 w-8" />}
          title={docs.length === 0 ? 'Chưa có tài liệu nào được ban hành' : 'Không tìm thấy tài liệu phù hợp'}
          description={docs.length === 0
            ? 'Khi công ty ban hành quy trình hoặc biểu mẫu, chúng sẽ hiện ở đây.'
            : 'Thử từ khóa khác.'}
        />
      ) : (
        byCategory.map((group) => (
          <Card key={group.category}>
            <CardContent className="p-0">
              <p className="border-b border-slate-100 bg-slate-50 px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                {CATEGORY_LABEL[group.category]} ({group.items.length})
              </p>
              <ul className="divide-y divide-slate-50">
                {group.items.map((doc) => (
                  <li key={doc.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm text-slate-900">{doc.title}</strong>
                        <Badge className={CATEGORY_COLOR[doc.category]}>{doc.version_label}</Badge>
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {doc.code} · hiệu lực từ {formatDate(doc.effective_from)}
                      </span>
                      {doc.summary && (
                        <span className="mt-1 block text-xs leading-relaxed text-slate-500">{doc.summary}</span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => void openFile(doc)}
                      disabled={!doc.file_path}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 transition hover:border-indigo-400 hover:text-indigo-700 disabled:opacity-40"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {doc.file_path ? 'Mở file' : 'Chưa có file'}
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
