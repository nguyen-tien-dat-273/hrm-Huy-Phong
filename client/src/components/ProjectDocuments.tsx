import { useEffect, useRef, useState } from 'react';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import {
  Upload, Link2, FileText, Trash2, Download, ExternalLink, Lock, Loader2, Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  DOCUMENT_TYPE_CONFIG, listDocuments, uploadDocument, addDocumentLink,
  getDocumentUrl, deleteDocument, validateFile, validateExternalUrl, formatFileSize, MAX_FILE_SIZE,
} from '@/lib/documents';
import { hasPermission } from '@/lib/permissions';
import { formatDate } from '@/lib/utils';
import type { DocumentType, ProjectDocument } from '@/types';
import { Pagination, usePagination, PAGE_SIZE_TABLE, PAGE_SIZE_LIST } from '@/components/ui/Pagination';

type Source = 'upload' | 'link';

export function ProjectDocuments({ projectId }: { projectId: string }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const pg = usePagination(documents, PAGE_SIZE_LIST, [documents.length]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Người có quyền Quản lý Dự án mới được đánh dấu tài liệu là mật. */
  const canManage = hasPermission(profile, 'projects');

  const [source, setSource] = useState<Source>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    docType: 'brd' as DocumentType,
    title: '',
    note: '',
    url: '',
    confidential: false,
  });

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Đồng nghiệp tải tài liệu lên là danh sách hiện thêm ngay, không cần F5.
  useRealtimeSync(
    [{ table: 'project_documents', filter: `project_id=eq.${projectId}` }],
    () => load(true),
  );

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    const { data, error } = await listDocuments(projectId);
    setLoadError(error ?? null);
    setDocuments(data);
    setLoading(false);
  };

  const resetForm = () => {
    setSource('upload');
    setFile(null);
    setForm({ docType: 'brd', title: '', note: '', url: '', confidential: false });
  };

  const openCreate = () => {
    resetForm();
    setModalOpen(true);
  };

  /** Đổi loại tài liệu thì bật sẵn cờ mật cho hợp đồng và báo giá. */
  const changeDocType = (docType: DocumentType) => {
    setForm((f) => ({
      ...f,
      docType,
      // Người không có quyền quản lý thì luôn để false — họ không thấy được ô
      // này, và bật ngầm sẽ khiến họ mất quyền xem tài liệu của chính mình.
      confidential: canManage && DOCUMENT_TYPE_CONFIG[docType].confidentialByDefault,
    }));
  };

  const pickFile = (picked: File) => {
    const invalid = validateFile(picked);
    if (invalid) {
      toast(invalid, 'error');
      return;
    }
    setFile(picked);
    // Điền sẵn tiêu đề bằng tên file, bỏ phần đuôi.
    setForm((f) => ({ ...f, title: f.title || picked.name.replace(/\.[^.]+$/, '') }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    if (!form.title.trim()) {
      toast('Vui lòng nhập tên tài liệu.', 'error');
      return;
    }
    if (source === 'upload' && !file) {
      toast('Vui lòng chọn file.', 'error');
      return;
    }
    if (source === 'link') {
      const invalid = validateExternalUrl(form.url);
      if (invalid) {
        toast(invalid, 'error');
        return;
      }
    }

    setSubmitting(true);
    const result =
      source === 'upload'
        ? await uploadDocument({
            projectId,
            file: file!,
            docType: form.docType,
            title: form.title,
            note: form.note,
            confidential: form.confidential,
            uploadedBy: profile.id,
          })
        : await addDocumentLink({
            projectId,
            url: form.url,
            docType: form.docType,
            title: form.title,
            note: form.note,
            confidential: form.confidential,
            uploadedBy: profile.id,
          });
    setSubmitting(false);

    if (result.error) {
      toast(result.error, 'error');
      return;
    }
    toast(source === 'upload' ? 'Đã tải tài liệu lên.' : 'Đã thêm liên kết.', 'success');
    setModalOpen(false);
    resetForm();
    load();
  };

  const handleOpen = async (doc: ProjectDocument, download: boolean) => {
    setBusyId(doc.id);
    const { url, error } = await getDocumentUrl(doc, { download });
    setBusyId(null);
    if (error || !url) {
      toast(error ?? 'Không mở được tài liệu.', 'error');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleDelete = async (doc: ProjectDocument) => {
    const ok = await confirm({
      title: `Xóa "${doc.title}"?`,
      message: doc.storage_path
        ? 'File sẽ bị xóa vĩnh viễn khỏi hệ thống. Không thể hoàn tác.'
        : 'Liên kết sẽ bị gỡ khỏi dự án. File gốc trên Google Drive không bị ảnh hưởng.',
      confirmLabel: 'Xóa',
      danger: true,
    });
    if (!ok) return;

    const { error } = await deleteDocument(doc);
    if (error) {
      toast(error, 'error');
      return;
    }
    toast('Đã xóa tài liệu.', 'success');
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-slate-600">
          {documents.length} tài liệu · tối đa {formatFileSize(MAX_FILE_SIZE)} mỗi file
        </p>
        <Button onClick={openCreate} theme="admin" className="w-full sm:w-auto">
          <Plus className="w-4 h-4" />
          Thêm tài liệu
        </Button>
      </div>

      {/* Vùng kéo thả — nhanh hơn mở hộp thoại chọn file. */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const dropped = e.dataTransfer.files?.[0];
          if (!dropped) return;
          resetForm();
          pickFile(dropped);
          setModalOpen(true);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`rounded-none border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
          dragging ? 'border-blue-400 bg-blue-50/60' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/60'
        }`}
      >
        <Upload className={`w-7 h-7 mx-auto mb-2 ${dragging ? 'text-blue-500' : 'text-slate-600'}`} />
        <p className="text-sm text-slate-600 font-medium">Kéo thả file vào đây, hoặc bấm để chọn</p>
        <p className="text-xs text-slate-600 mt-1">Word, PDF, Excel, PowerPoint, ảnh</p>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            if (!picked) return;
            resetForm();
            pickFile(picked);
            setModalOpen(true);
            e.target.value = '';
          }}
        />
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : loadError ? (
        <div className="bg-white border border-slate-200 rounded-none"><ErrorState message={loadError} onRetry={load} /></div>
      ) : documents.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-none">
          <EmptyState
            icon={<FileText className="w-8 h-8" />}
            title="Chưa có tài liệu"
          />
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-none divide-y divide-slate-50 overflow-hidden">
          {pg.rows.map((doc) => {
            const type = DOCUMENT_TYPE_CONFIG[doc.doc_type];
            const isLink = !!doc.external_url;
            return (
              <div key={doc.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 hover:bg-slate-50/70 transition-colors">
                <div className={`w-10 h-10 rounded-none flex items-center justify-center flex-shrink-0 ${isLink ? 'bg-cyan-50 text-cyan-600' : 'bg-slate-100 text-slate-600'}`}>
                  {isLink ? <Link2 className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-800 truncate">{doc.title}</span>
                    <Badge className={type.color}>{type.label}</Badge>
                    {doc.confidential && (
                      <Badge className="bg-red-50 text-red-600">
                        <Lock className="w-3 h-3" />
                        Mật
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5 truncate">
                    {isLink ? 'Google Docs' : doc.file_name}
                    {doc.size_bytes ? ` · ${formatFileSize(doc.size_bytes)}` : ''}
                    {doc.uploader?.name ? ` · ${doc.uploader.name}` : ''}
                    {` · ${formatDate(doc.created_at)}`}
                  </p>
                  {doc.note && <p className="text-xs text-slate-600 mt-0.5 truncate">{doc.note}</p>}
                </div>

                <div className="flex items-center gap-1.5 ml-auto">
                  <button
                    onClick={() => handleOpen(doc, false)}
                    disabled={busyId === doc.id}
                    title={isLink ? 'Mở liên kết' : 'Xem'}
                    className="p-2 rounded-none text-slate-600 hover:text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50"
                  >
                    {busyId === doc.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                  </button>
                  {!isLink && (
                    <button
                      onClick={() => handleOpen(doc, true)}
                      title="Tải về"
                      className="p-2 rounded-none text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(doc)}
                    title="Xóa"
                    className="p-2 rounded-none text-slate-600 hover:text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
          <Pagination className="px-4 pb-3" page={pg.page} total={pg.total} size={pg.size} noun="tài liệu" setPage={pg.setPage} />
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Thêm tài liệu dự án">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex gap-2">
            {([
              { key: 'upload', label: 'Tải file lên', icon: Upload },
              { key: 'link', label: 'Liên kết Google Docs', icon: Link2 },
            ] as const).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setSource(opt.key)}
                className={`flex-1 flex items-center justify-center gap-2 h-11 rounded-none text-sm font-medium border transition-colors ${
                  source === opt.key
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <opt.icon className="w-4 h-4" />
                {opt.label}
              </button>
            ))}
          </div>

          {source === 'upload' ? (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">File</label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center gap-3 p-3.5 rounded-none border border-slate-200 hover:bg-slate-50 transition-colors text-left"
              >
                <FileText className="w-5 h-5 text-slate-600 flex-shrink-0" />
                <span className="min-w-0 flex-1">
                  {file ? (
                    <>
                      <span className="block text-sm text-slate-800 truncate">{file.name}</span>
                      <span className="block text-xs text-slate-600">{formatFileSize(file.size)}</span>
                    </>
                  ) : (
                    <span className="text-sm text-slate-600">Chưa chọn file — bấm để chọn</span>
                  )}
                </span>
              </button>
            </div>
          ) : (
            <>
              <Input
                label="Liên kết Google Docs"
                type="url"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="https://docs.google.com/document/d/..."
                required
              />
            </>
          )}

          <Input
            label="Tên tài liệu"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="VD: BRD hệ thống quản lý hộ nông dân"
            required
          />

          <Select label="Loại tài liệu" value={form.docType} onChange={(e) => changeDocType(e.target.value as DocumentType)}>
            {(Object.keys(DOCUMENT_TYPE_CONFIG) as DocumentType[]).map((t) => (
              <option key={t} value={t}>{DOCUMENT_TYPE_CONFIG[t].label}</option>
            ))}
          </Select>

          <Textarea
            label="Ghi chú"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            rows={2}
            placeholder="Không bắt buộc"
          />

          {/* Chỉ hiện với người có quyền Quản lý Dự án. Nếu để nhân viên thường
              tick, họ sẽ MẤT LUÔN quyền xem tài liệu mình vừa tải — policy
              `documents_select` đòi quyền `projects` mới đọc được tài liệu mật. */}
          {canManage && (
            <label className="flex items-start gap-2.5 cursor-pointer select-none p-3 rounded-none border border-slate-200">
              <input
                type="checkbox"
                checked={form.confidential}
                onChange={(e) => setForm({ ...form, confidential: e.target.checked })}
                className="mt-0.5 w-4 h-4 rounded-none border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                <span className="block text-sm font-medium text-slate-800">Tài liệu mật</span>

              </span>
            </label>
          )}

          <div className="flex gap-3 pt-1">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)} className="flex-1">Hủy</Button>
            <Button type="submit" disabled={submitting} theme="admin" className="flex-1">
              {submitting ? 'Đang lưu...' : 'Thêm tài liệu'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
