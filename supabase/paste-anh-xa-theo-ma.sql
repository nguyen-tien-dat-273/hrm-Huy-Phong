-- ============================================================================
-- Anh xa ma may cham cong -> nhan vien HRM. So khop DUNG MAU, khong rut so.
-- Dan ca file vao Supabase > SQL Editor. BAM Ctrl+A TRUOC KHI RUN.
-- ----------------------------------------------------------------------------
-- May chi gui so tran: "1", "15", "60".
-- Trong HRM ma dat theo nep cua phan mem Ronald Jack: NV001, NV015, NV060.
--
-- Chap nhan dung hai dang, khong hon:
--
--     'NV' || lpad(<ma may>, 3, '0')     NV001  <- nep dang dung
--     <ma may> nguyen van                1      <- neu ai do dat so tran
--
-- KHONG rut phan so ra de so sanh. Cach do tung lam HP-000014 - ma he thong tu
-- cap, sinh tu 'HP-' || lpad(nextval('employee_code_seq'), 6, '0') - rut ra
-- thanh 14 va dung bang ma may 14 cua NGUOI KHAC. Hau qua: ma may 14 co hai
-- ung vien nen bi bo qua het, hoac te hon - neu nguoi that chua dat ma thi ngay
-- cong chay sang nguoi mang ma tu cap, khong loi nao hien ra.
--
-- Doi lai: ma khong dung mau thi KHONG khop, va hien o cau 2 kem ly do. Vi du
-- '00042' khong khop ma may 42; sua trong HRM thanh NV042 la xong.
--
-- Chi ghep cap CHAC CHAN: mot ma may ung voi dung MOT nhan vien dang lam viec,
-- va nhan vien do cung chi duoc MOT ma may tro toi.
--
-- Chay lai nhieu lan duoc.
-- ============================================================================

with thiet_bi as (
  select id from public.attendance_devices
  where lower(serial_number) = lower('1313245000324')
),
may(ma) as (
  select distinct e.device_user_id
  from public.attendance_device_events e
  join thiet_bi t on t.id = e.device_id
  where e.device_user_id ~ '^[0-9]+$'
),
ghep as (
  select m.ma, p.id as profile_id
  from may m
  join public.profiles p
    on p.is_active
   and p.employee_code is not null
   and (
     lower(p.employee_code) = 'nv' || lpad(m.ma, 3, '0')
     or p.employee_code = m.ma
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

-- ----------------------------------------------------------------------------
-- 1. Da ghep duoc nhung ai.
-- ----------------------------------------------------------------------------
select m.device_user_id as ma_may, p.employee_code as ma_hrm, p.name as nhan_vien
from public.attendance_device_mappings m
join public.attendance_devices d on d.id = m.device_id
join public.profiles p on p.id = m.profile_id
where lower(d.serial_number) = lower('1313245000324')
order by m.device_user_id::bigint;

-- ----------------------------------------------------------------------------
-- 2. Ma tren may van chua co chu, KEM LY DO.
--    ma_can_dat  = ma can dien vao HRM cho nguoi dung ma may do.
--    so_ung_vien = 0 thi chua ai mang ma do; > 1 thi co nguoi dat trung.
-- ----------------------------------------------------------------------------
with thiet_bi as (
  select id from public.attendance_devices
  where lower(serial_number) = lower('1313245000324')
),
chua_co_chu as (
  select e.device_user_id as ma,
         count(*) as so_lan_cham,
         max(e.punched_at) as lan_cuoi
  from public.attendance_device_events e
  join thiet_bi t on t.id = e.device_id
  left join public.attendance_device_mappings m
    on m.device_id = t.id and m.device_user_id = e.device_user_id
  where m.profile_id is null
  group by 1
)
select c.ma as ma_may,
       case when c.ma ~ '^[0-9]+$' then 'NV' || lpad(c.ma, 3, '0') end as ma_can_dat,
       c.so_lan_cham,
       c.lan_cuoi,
       count(p.id) as so_ung_vien,
       string_agg(p.employee_code || ' - ' || p.name, ' | ') as ung_vien
from chua_co_chu c
left join public.profiles p
  on p.is_active
 and p.employee_code is not null
 and c.ma ~ '^[0-9]+$'
 and (lower(p.employee_code) = 'nv' || lpad(c.ma, 3, '0') or p.employee_code = c.ma)
group by 1, 2, 3, 4
order by c.so_lan_cham desc;

-- ----------------------------------------------------------------------------
-- 3. Nhan vien trong HRM chua co ma may nao tro toi.
--    Ai khong dung may cham cong thi nam o day la binh thuong.
-- ----------------------------------------------------------------------------
select p.employee_code as ma_hrm, p.name as nhan_vien
from public.profiles p
where p.is_active
  and not exists (
    select 1 from public.attendance_device_mappings m where m.profile_id = p.id
  )
order by p.employee_code nulls last;
