-- May ADMS khong con can token: may chi xung danh bang so seri tren URL, server
-- web (giu service role key) tra may theo seri roi ghi du lieu.
-- Hai ham duoi day CHI service_role goi duoc - khong cap cho anon/authenticated,
-- nen nguoi ngoai co anon key (khoa cong khai) van khong goi thang vao duoc.
-- Chay lai nhieu lan duoc.

-- ----------------------------------------------------------------------------
-- Ghi cac lan quet. Dung lai nguyen than ham da kiem chung
-- ingest_attendance_device_events_validated: tao mot token noi bo song 5 phut
-- cho may nay, goi ham do, roi xoa token ngay trong cung giao dich. Khong lam lai
-- phan anh xa ma nhan vien, chong trung, dung ngay cong.
-- ----------------------------------------------------------------------------
create or replace function public.ingest_attendance_device_events_by_serial(
  device_serial text,
  events jsonb
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_device uuid;
  v_plain text;
  v_hash text;
  v_result jsonb;
begin
  select d.id into v_device
  from public.attendance_devices d
  where lower(d.serial_number) = lower(btrim(coalesce(device_serial, '')))
    and d.is_active
  limit 1;
  if v_device is null then
    return jsonb_build_object('ok', false, 'code', 'UNKNOWN_DEVICE');
  end if;

  v_plain := 'adms_' || encode(gen_random_bytes(24), 'hex');
  v_hash := encode(digest(v_plain, 'sha256'), 'hex');
  insert into public.attendance_device_tokens(device_id, label, token_hash, expires_at)
  values (v_device, 'ADMS (noi bo, tu xoa)', v_hash, now() + interval '5 minutes');

  v_result := public.ingest_attendance_device_events_validated(v_plain, events);

  delete from public.attendance_device_tokens where token_hash = v_hash;
  return v_result || jsonb_build_object('ok', true);
end;
$$;

-- ----------------------------------------------------------------------------
-- Bao danh: may hoi lenh moi ~60 giay (getrequest).
-- ----------------------------------------------------------------------------
create or replace function public.touch_attendance_device_by_serial(device_serial text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_updated integer;
begin
  update public.attendance_devices
  set last_seen_at = now()
  where lower(serial_number) = lower(btrim(coalesce(device_serial, ''))) and is_active;
  get diagnostics v_updated = row_count;
  return jsonb_build_object('ok', v_updated > 0);
end;
$$;

revoke all on function public.ingest_attendance_device_events_by_serial(text, jsonb) from public, anon, authenticated;
revoke all on function public.touch_attendance_device_by_serial(text) from public, anon, authenticated;
grant execute on function public.ingest_attendance_device_events_by_serial(text, jsonb) to service_role;
grant execute on function public.touch_attendance_device_by_serial(text) to service_role;
