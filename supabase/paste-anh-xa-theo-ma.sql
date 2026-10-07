-- ============================================================================
-- Anh xa ma may cham cong -> nhan vien HRM theo MA, khong dung ten.
-- Dan ca file vao Supabase > SQL Editor. BAM Ctrl+A TRUOC KHI RUN.
-- ----------------------------------------------------------------------------
-- May chi gui so tran: "15", "17", "32". Ma "NV015" la cua phan mem Ronald Jack
-- Pro, luu trong RJData.mdb, thiet bi khong he biet den no.
--
-- Cau nay chap nhan CA HAI nep dat ma trong HRM:
--   - employee_code = '15'     (so tran)
--   - employee_code = 'NV015'  (so dem 3 chu so, co tien to NV)
--
-- Nho vay ban dat ma kieu nao cung khop, va doi nep sau nay cung khong hong.
-- Chi ghep cap CHAC CHAN: mot ma may ung voi dung mot nhan vien dang lam viec,
-- va nhan vien do cung chi duoc mot ma may tro toi. Mo ho thi bo qua va liet ke
-- o cau cuoi - doan bua la gan ngay cong cua nguoi nay sang nguoi khac.
--
-- Chay lai nhieu lan duoc.
-- ============================================================================

with may(ma) as (
  values
    ('1'),
    ('2'),
    ('3'),
    ('4'),
    ('5'),
    ('6'),
    ('7'),
    ('8'),
    ('9'),
    ('10'),
    ('11'),
    ('12'),
    ('13'),
    ('14'),
    ('15'),
    ('16'),
    ('17'),
    ('18'),
    ('19'),
    ('20'),
    ('21'),
    ('22'),
    ('23'),
    ('24'),
    ('25'),
    ('26'),
    ('27'),
    ('28'),
    ('29'),
    ('30'),
    ('31'),
    ('32'),
    ('33'),
    ('34'),
    ('35'),
    ('36'),
    ('37'),
    ('38'),
    ('39'),
    ('40'),
    ('41'),
    ('42'),
    ('43'),
    ('60'),
    ('101'),
    ('102')
),
thiet_bi as (
  select id from public.attendance_devices
  where lower(serial_number) = lower('1313245000324')
),
ghep as (
  select m.ma, p.id as profile_id
  from may m
  join public.profiles p
    on p.is_active
   and (
     lower(p.employee_code) = lower(m.ma)
     or lower(p.employee_code) = 'nv' || lpad(m.ma, 3, '0')
   )
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

-- Da ghep duoc nhung ai.
select m.device_user_id as ma_may, p.name as nhan_vien, p.employee_code as ma_hrm
from public.attendance_device_mappings m
join public.attendance_devices d on d.id = m.device_id
join public.profiles p on p.id = m.profile_id
where lower(d.serial_number) = lower('1313245000324')
order by length(m.device_user_id), m.device_user_id;

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
