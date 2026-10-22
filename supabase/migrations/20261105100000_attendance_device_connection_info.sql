-- Thong tin ket noi cua may cham cong, theo cac truong cua phan mem Ronald Jack Pro
-- (Ma may, ID may, IP, Port, Kieu ket noi, Trang thai may Vao/Ra, So dang ky...).
-- Chi de quan ly va doi chieu; bridge van doc IP/Comm Key tu file cau hinh cua no.

alter table public.attendance_devices
  add column if not exists device_code text,
  add column if not exists device_number integer,
  add column if not exists ip_address text,
  add column if not exists port integer not null default 4370,
  add column if not exists connection_type text not null default 'TCP',
  add column if not exists baud_rate integer not null default 115200,
  add column if not exists comm_password text,
  add column if not exists direction text not null default 'BOTH',
  add column if not exists use_web_address boolean not null default false,
  add column if not exists web_address text,
  add column if not exists registration_number text,
  add column if not exists license text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_devices_connection_type_check') then
    alter table public.attendance_devices
      add constraint attendance_devices_connection_type_check check (connection_type in ('TCP', 'UDP', 'SERIAL'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'attendance_devices_direction_check') then
    alter table public.attendance_devices
      add constraint attendance_devices_direction_check check (direction in ('IN', 'OUT', 'BOTH'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'attendance_devices_port_check') then
    alter table public.attendance_devices
      add constraint attendance_devices_port_check check (port between 1 and 65535);
  end if;
end $$;

create unique index if not exists attendance_devices_code_unique
  on public.attendance_devices(lower(device_code)) where device_code is not null;
