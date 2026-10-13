// ============================================================================
// Minh chứng KPI — tải lên, xem, xoá.
// ----------------------------------------------------------------------------
// Hai nơi dùng:
//   - Admin đính vào TIÊU CHÍ: mô tả cái gì được tính là đạt.
//   - Nhân viên đính vào ĐIỂM TỰ CHẤM: bằng chứng cho con số mình tự cho.
//
// Người duyệt đối chiếu hai thứ đó rồi mới chốt điểm — nên file phải xem được
// ngay trên trình duyệt, không bắt tải về mới mở được.
// ============================================================================

import { supabase } from './supabase';
import { describeDbError } from './dbError';

export const KPI_EVIDENCE_BUCKET = 'kpi-evidence';

/**
 * Giới hạn riêng, rộng hơn tài liệu dự án vì sơ đồ nghiệp vụ cho phép đính
 * VIDEO — một clip quay màn hình 30 giây đã vượt 10MB.
 */
export const MAX_EVIDENCE_SIZE = 50 * 1024 * 1024;

/**
 * Lọc bằng ĐUÔI FILE chứ không bằng `file.type`.
 *
 * Trình duyệt khai MIME rất thất thường với file Office (`.docx` thực chất là
 * zip) và với video quay từ điện thoại. Lọc bằng MIME sẽ từ chối file hợp lệ
 * kèm một thông báo không ai hiểu.
 */
const ALLOWED = [
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'png', 'jpg', 'jpeg', 'webp', 'heic',
  'mp4', 'webm', 'mov',
];

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', heic: 'image/heic',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
};

export interface KpiEvidence {
  id: string;
  criteria_id: string | null;
  score_id: string | null;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  note: string | null;
  uploaded_by: string | null;
  created_at: string;
}

const extensionOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

export const formatSize = (bytes: number | null) => {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export function validateEvidence(file: File): string | null {
  const ext = extensionOf(file.name);
  if (!ALLOWED.includes(ext)) {
    return `Định dạng .${ext || '?'} không nhận. Chấp nhận: ${ALLOWED.join(', ')}.`;
  }
  if (file.size === 0) return 'File rỗng.';
  if (file.size > MAX_EVIDENCE_SIZE) {
    return `File nặng ${formatSize(file.size)}, vượt giới hạn ${formatSize(MAX_EVIDENCE_SIZE)}.`;
  }
  return null;
}

/** Tên file sạch để làm đường dẫn — bỏ dấu, bỏ ký tự lạ. */
const cleanName = (name: string) => name
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/đ/gi, 'd')
  .replace(/[^a-zA-Z0-9._-]/g, '-')
  .replace(/-+/g, '-')
  .slice(-80);

export async function listEvidence(target: { criteriaId?: string; scoreId?: string }) {
  let query = supabase.from('kpi_evidence').select('*').order('created_at');
  query = target.criteriaId
    ? query.eq('criteria_id', target.criteriaId)
    : query.eq('score_id', target.scoreId ?? '');
  const { data, error } = await query;
  return { data: (data || []) as KpiEvidence[], error: error ? describeDbError(error) : undefined };
}

/** Nạp một lần cho NHIỀU điểm — tránh mỗi dòng một request khi mở phiếu. */
export async function listEvidenceForScores(scoreIds: string[]) {
  if (scoreIds.length === 0) return { data: [] as KpiEvidence[] };
  const { data, error } = await supabase.from('kpi_evidence')
    .select('*').in('score_id', scoreIds).order('created_at');
  return { data: (data || []) as KpiEvidence[], error: error ? describeDbError(error) : undefined };
}

export async function uploadEvidence(input: {
  file?: File;
  note?: string;
  uploadedBy: string | null;
  criteriaId?: string;
  scoreId?: string;
}) {
  if (!input.file && !input.note?.trim()) {
    return { error: 'Cần chọn file hoặc viết giải trình.' };
  }

  let path = '';
  if (input.file) {
    const invalid = validateEvidence(input.file);
    if (invalid) return { error: invalid };
    const folder = input.criteriaId ? `criteria/${input.criteriaId}` : `score/${input.scoreId}`;
    path = `${folder}/${crypto.randomUUID()}-${cleanName(input.file.name)}`;
    const { error: uploadError } = await supabase.storage
      .from(KPI_EVIDENCE_BUCKET)
      .upload(path, input.file, { contentType: MIME_BY_EXT[extensionOf(input.file.name)] });
    if (uploadError) {
      return {
        error: /not found/i.test(uploadError.message)
          ? `Chưa có bucket "${KPI_EVIDENCE_BUCKET}" trên Supabase Storage. Tạo bucket Private tên đó rồi thử lại.`
          : `Tải file thất bại: ${uploadError.message}`,
      };
    }
  }

  const { error } = await supabase.from('kpi_evidence').insert({
    criteria_id: input.criteriaId ?? null,
    score_id: input.scoreId ?? null,
    // Giải trình suông thì vẫn phải có một dòng để người duyệt đọc; dùng chính
    // đoạn chữ làm tên cho dễ nhìn trong danh sách.
    storage_path: path || '-',
    file_name: input.file?.name ?? 'Giải trình',
    mime_type: input.file ? MIME_BY_EXT[extensionOf(input.file.name)] ?? null : null,
    size_bytes: input.file?.size ?? null,
    note: input.note?.trim() || null,
    uploaded_by: input.uploadedBy,
  } as never);

  if (error) {
    if (path) await supabase.storage.from(KPI_EVIDENCE_BUCKET).remove([path]);
    return { error: describeDbError(error) };
  }
  return {};
}

/** Link ký sống 5 phút — đủ để mở và xem xong một clip, không đủ để chia lại. */
export async function evidenceUrl(item: KpiEvidence) {
  if (item.storage_path === '-') return {};
  const { data, error } = await supabase.storage
    .from(KPI_EVIDENCE_BUCKET).createSignedUrl(item.storage_path, 300);
  return { url: data?.signedUrl, error: error ? describeDbError(error) : undefined };
}

export async function deleteEvidence(item: KpiEvidence) {
  if (item.storage_path !== '-') {
    await supabase.storage.from(KPI_EVIDENCE_BUCKET).remove([item.storage_path]);
  }
  const { error } = await supabase.from('kpi_evidence').delete().eq('id', item.id);
  return { error: error ? describeDbError(error) : undefined };
}
