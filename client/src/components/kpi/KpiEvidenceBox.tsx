// ============================================================================
// Khối minh chứng KPI — dùng chung cho cả ba nơi trong luồng.
// ----------------------------------------------------------------------------
//   Admin   đính vào TIÊU CHÍ      — mô tả cái gì được tính là đạt
//   Nhân viên đính vào ĐIỂM tự chấm — bằng chứng cho con số mình tự cho
//   Người duyệt đọc cả hai          — đối chiếu rồi mới chốt điểm
//
// Một component cho cả ba vì nội dung giống hệt nhau, chỉ khác quyền sửa. Tách
// làm ba bản sao là ba chỗ phải sửa mỗi lần đổi cách hiển thị file.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { FileText, Paperclip, Trash2 } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import {
  deleteEvidence, evidenceUrl, formatSize, listEvidence, uploadEvidence,
  type KpiEvidence,
} from '@/lib/kpiEvidence';

export function KpiEvidenceBox({
  criteriaId,
  scoreId,
  uploadedBy,
  readOnly = false,
  label = 'Minh chứng',
  hint,
}: {
  criteriaId?: string;
  scoreId?: string;
  uploadedBy: string | null;
  readOnly?: boolean;
  label?: string;
  hint?: string;
}) {
  const { toast } = useToast();
  const [items, setItems] = useState<KpiEvidence[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const { data, error } = await listEvidence({ criteriaId, scoreId });
    // Thiếu bảng = chưa chạy migration. Hiện khối rỗng chứ không chặn cả màn.
    if (!error) setItems(data);
  };

  useEffect(() => { void load(); }, [criteriaId, scoreId]);

  const add = async (file?: File) => {
    setBusy(true);
    const { error } = await uploadEvidence({ file, note, uploadedBy, criteriaId, scoreId });
    setBusy(false);
    if (error) return toast(error, 'error');
    setNote('');
    if (fileRef.current) fileRef.current.value = '';
    await load();
  };

  const open = async (item: KpiEvidence) => {
    const { url, error } = await evidenceUrl(item);
    if (error) return toast(error, 'error');
    // Giải trình suông không có file để mở.
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const remove = async (item: KpiEvidence) => {
    setBusy(true);
    const { error } = await deleteEvidence(item);
    setBusy(false);
    if (error) return toast(error, 'error');
    await load();
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
        <Paperclip className="h-3 w-3" />
        {label}
        {items.length > 0 && <span className="font-normal text-slate-400">({items.length})</span>}
      </p>
      {hint && <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{hint}</p>}

      {items.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-1.5 rounded-md bg-slate-50 px-2 py-1.5">
              <FileText className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1">
                {/* Giải trình suông thì không có gì để mở — hiện thành chữ
                    thường, bấm vào mà không ra gì là lỗi khó hiểu hơn. */}
                {item.storage_path === '-' ? (
                  <span className="block text-[11px] leading-snug text-slate-700">{item.note}</span>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => void open(item)}
                      className="block max-w-full truncate text-left text-[11px] font-semibold text-indigo-600 hover:underline"
                    >
                      {item.file_name}
                    </button>
                    {item.note && (
                      <span className="block text-[11px] leading-snug text-slate-500">{item.note}</span>
                    )}
                  </>
                )}
                {item.size_bytes != null && (
                  <span className="block text-[10px] text-slate-400">{formatSize(item.size_bytes)}</span>
                )}
              </span>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => void remove(item)}
                  disabled={busy}
                  aria-label={`Xoá ${item.file_name}`}
                  className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {readOnly ? (
        items.length === 0 && (
          <p className="mt-1 text-[11px] text-slate-400">Chưa đính kèm gì.</p>
        )
      ) : (
        <div className="mt-2 space-y-1.5">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder="Giải trình (có thể dùng một mình, không bắt buộc kèm file)…"
            className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-[11px] outline-none focus:border-indigo-500"
          />
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void add(file);
              }}
              disabled={busy}
              className="min-w-0 flex-1 text-[11px] file:mr-2 file:rounded-md file:border-0 file:bg-indigo-50 file:px-2 file:py-1 file:text-[11px] file:font-semibold file:text-indigo-700"
            />
            <button
              type="button"
              onClick={() => void add()}
              disabled={busy || !note.trim()}
              className="flex-shrink-0 rounded-md bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-200 disabled:opacity-40"
            >
              Lưu giải trình
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
