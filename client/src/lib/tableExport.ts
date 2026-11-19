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
  /** Các dòng chữ ở cuối sheet (Excel) — vd. chữ ký điện tử của chứng từ lương. */
  footerLines?: string[];
  /**
   * Tiêu đề hai tầng: mỗi phần tử phủ `span` cột liên tiếp (tổng span = số cột).
   * Có `title` → tầng trên ghi tên nhóm, tầng dưới ghi tên cột; không có → ô gộp dọc hai tầng.
   */
  headerGroups?: Array<{ title: string | null; span: number }>;
  /** Chia bảng theo nhóm (vd. phòng ban): dòng đổi nhóm thì chèn một dòng tên nhóm. Dòng phải xếp sẵn theo nhóm. */
  groupBy?: (row: T) => string;
  /** Đầu chứng từ như mẫu Excel: tên công ty + đơn vị lập bên trái, mã biểu mẫu bên phải. */
  letterhead?: Letterhead;
  /** Dòng chữ căn trái ngay trên bảng (vd. "Số ngày làm việc trong tháng: 23,5"). */
  preface?: string[];
  /** Dòng "Tổng cộng" cuối bảng, cùng số ô với `columns`. */
  totalRow?: (string | number | null)[];
}

export interface Letterhead {
  company: string;
  unit?: string | null;
  formCode?: string | null;
}

/** Một dòng thân bảng: dòng dữ liệu, hoặc dòng tên nhóm trải hết chiều ngang. */
export type BodyRow = { band: string } | { cells: (string | number)[] };

/** Xen dòng tên nhóm vào danh sách dòng khi `groupBy` đổi giá trị. */
export function bodyRowsOf<T>(options: ExportOptions<T>): BodyRow[] {
  const out: BodyRow[] = [];
  let current: string | null = null;
  options.rows.forEach((row, rowIndex) => {
    if (options.groupBy) {
      const group = options.groupBy(row);
      if (group !== current) {
        out.push({ band: group });
        current = group;
      }
    }
    out.push({ cells: options.columns.map((column) => column.value(row, rowIndex) ?? '') });
  });
  return out;
}

/** Hai tầng tiêu đề (tầng 2 rỗng nếu không nhóm) cùng danh sách ô gộp, toạ độ tương đối so với dòng tiêu đề đầu. */
export function headerLayout<T>(options: ExportOptions<T>) {
  const heads = options.headerGroups;
  if (!heads || !heads.some((head) => head.title)) {
    return { rows: [options.columns.map((column) => column.header)], merges: [] as Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> };
  }
  const top: string[] = [];
  const bottom: string[] = [];
  const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [];
  let col = 0;
  for (const head of heads) {
    if (head.title) {
      for (let i = 0; i < head.span; i += 1) {
        top.push(i === 0 ? head.title : '');
        bottom.push(options.columns[col + i]?.header ?? '');
      }
      if (head.span > 1) merges.push({ s: { r: 0, c: col }, e: { r: 0, c: col + head.span - 1 } });
    } else {
      for (let i = 0; i < head.span; i += 1) {
        top.push(options.columns[col + i]?.header ?? '');
        bottom.push('');
        merges.push({ s: { r: 0, c: col + i }, e: { r: 1, c: col + i } });
      }
    }
    col += head.span;
  }
  return { rows: [top, bottom], merges };
}

