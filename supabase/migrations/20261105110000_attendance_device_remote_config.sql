-- Bridge lay thong tin ket noi (IP, Port, kieu ket noi, Comm Key, vao/ra) tu HRM
-- thay vi chi doc file .env tren may. Doi IP may cham cong chi can sua tren HRM.
-- Xac thuc bang chinh token bridge, giong claim_attendance_device_sync.
-- Chay lai nhieu lan duoc.

create or replace function public.get_attendance_device_config(bridge_token text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  token_row public.attendance_device_tokens%rowtype;
  device_row public.attendance_devices%rowtype;
begin
  if bridge_token is null or length(bridge_token) < 20 then
    perform public.record_attendance_device_auth_failure();
    return jsonb_build_object('ok', false, 'code', 'AUTH_FAILED');
  end if;

  select t.* into token_row
  from public.attendance_device_tokens t
  join public.attendance_devices d on d.id = t.device_id
  where t.token_hash = encode(digest(bridge_token, 'sha256'), 'hex')
    and t.revoked_at is null
    and (t.expires_at is null or t.expires_at > now())
    and d.is_active
  limit 1;
  if token_row.id is null then
    perform public.record_attendance_device_auth_failure();
    return jsonb_build_object('ok', false, 'code', 'AUTH_FAILED');
  end if;

  select * into device_row from public.attendance_devices where id = token_row.device_id;
  return jsonb_build_object(
    'ok', true,
    'name', device_row.name,
    'serial_number', device_row.serial_number,
    'ip_address', device_row.ip_address,
    'port', device_row.port,
    'connection_type', device_row.connection_type,
    'comm_password', device_row.comm_password,
    'direction', device_row.direction
  );
end;
$$;

revoke all on function public.get_attendance_device_config(text) from public;
grant execute on function public.get_attendance_device_config(text) to anon, authenticated;
