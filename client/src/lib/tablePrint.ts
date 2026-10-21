// ============================================================================
// In một hay nhiều bảng danh sách ra giấy — đi cùng `tableExport.ts`: cùng
// cột, cùng dòng, nên bản in luôn khớp với file Excel.
// ----------------------------------------------------------------------------
// Dựng trang in riêng trong iframe ẩn thay vì in thẳng màn hình đang xem: bảng
// ra giấy đủ mọi dòng (không bị cuộn / phân trang / cột dính), có tiêu đề, ngày
// in và dòng ký tên, và hộp thoại in của trình duyệt cho phép "Lưu thành PDF".
// ============================================================================
import type { ExportOptions } from './tableExport';

export interface PrintTable {
  /** Tên bảng in đậm phía trên (bỏ trống nếu chỉ có một bảng). */
  caption?: string;
  header: string[];
  rows: (string | number | null | undefined)[][];
}

/** Một ô ký ở chân chứng từ. Có `name` + `signedAt` thì in chữ ký điện tử; không thì để trống cho ký tay. */
export interface PrintSigner {
  role: string;
  name?: string | null;
  signedAt?: string | null;
}

export interface PrintSignOff {
  signers: PrintSigner[];
  /** Có thì đóng con dấu "ĐÃ DUYỆT" kèm người và giờ duyệt. */
  approvedStamp?: { by: string; at: string } | null;
}

export interface PrintOptions {
  title: string;
  subtitle?: string;
  tables: PrintTable[];
  /** Mặc định tự chọn: từ 7 cột trở lên in ngang. */
  landscape?: boolean;
  /** Thay cho hai ô "Người lập / Người duyệt" mặc định. */
  signOff?: PrintSignOff;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const isNumeric = (value: unknown) =>
  typeof value === 'number' || (typeof value === 'string' && /^-?[\d.,]+( đ| VNĐ| %|%)?$/.test(value.trim()));

const formatCell = (value: string | number | null | undefined) => {
  if (value == null) return '';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toLocaleString('vi-VN') : value.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  }
  return value;
};

const fmtStamp = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('vi-VN');
};

function signOffHtml(signOff: PrintSignOff): string {
  const boxes = signOff.signers.map((signer) => {
    const signed = !!signer.name && !!signer.signedAt;
    const body = signed
      ? `<div class="esign"><b>Đã ký điện tử</b><span class="who">${escapeHtml(signer.name as string)}</span><span class="when">${escapeHtml(fmtStamp(signer.signedAt as string))}</span></div>`
      : `<div class="esign-blank"><i>(Ký, ghi rõ họ tên)</i></div>`;
    return `<div class="signer"><b>${escapeHtml(signer.role)}</b>${body}</div>`;
  }).join('');
  const stamp = signOff.approvedStamp
    ? `<div class="stamp"><span class="big">ĐÃ DUYỆT</span><span>${escapeHtml(signOff.approvedStamp.by)}</span><span>${escapeHtml(fmtStamp(signOff.approvedStamp.at))}</span></div>`
    : '';
  return `<div class="foot">${boxes}${stamp}</div>`;
}

function buildHtml(options: PrintOptions, landscape: boolean): string {
  const tables = options.tables.map((table) => {
    const head = table.header.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
    const body = table.rows.map((row) =>
      `<tr>${table.header.map((_, i) => {
        const cell = row[i];
        const text = escapeHtml(String(formatCell(cell)));
        return `<td${isNumeric(cell) && text !== '' ? ' class="num"' : ''}>${text}</td>`;
      }).join('')}</tr>`
    ).join('');
    const empty = table.rows.length === 0 ? `<tr><td colspan="${table.header.length}" class="empty">Không có dữ liệu</td></tr>` : '';
    return `${table.caption ? `<h2>${escapeHtml(table.caption)}</h2>` : ''}<table><thead><tr>${head}</tr></thead><tbody>${body}${empty}</tbody></table>`;
  }).join('');

  const printedAt = new Date().toLocaleString('vi-VN');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${escapeHtml(options.title)}</title><style>
@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm; }
* { box-sizing: border-box; }
body { font-family: "Segoe UI", Arial, sans-serif; color: #111; font-size: 11px; margin: 0; }
h1 { font-size: 16px; text-align: center; margin: 0 0 4px; text-transform: uppercase; }
.sub { text-align: center; color: #444; margin: 0 0 10px; }
h2 { font-size: 12px; margin: 14px 0 4px; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #555; padding: 3px 5px; vertical-align: top; word-break: break-word; }
th { background: #e8edf3; font-weight: 700; text-align: center; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
td.num { text-align: right; white-space: nowrap; }
td.empty { text-align: center; color: #666; }
.foot { display: flex; justify-content: space-between; margin-top: 18px; page-break-inside: avoid; position: relative; }
.foot > div { text-align: center; min-width: 160px; }
.signer { flex: 1; }
.esign { margin: 8px auto 0; display: inline-flex; flex-direction: column; gap: 1px; padding: 5px 10px; border: 1.5px solid #1d4ed8; color: #1d4ed8; border-radius: 4px; }
.esign .who { font-weight: 700; font-size: 12px; }
.esign .when { font-size: 9px; }
.esign-blank { height: 52px; padding-top: 4px; }
.stamp { position: absolute; right: 40%; top: -6px; transform: rotate(-12deg); display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 6px 14px; border: 3px double #c0262d; color: #c0262d; border-radius: 6px; font-size: 10px; opacity: .85; pointer-events: none; }
.stamp .big { font-size: 20px; font-weight: 900; letter-spacing: 2px; }
.meta { color: #666; font-size: 10px; margin-top: 12px; }
</style></head><body>
<h1>${escapeHtml(options.title)}</h1>${options.subtitle ? `<p class="sub">${escapeHtml(options.subtitle)}</p>` : ''}
${tables}
<p class="meta">In lúc ${escapeHtml(printedAt)}</p>
${options.signOff
    ? signOffHtml(options.signOff)
    : '<div class="foot"><div><b>Người lập</b><br><i>(Ký, ghi rõ họ tên)</i></div><div><b>Người duyệt</b><br><i>(Ký, ghi rõ họ tên)</i></div></div>'}
</body></html>`;
}

export function printTables(options: PrintOptions): Promise<void> {
  const widest = Math.max(0, ...options.tables.map((table) => table.header.length));
  const landscape = options.landscape ?? widest >= 7;
  const html = buildHtml(options, landscape);

  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
    const cleanup = () => window.setTimeout(() => frame.remove(), 1000);

    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) { cleanup(); reject(new Error('Không mở được khung in.')); return; }
      win.addEventListener('afterprint', cleanup);
      win.focus();
      win.print();
      resolve();
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

/** In đúng bộ cột / dòng của một lần xuất Excel. */
export function printTable<T>(options: ExportOptions<T>, signOff?: PrintSignOff): Promise<void> {
  return printTables({
    signOff,
    title: options.title ?? options.sheetName,
    subtitle: options.subtitle,
    tables: [{
      header: ['STT', ...options.columns.map((column) => column.header)],
      rows: options.rows.map((row, index) => [index + 1, ...options.columns.map((column) => column.value(row, index))]),
    }],
  });
}
