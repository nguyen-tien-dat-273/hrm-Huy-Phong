-- ============================================================================
-- Bam "Dong bo ngay" tu HRM, va cho HRM biet bridge con song hay khong.
-- ----------------------------------------------------------------------------
-- Van de: website chay tren Vercel, khong the voi toi 192.168.x.x cua may cham
-- cong. Muon dong bo thi phai mo terminal tren may trong LAN go lenh - khong ai
-- lam duoc viec do hang ngay.
--
-- Cach giai: dao chieu. HRM khong goi xuong may cham cong; no chi DAT MOT CO
-- (`sync_requested_at`). Bridge von da chay san trong LAN se hoi co do vai chuc
-- giay mot lan, thay co thi doc may ngay lap tuc. Nguoi dung thay nhu la bam
-- nut xong vai giay sau co du lieu.
--
-- Them `last_seen_at` duoc cap nhat moi lan bridge hoi: tu nay HRM phan biet
-- duoc "bridge chet" voi "bridge song nhung may cham cong tat" - truoc day hai
-- truong hop nay nhin giong het nhau tren man hinh.
--
-- Chay lai nhieu lan duoc.
-- ============================================================================

alter table public.attendance_devices
  add column if not exists sync_requested_at timestamptz;

comment on column public.attendance_devices.sync_requested_at is
  'Khac null = co nguoi bam "Dong bo ngay" va bridge chua nhan lenh. Bridge xoa ve null khi nhan.';

-- ----------------------------------------------------------------------------
-- HRM dat co. Chi Admin/CEO, dung chuan voi cac RPC khac cua phan he nay.
-- ----------------------------------------------------------------------------
create or replace function public.request_attendance_device_sync(target_device uuid)
returns timestamptz
language plpgsql security definer set search_path = public, extensions as $$
declare stamp timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Chi Admin/CEO duoc yeu cau dong bo.' using errcode = '42501';
  end if;

  update public.attendance_devices
  set sync_requested_at = now(), updated_at = now()
  where id = target_device and is_active
  returning sync_requested_at into stamp;

  if stamp is null then
    raise exception 'May cham cong khong ton tai hoac da tat.' using errcode = '22023';
  end if;
  return stamp;
end;
$$;

-- ----------------------------------------------------------------------------
-- Bridge hoi lenh. Xac thuc bang chinh token bridge, khong dung phien dang nhap.
-- ----------------------------------------------------------------------------
create or replace function public.claim_attendance_device_sync(bridge_token text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  token_row public.attendance_device_tokens%rowtype;
  claimed boolean;
begin
  if bridge_token is null or length(bridge_token) < 20 then
    raise exception 'Khoa bridge khong hop le.' using errcode = '28000';
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
    raise exception 'Khoa bridge sai, het han hoac da bi thu hoi.' using errcode = '28000';
  end if;

  -- Nhan lenh va xoa co trong CUNG mot cau lenh. Neu tach lam hai thi hai bridge
  -- chay song song se cung thay co va cung doc may mot luc - may chi phuc vu mot
  -- ket noi nen mot trong hai se bao mat ket noi.
  update public.attendance_devices
  set sync_requested_at = null, last_seen_at = now()
  where id = token_row.device_id and sync_requested_at is not null
  returning true into claimed;

  if claimed is null then
    claimed := false;
    -- Khong co lenh, nhung van phai ghi nhan bridge con song.
    update public.attendance_devices set last_seen_at = now()
    where id = token_row.device_id;
  end if;

  update public.attendance_device_tokens set last_used_at = now() where id = token_row.id;
  return jsonb_build_object('sync_requested', claimed);
end;
$$;

revoke all on function public.request_attendance_device_sync(uuid) from public;
revoke all on function public.claim_attendance_device_sync(text) from public;
grant execute on function public.request_attendance_device_sync(uuid) to authenticated;
grant execute on function public.claim_attendance_device_sync(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Cho Admin/CEO doc duoc lich su dong bo. Bang da co policy SELECT tu
-- 20260926100000; them o day la de chac chan khi chay tren database chua co.
-- ----------------------------------------------------------------------------
drop policy if exists attendance_device_sync_runs_admin on public.attendance_device_sync_runs;
create policy attendance_device_sync_runs_admin on public.attendance_device_sync_runs
  for select to authenticated using (public.is_admin());
