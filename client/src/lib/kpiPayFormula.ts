// ============================================================================
// Sinh công thức lương KPI từ tham số.
// ----------------------------------------------------------------------------
// Tách khỏi component React CÓ CHỦ ĐÍCH: đây là logic ra tiền, phải kiểm
// chứng được bằng script chạy trên node (`npm run check:payroll`) mà không
// phải dựng cả cây React lên. Giao diện chỉ hỏi tham số rồi gọi vào đây.
//
// Biến dùng trong biểu thức:
//   KPI_PCT    - kết quả chấm, do module KPI đẩy sang khi khoá phiếu (0-120)
//   MUC_RIENG  - mức lương KPI gán cho chính người đó ở Cơ chế lương
// ============================================================================

export type Mode = 'TY_LE' | 'NGUONG' | 'DAT_KHONG' | 'BAC_THANG';

export const MODE_LABEL: Record<Mode, string> = {
  TY_LE: 'Nhân thẳng theo KPI%',
  NGUONG: 'Có ngưỡng mới được tính',
  DAT_KHONG: 'Đạt thì trả đủ, không đạt thì không trả',
  BAC_THANG: 'Bậc thang theo khoảng KPI%',
};

export const MODE_HINT: Record<Mode, string> = {
  TY_LE: 'Đạt 85% thì nhận 85% mức lương KPI. Kiểu phổ biến nhất.',
  NGUONG: 'Dưới ngưỡng thì không có lương KPI; từ ngưỡng trở lên tính theo tỷ lệ.',
  DAT_KHONG: 'Chỉ có hai kết quả: đạt ngưỡng nhận trọn mức, không đạt nhận 0đ.',
  BAC_THANG: 'Mỗi khoảng KPI% ứng với một mức phần trăm cố định, không nội suy.',
};

export interface Tier {
  /** Từ KPI% này trở lên. */
  from: string;
  /** Trả bao nhiêu phần trăm mức lương KPI. */
  pay: string;
}

export interface Draft {
  id?: string;
  name: string;
  mode: Mode;
  /** Trần và sàn áp lên KPI% trước khi nhân. Trống = không chặn. */
  cap: string;
  floor: string;
  /** Ngưỡng cho kiểu NGUONG và DAT_KHONG. */
  threshold: string;
  tiers: Tier[];
}

export const BLANK: Draft = {
  name: '', mode: 'TY_LE', cap: '120', floor: '', threshold: '80',
  tiers: [{ from: '100', pay: '120' }, { from: '80', pay: '100' }, { from: '60', pay: '50' }],
};

/** Số hợp lệ, hoặc null nếu ô để trống. */
export function num(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * KPI% sau khi kẹp trong khoảng sàn–trần.
 *
 * Trần là thứ hay bị quên nhất: BRD chốt KPI% tối đa 120%, nhưng nếu không
 * kẹp ở đây thì một tháng chấm vượt sẽ trả vượt theo, và không ai phát hiện
 * cho tới lúc đối chiếu quỹ lương.
 */
function clampedPct(draft: Draft): string {
  const cap = num(draft.cap);
  const floor = num(draft.floor);
  let expr = 'KPI_PCT';
  if (floor != null) expr = `MAX(${expr}, ${floor})`;
  if (cap != null) expr = `MIN(${expr}, ${cap})`;
  return expr;
}

/** Sinh biểu thức cho engine từ các tham số đã khai. */
export function buildKpiFormula(draft: Draft): string {
  const proportional = `MUC_RIENG * ${clampedPct(draft)} / 100`;

  switch (draft.mode) {
    case 'TY_LE':
      return proportional;

    case 'NGUONG': {
      const threshold = num(draft.threshold) ?? 0;
      return `IF(KPI_PCT >= ${threshold}, ${proportional}, 0)`;
    }

    case 'DAT_KHONG': {
      const threshold = num(draft.threshold) ?? 0;
      return `IF(KPI_PCT >= ${threshold}, MUC_RIENG, 0)`;
    }

    case 'BAC_THANG': {
      // Xếp bậc cao xuống thấp rồi lồng IF: bậc đầu tiên khớp sẽ thắng, nên
      // thứ tự giảm dần là bắt buộc — xếp tăng dần thì mọi người đều rơi vào
      // bậc thấp nhất.
      const tiers = draft.tiers
        .map((tier) => ({ from: num(tier.from), pay: num(tier.pay) }))
        .filter((tier): tier is { from: number; pay: number } => tier.from != null && tier.pay != null)
        .sort((a, b) => b.from - a.from);
      if (tiers.length === 0) return '0';
      return tiers.reduceRight(
        (fallback, tier) => `IF(KPI_PCT >= ${tier.from}, MUC_RIENG * ${tier.pay} / 100, ${fallback})`,
        '0',
      );
    }

    default:
      return proportional;
  }
}

/** Câu tiếng Việt mô tả cách tính, đặt cạnh công thức sinh ra. */
export function describeKpiMethod(draft: Draft): string {
  const cap = num(draft.cap);
  const floor = num(draft.floor);
  const limits = [
    floor != null ? `sàn ${floor}%` : null,
    cap != null ? `trần ${cap}%` : null,
  ].filter(Boolean).join(', ');
  const suffix = limits ? ` (kẹp ${limits})` : '';

  switch (draft.mode) {
    case 'TY_LE':
      return `Lương KPI = mức lương KPI của người đó × KPI% đạt được${suffix}.`;
    case 'NGUONG':
      return `Đạt từ ${num(draft.threshold) ?? 0}% trở lên mới có lương KPI, và tính theo đúng tỷ lệ đạt${suffix}. Dưới ngưỡng nhận 0đ.`;
    case 'DAT_KHONG':
      return `Đạt từ ${num(draft.threshold) ?? 0}% trở lên nhận trọn mức lương KPI, dưới ngưỡng nhận 0đ. KPI% cao hơn không làm tăng thêm.`;
    case 'BAC_THANG':
      return 'Mỗi khoảng KPI% ứng với một mức phần trăm cố định. Bậc cao nhất khớp sẽ được áp.';
    default:
      return '';
  }
}

