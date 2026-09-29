// ============================================================================
// RC3.1 / RC3.2 / RC3.5 — Thư viện quy trình điện tử.
// ----------------------------------------------------------------------------
// Ba yêu cầu gộp thành một màn vì chúng là ba mặt của cùng một thứ: một tài
// liệu, ai đọc được nó, và nó còn hiệu lực hay không.
//
// Thời hiệu (RC3.5) do DATABASE lo. Màn này chỉ cho chọn "bản này thay thế bản
// nào" rồi trigger tự tắt bản cũ. Không tự tắt ở client: người ban hành bản
// mới đang nghĩ về nội dung bản mới, không phải đi tìm bản cũ để tắt — và nếu
// họ quên thì thư viện có hai bản cùng hiệu lực, người đọc không biết theo bản
// nào.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Building2, FileText, Plus, TriangleAlert, Upload } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { formatDate } from '@/lib/utils';
import { isFullAdmin } from '@/lib/permissions';

const BUCKET = 'process-documents';

type Status = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED' | 'ARCHIVED';
type Category = 'PROCESS' | 'POLICY' | 'GUIDE' | 'FORM';

interface ProcessDocument {
  id: string;
  code: string;
  title: string;
  version_label: string;
  category: Category;
  file_path: string | null;
  file_name: string | null;
  unit_id: string | null;
  status: Status;
  effective_from: string;
  superseded_at: string | null;
  supersedes_id: string | null;
  summary: string | null;
}

const CATEGORY_LABEL: Record<Category, string> = {
  PROCESS: 'Quy trình',
  POLICY: 'Quy chế',
  GUIDE: 'Hướng dẫn',
  FORM: 'Biểu mẫu',
};

const STATUS_STYLE: Record<Status, { label: string; color: string }> = {
  DRAFT: { label: 'Bản nháp', color: 'bg-slate-100 text-slate-600' },
  ACTIVE: { label: 'Đang hiệu lực', color: 'bg-emerald-50 text-emerald-700' },
  SUPERSEDED: { label: 'Đã thay thế', color: 'bg-amber-50 text-amber-700' },
  ARCHIVED: { label: 'Lưu trữ', color: 'bg-slate-100 text-slate-500' },
};

const BLANK = {
  code: '', title: '', version_label: 'v1.0',
  category: 'PROCESS' as Category, unit_id: '', summary: '',
  supersedes_id: '', status: 'ACTIVE' as Status,
};

