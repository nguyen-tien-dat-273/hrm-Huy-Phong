// ============================================================================
// Số ngày phép năm một người ĐƯỢC HƯỞNG, tính từ ngày vào làm.
// ----------------------------------------------------------------------------
// Trước đây `profiles.annual_leave_quota` là một con số HR GÕ TAY cho từng
// người. Hai chỗ sai âm thầm:
//
//   1. Điều 114 BLLĐ 2019 — "Cứ đủ 05 năm làm việc cho một người sử dụng lao
//      động thì số ngày nghỉ hằng năm... được tăng thêm tương ứng 01 ngày."
//      Gõ tay nghĩa là mỗi mốc 5 năm của mỗi người, HR quên là người đó bị
//      cấp thiếu phép. Công ty vài chục người thì năm nào cũng có người tới
//      mốc, và không có gì báo.
//
//   2. Điều 113 khoản 2 — người làm CHƯA ĐỦ 12 THÁNG thì số ngày phép tính
//      theo tỷ lệ tương ứng với số tháng làm việc. Cấp tròn 12 ngày cho người
//      vào làm tháng 11 là cấp dư; cấp 0 là cấp thiếu.
//
// Module này chỉ TÍNH, không ghi gì. Màn hình dùng nó để đối chiếu với số đang
// lưu và chỉ ra ai đang lệch — cố ý không tự sửa dữ liệu, vì quỹ phép là thứ
// người lao động đã nhìn thấy và có thể đã lên kế hoạch dùng.
//
// Tách khỏi component React CÓ CHỦ ĐÍCH: đây là diễn giải luật, phải kiểm
// chứng được bằng `npm run check:flows` mà không phải dựng cây React lên.
// ============================================================================

/** Chính sách phép năm của công ty. Mọi con số đều cấu hình được. */
export interface LeavePolicy {
  /**
   * Ngày phép cơ bản một năm làm đủ 12 tháng.
   *
   * Điều 113 BLLĐ 2019 đặt sàn 12 ngày với điều kiện lao động bình thường
   * (14 ngày với người chưa thành niên, lao động khuyết tật, nghề nặng nhọc
   * độc hại; 16 ngày với nghề đặc biệt nặng nhọc). Công ty được cho cao hơn.
   */
  baseDays: number;
  /** Cứ đủ bao nhiêu năm thâm niên thì cộng thêm. Điều 114: 5 năm. */
  seniorityStepYears: number;
  /** Mỗi mốc thâm niên cộng thêm mấy ngày. Điều 114: 1 ngày. */
  seniorityStepDays: number;
}

export const DEFAULT_LEAVE_POLICY: LeavePolicy = {
  baseDays: 12,
  seniorityStepYears: 5,
  seniorityStepDays: 1,
};

export interface LeaveEntitlement {
  /** Phép cơ bản sau khi đã chia tỷ lệ cho người chưa làm đủ năm. */
  base: number;
  /** Phần cộng thêm theo thâm niên. */
  seniority: number;
  /** Số năm đã làm cho công ty, tính tới cuối năm đang xét. */
  serviceYears: number;
  /** Số tháng được tính trong năm đang xét — 12 với người làm cả năm. */
  monthsInYear: number;
  /** Tổng số ngày được hưởng. */
  total: number;
  /** Chưa khai ngày vào làm thì không tính được, phải nói ra. */
  unknownHireDate: boolean;
}

/** Làm tròn tới 0,5 ngày — đơn vị nhỏ nhất mà phép năm dùng tới. */
function roundHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

/**
 * Số ngày phép năm của một người trong một năm.
 *
 * `hireDate` dạng `YYYY-MM-DD`. Không có thì trả về phép cơ bản nguyên và bật
 * cờ `unknownHireDate` — thà cấp đủ rồi báo thiếu dữ liệu, còn hơn cấp 0 ngày
 * cho người đi làm thật.
 */
export function leaveEntitlement(
  hireDate: string | null | undefined,
  year: number,
  policy: LeavePolicy = DEFAULT_LEAVE_POLICY,
): LeaveEntitlement {
  const base = Math.max(0, policy.baseDays);
  if (!hireDate) {
    return {
      base, seniority: 0, serviceYears: 0, monthsInYear: 12,
      total: base, unknownHireDate: true,
    };
  }

  const hired = new Date(`${hireDate}T00:00:00`);
  if (Number.isNaN(hired.getTime())) {
    return {
      base, seniority: 0, serviceYears: 0, monthsInYear: 12,
      total: base, unknownHireDate: true,
    };
  }

  const hireYear = hired.getFullYear();

  // Vào làm sau năm đang xét thì năm đó chưa có phép nào.
  if (hireYear > year) {
    return {
      base: 0, seniority: 0, serviceYears: 0, monthsInYear: 0,
      total: 0, unknownHireDate: false,
    };
  }

  /**
   * Số tháng được tính trong năm đang xét.
   *
   * Điều 113 khoản 2: chưa đủ 12 tháng thì tính theo tỷ lệ số tháng làm việc.
   * Tháng vào làm được tính TRỌN: người vào ngày 20/11 vẫn được tính tháng 11,
   * vì luật nói "số tháng làm việc" chứ không nói chia theo ngày, và cách hiểu
   * này có lợi cho người lao động.
   */
  const monthsInYear = hireYear === year ? 12 - hired.getMonth() : 12;
  const proratedBase = roundHalf((base * monthsInYear) / 12);

  /**
   * Thâm niên tính tới NGÀY CUỐI của năm đang xét.
   *
   * Lấy mốc cuối năm chứ không phải "hôm nay": phép năm là quyền của cả năm,
   * nên ai chạm mốc 5 năm vào tháng 12 thì cả năm đó đã được hưởng thêm ngày.
   * Tính theo "hôm nay" sẽ cho ra con số khác nhau tuỳ lúc mở màn hình.
   */
  const yearEnd = new Date(year, 11, 31);
  let serviceYears = yearEnd.getFullYear() - hireYear;
  const anniversary = new Date(year, hired.getMonth(), hired.getDate());
  if (anniversary > yearEnd) serviceYears -= 1;
  serviceYears = Math.max(0, serviceYears);

  const steps = policy.seniorityStepYears > 0
    ? Math.floor(serviceYears / policy.seniorityStepYears)
    : 0;
  const seniority = steps * policy.seniorityStepDays;

  return {
    base: proratedBase,
    seniority,
    serviceYears,
    monthsInYear,
    total: roundHalf(proratedBase + seniority),
    unknownHireDate: false,
  };
}

/** Câu mô tả chính sách, in ngay đầu bảng để HR đối chiếu được con số. */
export function describeLeavePolicy(policy: LeavePolicy = DEFAULT_LEAVE_POLICY): string {
  return `Mỗi năm ${policy.baseDays} ngày; cứ đủ ${policy.seniorityStepYears} năm `
    + `thâm niên cộng thêm ${policy.seniorityStepDays} ngày (Điều 113, 114 BLLĐ 2019). `
    + 'Người làm chưa đủ 12 tháng được tính theo số tháng làm việc.';
}
