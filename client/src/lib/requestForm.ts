// ============================================================================
// Mẫu giấy đề nghị / đơn từ khi in hoặc xuất Word — dựng theo mẫu "Giấy đề
// nghị tăng ca" của công ty: tiêu ngữ hai cột, tiêu đề giữa trang, "Kính gửi",
// các dòng thông tin, bảng nội dung, hàng ô ký. Mọi loại đơn dùng chung bố cục
// này, chỉ khác tiêu đề, người nhận, dòng thông tin và người ký.
// ============================================================================
import { printHtml } from './tablePrint';

export interface FormSigner {
  role: string;
  /** Dòng nhắc dưới chức danh, mặc định "(Ký, ghi rõ họ tên)". */
  hint?: string;
  name?: string | null;
  /** Có cả `name` lẫn `signedAt` thì in khung "Đã ký điện tử". */
  signedAt?: string | null;
}

export interface RequestForm {
  /** Tiêu đề viết hoa giữa trang, vd. "GIẤY ĐỀ NGHỊ TĂNG CA". */
  title: string;
  /** Tên công ty góc trái; bỏ trống thì dùng mặc định. */
  company?: string | null;
  department?: string | null;
  recipients: string[];
  /** Mỗi dòng in dạng "Nhãn: giá trị". */
  info: { label: string; value: string }[];
  reason?: { label: string; value: string };
  table?: { header: string[]; rows: string[][]; widths?: string[] };
  signers: FormSigner[];
  /** Ngày ghi ở tiêu ngữ; mặc định hôm nay. */
  date?: Date;
}

export const DEFAULT_COMPANY = 'CÔNG TY CỔ PHẦN HUY PHONG';

/** Người nhận chung cho các đơn chấm công. */
export const STANDARD_RECIPIENTS = ['Ban Giám đốc Công ty', 'Phòng Hành chính Nhân sự', 'Trưởng Bộ Phận'];

export const SIGN_HINT_CONFIRM = '(Xác nhận, ký, ghi rõ họ tên)';

const esc = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const DOTS = '....................';

const orDots = (value: string | null | undefined) => (value && value.trim() ? esc(value.trim()).replace(/\n/g, '<br>') : DOTS);

const fmtStamp = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('vi-VN');
};

function signerHtml(signer: FormSigner): string {
  const signed = !!signer.name && !!signer.signedAt;
  const body = signed
    ? `<div class="esign"><b>Đã ký điện tử</b><br>${esc(signer.name as string)}<br><span class="small">${esc(fmtStamp(signer.signedAt as string))}</span></div>`
    : `<div class="blank"></div>${signer.name ? `<b>${esc(signer.name)}</b>` : ''}`;
  return `<td class="sign"><b>${esc(signer.role)}</b><br><i>${esc(signer.hint ?? '(Ký, ghi rõ họ tên)')}</i>${body}</td>`;
}

/** Trang HTML của giấy, dùng chung cho in và file Word. */
export function buildRequestFormHtml(form: RequestForm, forWord = false): string {
  const date = form.date ?? new Date();
  const placeDate = `Hà Nội, ngày ${date.getDate()} tháng ${date.getMonth() + 1} năm ${date.getFullYear()}.`;

  const recipients = form.recipients.map((line, index) =>
    `<div>- ${esc(line)}${index < form.recipients.length - 1 ? ' ;' : ''}</div>`).join('');

  const info = form.info.map((row) => `<p class="line">${esc(row.label)}: <b>${orDots(row.value)}</b></p>`).join('');
  const reason = form.reason
    ? `<p class="line">${esc(form.reason.label)}:</p><p class="line reason">${orDots(form.reason.value)}</p>`
    : '';

  let table = '';
  if (form.table) {
    const widths = form.table.widths ?? [];
    const head = form.table.header.map((h, i) => `<th${widths[i] ? ` style="width:${widths[i]}"` : ''}>${esc(h).replace(/\n/g, '<br>')}</th>`).join('');
    const body = form.table.rows.map((row) =>
      `<tr>${form.table!.header.map((_, i) => `<td${i === 0 ? ' class="c"' : ''}>${esc(row[i] ?? '')}</td>`).join('')}</tr>`).join('');
    table = `<table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  const css = `
@page { size: A4 portrait; margin: 18mm 15mm 18mm 20mm; }
* { box-sizing: border-box; }
body { font-family: "Times New Roman", Times, serif; font-size: 13pt; color: #000; margin: 0; line-height: 1.35; }
table { border-collapse: collapse; width: 100%; }
td, th { vertical-align: top; }
.head td { width: 50%; text-align: center; padding: 0 4px; }
.head .left { font-weight: bold; }
.title { text-align: center; font-weight: bold; font-size: 15pt; margin: 22px 0 14px; }
.to td { padding: 0; }
.to td.k { width: 22%; font-weight: bold; white-space: nowrap; }
.line { margin: 6px 0 0; }
.reason { min-height: 20px; text-align: justify; }
.grid { margin-top: 12px; }
.grid th, .grid td { border: 1px solid #000; padding: 5px 7px; }
.grid th { text-align: center; font-weight: bold; }
.grid td { height: 26px; }
.grid td.c { text-align: center; }
.sigs { margin-top: 22px; }
.sigs td.sign { width: 33%; text-align: center; padding: 0 4px; }
.blank { height: 78px; }
.esign { margin: 8px auto 0; display: inline-block; padding: 4px 10px; border: 1.5px solid #1d4ed8; color: #1d4ed8; font-size: 11pt; }
.small { font-size: 9pt; }
i { font-weight: normal; }`;

  const wordHead = forWord
    ? '<xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml>'
    : '';

  return `<!doctype html><html lang="vi" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(form.title)}</title>${wordHead}<style>${css}</style></head><body>
<table class="head"><tr>
<td class="left">${esc(form.company || DEFAULT_COMPANY)}<br>Phòng: ${orDots(form.department)}</td>
<td><b>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</b><br><b>Độc lập - Tự do - Hạnh phúc</b><br><i>${placeDate}</i></td>
</tr></table>
<div class="title">${esc(form.title)}</div>
<table class="to"><tr><td class="k">Kính gửi:</td><td>${recipients}</td></tr></table>
${info}${reason}${table}
<table class="sigs"><tr>${form.signers.map(signerHtml).join('')}</tr></table>
</body></html>`;
}

export function printRequestForm(form: RequestForm): Promise<void> {
  return printHtml(buildRequestFormHtml(form));
}

/** Tải giấy về dạng .doc (Word mở trực tiếp). */
export function exportRequestFormDoc(form: RequestForm, filename: string): void {
  const blob = new Blob(['﻿', buildRequestFormHtml(form, true)], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.doc`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Ba ô ký của các đơn chấm công, theo đúng mẫu giấy đề nghị tăng ca. */
export function attendanceSigners(applicant: string): FormSigner[] {
  return [
    { role: 'TP. Hành chính Nhân sự', hint: SIGN_HINT_CONFIRM },
    { role: 'Trưởng bộ phận', hint: SIGN_HINT_CONFIRM },
    { role: 'Người đề nghị', name: applicant },
  ];
}
