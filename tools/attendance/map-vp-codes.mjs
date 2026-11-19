#!/usr/bin/env node
// ============================================================================
// Đặt mã nhân viên HRM = mã trên máy chấm công Văn phòng (theo BCC T10), ghép theo TÊN,
// và tạo hồ sơ cho người có trên máy nhưng chưa có trong HRM. KHÔNG đụng bộ phận Kho
// (máy riêng, danh sách tools/attendance/vp-t10.json chỉ gồm sheet "VP").
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node tools/attendance/map-vp-codes.mjs          # chỉ xem kế hoạch
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node tools/attendance/map-vp-codes.mjs --apply  # thực hiện
//
// Sau khi đổi mã, ingest tự ghép máy ↔ nhân viên theo số cuối (NV023 ↔ 23), xem
// migration 20261107100000; các dòng "chưa ánh xạ" được xét lại ở lần máy gửi kế tiếp.
// Tài khoản mới: tên đăng nhập = mã viết thường, mật khẩu tạm in MỘT lần, bắt đổi khi đăng nhập.
// ============================================================================
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
  .toLowerCase().replace(/\s+/g, ' ').trim();
const list = JSON.parse(await readFile(new URL('./vp-t10.json', import.meta.url), 'utf8'));

const { data: profiles, error } = await db.from('profiles')
  .select('id,name,email,employee_code,department,is_active,employment_status');
if (error) { console.error(error.message); process.exit(1); }

const byName = new Map();
for (const p of profiles) { const k = norm(p.name); byName.set(k, [...(byName.get(k) || []), p]); }
const pick = (arr) => arr.find((p) => p.is_active !== false && p.employment_status !== 'terminated') || arr[0];

const rename = [], create = [], ambiguous = [], same = [];
for (const r of list) {
  const hits = byName.get(norm(r.name)) || [];
  const live = hits.filter((p) => p.is_active !== false && p.employment_status !== 'terminated');
  if (live.length > 1) { ambiguous.push({ r, hits: live }); continue; }
  const p = pick(hits);
  if (!p) create.push(r);
  else if ((p.employee_code || '').toLowerCase() === r.code.toLowerCase()) same.push({ r, p });
  else rename.push({ r, p });
}

// mã đích đang do người KHÔNG nằm trong danh sách đổi giữ -> xung đột cần người quyết
const movingIds = new Set(rename.map((x) => x.p.id));
const conflicts = rename.concat(create.map((r) => ({ r, p: null }))).flatMap(({ r }) =>
  profiles.filter((q) => (q.employee_code || '').toLowerCase() === r.code.toLowerCase() && !movingIds.has(q.id)
    && norm(q.name) !== norm(r.name)).map((q) => ({ r, q })));

console.log(`\nĐã đúng mã: ${same.length}`);
console.log(`\nĐổi mã (${rename.length}):`);
for (const { r, p } of rename) console.log(`  ${r.name.padEnd(26)} ${String(p.employee_code ?? '(trống)').padEnd(12)} -> ${r.code}`);
console.log(`\nTạo mới (${create.length}):`);
for (const r of create) console.log(`  ${r.name.padEnd(26)} ${r.code}  [${r.dept}]`);
if (ambiguous.length) { console.log(`\nTRÙNG TÊN, bỏ qua (${ambiguous.length}):`); for (const a of ambiguous) console.log(`  ${a.r.name} (${a.r.code}): ${a.hits.map((h) => h.email).join(', ')}`); }
if (conflicts.length) { console.log(`\nXUNG ĐỘT: mã đích đang thuộc người khác (cần xử lý tay, bỏ qua):`); for (const c of conflicts) console.log(`  ${c.r.code} (${c.r.name}) đang là của "${c.q.name}" <${c.q.email}>`); }
if (!apply) { console.log('\n(Chế độ xem. Thêm --apply để ghi.)'); process.exit(0); }

const blocked = new Set(conflicts.map((c) => c.r.code));
const todo = rename.filter((x) => !blocked.has(x.r.code));
// pha 1: nhả mã cũ để hoán đổi mã giữa hai người không đụng unique
for (const { p } of todo) {
  const { error: e } = await db.from('profiles').update({ employee_code: null }).eq('id', p.id);
  if (e) { console.error('Lỗi nhả mã', p.name, e.message); process.exit(1); }
}
for (const { r, p } of todo) {
  const { error: e } = await db.from('profiles').update({ employee_code: r.code }).eq('id', p.id);
  if (e) console.error('LỖI đặt mã', r.name, e.message); else console.log('ĐÃ ĐỔI', r.name, '->', r.code);
}
for (const r of create.filter((x) => !blocked.has(x.code))) {
  const username = r.code.toLowerCase(), email = `${username}@ppms.local`;
  const password = `${randomBytes(12).toString('base64url')}aA1!`;
  const { data, error: e } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: r.name } });
  if (e || !data.user) { console.error('LỖI tạo', r.name, e?.message); continue; }
  const { error: pe } = await db.from('profiles').upsert({
    id: data.user.id, email, name: r.name, role: 'staff', access_role_code: 'staff', department: r.dept,
    employee_code: r.code, is_active: true, must_change_password: true, permissions: [],
  });
  if (pe) { await db.auth.admin.deleteUser(data.user.id); console.error('LỖI hồ sơ', r.name, pe.message); continue; }
  console.log(`ĐÃ TẠO ${r.name}  đăng nhập: ${username}  mật khẩu tạm: ${password}`);
}
