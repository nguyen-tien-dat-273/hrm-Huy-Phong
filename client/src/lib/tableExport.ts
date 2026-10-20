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
  value: (row: T, index: number) => string | number | null | undefined;
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
  const numCols = options.columns.length;
  if (numCols === 0) return;

  const header = options.columns.map((column) => column.header);
  const rawBody = options.rows.map((row, rowIndex) =>
    options.columns.map((column) => {
      const v = column.value(row, rowIndex);
      return v ?? '';
    })
  );

  const sheetRows: (string | number)[][] = [];
  let headerRowIndex = 0;

  if (options.title) {
    sheetRows.push([options.title]);
    headerRowIndex++;
  }
  if (options.subtitle) {
    sheetRows.push([options.subtitle]);
    headerRowIndex++;
  }
  if (options.title || options.subtitle) {
    sheetRows.push([]); // Dòng đệm trống
    headerRowIndex++;
  }

  sheetRows.push(header);
  for (const row of rawBody) {
    sheetRows.push(row);
  }

  const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);

  // 1. Merges cho Tiêu đề & Tiêu đề phụ (trải rộng toàn bảng để trình bày chuẩn)
  const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [];
  let rIdx = 0;
  if (options.title) {
    merges.push({ s: { r: rIdx, c: 0 }, e: { r: rIdx, c: numCols - 1 } });
    rIdx++;
  }
  if (options.subtitle) {
    merges.push({ s: { r: rIdx, c: 0 }, e: { r: rIdx, c: numCols - 1 } });
    rIdx++;
  }
  if (merges.length > 0) {
    worksheet['!merges'] = merges;
  }

  // 2. Tính toán độ rộng cột tự động (Column Widths) với độ giãn hợp lý
  const colWidths = options.columns.map((col, cIdx) => {
    let maxLen = col.header.length;
    for (const row of rawBody) {
      const cellVal = row[cIdx];
      const str = cellVal == null ? '' : String(cellVal);
      if (str.length > maxLen) {
        maxLen = str.length;
      }
    }
    // wch tính theo ký tự + thêm đệm 4 ký tự để không bao giờ bị cắt chữ
    const calculated = Math.max(maxLen + 4, 12);
    return { wch: Math.max(col.width ?? 0, Math.min(calculated, 60)) };
  });
  worksheet['!cols'] = colWidths;

  // 3. Chiều cao hàng (Row Heights)
  const rowHeights: Array<{ hpt?: number }> = [];
  if (options.title) rowHeights.push({ hpt: 28 }); // Tiêu đề chính lớn
  if (options.subtitle) rowHeights.push({ hpt: 20 }); // Tiêu đề phụ
  if (options.title || options.subtitle) rowHeights.push({ hpt: 10 }); // Khoảng cách
  rowHeights.push({ hpt: 26 }); // Hàng tiêu đề bảng
  for (let i = 0; i < options.rows.length; i++) {
    rowHeights.push({ hpt: 22 }); // Hàng dữ liệu
  }
  worksheet['!rows'] = rowHeights;

  // 4. Định dạng số & tiền tệ chuyên nghiệp (Number Formatting)
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
  const startDataRow = headerRowIndex + 1;

  for (let R = startDataRow; R <= range.e.r; R++) {
    for (let C = 0; C <= range.e.c; C++) {
      const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = worksheet[cellAddress];
      if (!cell) continue;

      if (typeof cell.v === 'number') {
        if (Number.isInteger(cell.v)) {
          if (Math.abs(cell.v) >= 1000) {
            cell.z = '#,##0';
          }
        } else {
          cell.z = '#,##0.0#';
        }
      } else if (typeof cell.v === 'string') {
        const trimmed = cell.v.trim();
        // Kiểm tra số tiền định dạng Việt Nam, ví dụ: "15.000.000 đ" hay "2.500.000"
        if (/^-?\d{1,3}(\.\d{3})+( đ| VNĐ)?$/.test(trimmed)) {
          const num = Number(trimmed.replace(/[^\d-]/g, ''));
          if (!isNaN(num)) {
            cell.v = num;
            cell.t = 'n';
            cell.z = '#,##0';
          }
        }
      }
    }
  }

  // 5. Cố định hàng tiêu đề khi cuộn (Freeze Panes)
  worksheet['!views'] = [{ state: 'frozen', ySplit: headerRowIndex + 1 }];

  // 6. Bật tính năng lọc tự động (AutoFilter)
  worksheet['!autofilter'] = {
    ref: XLSX.utils.encode_range({
      s: { r: headerRowIndex, c: 0 },
      e: { r: range.e.r, c: numCols - 1 },
    }),
  };

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
    ...options.rows.map((row, rowIndex) => options.columns.map((column) => csvCell(column.value(row, rowIndex))).join(',')),
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
