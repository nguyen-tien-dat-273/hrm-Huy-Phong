// ============================================================================
// Tài liệu dự án — tải lên, tải về, xóa.
// ============================================================================

import { supabase } from './supabase';
import { describeDbError } from '@/lib/dbError';
import type { DocumentType, ProjectDocument } from '@/types';

export const DOCUMENTS_BUCKET = 'project-documents';

/** Khớp với `file_size_limit` của bucket trong migration. */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Signed URL sống đủ lâu để tải xong, không đủ lâu để chia sẻ lại. */
const SIGNED_URL_TTL_SECONDS = 60;

export const DOCUMENT_TYPE_CONFIG: Record<DocumentType, { label: string; color: string; confidentialByDefault: boolean }> = {
  brd:       { label: 'BRD', color: 'bg-blue-100 text-blue-700', confidentialByDefault: false },
  srs:       { label: 'SRS', color: 'bg-violet-100 text-violet-700', confidentialByDefault: false },
  contract:  { label: 'Hợp đồng', color: 'bg-red-100 text-red-700', confidentialByDefault: true },
  quotation: { label: 'Báo giá', color: 'bg-amber-100 text-amber-700', confidentialByDefault: true },
  minutes:   { label: 'Biên bản', color: 'bg-emerald-100 text-emerald-700', confidentialByDefault: false },
  design:    { label: 'Thiết kế', color: 'bg-cyan-100 text-cyan-700', confidentialByDefault: false },
  report:    { label: 'Báo cáo', color: 'bg-slate-100 text-slate-700', confidentialByDefault: false },
  other:     { label: 'Khác', color: 'bg-slate-100 text-slate-600', confidentialByDefault: false },
};

/**
 * Kiểm tra định dạng bằng ĐUÔI FILE, không bằng MIME type.
 *
 * Lý do: `.docx` thực chất là một file zip, nên trình duyệt khai báo MIME rất
 * thất thường — có khi là `application/zip`, có khi là chuỗi rỗng nếu máy chưa
 * cài Word. Lọc bằng MIME sẽ từ chối file Word hợp lệ với thông báo khó hiểu.
 */
const ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'png', 'jpg', 'jpeg', 'webp'];

/**
 * MIME chuẩn theo ĐUÔI FILE — phải khớp `allowed_mime_types` của bucket.
 *
 * VÌ SAO KHÔNG DÙNG `file.type` CỦA TRÌNH DUYỆT: với file Office, `file.type`
 * cực kỳ thất thường theo hệ điều hành. Windows hay khai `.docx`/`.xlsx` là
 * `application/x-zip-compressed` — chuỗi này KHÔNG có trong danh sách bucket,
 * nên Supabase Storage từ chối với lỗi tiếng Anh khó hiểu, dù file hoàn toàn
 * hợp lệ. Đây chính là kiểu "file đúng mà không thêm được". Suy MIME từ đuôi
 * file thì luôn khớp bucket.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf:  'application/pdf',
  doc:  'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls:  'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt:  'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png:  'image/png',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** Đuôi file, chữ thường, không có dấu chấm. */
function extensionOf(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

/** ContentType để gửi lên Storage — luôn khớp bucket, không tin trình duyệt. */
export function uploadContentType(fileName: string): string {
  return MIME_BY_EXTENSION[extensionOf(fileName)] ?? 'application/octet-stream';
}

/**
 * Dịch lỗi Supabase Storage sang tiếng Việt. Lỗi Storage KHÔNG phải
 * PostgrestError nên describeDbError để nguyên văn tiếng Anh — ví dụ
 * "The object exceeded the maximum allowed size" hay "mime type ... is not
 * supported", đúng những câu khiến người dùng tưởng hệ thống hỏng.
 */
function describeStorageError(error: { message?: string } | null | undefined): string {
  const msg = error?.message ?? '';
  if (/exceeded the maximum allowed size|payload too large|413/i.test(msg)) {
    return `File vượt quá ${formatFileSize(MAX_FILE_SIZE)}.`;
  }
  if (/mime type|not supported|invalid_mime/i.test(msg)) {
    return 'Định dạng file này không được hỗ trợ.';
  }
  if (/already exists|duplicate/i.test(msg)) {
    return 'File trùng tên vừa được tải lên — thử lại.';
  }
  if (/jwt|unauthorized|403|401/i.test(msg)) {
    return 'Phiên đăng nhập hết hạn hoặc thiếu quyền. Đăng nhập lại rồi thử lại.';
  }
  if (/failed to fetch|network/i.test(msg)) {
    return 'Không kết nối được tới máy chủ. Kiểm tra mạng rồi thử lại.';
  }
  return msg || 'Lỗi không xác định.';
}

export function validateFile(file: File): string | null {
  const ext = extensionOf(file.name);
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return `Định dạng .${ext || '?'} không được hỗ trợ. Chấp nhận: ${ALLOWED_EXTENSIONS.join(', ')}.`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return `File nặng ${formatFileSize(file.size)}, vượt giới hạn ${formatFileSize(MAX_FILE_SIZE)}.`;
  }
  if (file.size === 0) return 'File rỗng.';
  return null;
}

/** Chỉ nhận link Google Workspace — tránh dán nhầm hoặc dán link độc hại. */
export function validateExternalUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return 'Vui lòng nhập liên kết.';
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'Liên kết không hợp lệ. Cần bắt đầu bằng https://';
  }
  if (parsed.protocol !== 'https:') return 'Liên kết phải dùng https.';
  const allowed = ['docs.google.com', 'drive.google.com', 'sheets.google.com', 'slides.google.com'];
  if (!allowed.includes(parsed.hostname)) {
    return `Chỉ nhận liên kết Google Docs/Drive (${allowed.join(', ')}).`;
  }
  return null;
}

