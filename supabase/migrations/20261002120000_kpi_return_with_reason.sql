-- Tra phieu KPI ve cho nhan vien KEM LY DO.
--
-- Trong user flow cua khach, nhanh "Khong dat" la: TU CHOI -> Nhap ly do ->
-- Tra ve nhan vien chinh sua / bo sung. He thong hien chi co
-- `reopen_kpi_self_scores` mo lai ban tu cham, khong mang theo mot chu nao.
--
-- Hau qua: nhan vien mo phieu ra thay no mo lai duoc, khong biet minh sai o
-- dau, sua gi. Vong lap "tra ve bo sung" dut ngay cho do - ho phai di hoi
-- mieng, va nguoi duyet phai nho minh da yeu cau gi.
--
-- Chay lai duoc nhieu lan.

alter table public.performance_reviews
  add column if not exists returned_at timestamptz,
  add column if not exists return_reason text;

comment on column public.performance_reviews.return_reason is
  'Ly do nguoi duyet tra phieu ve. Xoa khi nhan vien gui lai.';

-- Tra ve kem ly do.
--
-- Khong dung lai `reopen_kpi_self_scores`: ham do van giu nguyen cho truong
-- hop mo lai thuan tuy (go nham nut gui), con day la mot hanh vi nghiep vu
-- khac han va bat buoc phai co ly do.
create or replace function public.return_kpi_self_scores(p_review uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_reviewer uuid;
  v_user uuid;
  v_locked timestamptz;
  v_submitted timestamptz;
begin
  select r.reviewer_id, r.user_id, r.locked_at, r.self_submitted_at
    into v_reviewer, v_user, v_locked, v_submitted
  from public.performance_reviews r where r.id = p_review;

  if v_user is null then
    raise exception 'Khong tim thay phieu cham.';
  end if;

  if not public.can_function('admin.performance_manage') and auth.uid() is distinct from v_reviewer then
    raise exception 'Chi quan ly cham phieu nay moi tra ve duoc.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_locked is not null then
    raise exception 'Ky da khoa thi khong tra ve duoc.' using errcode = 'check_violation';
  end if;

  if v_submitted is null then
    raise exception 'Phieu nay nhan vien chua gui duyet.' using errcode = 'check_violation';
  end if;

  -- Ly do la bat buoc. Tra ve khong noi ly do thi nhan vien van khong biet
  -- sua gi - dung bang luc chua co tinh nang nay.
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Phai nhap ly do tra ve.' using errcode = 'check_violation';
  end if;

  update public.performance_reviews
     set self_submitted_at = null,
         returned_at = now(),
         return_reason = trim(p_reason),
         updated_at = now()
   where id = p_review;
end;
$fn$;

revoke all on function public.return_kpi_self_scores(uuid, text) from public;
grant execute on function public.return_kpi_self_scores(uuid, text) to authenticated;

-- Gui lai thi don ly do cu di.
--
-- Giu lai se thanh mot loi canh bao doi cho mot lan tra ve da xu ly xong, con
-- nam do mai tren phieu cua nhan vien.
--
-- Phan con lai GIU NGUYEN ban goc tung chu: van tra ve timestamptz vi
-- frontend doc gia tri do, van tra lai moc cu neu da gui (goi hai lan khong
-- sinh ra hai lan gui), va van dem tieu chi thieu bang cach join sang
-- kpi_template_criteria is_active.
create or replace function public.submit_kpi_self_scores(p_review uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user uuid;
  v_locked timestamptz;
  v_submitted timestamptz;
  v_missing integer;
begin
  select r.user_id, r.locked_at, r.self_submitted_at
    into v_user, v_locked, v_submitted
  from public.performance_reviews r
  where r.id = p_review;

  if v_user is null then
    raise exception 'Khong tim thay phieu cham.';
  end if;
  if auth.uid() <> v_user then
    raise exception 'Chi nguoi duoc cham moi gui duoc ban tu cham.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_locked is not null then
    raise exception 'Ky nay da khoa, khong gui duoc nua.'
      using errcode = 'check_violation';
  end if;
  if v_submitted is not null then
    return v_submitted;
  end if;

  -- Cham thieu thi khong cho gui: mot ban tu cham bo trong mot nua khien
  -- quan ly khong biet la nhan vien danh gia thap hay quen cham.
  select count(*) into v_missing
  from public.performance_review_scores s
  join public.kpi_template_criteria c on c.id = s.criteria_id and c.is_active
  where s.review_id = p_review and s.self_score is null;

  if v_missing > 0 then
    raise exception 'Con % tieu chi chua tu cham. Cham du roi hay gui.', v_missing
      using errcode = 'check_violation';
  end if;

  update public.performance_reviews
     set self_submitted_at = now(),
         returned_at = null,
         return_reason = null,
         updated_at = now()
   where id = p_review
   returning self_submitted_at into v_submitted;

  return v_submitted;
end;
$fn$;

revoke all on function public.submit_kpi_self_scores(uuid) from public;
grant execute on function public.submit_kpi_self_scores(uuid) to authenticated;