export function AdminProcessLibrary() {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [docs, setDocs] = useState<ProcessDocument[]>([]);
  const [units, setUnits] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [supported, setSupported] = useState(true);
  const [showSuperseded, setShowSuperseded] = useState(false);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(BLANK);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const canManage = isFullAdmin(profile);

  const load = async () => {
    if (!supabase) return;
    setLoading(true);
    const [docRes, unitRes] = await Promise.all([
      supabase.from('process_documents').select('*').order('effective_from', { ascending: false }),
      supabase.from('organization_units').select('id, name').eq('is_active', true).order('name'),
    ]);
    if (docRes.error) {
      setSupported(false);
      setLoading(false);
      return;
    }
    setDocs((docRes.data || []) as ProcessDocument[]);
    setUnits((unitRes.data || []) as { id: string; name: string }[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const unitName = (id: string | null) =>
    id ? units.find((u) => u.id === id)?.name ?? 'Đơn vị đã xoá' : 'Toàn công ty';

  const visible = useMemo(
    () => docs.filter((doc) => showSuperseded || doc.status !== 'SUPERSEDED'),
    [docs, showSuperseded],
  );

  // Chỉ bản đang hiệu lực mới được chọn làm "bản bị thay thế" — thay thế một
  // bản đã hết hiệu lực là thao tác vô nghĩa.
  const supersedable = docs.filter((doc) => doc.status === 'ACTIVE');

  const save = async () => {
    if (!supabase || !profile) return;
    if (draft.title.trim().length < 3) return toast('Nhập tiêu đề ít nhất 3 ký tự.', 'warning');
    if (!draft.code.trim()) return toast('Nhập mã tài liệu.', 'warning');

    setSaving(true);
    let filePath: string | null = null;
    let fileName: string | null = null;

    if (file) {
      const path = `${draft.code.trim()}/${Date.now()}-${file.name}`;
      const upload = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (upload.error) {
        setSaving(false);
        return toast(
          `Không tải được file: ${upload.error.message}. `
          + `Kiểm tra bucket "${BUCKET}" đã tạo trên Supabase Storage chưa.`,
          'error',
        );
      }
      filePath = path;
      fileName = file.name;
    }

    const { error } = await supabase.from('process_documents').insert({
      code: draft.code.trim().toUpperCase(),
      title: draft.title.trim(),
      version_label: draft.version_label.trim() || 'v1.0',
      category: draft.category,
      unit_id: draft.unit_id || null,
      summary: draft.summary.trim() || null,
      supersedes_id: draft.supersedes_id || null,
      status: draft.status,
      file_path: filePath,
      file_name: fileName,
      published_by: profile.id,
    });
    setSaving(false);

    if (error) return toast(describeDbError(error), 'error');
    toast(
      draft.supersedes_id
        ? 'Đã ban hành. Bản cũ tự chuyển sang "Đã thay thế".'
        : 'Đã thêm tài liệu.',
      'success',
    );
    setOpen(false);
    setDraft(BLANK);
    setFile(null);
    await load();
  };

  const openFile = async (doc: ProcessDocument) => {
    if (!supabase || !doc.file_path) return;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.file_path, 300);
    if (error || !data) return toast('Không mở được file: ' + (error?.message ?? ''), 'error');
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  if (!supported) {
    return (
      <Card><CardContent>
        <p className="flex items-start gap-2.5 text-sm leading-relaxed text-amber-800">
          <TriangleAlert className="mt-0.5 h-5 w-5 flex-shrink-0" />
          Chưa chạy migration{' '}
          <code className="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-xs">
            20260930120000_process_library.sql
          </code>.
        </p>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Thư viện quy trình</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Quy trình, quy chế và hướng dẫn vận hành. Ban hành bản mới thì bản cũ tự hết hiệu lực.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSuperseded((value) => !value)}
          >
            {showSuperseded ? 'Ẩn bản đã thay thế' : 'Hiện cả bản đã thay thế'}
          </Button>
          {canManage && (
            <Button theme="admin" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> Ban hành tài liệu
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-40" />
      ) : visible.length === 0 ? (
        <Card><CardContent>
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-50 text-slate-300">
              <BookOpen className="h-5 w-5" />
            </span>
            <p className="text-sm font-semibold text-slate-600">Thư viện chưa có tài liệu nào</p>
            <p className="max-w-sm text-xs leading-relaxed text-slate-400">
              Ban hành quy trình, quy chế hoặc hướng dẫn đầu tiên. Tài liệu để trống đơn vị sẽ
              hiện cho toàn công ty.
            </p>
          </div>
        </CardContent></Card>
      ) : (
        <Card><CardContent className="p-0">
          <ul className="divide-y divide-slate-50">
            {visible.map((doc) => {
              const status = STATUS_STYLE[doc.status];
              return (
                <li key={doc.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                    <FileText className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-800">
                      {doc.title}
                      <Badge className="bg-slate-100 text-slate-600">{CATEGORY_LABEL[doc.category]}</Badge>
                      <Badge className={status.color}>{status.label}</Badge>
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <span className="font-mono">{doc.code}</span>
                      <span>· {doc.version_label}</span>
                      <span>· hiệu lực {formatDate(doc.effective_from)}</span>
                      <span className="inline-flex items-center gap-1">
                        · <Building2 className="h-3 w-3" /> {unitName(doc.unit_id)}
                      </span>
                    </p>
                    {doc.summary && (
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-400">{doc.summary}</p>
                    )}
                  </div>
                  {doc.file_path && (
                    <Button size="sm" variant="outline" onClick={() => void openFile(doc)}>
                      Mở file
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent></Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Ban hành tài liệu" size="lg">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Mã tài liệu" placeholder="VD: QT-KD-01"
              value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
            <Input label="Phiên bản" placeholder="v1.0"
              value={draft.version_label} onChange={(e) => setDraft({ ...draft, version_label: e.target.value })} />
          </div>

          <Input label="Tiêu đề" value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Loại" value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value as Category })}>
              {(Object.keys(CATEGORY_LABEL) as Category[]).map((key) => (
                <option key={key} value={key}>{CATEGORY_LABEL[key]}</option>
              ))}
            </Select>
            <div>
              <Select label="Phạm vi đọc" value={draft.unit_id}
                onChange={(e) => setDraft({ ...draft, unit_id: e.target.value })}>
                <option value="">Toàn công ty (liên phòng ban)</option>
                {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
              </Select>
              <p className="mt-1.5 text-xs text-slate-500">
                Chọn một đơn vị thì chỉ người thuộc đơn vị đó và người phụ trách đọc được.
              </p>
            </div>
          </div>

          <div>
            <Select label="Thay thế bản nào" value={draft.supersedes_id}
              onChange={(e) => setDraft({ ...draft, supersedes_id: e.target.value })}>
              <option value="">Không thay thế bản nào</option>
              {supersedable.map((doc) => (
                <option key={doc.id} value={doc.id}>{doc.code} {doc.version_label} — {doc.title}</option>
              ))}
            </Select>
            {draft.supersedes_id && (
              <p className="mt-1.5 text-xs leading-relaxed text-amber-700">
                Bản được chọn sẽ <strong>tự chuyển sang "Đã thay thế"</strong> ngay khi lưu.
                Chỉ xảy ra nếu tài liệu này ban hành ở trạng thái Đang hiệu lực.
              </p>
            )}
          </div>

          <Select label="Trạng thái ban hành" value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value as Status })}>
            <option value="ACTIVE">Đang hiệu lực</option>
            <option value="DRAFT">Bản nháp (chỉ mình tôi thấy)</option>
          </Select>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">File PDF</label>
            <input
              type="file"
              accept=".pdf,.doc,.docx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-indigo-700"
            />
            {file && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
                <Upload className="h-3 w-3" /> {file.name}
              </p>
            )}
          </div>

          <Textarea label="Tóm tắt" value={draft.summary}
            onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>Hủy</Button>
            <Button theme="admin" onClick={() => void save()} disabled={saving}>
              {saving ? 'Đang lưu…' : 'Ban hành'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
