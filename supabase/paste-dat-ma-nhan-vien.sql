-- ============================================================================
-- Dat employee_code trong HRM BANG dung ma tren may cham cong.
-- Dan ca file vao Supabase > SQL Editor, bam Ctrl+A roi Run.
-- ----------------------------------------------------------------------------
-- Vi sao phai muon TEN de ghep: hai ben hien khong co ma nao trung nhau. May
-- dung so thu tu 1..60, HRM dung ma kieu BUITHINHANHUE. Ghep thang ma voi ma
-- thi ra 0 cap. Nen buoc nay dung ten mot lan de DAT lai ma; xong roi thi ham
-- nap su kien tu khop mai mai bang chinh employee_code:
--
--   left join public.profiles p
--     on lower(p.employee_code) = lower(pending.device_user_id) and p.is_active
--
-- Khong can bang anh xa nua.
--
-- File THUAN ASCII: ten tieng Viet viet duoi dang U&'...' nen dan khong the
-- hong encoding; Postgres tu giai ma ve chu that.
--
-- CANH BAO: cau nay GHI DE ma nhan vien cu. employee_code con duoc dung o cho
-- khac - nhap nhan su tu Excel khop theo cot "Ma nhan vien", va bang cong thang
-- xuat ra cung co cot do. Doi ma la nhung cho ay doi theo.
--
-- An toan:
--   - Chi doi nguoi NAO CHAC CHAN: mot ten tren may khop dung MOT nhan vien
--     dang lam viec, va nhan vien do cung chi khop dung MOT ma may. Trung ten
--     thi bo qua va liet ke o cau cuoi.
--   - Bo qua neu ma do da thuoc ve nguoi khac (co unique index tren
--     lower(employee_code)), tranh lam hong ca cau lenh vi mot dong.
--   - So sanh ten bo qua hoa thuong va gop khoang trang thua, NHUNG khong bo
--     dau: "Dung" va "Dzung" la hai nguoi khac nhau.
--   - Chay lai nhieu lan duoc.
-- ============================================================================

with may(ma, ten) as (
  values
    (U&'1', U&'L\01b0u V\0169 Phong'),
    (U&'6', U&'C\00f9 L\1ec7 Minh'),
    (U&'21', U&'Nguy\1ec5n Tu\1ea5n \0110\1ea1t'),
    (U&'22', U&'Nguy\1ec5n B\00e1 Hi\1ec7p'),
    (U&'5', U&'Ph\1ea1m T Th\00f9y D\01b0\01a1ng'),
    (U&'8', U&'Nguy\1ec5n Ng\1ecdc Anh'),
    (U&'4', U&'L\01b0u Th\1ecb V\01b0\1ee3ng'),
    (U&'9', U&'L\00ea Di\1ec7u Linh'),
    (U&'11', U&'V\0169 Th\1ecb H\00f2a'),
    (U&'12', U&'Tr\1ea7n Vi\1ec7t \0110\1ee9c'),
    (U&'13', U&'V\0169 Th\1ecb Thanh Th\00fay'),
    (U&'14', U&'L\01b0\01a1ng Xu\00e2n T\00f9ng'),
    (U&'15', U&'Nguy\1ec5n Minh T\1ea3o'),
    (U&'16', U&'Tr\1ea7n Th\1ecb Thu Th\1ea3o'),
    (U&'17', U&'H\1ed3 Linh Chi'),
    (U&'18', U&'Nguy\1ec5n Hu\1ef3nh \0110\1ee9c'),
    (U&'19', U&'Nguy\1ec5n B\00e1 Tr\1ecdng'),
    (U&'20', U&'\0110\00e0o Minh Chi\1ebfn'),
    (U&'23', U&'Nguy\1ec5n Mai Anh'),
    (U&'25', U&'Nguy\1ec5n \0110\1ee9c Minh'),
    (U&'26', U&'L\01b0u Ti\1ebfn \0110\1ee9c'),
    (U&'24', U&'Ph\1ea1m Phi H\00f9ng'),
    (U&'7', U&'Nguy\1ec5n Th\1ecb M\00f9i'),
    (U&'2', U&'B\00f9i Th\1ecb Nh\00e2n Hu\1ec7'),
    (U&'3', U&'\0110\00e0m Minh Ngh\0129a'),
    (U&'10', U&'H\00e0 Th\1ecb Thu Trang'),
    (U&'27', U&'Xu\00e2n'),
    (U&'36', U&'Trung'),
    (U&'35', U&'Tr\1ea7n Th\1ebf Linh'),
    (U&'34', U&'Nguy\1ec5n Th\1ecb Kim Dung'),
    (U&'37', U&'Nguy\1ec5n Th\1ecb Nh\01b0 Hoa')
),
chuan as (
  select ma, ten, lower(btrim(regexp_replace(ten, '\s+', ' ', 'g'))) as khoa from may
),
nhan_su as (
  select id, name, employee_code,
         lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) as khoa
  from public.profiles where is_active
),
ghep as (
  select c.ma, c.ten, n.id, n.name, n.employee_code as ma_cu
  from chuan c join nhan_su n on n.khoa = c.khoa
),
chac_chan as (
  select g.* from ghep g
  where (select count(*) from ghep a where a.ma = g.ma) = 1
    and (select count(*) from ghep b where b.id = g.id) = 1
)
update public.profiles p
set employee_code = c.ma
from chac_chan c
where p.id = c.id
  and lower(coalesce(p.employee_code, '')) is distinct from lower(c.ma)
  and not exists (
    select 1 from public.profiles q
    where q.id <> p.id and lower(q.employee_code) = lower(c.ma)
  );

-- Ai dang mang ma trung voi may (ke ca nguoi da dat tu truoc).
select p.employee_code as ma, p.name as nhan_vien
from public.profiles p
where p.is_active and p.employee_code ~ '^[0-9]+$'
order by length(p.employee_code), p.employee_code;

-- Ma nao tren may van chua co chu. so_lan_cham cho biet nen uu tien ma nao.
select e.device_user_id as ma_chua_co_chu, count(*) as so_lan_cham,
       min(e.punched_at) as lan_dau, max(e.punched_at) as lan_cuoi
from public.attendance_device_events e
join public.attendance_devices d on d.id = e.device_id
left join public.attendance_device_mappings m
  on m.device_id = d.id and m.device_user_id = e.device_user_id
left join public.profiles p
  on lower(p.employee_code) = lower(e.device_user_id) and p.is_active
where lower(d.serial_number) = lower('1313245000324')
  and m.profile_id is null and p.id is null
group by 1
order by 2 desc;
