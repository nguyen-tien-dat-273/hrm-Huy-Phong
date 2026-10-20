// Cây tổ chức: đi từ một đơn vị ngược lên gốc. Cơ chế lương (và trước đây bộ
// KPI) thừa hưởng theo đúng chuỗi này — đơn vị gần nhất có khai thì thắng.

export interface ResolvableUnit {
  id: string;
  name: string;
  parent_id: string | null;
}

/**
 * Chuỗi đơn vị từ chính nó đi ngược lên gốc, gần nhất đứng trước.
 *
 * Chặn ở 10 cấp như bản đệ quy trong DB, và `seen` chặn vòng lặp vô hạn nếu
 * dữ liệu có vòng cha-con.
 */
export function unitLineage(
  unitId: string | null | undefined,
  unitById: Map<string, ResolvableUnit>,
): ResolvableUnit[] {
  const chain: ResolvableUnit[] = [];
  const seen = new Set<string>();
  let cursor = unitId ? unitById.get(unitId) : undefined;
  while (cursor && !seen.has(cursor.id) && chain.length < 10) {
    seen.add(cursor.id);
    chain.push(cursor);
    cursor = cursor.parent_id ? unitById.get(cursor.parent_id) : undefined;
  }
  return chain;
}
