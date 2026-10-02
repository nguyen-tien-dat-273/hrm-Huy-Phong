// ============================================================================
// Suy điểm KPI từ thang điểm — bản client, phải khớp hàm cùng tên trong DB.
// ----------------------------------------------------------------------------
// Nguồn sự thật là `public.kpi_score_from_levels` trong migration
// 20260929100000: trigger của database mới là thứ thực sự ghi điểm vào phiếu.
// Bản này chỉ dùng để XEM TRƯỚC khi người dùng đang khai thang điểm hoặc đang
// gõ số đo — thấy ngay "nhập 2 thì được 2 điểm" thay vì phải lưu rồi tải lại.
//
// Hai bản phải cùng quy tắc, nếu không màn hình sẽ hứa một đằng và phiếu chấm
// ra một nẻo. Quy tắc, lặp lại nguyên văn từ migration:
//   - `min`/`max` tùy chọn; mặc định bao gồm hai đầu, cờ `min_exclusive` /
//     `max_exclusive` đổi đầu đó thành "trên" / "dưới".
//   - Mức khớp ĐẦU TIÊN thắng, theo đúng thứ tự khai.
//   - Mức không có cả min lẫn max là mức mô tả thuần, bỏ qua khi tự chấm.
//   - Không mức nào khớp thì trả null, KHÔNG trả 0 — số đo rơi ngoài mọi
//     khoảng là thang điểm khai thiếu, cho 0 điểm là trừ oan tiền của người
//     bị chấm.
// ============================================================================

export interface ScoreLevel {
  score: number;
  /** Cận dưới. Thiếu = không có cận dưới. */
  min?: number | null;
  /** Cận trên. Thiếu = không có cận trên. */
  max?: number | null;
  /**
   * `true` = "trên min" (không lấy chính min); mặc định là "từ min" (lấy cả min).
   *
   * Bảng KPI thật viết "Trên 105%" ngay cạnh "Từ 90 - 105%" — không phân
   * biệt được hai kiểu này thì số 105 rơi vào cả hai dòng. Với tiêu chí
   * Công nợ ("nhỏ hơn 2 lần" / "từ 2 đến 3 lần") thì số đúng bằng 2 xảy ra
   * thật, và nó quyết định 4 điểm hay 3.
   *
   * Thiếu cờ = giữ nguyên như cũ, nên mọi thang điểm đã khai vẫn chạy y hệt.
   */
  min_exclusive?: boolean;
  /** `true` = "dưới max" (không lấy chính max); mặc định lấy cả max. */
  max_exclusive?: boolean;
  label?: string;
}

function toNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Mức có ngưỡng mới tham gia tự chấm. */
export function hasThreshold(level: ScoreLevel): boolean {
  return toNumber(level.min) != null || toNumber(level.max) != null;
}

/** Thang điểm tự chấm được khi có ít nhất một mức khai ngưỡng. */
export function isAutoScorable(levels: ScoreLevel[] | null | undefined): boolean {
  return Array.isArray(levels) && levels.some(hasThreshold);
}

export function scoreFromLevels(
  levels: ScoreLevel[] | null | undefined,
  actual: number | null | undefined,
): number | null {
  const value = toNumber(actual);
  if (value == null || !Array.isArray(levels)) return null;

  for (const level of levels) {
    const min = toNumber(level.min);
    const max = toNumber(level.max);
    if (min == null && max == null) continue;
    const overMin = min == null || (level.min_exclusive ? value > min : value >= min);
    const underMax = max == null || (level.max_exclusive ? value < max : value <= max);
    if (overMin && underMax) return toNumber(level.score);
  }
  return null;
}

/**
 * Khoảng của thang điểm có lỗ hổng hay chồng lấn không.
 *
 * Khai thang điểm bằng tay rất dễ để hở một khoảng (mức 1 tới 1, mức tiếp theo
 * từ 3 — số 2 rơi vào hư không) hoặc cho hai mức cùng phủ một số. Cả hai đều
 * chỉ lộ ra khi đã chấm thật và ai đó thắc mắc vì sao điểm trống. Kiểm ngay
 * lúc khai rẻ hơn nhiều.
 */
export function describeLevelIssues(levels: ScoreLevel[]): string[] {
  const issues: string[] = [];
  const ranged = levels.filter(hasThreshold);
  if (ranged.length === 0) return issues;

  const sorted = [...ranged].sort(
    (a, b) => (toNumber(a.min) ?? Number.NEGATIVE_INFINITY) - (toNumber(b.min) ?? Number.NEGATIVE_INFINITY),
  );

  for (let index = 1; index < sorted.length; index += 1) {
    const previousMax = toNumber(sorted[index - 1].max);
    const currentMin = toNumber(sorted[index].min);
    if (previousMax == null || currentMin == null) continue;

    // Hai đầu đều mở thì chính số đó không thuộc mức nào — chạm nhau ở một
    // điểm là liền mạch, không phải chồng lấn.
    const touchOnly = currentMin === previousMax
      && (sorted[index].min_exclusive || sorted[index - 1].max_exclusive);

    if (currentMin <= previousMax && !touchOnly) {
      issues.push(
        `Hai mức cùng phủ giá trị ${currentMin}–${previousMax}. Mức khai trước sẽ thắng.`,
      );
    } else if (currentMin > previousMax + Number.EPSILON && currentMin - previousMax > 1e-9) {
      // Chỉ báo khi khoảng hở thật sự chứa được một giá trị. Với thang số
      // nguyên, max = 1 rồi min = 2 là liền mạch chứ không phải lỗ hổng.
      const gap = currentMin - previousMax;
      if (gap > 1.0000001) {
        issues.push(
          `Hở khoảng giữa ${previousMax} và ${currentMin} — số đo rơi vào đó sẽ không ra điểm nào.`,
        );
      }
    }
  }

  return issues;
}