/**
 * Làm sạch tên file để đặt đường dẫn trong Storage.
 * Tên gốc vẫn được giữ nguyên ở cột `file_name` để hiển thị và khi tải về —
 * "Biên bản nghiệm thu.pdf" phải hiện đúng như vậy, không thành "bien-ban...".
 */
function slugifyFileName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(-80); // giữ phần đuôi để không mất extension với tên quá dài
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function listDocuments(projectId: string): Promise<{ data: ProjectDocument[]; error?: string }> {
  const { data, error } = await supabase
    .from('project_documents')
    .select('*, uploader:profiles_directory!uploaded_by(id, name, avatar_url)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) return { data: [], error: describeDbError(error) };
  return { data: (data || []) as ProjectDocument[] };
}

export async function uploadDocument(input: {
  projectId: string;
  file: File;
  docType: DocumentType;
  title: string;
  note?: string;
  confidential: boolean;
  uploadedBy: string;
}): Promise<{ error?: string }> {
  const invalid = validateFile(input.file);
  if (invalid) return { error: invalid };

  // Tiền tố uuid để hai file trùng tên không đè lên nhau.
  const path = `${input.projectId}/${crypto.randomUUID()}-${slugifyFileName(input.file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    // ContentType suy từ đuôi file, KHÔNG dùng input.file.type — xem
    // uploadContentType(). Đây là chỗ trước đây file .docx/.xlsx trên Windows
    // bị Storage từ chối vì trình duyệt khai MIME lạ.
    .upload(path, input.file, { contentType: uploadContentType(input.file.name) });

  if (uploadError) return { error: `Tải file lên thất bại: ${describeStorageError(uploadError)}` };

  const { error: rowError } = await supabase.from('project_documents').insert({
    project_id: input.projectId,
    doc_type: input.docType,
    title: input.title.trim(),
    note: input.note?.trim() || null,
    storage_path: path,
    file_name: input.file.name,
    mime_type: input.file.type || null,
    size_bytes: input.file.size,
    confidential: input.confidential,
    uploaded_by: input.uploadedBy,
  } as never);

  if (rowError) {
    // File đã nằm trong Storage nhưng không có bản ghi trỏ tới — dọn ngay,
    // nếu không sẽ thành rác vĩnh viễn không ai biết đường xóa.
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
    return { error: `Lưu thông tin tài liệu thất bại: ${describeDbError(rowError)}` };
  }

  return {};
}

export async function addDocumentLink(input: {
  projectId: string;
  url: string;
  docType: DocumentType;
  title: string;
  note?: string;
  confidential: boolean;
  uploadedBy: string;
}): Promise<{ error?: string }> {
  const invalid = validateExternalUrl(input.url);
  if (invalid) return { error: invalid };

  const { error } = await supabase.from('project_documents').insert({
    project_id: input.projectId,
    doc_type: input.docType,
    title: input.title.trim(),
    note: input.note?.trim() || null,
    external_url: input.url.trim(),
    confidential: input.confidential,
    uploaded_by: input.uploadedBy,
  } as never);

  if (error) return { error: `Lưu liên kết thất bại: ${describeDbError(error)}` };
  return {};
}

/**
 * Mở tài liệu. File tải lên thì xin signed URL có hạn; liên kết ngoài thì mở
 * thẳng. `download` = true buộc trình duyệt tải về thay vì hiển thị.
 */
export async function getDocumentUrl(
  doc: ProjectDocument,
  options: { download?: boolean } = {},
): Promise<{ url?: string; error?: string }> {
  if (doc.external_url) return { url: doc.external_url };
  if (!doc.storage_path) return { error: 'Tài liệu không có file lẫn liên kết.' };

  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS, {
      download: options.download ? (doc.file_name ?? true) : false,
    });

  if (error || !data) return { error: `Không tạo được liên kết tải: ${error ? describeDbError(error) : 'lỗi không rõ'}` };
  return { url: data.signedUrl };
}

export async function deleteDocument(doc: ProjectDocument): Promise<{ error?: string }> {
  // Xóa file trước: nếu xóa dòng trước mà bước này hỏng thì file thành rác
  // không còn đường lần ra.
  if (doc.storage_path) {
    const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).remove([doc.storage_path]);
    if (error) return { error: `Xóa file thất bại: ${describeDbError(error)}` };
  }

  const { error } = await supabase.from('project_documents').delete().eq('id', doc.id);
  if (error) return { error: `Xóa tài liệu thất bại: ${describeDbError(error)}` };
  return {};
}

/**
 * Dọn toàn bộ file của một dự án. PHẢI gọi trước khi xóa dự án.
 *
 * `ON DELETE CASCADE` chỉ xóa dòng trong `project_documents` — file trong
 * Storage ở lại vĩnh viễn, chiếm dung lượng mà không còn gì trỏ tới.
 */
export async function deleteProjectDocuments(projectId: string): Promise<{ error?: string }> {
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).list(projectId);
  if (error) return { error: describeDbError(error) };
  if (!data || data.length === 0) return {};

  const paths = data.map((f) => `${projectId}/${f.name}`);
  const { error: removeError } = await supabase.storage.from(DOCUMENTS_BUCKET).remove(paths);
  if (removeError) return { error: describeDbError(removeError) };
  return {};
}
