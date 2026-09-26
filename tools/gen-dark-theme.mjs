// Sinh client/src/dark-theme.css — chạy: node tools/gen-dark-theme.mjs
// Mục đích: các trang viết class màu SÁNG (bg-white, text-slate-800, bg-emerald-50...)
// mà thiếu biến thể `dark:`. File sinh ra ánh xạ chúng sang bảng màu tối, và bỏ qua
// phần tử nào đã tự khai báo `dark:bg-` / `dark:text-` / `dark:border-`.
import { writeFileSync } from 'node:fs';

const H = 'html:where(.dark)';
const rows = [];
const guard = (p) => `:where(:not([class*="dark:${p}-"]):not([class*="dark:!${p}-"]))`;
const esc = (c) => c.replace(/\//g, '\\/');
const rule = (sel, decl) => rows.push(`${sel} { ${decl} }`);

/* ---- Trung tính ---- */
const neutralBg = {
  white: '#0f172a', 50: '#111b30', 100: '#1a2438', 200: '#243046', 300: '#334155',
};
const neutralText = {
  black: '#f8fafc', 950: '#f8fafc', 900: '#f1f5f9', 800: '#f1f5f9',
  700: '#e2e8f0', 600: '#cbd5e1', 500: '#a3b0c4',
};
const neutralBorder = { white: '#1e293b', 50: '#1a2438', 100: '#1e293b', 200: '#2a374c', 300: '#3b4a61' };
const families = ['slate', 'gray', 'zinc', 'neutral', 'stone'];
const alphas = [40, 50, 60, 70, 72, 75, 80, 85, 90, 95];

for (const [shade, hex] of Object.entries(neutralBg)) {
  const names = shade === 'white' ? ['white'] : families.map((f) => `${f}-${shade}`);
  for (const n of names) {
    rule(`${H} .bg-${n}${guard('bg')}`, `background-color: ${hex}`);
    rule(`${H} .\\!bg-${n}${guard('bg')}`, `background-color: ${hex} !important`);
    rule(`${H} .hover\\:bg-${n}:hover${guard('hover:bg')}`, `background-color: ${hex === '#0f172a' ? '#1e293b' : hex}`);
    for (const a of alphas) {
      if (['white', '50', '100'].includes(String(shade)))
        rule(`${H} .${esc(`bg-${n}/${a}`)}${guard('bg')}`, `background-color: ${hex}${Math.round(a * 2.55).toString(16).padStart(2, '0')}`);
    }
  }
}
for (const [shade, hex] of Object.entries(neutralText)) {
  const names = shade === 'black' ? ['black'] : families.map((f) => `${f}-${shade}`);
  for (const n of names) {
    rule(`${H} .text-${n}${guard('text')}`, `color: ${hex}`);
    rule(`${H} .\\!text-${n}${guard('text')}`, `color: ${hex} !important`);
    rule(`${H} .hover\\:text-${n}:hover${guard('hover:text')}`, `color: ${hex}`);
  }
}
for (const [shade, hex] of Object.entries(neutralBorder)) {
  const names = shade === 'white' ? ['white'] : families.map((f) => `${f}-${shade}`);
  for (const n of names) {
    rule(`${H} .border-${n}${guard('border')}`, `border-color: ${hex}`);
    rule(`${H} .${esc(`border-${n}/80`)}${guard('border')}`, `border-color: ${hex}`);
    rule(`${H} .${esc(`border-${n}/70`)}${guard('border')}`, `border-color: ${hex}`);
    rule(`${H} .${esc(`border-${n}/50`)}${guard('border')}`, `border-color: ${hex}`);
    if (shade !== 'white')
      rule(`${H} .divide-${n} > :not(:last-child)${guard('divide')}`, `border-color: ${hex}`);
  }
}
// divide-slate-50 cũng được dùng nhiều
for (const f of families) rule(`${H} .divide-${f}-50 > :not(:last-child)${guard('divide')}`, 'border-color: #1a2438');

/* ---- Gradient nền sáng ---- */
for (const [n, hex] of [['white', '#0f172a'], ['slate-50', '#111b30'], ['slate-100', '#1a2438']]) {
  rule(`${H} .from-${n}${guard('from')}`, `--tw-gradient-from: ${hex}`);
  rule(`${H} .to-${n}${guard('to')}`, `--tw-gradient-to: ${hex}`);
  rule(`${H} .via-${n}${guard('via')}`, `--tw-gradient-via: ${hex}`);
}

/* ---- Họ màu có sắc: [200,300,400,500] ---- */
const hue = {
  red: ['#fecaca', '#fca5a5', '#f87171', '#ef4444'],
  orange: ['#fed7aa', '#fdba74', '#fb923c', '#f97316'],
  amber: ['#fde68a', '#fcd34d', '#fbbf24', '#f59e0b'],
  yellow: ['#fef08a', '#fde047', '#facc15', '#eab308'],
  lime: ['#d9f99d', '#bef264', '#a3e635', '#84cc16'],
  green: ['#bbf7d0', '#86efac', '#4ade80', '#22c55e'],
  emerald: ['#a7f3d0', '#6ee7b7', '#34d399', '#10b981'],
  teal: ['#99f6e4', '#5eead4', '#2dd4bf', '#14b8a6'],
  cyan: ['#a5f3fc', '#67e8f9', '#22d3ee', '#06b6d4'],
  sky: ['#bae6fd', '#7dd3fc', '#38bdf8', '#0ea5e9'],
  blue: ['#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6'],
  indigo: ['#fac5c9', '#f39aa1', '#e66a76', '#d23d4b'], // indigo = đỏ thương hiệu
  violet: ['#ddd6fe', '#c4b5fd', '#a78bfa', '#8b5cf6'],
  purple: ['#e9d5ff', '#d8b4fe', '#c084fc', '#a855f7'],
  fuchsia: ['#f5d0fe', '#f0abfc', '#e879f9', '#d946ef'],
  pink: ['#fbcfe8', '#f9a8d4', '#f472b6', '#ec4899'],
  rose: ['#fecdd3', '#fda4af', '#fb7185', '#f43f5e'],
};
const rgb = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16} ${(n >> 8) & 255} ${n & 255} / ${a})`;
};
const bgAlpha = { 50: 0.14, 100: 0.2, 200: 0.28 };
const textTo = { 400: 2, 500: 2, 600: 2, 700: 1, 800: 1, 900: 0 }; // index vào mảng [200,300,400]
const borderAlpha = { 100: 0.28, 200: 0.38, 300: 0.5 };
for (const [h, [c200, c300, c400, c500]] of Object.entries(hue)) {
  for (const [shade, a] of Object.entries(bgAlpha)) {
    rule(`${H} .bg-${h}-${shade}${guard('bg')}`, `background-color: ${rgb(c500, a)}`);
    if (shade === '50')
      for (const op of [40, 50, 60, 70, 80])
        rule(`${H} .${esc(`bg-${h}-50/${op}`)}${guard('bg')}`, `background-color: ${rgb(c500, 0.1)}`);
    rule(`${H} .hover\\:bg-${h}-${shade}:hover${guard('hover:bg')}`, `background-color: ${rgb(c500, a + 0.08)}`);
  }
  for (const [shade, idx] of Object.entries(textTo)) {
    const hex = [c200, c300, c400][idx];
    rule(`${H} .text-${h}-${shade}${guard('text')}`, `color: ${hex}`);
    rule(`${H} .hover\\:text-${h}-${shade}:hover${guard('hover:text')}`, `color: ${hex}`);
  }
  for (const [shade, a] of Object.entries(borderAlpha))
    rule(`${H} .border-${h}-${shade}${guard('border')}`, `border-color: ${rgb(c500, a)}`);
  rule(`${H} .from-${h}-50${guard('from')}`, `--tw-gradient-from: ${rgb(c500, 0.14)}`);
  rule(`${H} .to-${h}-50${guard('to')}`, `--tw-gradient-to: ${rgb(c500, 0.14)}`);
  rule(`${H} .via-${h}-50${guard('via')}`, `--tw-gradient-via: ${rgb(c500, 0.14)}`);
}

/* ---- Màu hex tùy ý (bg-[#...]) ---- */
const arbitrary = [
  ['bg', 'FCFAF8', 'background-color: #162036'], // đầu mục bảng
  ['bg', 'F7F3ED', 'background-color: #162036'],
  ['bg', 'EEF6F0', 'background-color: rgb(16 185 129 / 0.14)'],
  ['text', '102A43', 'color: #e2e8f0'],
  ['text', 'F7F3ED', 'color: #e2e8f0'],
  ['text', '66798A', 'color: #94a3b8'],
  ['text', '8A9AA5', 'color: #94a3b8'],
  ['text', '3D765A', 'color: #6ee7b7'],
  ['border', 'D7DED9', 'border-color: #2a374c'],
  ['border', 'B9C5CC', 'border-color: #3b4a61'],
  ['border', 'C9DDD2', 'border-color: rgb(16 185 129 / 0.38)'],
];
for (const [p, hex, decl] of arbitrary)
  rule(`${H} .${p}-\\[\\#${hex}\\]${guard(p)}`, decl);

const out = `/* FILE SINH TỰ ĐỘNG bởi tools/gen-dark-theme.mjs — đừng sửa tay.
   Ánh xạ class màu sáng của Tailwind sang bảng màu tối khi <html class="dark">.
   - Nằm trong @layer utilities, đặt SAU utilities sinh bởi Tailwind.
   - Selector "html:where(.dark) .x" có specificity (0,1,1): thắng class gốc (0,1,0)
     nhưng thua biến thể hover:/focus: (0,2,0), nên trạng thái tương tác vẫn đúng.
   - Phần tử đã có \`dark:bg-\`/\`dark:text-\`/\`dark:border-\` riêng thì bị bỏ qua. */
@layer utilities {
${rows.join('\n')}
}
`;
writeFileSync(new URL('../client/src/dark-theme.css', import.meta.url), out);
console.log(rows.length, 'rules');
