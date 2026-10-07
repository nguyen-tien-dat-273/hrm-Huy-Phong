import { supabase } from './supabase';
import type { Profile } from '@/types';

/**
 * Nạp hồ sơ nhân sự theo id, để ghép vào bản ghi ở phía giao diện.
 *
 * Vì sao không nhúng thẳng bằng PostgREST (`profile:profiles_directory!...`):
 * `profiles_directory` là một VIEW nên không mang khóa ngoại, và PostgREST
 * không suy ra được đường nối từ bảng sang nó — mọi truy vấn nhúng đều trả
 * PGRST200 "Could not find a relationship", kể cả sau khi đã
 * `notify pgrst, 'reload schema'`.
 *
 * Vì sao không quay về bảng `profiles`: migration siết bảo mật giới hạn quyền
 * đọc bảng gốc còn `id = auth.uid() or is_admin() or can('users')`. Trưởng nhóm
 * không có quyền `users` sẽ đọc ra rỗng — tên nhân viên biến mất khỏi màn hình
 * mà không có lỗi nào, đúng kiểu hỏng âm thầm. View sinh ra chính là để tránh
 * chuyện đó, nên phải đi qua nó.
 */
export async function fetchProfileMap(
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, Profile>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();

  // PostgREST nhét danh sách id vào URL; quá dài thì máy chủ từ chối. Chia lô
  // để một dự án đông người không làm hỏng cả lời gọi.
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 200) chunks.push(unique.slice(i, i + 200));

  const pairs: [string, Profile][] = [];
  for (const chunk of chunks) {
    const { data } = await supabase.from('profiles_directory').select('*').in('id', chunk);
    for (const row of (data || []) as Profile[]) pairs.push([row.id, row]);
  }
  return new Map(pairs);
}

/** Ghép hồ sơ vào từng bản ghi, đặt dưới tên trường `key`. */
export function attachProfiles<T, K extends string>(
  rows: readonly T[],
  idOf: (row: T) => string | null | undefined,
  people: Map<string, Profile>,
  key: K,
): (T & Record<K, Profile | null>)[] {
  return rows.map((row) => ({
    ...row,
    [key]: people.get(idOf(row) || '') ?? null,
  })) as (T & Record<K, Profile | null>)[];
}
