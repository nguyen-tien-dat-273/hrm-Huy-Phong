// ============================================================================
// Xuất một bảng danh sách ra Excel / CSV (UI_02).
// ----------------------------------------------------------------------------
// PDF đi đường in của trình duyệt (In → Lưu thành PDF): CSS in ấn ở
// `index.css` đã bỏ khung điều hướng và nút bấm, bảng ra giấy sạch. Thêm một
// thư viện PDF chỉ để vẽ lại đúng cái bảng đang thấy là đánh đổi sai.
//
// `xlsx` nạp động như mọi chỗ xuất Excel khác trong dự án — chỉ tải khi có
// người bấm.
// ============================================================================

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
  width?: number;
}

export interface ExportOptions<T> {
  /** Tên file không kèm đuôi. */
  filename: string;
  sheetName: string;
  /** Dòng tiêu đề đầu sheet (Excel) — CSV bỏ qua để máy khác đọc thẳng được. */
  title?: string;
  subtitle?: string;
  columns: ExportColumn<T>[];
  rows: readonly T[];
}

export async function exportExcel<T>(options: ExportOptions<T>): Promise<void> {
  const XLSX = await import('xlsx');
  const header = options.columns.map((column) => column.header);
  const body = options.rows.map((row) => options.columns.map((column) => column.value(row) ?? ''));
  const sheetRows: (string | number)[][] = [
    ...(options.title ? [[options.title]] : []),
    ...(options.subtitle ? [[options.subtitle]] : []),
    ...(options.title || options.subtitle ? [[]] : []),
    header,
    ...body,
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
  worksheet['!cols'] = options.columns.map((column) => ({ wch: column.width ?? 18 }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, options.sheetName.slice(0, 31));
  XLSX.writeFile(workbook, `${options.filename}.xlsx`);
}

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value);
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportCsv<T>(options: ExportOptions<T>): void {
  const lines = [
    options.columns.map((column) => csvCell(column.header)).join(','),
    ...options.rows.map((row) => options.columns.map((column) => csvCell(column.value(row))).join(',')),
  ];
  // BOM để Excel trên Windows mở đúng tiếng Việt.
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${options.filename}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Bỏ dấu tiếng Việt — tên người hưởng và nội dung chuyển khoản ở cổng e-banking. */
export function stripVietnamese(text: string): string {
  return text
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D');
}
