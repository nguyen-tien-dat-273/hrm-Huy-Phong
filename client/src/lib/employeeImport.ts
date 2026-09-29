// ============================================================================
// RC2.1 — Import Excel để cập nhật nhanh danh sách hồ sơ nhân sự.
// ----------------------------------------------------------------------------
// BRD Huy Phong v1.0, RC2.1 (Cao, Giai đoạn 1): "Hỗ trợ Import file Excel để
// cập nhật nhanh danh sách hồ sơ nhân sự thay vì nhập tay từng người."
//
// Ba quyết định định hình toàn bộ file này:
//
// 1. Import CHỈ CẬP NHẬT hồ sơ đã có, KHÔNG tạo tài khoản đăng nhập.
//    Tạo tài khoản cần khoá service_role chạy phía máy chủ và sinh mật khẩu
//    tạm — không thể làm hàng loạt từ trình duyệt một cách an toàn. Dòng nào
//    không khớp tài khoản nào sẽ được báo rõ để HR tạo tài khoản trước.
//
// 2. BẮT BUỘC xem trước rồi mới ghi.
//    Đây là hồ sơ nhân sự, và file Excel do người khác gửi tới thường có ô
//    thừa dấu cách, ngày sai định dạng, tên phòng ban viết khác. Ghi thẳng là
//    cách nhanh nhất để hỏng dữ liệu của cả công ty trong một cú bấm.
//
// 3. Ô TRỐNG nghĩa là "không đổi", không phải "xoá".
//    HR hay gửi file chỉ điền vài cột cần sửa. Hiểu ô trống thành NULL sẽ xoá
//    sạch những trường họ không đụng tới.
// ============================================================================

import type { EducationLevel, EmploymentStatus, Profile } from '@/types';

/** Cột trong file Excel. Khớp theo tiêu đề, không theo thứ tự. */
export interface ImportColumn {
  /** Tiêu đề hiển thị trong file mẫu. */
  header: string;
  field: keyof Profile;
  hint: string;
}

export const IMPORT_COLUMNS: ImportColumn[] = [
  { header: 'Mã nhân viên', field: 'employee_code', hint: 'Dùng để khớp với hồ sơ đã có' },
  { header: 'Email / Tên đăng nhập', field: 'email', hint: 'Dùng khớp khi chưa có mã nhân viên' },
  { header: 'Họ và tên', field: 'name', hint: '' },
  { header: 'Số điện thoại', field: 'phone', hint: '' },
  { header: 'Ngày vào làm', field: 'hire_date', hint: 'dd/mm/yyyy' },
  { header: 'Quê quán', field: 'hometown', hint: '' },
  { header: 'Địa chỉ thường trú', field: 'permanent_address', hint: '' },
  { header: 'Nơi ở hiện tại', field: 'current_address', hint: '' },
  { header: 'Trình độ học vấn', field: 'education_level', hint: 'THPT / Trung cấp / Cao đẳng / Đại học / Sau đại học / Khác' },
  { header: 'Trường', field: 'school_name', hint: '' },
  { header: 'Chuyên ngành', field: 'major', hint: '' },
  { header: 'Năm tốt nghiệp', field: 'graduation_year', hint: '' },
  { header: 'Trạng thái lao động', field: 'employment_status', hint: 'Thử việc / Chính thức / Tạm hoãn / Đã nghỉ việc' },
];

const EDUCATION_BY_LABEL: Record<string, EducationLevel> = {
  'thpt': 'HIGH_SCHOOL',
  'trung học phổ thông': 'HIGH_SCHOOL',
  'trung cấp': 'VOCATIONAL',
  'cao đẳng': 'COLLEGE',
  'đại học': 'UNIVERSITY',
  'sau đại học': 'POSTGRADUATE',
  'khác': 'OTHER',
};

const STATUS_BY_LABEL: Record<string, EmploymentStatus> = {
  'đang tiếp nhận': 'onboarding',
  'thử việc': 'probation',
  'chính thức': 'active',
  'tạm hoãn': 'suspended',
  'đã nghỉ việc': 'terminated',
};

/** Một thay đổi sẽ được ghi, hoặc một dòng bị loại kèm lý do. */
export interface ImportRow {
  /** Số dòng trong file, tính cả dòng tiêu đề — để người dùng dò lại được. */
  line: number;
  raw: Record<string, string>;
  /** Hồ sơ khớp được. NULL nghĩa là dòng này không ghi được. */
  matched: Profile | null;
  /** Chỉ chứa trường thực sự ĐỔI so với hồ sơ hiện tại. */
  changes: Partial<Profile>;
  problems: string[];
}

export interface ImportPreview {
  rows: ImportRow[];
  /** Dòng ghi được: có hồ sơ khớp và có ít nhất một thay đổi. */
  writable: ImportRow[];
  /** Dòng khớp được nhưng không có gì đổi — không cần ghi. */
  unchanged: ImportRow[];
  /** Dòng không ghi được. */
  rejected: ImportRow[];
}

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Đổi ngày từ file Excel sang `yyyy-mm-dd`.
 *
 * Excel trả ngày về ba dạng khác nhau tuỳ cách ô được định dạng: chuỗi
 * "15/03/2024", chuỗi ISO, hoặc SỐ SERI (số ngày kể từ 30/12/1899). Bỏ sót
 * dạng số seri là nhận về những ngày kiểu năm 1900 mà không ai hiểu vì sao.
 */
