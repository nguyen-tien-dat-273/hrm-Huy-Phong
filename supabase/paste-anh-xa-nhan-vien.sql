-- ============================================================================
-- Anh xa ma may cham cong -> nhan vien HRM, ghep theo TEN.
-- Dan ca file vao Supabase > SQL Editor, bam Ctrl+A roi Run.
-- ----------------------------------------------------------------------------
-- File THUAN ASCII: ten tieng Viet viet duoi dang U&'...' nen dan khong the
-- hong encoding; Postgres tu giai ma ve chu that.
--
-- Chi ghep cap NAO CHAC CHAN: mot ten tren may khop dung MOT nhan vien dang lam
-- viec, va nhan vien do cung chi duoc MOT ma may tro toi. Trung ten hay mo ho
-- thi BO QUA, va cau cuoi liet ke ra de nguoi dung tu quyet. Doan bua o day la
-- gan ngay cong cua nguoi nay sang nguoi khac, sai am tham den tan ky luong.
--
-- So sanh bo qua hoa thuong va gop khoang trang thua. KHONG bo dau tieng Viet:
-- "Dung" va "Dzung" la hai nguoi khac nhau, bo dau thi nhap mot.
--
-- Chay lai nhieu lan duoc.
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
thiet_bi as (
  select id from public.attendance_devices
  where lower(serial_number) = lower('1313245000324')
),
chuan as (
  select ma, ten, lower(btrim(regexp_replace(ten, '\s+', ' ', 'g'))) as khoa from may
),
nhan_su as (
  select id, name, lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) as khoa
  from public.profiles where is_active
),
ghep as (
  select c.ma, c.ten, n.id as profile_id, n.name as ten_hrm
  from chuan c join nhan_su n on n.khoa = c.khoa
),
chac_chan as (
  select g.* from ghep g
  where (select count(*) from ghep a where a.ma = g.ma) = 1
    and (select count(*) from ghep b where b.profile_id = g.profile_id) = 1
)
insert into public.attendance_device_mappings (device_id, device_user_id, profile_id)
select t.id, c.ma, c.profile_id
from chac_chan c cross join thiet_bi t
on conflict (device_id, device_user_id) do update
  set profile_id = excluded.profile_id;

-- Da anh xa duoc nhung ai.
select m.device_user_id as ma_may, p.name as nhan_vien, p.employee_code as ma_hrm
from public.attendance_device_mappings m
join public.attendance_devices d on d.id = m.device_id
join public.profiles p on p.id = m.profile_id
where lower(d.serial_number) = lower('1313245000324')
order by length(m.device_user_id), m.device_user_id;

-- Con ma nao chua co chu. Cot so_lan_cham cho biet nen uu tien lam ma nao truoc.
select e.device_user_id as ma_chua_anh_xa, count(*) as so_lan_cham,
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
