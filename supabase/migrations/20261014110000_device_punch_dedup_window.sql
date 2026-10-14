-- ============================================================================
-- BR-ATT-007: khu trung lap quet the trong 180 giay tren cung thiet bi.
-- ----------------------------------------------------------------------------
-- Truoc day chi co `unique(device_id, external_id)` - ma `external_id` la bam
-- cua (ma nhan vien | moc gio | trang thai | kieu xac thuc). Hai lan quet cach
-- nhau 30 giay co MOC GIO KHAC NHAU nen ra hai bam khac nhau, va ca hai cung
-- duoc luu.
--
-- Nguoi quet lai vi may khong keu, hoac quet nham roi quet lai, la chuyen hang
-- ngay. Dac ta M03 (F03.02, BR-ATT-007) yeu cau gop cac lan quet lien tiep
-- duoi 180 giay tren cung thiet bi thanh MOT.
--
-- Lam bang trigger chu khong sua ham dong bo: ham do dai va cung xu ly anh xa
-- nhan su, sinh ngay cong, dem so ban ghi. Chen them dieu kien vao giua no de
-- vo mot thu khong lien quan. Trigger chi lam dung mot viec va doc duoc rieng.
--
-- KHONG dung unique index: Postgres khong co index nao dien ta duoc "cach nhau
-- duoi N giay" - dieu kien phu thuoc vao gia tri cua dong KHAC.
--
-- Chay lai duoc nhieu lan.
-- ============================================================================

-- Dat o `app_settings` - bang mot dong dang giu gio chuan moi ngay va phep nam
-- mac dinh, tuc cac quy tac van hanh dung chung. Luu y KHONG co bang
-- `attendance_settings`; ten do chi la mot MA QUYEN.
alter table public.app_settings
  add column if not exists device_dedup_seconds integer not null default 180
    check (device_dedup_seconds >= 0);

comment on column public.app_settings.device_dedup_seconds is
  'BR-ATT-007: hai lan quet cua cung mot nguoi tren cung thiet bi cach nhau '
  'duoi so giay nay duoc coi la MOT. 0 = tat khu trung lap theo thoi gian.';

create or replace function public.skip_duplicate_device_punch()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_window integer;
begin
  select coalesce(max(device_dedup_seconds), 180) into v_window
  from public.app_settings;

  if v_window <= 0 then
    return new;
  end if;

  -- Da co lan quet nao cua CHINH nguoi do, tren CHINH may do, trong cua so
  -- nay chua. So sanh hai chieu vi ban ghi co the ve khong dung thu tu thoi
  -- gian (bridge nap bu sau khi mat mang).
  if exists (
    select 1
    from public.attendance_device_events e
    where e.device_id = new.device_id
      and e.device_user_id = new.device_user_id
      and e.id is distinct from new.id
      and abs(extract(epoch from (e.punched_at - new.punched_at))) < v_window
  ) then
    -- Tra NULL = bo qua dong nay, khong phai loi. Ham dong bo dem so dong da
    -- chen nen so lieu bao ve van dung, chi la it hon.
    return null;
  end if;

  return new;
end;
$fn$;

drop trigger if exists attendance_device_events_dedup on public.attendance_device_events;
create trigger attendance_device_events_dedup
before insert on public.attendance_device_events
for each row execute function public.skip_duplicate_device_punch();

-- Trigger goi mot truy van moi dong, nen can index dung cho dieu kien tren.
create index if not exists attendance_device_events_dedup_lookup
  on public.attendance_device_events(device_id, device_user_id, punched_at);
