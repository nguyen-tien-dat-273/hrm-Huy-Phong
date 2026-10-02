// ============================================================================
// Phiếu KPI — một nguồn cho cả bản in lẫn bản xem trên màn.
// ----------------------------------------------------------------------------
// Bộ cột lấy đúng mẫu giấy công ty đang dùng:
//
//   Stt | Mục tiêu BP | Trọng số | Kế hoạch/cam kết
//       | Thực hiện: Cá nhân đánh giá · QL đánh giá
//       | Chấm điểm: Cá nhân chấm · Quản lý chấm
//       | Thực hiện/cam kết | Ghi chú
//
// Dựng ở đây chứ không dựng hai lần trong hai component: bản in và bản xem mà
// tính "Kế hoạch" khác nhau một chút thì người ký giấy và người xem màn hình
// đang đọc hai con số khác nhau, và không ai phát hiện ra cho tới lúc tranh cãi
// về tiền.
// ============================================================================

import type { ScoreLevel } from './kpiScoring';

export interface SheetCriteria {
  id: string;
  name: string;
  weight_percent: number;
  score_levels: ScoreLevel[];
  measure_unit: string | null;
  measure_hint: string | null;
}

export interface SheetScore {
  criteria_id: string;
  self_score: number | null;
  self_actual_value: number | null;
  manager_score: number | null;
  actual_value: number | null;
  not_applicable: boolean;
  not_applicable_reason: string | null;
  manager_comment?: string | null;
}

export interface SheetRow {
  index: number;
  name: string;
  weight: number;
  /** Mức phải đạt để trọn điểm, kèm đơn vị. Rỗng khi tiêu chí chấm tay. */
  plan: string;
  selfActual: string;
  managerActual: string;
  selfScore: string;
  managerScore: string;
  /** Thực hiện / cam kết, %. Rỗng khi không đủ dữ liệu để chia. */
  ratio: string;
  note: string;
}

const show = (value: number | null | undefined, unit?: string | null) => (
  value == null ? '' : `${Number(value)}${unit ? ` ${unit}` : ''}`
);

/**
 * "Kế hoạch/cam kết" = ngưỡng của mục tiêu ĂN ĐIỂM CAO NHẤT.
 *
 * Đó đúng là mức phải đạt để được trọn điểm, tức là cam kết của kỳ. Tiêu chí
 * chấm tay (không mục tiêu nào khai ngưỡng) thì để trống chứ không bịa ra số.
 */
function planOf(criteria: SheetCriteria): { text: string; base: number | null } {
  const ranged = (criteria.score_levels || []).filter(
    (level) => level.min != null || level.max != null,
  );
  if (ranged.length === 0) return { text: '', base: null };

  const best = [...ranged].sort((a, b) => Number(b.score) - Number(a.score))[0];
  if (best.min != null) {
    return {
      text: `${best.min_exclusive ? 'trên ' : 'từ '}${best.min}${criteria.measure_unit ? ` ${criteria.measure_unit}` : ''}`,
      base: Number(best.min),
    };
  }
  return {
    text: `${best.max_exclusive ? 'dưới ' : 'đến '}${best.max}${criteria.measure_unit ? ` ${criteria.measure_unit}` : ''}`,
    // Cam kết dạng "không quá N" thì tỷ lệ thực hiện/cam kết đọc ngược (càng
    // thấp càng tốt), chia ra một con số % sẽ gây hiểu nhầm. Để trống.
    base: null,
  };
}

export function buildSheetRows(
  criteria: SheetCriteria[],
  scores: SheetScore[],
): SheetRow[] {
  return criteria.map((item, index) => {
    const score = scores.find((row) => row.criteria_id === item.id);
    const plan = planOf(item);
    // Số thực hiện ưu tiên của QUẢN LÝ: đó là con số được dùng để chốt điểm.
    const done = score?.actual_value ?? score?.self_actual_value ?? null;

    return {
      index: index + 1,
      name: item.name,
      weight: Number(item.weight_percent),
      plan: plan.text,
      selfActual: show(score?.self_actual_value, item.measure_unit),
      managerActual: show(score?.actual_value, item.measure_unit),
      selfScore: show(score?.self_score),
      managerScore: score?.not_applicable ? 'KPS' : show(score?.manager_score),
      ratio: plan.base && plan.base !== 0 && done != null
        ? `${((Number(done) / plan.base) * 100).toFixed(0)}%`
        : '',
      note: score?.manager_comment || score?.not_applicable_reason || item.measure_hint || '',
    };
  });
}