export async function exportExcel<T>(options: ExportOptions<T>): Promise<void> {
  const XLSX = await import('xlsx');
  const numCols = options.columns.length;
  if (numCols === 0) return;

  const layout = headerLayout(options);
  const body = bodyRowsOf(options);
  const rawBody = body.map((item) => ('cells' in item ? item.cells : [item.band]));

  const sheetRows: (string | number)[][] = [];
  const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [];
  const rowHeights: Array<{ hpt?: number }> = [];
  /** Dòng chữ trải ngang toàn bảng (tiêu đề, dòng phụ). */
  const pushWide = (text: string, height: number) => {
    merges.push({ s: { r: sheetRows.length, c: 0 }, e: { r: sheetRows.length, c: numCols - 1 } });
    sheetRows.push([text]);
    rowHeights.push({ hpt: height });
  };

  const head = options.letterhead;
  if (head) {
    // Tên công ty bên trái, mã biểu mẫu ô cuối bên phải — như dòng 1 của mẫu Excel.
    const row: (string | number)[] = [head.company];
    if (head.formCode && numCols > 1) {
      row[numCols - 1] = head.formCode;
      for (let c = 1; c < numCols - 1; c++) row[c] = '';
    }
    const leftSpan = head.formCode && numCols > 1 ? Math.max(1, Math.floor(numCols / 2)) : numCols;
    if (leftSpan > 1) merges.push({ s: { r: sheetRows.length, c: 0 }, e: { r: sheetRows.length, c: leftSpan - 1 } });
    sheetRows.push(row);
    rowHeights.push({ hpt: 20 });
    if (head.unit) {
      if (leftSpan > 1) merges.push({ s: { r: sheetRows.length, c: 0 }, e: { r: sheetRows.length, c: leftSpan - 1 } });
      sheetRows.push([head.unit]);
      rowHeights.push({ hpt: 18 });
    }
  }
  if (options.title) pushWide(options.title, 28);
  if (options.subtitle) pushWide(options.subtitle, 20);
  for (const line of options.preface ?? []) pushWide(line, 18);
  if (head || options.title || options.subtitle || options.preface?.length) {
    sheetRows.push([]); // Dòng đệm trống
    rowHeights.push({ hpt: 10 });
  }
  const headerRowIndex = sheetRows.length;

  const headRows = layout.rows.length;
  for (const headRow of layout.rows) sheetRows.push(headRow);
  for (const row of rawBody) {
    sheetRows.push(row);
  }
  if (options.totalRow) {
    sheetRows.push(options.totalRow.map((cell) => cell ?? ''));
  }
  if (options.footerLines?.length) {
    sheetRows.push([]);
    for (const line of options.footerLines) sheetRows.push([line]);
  }

  const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);

  // 1. Ô gộp: dòng tổng (chữ "Tổng cộng" trải qua các ô trống đầu dòng), chân trang, tiêu đề bảng, dòng nhóm
  if (options.totalRow) {
    const r = headerRowIndex + headRows + body.length;
    let span = 1;
    while (span < numCols && (options.totalRow[span] == null || options.totalRow[span] === '')) span++;
    if (span > 1 && span < numCols) merges.push({ s: { r, c: 0 }, e: { r, c: span - 1 } });
  }
  if (options.footerLines?.length) {
    const first = sheetRows.length - options.footerLines.length;
    for (let r = first; r < sheetRows.length; r++) merges.push({ s: { r, c: 0 }, e: { r, c: numCols - 1 } });
  }
  for (const merge of layout.merges) {
    merges.push({ s: { r: headerRowIndex + merge.s.r, c: merge.s.c }, e: { r: headerRowIndex + merge.e.r, c: merge.e.c } });
  }
  body.forEach((item, index) => {
    if ('band' in item) {
      const r = headerRowIndex + headRows + index;
      merges.push({ s: { r, c: 0 }, e: { r, c: numCols - 1 } });
    }
  });
  if (merges.length > 0) {
    worksheet['!merges'] = merges;
  }

  // 2. Tính toán độ rộng cột tự động (Column Widths) với độ giãn hợp lý
  const colWidths = options.columns.map((col, cIdx) => {
    let maxLen = col.header.length;
    for (const item of body) {
      if (!('cells' in item)) continue;
      const cellVal = item.cells[cIdx];
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

  // 3. Chiều cao hàng (Row Heights) — các dòng đầu chứng từ đã đặt khi dựng ở trên
  for (let i = 0; i < headRows; i++) rowHeights.push({ hpt: 26 }); // Hàng tiêu đề bảng
  for (const item of body) {
    rowHeights.push({ hpt: 'band' in item ? 24 : 22 }); // Dòng tên nhóm / dòng dữ liệu
  }
  worksheet['!rows'] = rowHeights;

  // 4. Định dạng số & tiền tệ chuyên nghiệp (Number Formatting)
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
  const startDataRow = headerRowIndex + headRows;

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
  worksheet['!views'] = [{ state: 'frozen', ySplit: headerRowIndex + headRows }];

  // 6. Bật tính năng lọc tự động (AutoFilter)
  // Bảng nhiều tầng / chia nhóm: bộ lọc sẽ lẫn dòng tên nhóm nên không bật.
  if (headRows === 1 && !options.groupBy) {
    worksheet['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: headerRowIndex, c: 0 },
        e: { r: range.e.r, c: numCols - 1 },
      }),
    };
  }

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
