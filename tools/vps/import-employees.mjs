// Nhập nhân viên từ DANH SACH NV.xlsx. Chạy TRÊN VPS:
//   cd /opt/hrm && set -a && . /opt/supabase/.env && set +a && SUPABASE_URL=https://hrmhuyphong.com node import-employees.mjs [--apply]
// Cần SERVICE_ROLE_KEY trong môi trường. Mặc định chạy thử. Tài khoản đã có thì chỉ cập nhật hồ sơ.
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
const PASSWORD = '12345678';
const rows = [
 {
  "code": "HP001",
  "name": "Lưu Vũ Phong",
  "hire_date": "2001-01-01",
  "dept": "Ban giám đốc/KD shop/nhập khẩu",
  "position": "Giám đốc",
  "phone": "0906232341"
 },
 {
  "code": "HP002",
  "name": "Bùi Thị Nhân Huệ",
  "hire_date": "2010-01-01",
  "dept": "Ban giám đốc/KTT/QL Kho/mkt",
  "position": "Phó Giám đốc",
  "phone": "0903437176"
 },
 {
  "code": "HP003",
  "name": "Đàm Minh Nghĩa",
  "hire_date": "2001-01-01",
  "dept": "BP Kho vận",
  "position": "QL Kho",
  "phone": "0913004328"
 },
 {
  "code": "HP004",
  "name": "Lưu Thị Vượng",
  "hire_date": "2025-02-05",
  "dept": "Phòng kế toán",
  "position": "KTT",
  "phone": "0971630990"
 },
 {
  "code": "HP005",
  "name": "Phạm Thị Thùy Dương",
  "hire_date": "2017-08-21",
  "dept": "Phòng kế toán",
  "position": "Thủ quỹ",
  "phone": "0984422414"
 },
 {
  "code": "HP006",
  "name": "Nguyễn Thị Mùi",
  "hire_date": "2013-10-18",
  "dept": "Phòng kế toán",
  "position": "Kế toán công nợ",
  "phone": "0929319268"
 },
 {
  "code": "HP007",
  "name": "Lê Diệu Linh",
  "hire_date": "2025-03-04",
  "dept": "Phòng kế toán",
  "position": "Kế toán công nợ",
  "phone": "0348635698"
 },
 {
  "code": "HP008",
  "name": "Nguyễn Thị Kim Dung",
  "hire_date": "2025-09-08",
  "dept": "Phòng kế toán",
  "position": "Kế toán tổng hợp",
  "phone": "0876736886"
 },
 {
  "code": "HP009",
  "name": "Nguyễn Minh Tảo",
  "hire_date": "2017-04-05",
  "dept": "Phòng KD Shop",
  "position": "Nhân viên kinh doanh",
  "phone": "0972587131"
 },
 {
  "code": "HP010",
  "name": "Hồ Linh Chi",
  "hire_date": "2022-08-29",
  "dept": "Phòng KD Shop",
  "position": "Nhân viên kinh doanh",
  "phone": "0867141688"
 },
 {
  "code": "HP011",
  "name": "Nguyễn Huỳnh Đức",
  "hire_date": "2022-03-07",
  "dept": "Phòng KD Shop",
  "position": "Nhân viên kinh doanh",
  "phone": "0976387576"
 },
 {
  "code": "HP012",
  "name": "Lê Văn Lợi",
  "dept": "Phòng KD Shop",
  "position": "Nhân viên kinh doanh",
  "phone": "0903136386"
 },
 {
  "code": "HP013",
  "name": "Hà Thị Thu Trang",
  "hire_date": "2010-08-01",
  "dept": "Phòng KD Nhà hàng",
  "position": "Trưởng phòng KDNH",
  "phone": "0904892589"
 },
 {
  "code": "HP014",
  "name": "Vũ Thị Hòa",
  "hire_date": "2019-04-01",
  "dept": "Phòng KD Nhà hàng",
  "position": "Nhân viên kinh doanh",
  "phone": "0914228613"
 },
 {
  "code": "HP015",
  "name": "Vũ Thị Thanh Thúy",
  "hire_date": "2023-06-03",
  "dept": "Phòng KD Nhà hàng",
  "position": "Nhân viên kinh doanh",
  "phone": "0916867627"
 },
 {
  "code": "HP016",
  "name": "Lương Xuân Tùng",
  "hire_date": "2023-05-04",
  "dept": "Phòng KD Nhà hàng",
  "position": "Nhân viên kinh doanh",
  "phone": "0982549084"
 },
 {
  "code": "HP017",
  "name": "Nguyễn Tuấn Đạt",
  "hire_date": "2023-03-01",
  "dept": "Phòng Marketing",
  "position": "Nhân viên MKT",
  "phone": "0978441993"
 },
 {
  "code": "HP018",
  "name": "Nguyễn Thị Mai Anh",
  "hire_date": "2025-08-25",
  "dept": "Phòng Marketing",
  "position": "Nhân viên MKT",
  "phone": "0941054629"
 },
 {
  "code": "HP019",
  "name": "Lưu Thu Phương",
  "dept": "Phòng Marketing",
  "position": "Nhân viên MKT",
  "phone": "0337125553"
 },
 {
  "code": "HP020",
  "name": "Nguyễn Đức Minh",
  "hire_date": "2016-01-05",
  "dept": "Phòng XNK",
  "position": "Nhân viên nhập khẩu",
  "phone": "0972301322"
 },
 {
  "code": "HP021",
  "name": "Lưu Tiến Đức",
  "hire_date": "2022-12-25",
  "dept": "Phòng XNK",
  "position": "Nhân viên nghiên cứu phát triển SP",
  "phone": "0936131370"
 },
 {
  "code": "HP022",
  "name": "Trần Thu Hường",
  "hire_date": "2020-12-01",
  "dept": "Bộ phận Kho",
  "position": "Phụ kho",
  "phone": "0904340963"
 },
 {
  "code": "HP023",
  "name": "Lưu Danh Nhân",
  "hire_date": "2002-01-01",
  "dept": "Bộ phận Kho",
  "position": "Vận chuyển",
  "phone": "0903429293"
 },
 {
  "code": "HP024",
  "name": "Trần Xuân Trường",
  "hire_date": "2015-05-01",
  "dept": "Bộ phận Kho",
  "position": "Vận chuyển",
  "phone": "0366522208"
 },
 {
  "code": "HP025",
  "name": "Lê Thu Hà",
  "hire_date": "2020-01-11",
  "dept": "Bộ phận Kho",
  "position": "Thủ kho",
  "phone": "0904333815"
 },
 {
  "code": "HP026",
  "name": "Phạm Phi Hùng",
  "hire_date": "2017-06-12",
  "dept": "Bộ phận Kho",
  "position": "Vận chuyển",
  "phone": "0944214298"
 },
 {
  "code": "TTS01",
  "name": "Đỗ Hoàng Ngân",
  "dept": "Phòng Marketing",
  "position": "Thực tập sinh",
  "phone": "0968499814"
 },
 {
  "code": "TTS02",
  "name": "Đinh Thị Kiều Oanh",
  "dept": "Phòng Dự án",
  "position": "Thực tập sinh",
  "phone": "0946774726"
 },
 {
  "code": "TTS03",
  "name": "Đào Quốc Khánh",
  "dept": "Phòng XNK",
  "position": "Thực tập sinh",
  "phone": "0981138254"
 },
 {
  "code": "TTS04",
  "name": "Lê Mai Linh",
  "dept": "Phòng Marketing",
  "position": "Thực tập sinh",
  "phone": "0862079826"
 },
 {
  "code": "TTS05",
  "name": "Lê Hà Thu",
  "dept": "Phòng kế toán",
  "position": "Thực tập sinh",
  "phone": "0946482418"
 }
];
const apply = process.argv.includes('--apply');
const s = createClient(process.env.SUPABASE_URL, process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const h = (x) => createHash('md5').update(x).digest('hex').slice(0, 10).toUpperCase();
const unitCache = new Map(), posCache = new Map();
async function unitOf(name) {
  if (unitCache.has(name)) return unitCache.get(name);
  let { data, error } = await s.from('organization_units').select('id').eq('name', name).maybeSingle();
  if (!data) ({ data, error } = await s.from('organization_units').insert({ code: 'DEPT-' + h(name), name, unit_type: 'department' }).select('id').single()); if (error) throw new Error('đơn vị '+name+': '+error.message);
  unitCache.set(name, data.id); return data.id;
}
async function posOf(title, unitId) {
  const k = unitId + title; if (posCache.has(k)) return posCache.get(k);
  let { data, error } = await s.from('job_positions').select('id').eq('title', title).eq('unit_id', unitId).maybeSingle();
  if (!data) ({ data, error } = await s.from('job_positions').insert({ code: 'POS-' + h(unitId + title), title, unit_id: unitId }).select('id').single()); if (error) throw new Error('chức vụ '+title+': '+error.message);
  posCache.set(k, data.id); return data.id;
}
for (const r of rows) {
  const email = r.phone + '@ppms.local';
  const { data: ex } = await s.from('profiles').select('id').eq('email', email).maybeSingle();
  if (!apply) { console.log(ex ? 'CÓ SẴN ' : 'TẠO    ', r.code, email, r.name); continue; }
  let id = ex?.id;
  if (!id) {
    const { data, error } = await s.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { name: r.name } });
    if (error && /already/i.test(error.message)) {
      for (let p = 1; !id && p <= 20; p++) {
        const { data: l } = await s.auth.admin.listUsers({ page: p, perPage: 200 });
        id = l?.users?.find((u) => u.email === email)?.id;
        if (!l?.users?.length) break;
      }
      if (id) await s.auth.admin.updateUserById(id, { password: PASSWORD });
    } else if (error) { console.log('LỖI', r.code, error.message); continue; } else id = data.user.id;
    if (!id) { console.log('LỖI', r.code, 'không tìm thấy tài khoản có sẵn'); continue; }
  }
  const unit_id = await unitOf(r.dept); const position_id = await posOf(r.position, unit_id);
  const { error } = await s.from('profiles').upsert({ id, email, name: r.name, role: 'staff', access_role_code: 'staff', department: r.dept, unit_id, position_id, employee_code: r.code, phone: r.phone, ...(r.hire_date ? { hire_date: r.hire_date } : {}), is_active: true, must_change_password: true });
  console.log(error ? 'LỖI ' + r.code + ' ' + error.message : 'OK  ' + r.code + ' ' + email);
}
