import { supabase } from '@/lib/supabase';

export const TRAINING_VIDEOS_BUCKET = 'training-videos';
export const TRAINING_DOCUMENTS_BUCKET = 'training-documents';
export const MAX_TRAINING_VIDEO_SIZE = 500 * 1024 * 1024;
export const MAX_TRAINING_DOCUMENT_SIZE = 20 * 1024 * 1024;

const allowedExtensions = ['mp4', 'webm', 'mov', 'm4v'];

function extensionOf(name: string) {
  return name.split('.').pop()?.toLowerCase() || '';
}

function safeName(name: string) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').slice(-100);
}

export function validateTrainingVideo(file: File): string | null {
  const extension = extensionOf(file.name);
  if (!allowedExtensions.includes(extension)) return 'Video phải có định dạng MP4, WebM, MOV hoặc M4V.';
  if (file.size === 0) return 'Video rỗng.';
  if (file.size > MAX_TRAINING_VIDEO_SIZE) return 'Video vượt quá giới hạn 500 MB.';
  return null;
}

export async function uploadTrainingVideo(file: File, courseId: string) {
  const invalid = validateTrainingVideo(file);
  if (invalid) return { path: null, error: invalid };
  const path = `${courseId}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const { error } = await supabase.storage.from(TRAINING_VIDEOS_BUCKET).upload(path, file, {
    contentType: file.type || `video/${extensionOf(file.name)}`,
    upsert: false,
  });
  return { path: error ? null : path, error: error?.message || null };
}

export async function createTrainingVideoUrl(path: string) {
  const { data, error } = await supabase.storage.from(TRAINING_VIDEOS_BUCKET).createSignedUrl(path, 3600);
  return { url: data?.signedUrl || null, error: error?.message || null };
}

export async function removeTrainingVideo(path: string) {
  return supabase.storage.from(TRAINING_VIDEOS_BUCKET).remove([path]);
}

const allowedDocumentExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt'];

export function validateTrainingDocument(file: File): string | null {
  const extension = extensionOf(file.name);
  if (!allowedDocumentExtensions.includes(extension)) return 'Tài liệu phải là PDF, Office hoặc TXT.';
  if (!file.size) return 'Tệp tài liệu rỗng.';
  if (file.size > MAX_TRAINING_DOCUMENT_SIZE) return 'Tài liệu vượt quá giới hạn 20 MB.';
  return null;
}

export async function uploadTrainingDocument(file: File, courseId: string) {
  const invalid = validateTrainingDocument(file);
  if (invalid) return { path: null, error: invalid };
  const path = `${courseId}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const { error } = await supabase.storage.from(TRAINING_DOCUMENTS_BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
  return { path: error ? null : path, error: error?.message || null };
}

export async function createTrainingDocumentUrl(path: string) {
  const { data, error } = await supabase.storage.from(TRAINING_DOCUMENTS_BUCKET).createSignedUrl(path, 3600);
  return { url: data?.signedUrl || null, error: error?.message || null };
}

export async function removeTrainingDocument(path: string) {
  return supabase.storage.from(TRAINING_DOCUMENTS_BUCKET).remove([path]);
}
