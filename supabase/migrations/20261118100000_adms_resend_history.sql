-- Yeu cau may ADMS day lai lich su cham cong tu mot ngay.
-- Admin dat resend_from; lan may hoi lenh ke tiep (getrequest) server nhan co mot lan
-- bang seri va tra lenh DATA QUERY ATTLOG. Du lieu may gui lai di qua duong ingest binh
-- thuong nen khong ghi trung (external_id chan san). Chay lai nhieu lan duoc.

alter table public.attendance_devices add column if not exists resend_from date;

create or replace function public.request_attendance_device_resend(target_device uuid, p_from date)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Chi Admin/CEO duoc yeu cau may day lai du lieu.' using errcode = '42501';
  end if;
  update public.attendance_devices set resend_from = p_from, updated_at = now()
  where id = target_device and is_active;
  if not found then
    raise exception 'May cham cong khong ton tai hoac da tat.' using errcode = '22023';
  end if;
end;
$$;

-- Server (service_role) nhan lenh: tra ngay bat dau roi xoa co trong CUNG mot cau lenh.
create or replace function public.claim_attendance_device_resend_by_serial(device_serial text)
returns date
language plpgsql security definer set search_path = public as $$
declare v_from date;
begin
  update public.attendance_devices d set resend_from = null
  from (select id, resend_from from public.attendance_devices
        where lower(serial_number) = lower(btrim(coalesce(device_serial, '')))
          and is_active and resend_from is not null for update) x
  where d.id = x.id
  returning x.resend_from into v_from;
  return v_from;
end;
$$;

revoke all on function public.request_attendance_device_resend(uuid, date) from public, anon;
grant execute on function public.request_attendance_device_resend(uuid, date) to authenticated, service_role;
revoke all on function public.claim_attendance_device_resend_by_serial(text) from public, anon, authenticated;
grant execute on function public.claim_attendance_device_resend_by_serial(text) to service_role;
