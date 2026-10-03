// ============================================================================
// Phiếu KPI — một nguồn cho cả bản in lẫn bản xem trên màn.
// ----------------------------------------------------------------------------
// Bộ cột lấy đúng file Excel công ty đang dùng (sheet "Chấm điểm" của
// KPIs thủ kho / Phụ kho / vận chuyển / KPI Đức…):
//
//   Stt | Mục tiêu BP | Trọng số | Kế hoạch/cam kết
//       | Thực hiện: Cá nhân đánh giá · QL đánh giá
//       | Chấm điểm: Cá nhân chấm · Quản lý chấm
//       | Thực hiện/cam kết | Ghi chú
//
// Cách tính đã đối chiếu thẳng với số trong file (KPIs thủ kho, sheet
// "Chấm điểm", các dòng 10-16):
//
//   Kế hoạch/cam kết = điểm chuẩn của tiêu chí, thường là 4
//   Thực hiện        = điểm thô 1-4 mà cá nhân / quản lý đánh giá
//   Chấm điểm        = Thực hiện / Kế hoạch x Trọng số
//   Thực hiện/cam kết= Thực hiện / Kế hoạch
//
// Ví dụ đã kiểm: "Chuyên cần" trọng số 0,12 · cam kết 4 · QL đánh giá 3
// -> chấm điểm 0,09. Đúng bằng 3/4 x 0,12.
//
// Dựng ở đây chứ không dựng hai lần trong hai component: bản in và bản xem mà
// tính lệch nhau một chút thì người ký giấy và người xem màn hình đang đọc hai
// con số khác nhau, và không ai phát hiện ra cho tới lúc tranh cãi về tiền.
// ============================================================================

export interface SheetCriteria {
  id: string;
  name: string;
  weight_percent: number;
  /** Điểm chuẩn của tiêu chí — cột "Kế hoạch/cam kết" trong file Excel. */
  max_score: number;
  measure_unit: string | null;
  measure_hint: string | null;
}

export interface SheetScore {
  criteria_id: string;
  self_score: number | null;
  manager_score: number | null;
  not_applicable: boolean;
  not_applicable_reason: string | null;
  manager_comment?: string | null;
}

export interface SheetRow {
  index: number;
  name: string;
  /** Trọng số, %. File Excel ghi 0,2; ở đây hiện 20 cho thống nhất với hệ thống. */
  weight: number;
  plan: string;
  selfActual: string;
  managerActual: string;
  /** Điểm quy đổi theo trọng số, %. Cộng hết các dòng ra đúng kết quả kỳ. */
  selfWeighted: string;
  managerWeighted: string;
  ratio: string;
  note: string;
}

const show = (value: number | null | undefined) => (value == null ? '' : String(Number(value)));

/** Điểm quy đổi: thực hiện / cam kết x trọng số. Rỗng khi chưa chấm. */
function weighted(score: number | null | undefined, max: number, weight: number): string {
  if (score == null || !max) return '';
  return `${((Number(score) / max) * weight).toFixed(2).replace(/\.00$/, '')}%`;
}

export function buildSheetRows(
  criteria: SheetCriteria[],
  scores: SheetScore[],
): SheetRow[] {
  return criteria.map((item, index) => {
    const score = scores.find((row) => row.criteria_id === item.id);
    const max = Number(item.max_score) || 0;
    const weight = Number(item.weight_percent) || 0;

    // Tiêu chí "không phát sinh" không tính vào đâu cả — để trống các cột số
    // thay vì cho 0, vì 0 đọc ra là "làm mà không đạt gì".
    if (score?.not_applicable) {
      return {
        index: index + 1,
        name: item.name,
        weight,
        plan: show(max),
        selfActual: '', managerActual: '',
        selfWeighted: '', managerWeighted: '',
        ratio: 'KPS',
        note: score.not_applicable_reason || item.measure_hint || '',
      };
    }

    return {
      index: index + 1,
      name: item.name,
      weight,
      plan: show(max),
      selfActual: show(score?.self_score),
      managerActual: show(score?.manager_score),
      selfWeighted: weighted(score?.self_score, max, weight),
      managerWeighted: weighted(score?.manager_score, max, weight),
      ratio: score?.manager_score != null && max
        ? `${((Number(score.manager_score) / max) * 100).toFixed(0)}%`
        : '',
      note: score?.manager_comment || item.measure_hint || '',
    };
  });
}
