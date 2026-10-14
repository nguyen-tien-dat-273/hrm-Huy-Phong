-- ============================================================================
-- BR-ATT-001, ve con thieu: don xin di muon khong duoc qua 09:00.
-- ----------------------------------------------------------------------------
-- Quy tac day du la "toi da 3 don muon/thang VA khong qua 09:00". Phan han muc
-- 3 don da co (trigger `guard_attendance_request_quota`, migration
-- 20260930110000), nhung ve gio thi chua ai chan: nhan vien xin muon 3 tieng
-- van gui duoc, va nguoi duyet khong co gi nhac.
--
-- Hai moc 09:00 trong dac ta an khop nhau: BR-ATT-001 chan don xin muon qua
-- 09:00, con BR-ATT-003 tru nua cong voi ai quet sau 09:00. Tuc 09:00 la ranh
-- gioi cung - qua do thi khong con la "di muon co phep" nua.
--
-- Gio den = gio vao ca CUA NGAY DO + so phut xin muon. Lay gio vao ca tu
-- `work_schedules` chu khong khoa cung 08:00, vi gio mua he va mua dong khac
-- nhau va cong ty con doi duoc lich.
--
-- Tach trigger rieng thay vi sua `guard_attendance_request_quota`: hai quy tac
-- khac nhau, thong bao loi khac nhau. Gop vao mot ham thi sua quy tac nay de
-- lam vo quy tac kia.
--
-- Chay lai duoc nhieu lan.
-- ============================================================================

alter table public.payroll_settings
  -- Gio muon nhat duoc phep xin, dang so phut tu nua dem. 540 = 09:00.
  -- NULL = khong chan theo gio, chi con han muc so don.
  add column if not exists late_request_cutoff_minutes integer
    check (late_request_cutoff_minutes is null
           or (late_request_cutoff_minutes between 0 and 1440));

update public.payroll_settings
   set late_request_cutoff_minutes = 540
 where late_request_cutoff_minutes is null;

comment on column public.payroll_settings.late_request_cutoff_minutes is
  'BR-ATT-001: gio den muon nhat ma don xin di muon duoc phep, tinh bang phut '
  'tu nua dem (540 = 09:00). NULL = khong chan theo gio.';

create or replace function public.guard_late_request_cutoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cutoff integer;
  v_start  time;
  v_arrive integer;
begin
  -- Chi xet don XIN DI MUON. Ve som va lam them khong lien quan toi moc nay.
  if new.request_type <> 'LATE_ARRIVAL' then
    return new;
  end if;

  -- Don bi tu choi hoac da huy thi khong can chan nua.
  if new.status in ('REJECTED', 'CANCELLED') then
    return new;
  end if;

  select max(late_request_cutoff_minutes) into v_cutoff from public.payroll_settings;
  if v_cutoff is null then
    return new;
  end if;

  -- Gio vao ca cua dung ngay xin muon. Khong khai lich thi lay 08:00.
  select s.start_time into v_start
  from public.work_schedules s
  where s.is_active
    and s.effective_from <= new.work_date
    and (s.effective_to is null or s.effective_to >= new.work_date)
  order by s.effective_from desc
  limit 1;

  v_arrive := extract(hour from coalesce(v_start, time '08:00')) * 60
            + extract(minute from coalesce(v_start, time '08:00'))
            + coalesce(new.minutes, 0);

  if v_arrive > v_cutoff then
    raise exception
      'Don xin di muon toi %:% vuot moc %:% cua quy che. Truong hop nay phai xin nghi phep hoac bo sung cong.',
      lpad((v_arrive / 60)::text, 2, '0'), lpad((v_arrive % 60)::text, 2, '0'),
      lpad((v_cutoff / 60)::text, 2, '0'), lpad((v_cutoff % 60)::text, 2, '0')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

drop trigger if exists attendance_requests_late_cutoff on public.attendance_requests;
create trigger attendance_requests_late_cutoff
before insert or update of status, work_date, request_type, minutes
on public.attendance_requests
for each row execute function public.guard_late_request_cutoff();
