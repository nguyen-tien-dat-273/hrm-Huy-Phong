// Đổi tên đăng nhập (email nội bộ @ppms.local) của một nhân viên.
// Dùng: node --env-file=.env tools/vps/rename-login.mjs "Nguyễn Thị Kim Dung" 0962861353 [--apply]
// Không có --apply thì chỉ in ra việc sẽ làm.
const [name, username] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || !name || !username) {
  console.error('Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, tên nhân viên hoặc tên đăng nhập mới.');
  process.exit(1);
}
const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const newEmail = `${username.trim().toLowerCase()}@ppms.local`;

const find = await fetch(`${url}/rest/v1/profiles?select=id,name,email,employee_code&name=eq.${encodeURIComponent(name)}`, { headers: h });
const rows = await find.json();
if (!Array.isArray(rows) || rows.length !== 1) {
  console.error(`Cần đúng 1 hồ sơ tên "${name}", tìm thấy:`, rows);
  process.exit(1);
}
const p = rows[0];
console.log(`${p.name} (${p.employee_code ?? '—'}): ${p.email} -> ${newEmail}`);
if (!apply) { console.log('Chưa ghi gì. Thêm --apply để thực hiện.'); process.exit(0); }

const a = await fetch(`${url}/auth/v1/admin/users/${p.id}`, {
  method: 'PUT', headers: h, body: JSON.stringify({ email: newEmail, email_confirm: true }),
});
if (!a.ok) { console.error('Đổi ở auth lỗi:', await a.text()); process.exit(1); }
const r = await fetch(`${url}/rest/v1/profiles?id=eq.${p.id}`, {
  method: 'PATCH', headers: h, body: JSON.stringify({ email: newEmail }),
});
if (!r.ok) { console.error('Đổi ở profiles lỗi:', await r.text()); process.exit(1); }
console.log('Xong.');