export function parseExcelDate(value: unknown): string | null {
  const text = clean(value);
  if (!text) return null;

  const dmy = text.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const serial = Number(text);
  if (Number.isFinite(serial) && serial > 0 && serial < 60000) {
    const epoch = Date.UTC(1899, 11, 30);
    const date = new Date(epoch + serial * 86400000);
    return date.toISOString().slice(0, 10);
  }

  return null;
}

/**
 * Dựng bản xem trước từ dữ liệu đã đọc khỏi file Excel.
 *
 * Thuần tính toán, không chạm database — nhờ vậy kiểm chứng được bằng dữ liệu
 * thuần, và màn hình chỉ việc hiển thị.
 */
export function buildImportPreview(
  sheet: Record<string, unknown>[],
  profiles: Profile[],
): ImportPreview {
  const byCode = new Map(
    profiles.filter((p) => p.employee_code).map((p) => [p.employee_code!.toLowerCase(), p]),
  );
  const byEmail = new Map(profiles.map((p) => [p.email.toLowerCase(), p]));

  const seen = new Set<string>();
  const rows: ImportRow[] = sheet.map((record, index) => {
    const raw: Record<string, string> = {};
    for (const column of IMPORT_COLUMNS) raw[column.header] = clean(record[column.header]);

    const problems: string[] = [];
    const code = raw['Mã nhân viên'].toLowerCase();
    const email = raw['Email / Tên đăng nhập'].toLowerCase();

    // Mã nhân viên ưu tiên hơn email: email đổi được, mã thì không.
    const matched = (code && byCode.get(code)) || (email && byEmail.get(email)) || null;

    if (!code && !email) {
      problems.push('Thiếu cả mã nhân viên lẫn email — không biết dòng này của ai.');
    } else if (!matched) {
      problems.push('Không có tài khoản nào khớp. Tạo tài khoản ở Hồ sơ & tài khoản trước rồi import lại.');
    } else {
      const key = matched.id;
      if (seen.has(key)) {
        problems.push('Trùng với một dòng phía trên trong cùng file — chỉ dòng đầu được ghi.');
      }
      seen.add(key);
    }

    const changes: Partial<Profile> = {};
    if (matched && problems.length === 0) {
      for (const column of IMPORT_COLUMNS) {
        const value = raw[column.header];
        // Ô trống = không đổi. Xem ghi chú đầu file.
        if (!value) continue;
        // Hai cột khớp không phải là cột cập nhật.
        if (column.field === 'employee_code' || column.field === 'email') continue;

        if (column.field === 'hire_date') {
          const parsed = parseExcelDate(value);
          if (!parsed) {
            problems.push(`Ngày vào làm "${value}" không đọc được — dùng dd/mm/yyyy.`);
            continue;
          }
          if (parsed !== matched.hire_date) changes.hire_date = parsed;
          continue;
        }

        if (column.field === 'education_level') {
          const level = EDUCATION_BY_LABEL[value.toLowerCase()];
          if (!level) {
            problems.push(`Trình độ "${value}" không nằm trong danh sách cho phép.`);
            continue;
          }
          if (level !== matched.education_level) changes.education_level = level;
          continue;
        }

        if (column.field === 'employment_status') {
          const status = STATUS_BY_LABEL[value.toLowerCase()];
          if (!status) {
            problems.push(`Trạng thái "${value}" không nằm trong danh sách cho phép.`);
            continue;
          }
          if (status !== matched.employment_status) changes.employment_status = status;
          continue;
        }

        if (column.field === 'graduation_year') {
          const year = Number(value);
          if (!Number.isInteger(year) || year < 1950 || year > 2100) {
            problems.push(`Năm tốt nghiệp "${value}" không hợp lệ.`);
            continue;
          }
          if (year !== matched.graduation_year) changes.graduation_year = year;
          continue;
        }

        if (value !== (matched[column.field] ?? '')) {
          (changes as Record<string, unknown>)[column.field] = value;
        }
      }
    }

    return { line: index + 2, raw, matched, changes, problems };
  });

  const rejected = rows.filter((row) => row.problems.length > 0 || !row.matched);
  const usable = rows.filter((row) => row.problems.length === 0 && row.matched);

  return {
    rows,
    writable: usable.filter((row) => Object.keys(row.changes).length > 0),
    unchanged: usable.filter((row) => Object.keys(row.changes).length === 0),
    rejected,
  };
}

/** Nhãn tiếng Việt của một trường, để bản xem trước nói bằng ngôn ngữ người dùng. */
export function fieldLabel(field: string): string {
  return IMPORT_COLUMNS.find((column) => column.field === field)?.header ?? field;
}
