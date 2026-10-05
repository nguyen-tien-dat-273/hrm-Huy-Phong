// ============================================================================
// Bộ KPI đang áp cho một người — bản client, phải khớp `kpi_scheme_for` trong DB.
// ----------------------------------------------------------------------------
// Nguồn sự thật là `public.kpi_scheme_for(uuid, date)` (migration
// 20261001140000). Nó quyết định phiếu chấm thật sự lấy bộ nào, theo bốn lớp,
// lớp trước có là dùng luôn:
//
//   1. Bản gán riêng cho người          (employee_kpi_schemes)
//   2. Bản gán cho đơn vị               (unit_kpi_schemes), đơn vị GẦN nhất trước
//   3. Bộ khai thẳng cho đơn vị         (kpi_position_templates.unit_id), cũng gần nhất trước
//   4. Mẫu khớp vị trí                  (kpi_position_templates.position_id)
//
// Vì sao phải gom về một chỗ: trước đây mỗi màn tự suy một kiểu, và không màn
// nào đúng cả bốn lớp.
//
//   - Màn "Bộ KPI nhân sự" xét lớp 1, 2, 4 — thiếu lớp 3.
//   - Màn "Chấm điểm theo tháng" xét lớp 1, 3, 4 — thiếu lớp 2, và lớp 3 chỉ
//     so đúng đơn vị của người đó chứ không đi ngược lên cấp trên.
//
// Hệ quả thật: người nhận KPI theo phòng (hoặc theo phòng cấp trên) hiện
// "Chưa có bộ KPI" ở màn chấm điểm và KHÔNG gửi yêu cầu chấm được — trong khi
// database vẫn tìm ra bộ cho họ. Tới kỳ chấm thì người đó đứng ngoài, và cái
// lộ ra chỉ là một dòng trống trong bảng tổng hợp.
//
// Cả hai màn giờ gọi chung hàm này. Lệch với database lần nữa thì lệch ở một
// chỗ, và `npm run check:kpi` bắt được.
// ============================================================================

export interface SchemeRow {
  user_id: string;
  template_id: string;
  /** Thiếu = coi như đã có hiệu lực. */
  effective_from?: string | null;
}

export interface UnitSchemeRow {
  unit_id: string;
  template_id: string;
  effective_from?: string | null;
}

export interface ResolvableTemplate {
  id: string;
  name: string;
  is_active: boolean;
  unit_id?: string | null;
  position_id?: string | null;
  created_at?: string | null;
}

export interface ResolvableUnit {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface ResolvablePerson {
  id: string;
  unit_id?: string | null;
  position_id?: string | null;
}

export interface KpiSchemeData {
  personalSchemes: SchemeRow[];
  unitSchemes: UnitSchemeRow[];
  templates: ResolvableTemplate[];
  unitById: Map<string, ResolvableUnit>;
}

/** Lớp nào trong bốn lớp đã trả lời. */
export type KpiSchemeSource = 'personal' | 'unit' | 'unit_template' | 'position';

export interface KpiSchemeResult {
  /** Id bộ mà database sẽ trả về. Có thể khác null trong khi `template` là null
   *  nếu bản ghi gán trỏ tới một bộ đã bị xoá — đó là dữ liệu hỏng, phải thấy
   *  được chứ không nên im lặng coi như chưa gán. */
  templateId: string | null;
  template: ResolvableTemplate | null;
  source: KpiSchemeSource | null;
  /** Đơn vị mà bộ này đến từ, khi nguồn là lớp 2 hoặc lớp 3. */
  fromUnit: ResolvableUnit | null;
  /** Nhãn ngắn để hiện lên màn, ví dụ "Theo phòng Khối Văn Phòng". */
  label: string;
}

/**
 * Chuỗi đơn vị từ chính nó đi ngược lên gốc, gần nhất đứng trước.
 *
 * Chặn ở 10 cấp đúng như `where child.depth < 10` của bản recursive trong DB,
 * và `seen` chặn vòng lặp vô hạn nếu dữ liệu có vòng cha-con.
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

/** Bản ghi đã tới ngày hiệu lực chưa. Thiếu ngày = coi như đã tới. */
function effective(row: { effective_from?: string | null }, on: string): boolean {
  return !row.effective_from || row.effective_from <= on;
}

/** So ngày dạng 'YYYY-MM-DD' — chuỗi ISO so trực tiếp được, mới nhất trước. */
function byEffectiveDesc(a: { effective_from?: string | null }, b: { effective_from?: string | null }): number {
  return (b.effective_from || '').localeCompare(a.effective_from || '');
}

export function kpiSchemeFor(
  person: ResolvablePerson,
  data: KpiSchemeData,
  /** Ngày xét hiệu lực, dạng 'YYYY-MM-DD'. Mặc định hôm nay. */
  on: string = new Date().toISOString().slice(0, 10),
): KpiSchemeResult {
  const templateById = new Map(data.templates.map((item) => [item.id, item]));
  const done = (
    templateId: string,
    source: KpiSchemeSource,
    fromUnit: ResolvableUnit | null,
    label: string,
  ): KpiSchemeResult => ({
    templateId,
    template: templateById.get(templateId) ?? null,
    source,
    fromUnit,
    label,
  });

  // --- Lớp 1: gán riêng cho người ------------------------------------------
  // Cố ý KHÔNG lọc `is_active`: database cũng không lọc ở lớp này, và bản gán
  // riêng trỏ tới một bộ đã tắt vẫn thắng mọi lớp dưới. Lọc thêm ở đây sẽ cho
  // ra một bộ khác với bộ phiếu chấm thật sự dùng.
  const personal = data.personalSchemes
    .filter((row) => row.user_id === person.id && effective(row, on))
    .sort(byEffectiveDesc)[0];
  if (personal) return done(personal.template_id, 'personal', null, 'Gán riêng');

  const lineage = unitLineage(person.unit_id, data.unitById);

  // --- Lớp 2: gán cho đơn vị, đơn vị gần nhất thắng -------------------------
  for (const unit of lineage) {
    const row = data.unitSchemes
      .filter((item) => item.unit_id === unit.id && effective(item, on))
      .sort(byEffectiveDesc)[0];
    if (row) return done(row.template_id, 'unit', unit, `Theo phòng ${unit.name}`);
  }

  // --- Lớp 3: bộ khai thẳng cho đơn vị, cũng gần nhất thắng -----------------
  for (const unit of lineage) {
    const found = data.templates
      .filter((item) => item.is_active && item.unit_id && item.unit_id === unit.id)
      // DB xếp `created_at desc`; thiếu cột thì giữ nguyên thứ tự đưa vào.
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0];
    if (found) return done(found.id, 'unit_template', unit, `Theo phòng ${unit.name}`);
  }

  // --- Lớp 4: mẫu khớp vị trí ----------------------------------------------
  const byPosition = person.position_id
    ? data.templates.find((item) => item.is_active && item.position_id && item.position_id === person.position_id)
    : undefined;
  if (byPosition) return done(byPosition.id, 'position', null, 'Theo vị trí');

  return { templateId: null, template: null, source: null, fromUnit: null, label: '' };
}
