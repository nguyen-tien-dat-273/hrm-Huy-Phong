-- ============================================================================
-- M06 · F06.04 — Tính toán, Điều chỉnh, Khoá kỳ & Phát hành phiếu lương.
-- ----------------------------------------------------------------------------
-- Vòng đời kỳ lương theo đặc tả:
--
--   DRAFT -> CALCULATED      KTT chạy bảng lương nháp (FR06.04.01), tính lại
--                            bao nhiêu lần cũng được.
--   CALCULATED -> LOCKED     KTT khoá kỳ bằng mã 2FA (FR06.04.03). Từ đây dữ
--                            liệu đóng băng và bảng lương tự TRÌNH Ban Giám đốc.
--   LOCKED -> APPROVED       BGĐ ký duyệt chi trả (FR06.04.04, BR-PAY-010).
--   LOCKED -> CALCULATED     BGĐ từ chối (bắt buộc lý do) hoặc KTT rút lại —
--                            trả về để điều chỉnh.
--   APPROVED -> PAID         KTT xác nhận đã chuyển khoản. Phiếu lương PHÁT
--                            HÀNH cho nhân viên ngay lúc này (FR06.04.05).
--
-- Bỏ đường "mở lại kỳ" sau khi đã duyệt: hậu điều kiện F06.04 ghi dữ liệu kỳ
-- đó "lưu trữ cố định, không thể can thiệp sửa đổi". Sai sót phát hiện sau đó
-- xử lý bằng Điều chỉnh lương ở kỳ sau.
--
-- Mọi chuyển trạng thái chỉ đi qua RPC dưới đây. Trigger chặn sửa thẳng cột
-- trạng thái, nên bấm nút hay gọi API cũng phải đi cùng một cửa kiểm tra.
--
-- BR-PAY-009: kỳ lương đã khoá thì kỳ công (M03), phiếu KPI (M05), số liệu
-- tháng và điều chỉnh của tháng đó bị khoá cứng ở database.
--
-- Chạy lại được nhiều lần.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Trạng thái và cột mới của kỳ lương
-- ---------------------------------------------------------------------------
alter table public.payroll_runs drop constraint if exists payroll_runs_status_check;
alter table public.payroll_runs
  add constraint payroll_runs_status_check
  check (status in ('DRAFT', 'CALCULATED', 'LOCKED', 'APPROVED', 'PAID'));

alter table public.payroll_runs
  add column if not exists calculated_by uuid references public.profiles(id) on delete set null,
  add column if not exists locked_by uuid references public.profiles(id) on delete set null,
  add column if not exists locked_at timestamptz,
  -- SHA-256 toàn bộ phiếu lúc khoá. BGĐ duyệt đúng bộ số đã khoá, không phải
  -- bộ số ai đó sửa sau lúc khoá.
  add column if not exists lock_fingerprint text,
  add column if not exists approval_fingerprint text,
  add column if not exists review_note text,
  add column if not exists paid_by uuid references public.profiles(id) on delete set null,
  add column if not exists published_at timestamptz;

-- Kỳ đã trả trước khi có bước phát hành: nhân viên vốn đang xem được phiếu.
update public.payroll_runs
set published_at = coalesce(paid_at, updated_at)
where status = 'PAID' and published_at is null;

alter table public.payslips
  add column if not exists rounding_adjustment numeric(15, 2) not null default 0;

comment on column public.payslips.rounding_adjustment is
  'Chênh lệch do làm tròn thực lĩnh (FR06.04.01). net_pay đã gồm phần này.';

-- Tháng này đã khoá lương chưa (khoá trở đi).
create or replace function public.payroll_month_closed(p_month date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.payroll_runs r
    where r.month_start = date_trunc('month', p_month)::date
      and r.status in ('LOCKED', 'APPROVED', 'PAID')
  );
$$;

revoke all on function public.payroll_month_closed(date) from public;
grant execute on function public.payroll_month_closed(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Chỉ RPC mới được chuyển trạng thái
-- ---------------------------------------------------------------------------
create or replace function public.guard_payroll_run_status()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  v_allowed boolean := coalesce(current_setting('app.payroll_run_transition', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if not v_allowed and new.status <> 'DRAFT' then
      raise exception 'Kỳ lương mới phải bắt đầu ở trạng thái Bản nháp.' using errcode = '23514';
    end if;
    return new;
  end if;

  if not v_allowed and (
    new.status is distinct from old.status
    or new.locked_by is distinct from old.locked_by or new.locked_at is distinct from old.locked_at
    or new.lock_fingerprint is distinct from old.lock_fingerprint
    or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at
    or new.approval_fingerprint is distinct from old.approval_fingerprint
    or new.paid_by is distinct from old.paid_by or new.paid_at is distinct from old.paid_at
    or new.published_at is distinct from old.published_at
    or new.calculated_at is distinct from old.calculated_at
    or new.review_note is distinct from old.review_note
  ) then
    raise exception 'Trạng thái kỳ lương chỉ đổi qua đúng thao tác (Tính lương, Khoá kỳ, Duyệt, Chi trả).'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status and not (
    (old.status = 'DRAFT' and new.status = 'CALCULATED')
    or (old.status = 'CALCULATED' and new.status = 'LOCKED')
    or (old.status = 'LOCKED' and new.status in ('APPROVED', 'CALCULATED'))
    or (old.status = 'APPROVED' and new.status = 'PAID')
  ) then
    raise exception 'Chuyển trạng thái kỳ lương không hợp lệ (% -> %).', old.status, new.status
      using errcode = '23514';
  end if;

  if new.status in ('LOCKED', 'APPROVED') and new.status is distinct from old.status and not exists (
    select 1 from public.timesheet_periods p
    where p.month_start = new.month_start and p.status = 'LOCKED'
  ) then
    raise exception 'Chưa khoá kỳ công tháng % (M03) — không khoá / duyệt được bảng lương.',
      to_char(new.month_start, 'MM/YYYY') using errcode = '23514';
  end if;

  return new;
end;
$fn$;

drop trigger if exists payroll_runs_status_guard on public.payroll_runs;
create trigger payroll_runs_status_guard
before insert or update on public.payroll_runs
for each row execute function public.guard_payroll_run_status();

-- Phiếu bất biến từ lúc KHOÁ (trước đây từ lúc duyệt).
create or replace function public.guard_payslip_immutable()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  run_status text;
  target_run uuid;
  slip_id uuid;
begin
  if tg_table_name = 'payslips' then
    if tg_op = 'DELETE' then target_run := old.run_id; else target_run := new.run_id; end if;
  else
    if tg_op = 'DELETE' then slip_id := old.payslip_id; else slip_id := new.payslip_id; end if;
    select p.run_id into target_run from public.payslips p where p.id = slip_id;
  end if;

  select r.status into run_status from public.payroll_runs r where r.id = target_run;

  if run_status in ('LOCKED', 'APPROVED', 'PAID') then
    raise exception 'Kỳ lương đã khoá — phiếu lương không sửa được.' using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$fn$;

-- Dấu vân tay của toàn bộ phiếu trong kỳ: người, các con số tổng và từng dòng.
create or replace function public.payroll_run_fingerprint(p_run_id uuid)
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
  select encode(digest(coalesce(string_agg(slip_text, '#' order by user_id), ''), 'sha256'), 'hex')
  from (
    select s.user_id,
      concat_ws('|', s.user_id, s.gross_pay, s.insurance_employee, s.personal_income_tax,
        s.other_deductions, s.rounding_adjustment, s.net_pay,
        (select string_agg(concat_ws(':', l.sequence, l.code, l.amount), ',' order by l.sequence)
         from public.payslip_lines l where l.payslip_id = s.id)) as slip_text
    from public.payslips s
    where s.run_id = p_run_id
  ) x;
$$;

revoke all on function public.payroll_run_fingerprint(uuid) from public;
grant execute on function public.payroll_run_fingerprint(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Chạy bảng lương nháp (FR06.04.01) — ghi phiếu và chuyển CALCULATED
-- ---------------------------------------------------------------------------
create or replace function public.persist_payroll_payslips(
  target_run_id uuid,
  payslip_entries jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  payroll_run public.payroll_runs%rowtype;
  entry jsonb;
  line jsonb;
  payslip_id uuid;
  seen_users uuid[] := '{}';
  employee_id uuid;
  v_total numeric := 0;
begin
  if auth.uid() is null or not public.can_function('admin.payroll') then
    raise exception 'Bạn không có quyền ghi bảng lương.' using errcode = '42501';
  end if;
  if payslip_entries is null or jsonb_typeof(payslip_entries) <> 'array' then
    raise exception 'Danh sách phiếu lương không hợp lệ.' using errcode = '22023';
  end if;
  if jsonb_array_length(payslip_entries) > 10000 then
    raise exception 'Mỗi lần chỉ được ghi tối đa 10000 phiếu lương.' using errcode = '54000';
  end if;

  select * into payroll_run from public.payroll_runs where id = target_run_id for update;
  if payroll_run.id is null then
    raise exception 'Không tìm thấy kỳ lương.' using errcode = 'P0002';
  end if;
  if payroll_run.status not in ('DRAFT', 'CALCULATED') then
    raise exception 'Kỳ lương đã khoá — không tính lại được. Sai sót xử lý bằng Điều chỉnh lương kỳ sau.'
      using errcode = '23514';
  end if;

  for entry in select value from jsonb_array_elements(payslip_entries)
  loop
    employee_id := nullif(entry->>'user_id', '')::uuid;
    if employee_id is null or employee_id = any(seen_users) then
      raise exception 'Phiếu lương thiếu nhân viên hoặc có nhân viên trùng.' using errcode = '22023';
    end if;
    seen_users := array_append(seen_users, employee_id);
  end loop;

  delete from public.payslips where run_id = target_run_id;

  for entry in select value from jsonb_array_elements(payslip_entries)
  loop
    insert into public.payslips (
      run_id, user_id, employee_name, employee_code, department, pay_basis,
      work_days, leave_days, paid_days, standard_days, work_hours, gross_pay,
      taxable_income, insurance_employee, insurance_employer, personal_income_tax,
      other_deductions, rounding_adjustment, net_pay, snapshot
    ) values (
      target_run_id,
      (entry->>'user_id')::uuid,
      coalesce(entry->>'employee_name', ''),
      nullif(entry->>'employee_code', ''),
      nullif(entry->>'department', ''),
      entry->>'pay_basis',
      coalesce((entry->>'work_days')::numeric, 0),
      coalesce((entry->>'leave_days')::numeric, 0),
      coalesce((entry->>'paid_days')::numeric, 0),
      coalesce((entry->>'standard_days')::numeric, 0),
      coalesce((entry->>'work_hours')::numeric, 0),
      coalesce((entry->>'gross_pay')::numeric, 0),
      coalesce((entry->>'taxable_income')::numeric, 0),
      coalesce((entry->>'insurance_employee')::numeric, 0),
      coalesce((entry->>'insurance_employer')::numeric, 0),
      coalesce((entry->>'personal_income_tax')::numeric, 0),
      coalesce((entry->>'other_deductions')::numeric, 0),
      coalesce((entry->>'rounding_adjustment')::numeric, 0),
      coalesce((entry->>'net_pay')::numeric, 0),
      coalesce(entry->'snapshot', '{}'::jsonb)
    )
    returning id into payslip_id;

    v_total := v_total + coalesce((entry->>'net_pay')::numeric, 0);

    for line in select value from jsonb_array_elements(coalesce(entry->'lines', '[]'::jsonb))
    loop
      insert into public.payslip_lines (
        payslip_id, sequence, code, name, kind, quantity, rate, amount, taxable, insurable, detail
      ) values (
        payslip_id,
        coalesce((line->>'sequence')::integer, 0),
        coalesce(line->>'code', ''),
        coalesce(line->>'name', ''),
        line->>'kind',
        nullif(line->>'quantity', '')::numeric,
        nullif(line->>'rate', '')::numeric,
        coalesce((line->>'amount')::numeric, 0),
        coalesce((line->>'taxable')::boolean, true),
        coalesce((line->>'insurable')::boolean, false),
        nullif(line->>'detail', '')
      );
    end loop;
  end loop;

  perform set_config('app.payroll_run_transition', 'on', true);
  update public.payroll_runs
  set status = 'CALCULATED', calculated_at = now(), calculated_by = auth.uid(), review_note = null
  where id = target_run_id;
  perform set_config('app.payroll_run_transition', 'off', true);

  perform public.add_payroll_approval_event('RUN', target_run_id, 'CALCULATED', null,
    jsonb_build_object('payslips', jsonb_array_length(payslip_entries), 'net_total', v_total));
end;
$$;

revoke all on function public.persist_payroll_payslips(uuid, jsonb) from public;
grant execute on function public.persist_payroll_payslips(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Khoá kỳ bằng 2FA (FR06.04.03)
-- ---------------------------------------------------------------------------
-- Yếu tố thứ hai là mã TOTP (ứng dụng xác thực) do Supabase Auth kiểm. Sau khi
-- nhập đúng mã, JWT lên mức `aal2` và `amr` có mốc `totp` mới. Hàm đòi CẢ HAI,
-- và mốc TOTP phải trong 5 phút gần nhất: khoá kỳ là một hành động, không phải
-- trạng thái của phiên — nhập mã sáng nay không đủ để khoá chiều nay.
create or replace function public.lock_payroll_run(p_run_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.payroll_runs%rowtype;
  v_open_reviews integer;
  v_slips integer;
  v_fingerprint text;
begin
  if auth.uid() is null or not public.can_function('admin.payroll') then
    raise exception 'Bạn không có quyền khoá kỳ lương.' using errcode = '42501';
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' or not public.payroll_recent_auth(5, array['totp']) then
    raise exception 'Mã xác thực 2FA chưa hợp lệ hoặc đã quá 5 phút — nhập lại mã OTP để khoá kỳ.'
      using errcode = '28000';
  end if;

  select * into v_run from public.payroll_runs where id = p_run_id for update;
  if v_run.id is null then
    raise exception 'Không tìm thấy kỳ lương.' using errcode = 'P0002';
  end if;
  if v_run.status <> 'CALCULATED' then
    raise exception 'Chỉ khoá được kỳ đã tính lương (đang: %).', v_run.status using errcode = '23514';
  end if;

  -- BR-PAY-001 (module): lương biến đổi phải căn cứ dữ liệu ĐÃ KHOÁ của M03 và M05.
  if not exists (
    select 1 from public.timesheet_periods p
    where p.month_start = v_run.month_start and p.status = 'LOCKED'
  ) then
    raise exception 'Chưa khoá kỳ công tháng % (M03).', to_char(v_run.month_start, 'MM/YYYY') using errcode = '23514';
  end if;
  if to_regclass('public.performance_reviews') is not null then
    execute 'select count(*) from public.performance_reviews where period_month = $1 and locked_at is null'
      into v_open_reviews using v_run.month_start;
    if v_open_reviews > 0 then
      raise exception 'Còn % phiếu KPI tháng % chưa khoá (M05) — khoá KPI trước khi khoá lương.',
        v_open_reviews, to_char(v_run.month_start, 'MM/YYYY') using errcode = '23514';
    end if;
  end if;

  select count(*) into v_slips from public.payslips where run_id = p_run_id;
  if v_slips = 0 then
    raise exception 'Kỳ lương chưa có phiếu nào — tính lương trước.' using errcode = '23514';
  end if;

  v_fingerprint := public.payroll_run_fingerprint(p_run_id);

  perform set_config('app.payroll_run_transition', 'on', true);
  update public.payroll_runs
  set status = 'LOCKED', locked_by = auth.uid(), locked_at = now(), lock_fingerprint = v_fingerprint,
      review_note = null
  where id = p_run_id;
  perform set_config('app.payroll_run_transition', 'off', true);

  perform public.add_payroll_approval_event('RUN', p_run_id, 'LOCKED', null,
    jsonb_build_object('fingerprint', v_fingerprint, 'payslips', v_slips));
  perform public.write_payroll_audit(
    'salary.run_lock', 'payroll_run', p_run_id::text,
    format('Khoá kỳ lương %s (2FA) và trình Ban Giám đốc', to_char(v_run.month_start, 'MM/YYYY')),
    jsonb_build_object('fingerprint', v_fingerprint, 'payslips', v_slips)
  );
  return v_fingerprint;
end;
$$;

revoke all on function public.lock_payroll_run(uuid) from public;
grant execute on function public.lock_payroll_run(uuid) to authenticated;

-- Danh sách kiểm tra trước khi khoá, cho màn Bảng lương hiện từng điều kiện.
-- Cần hàm riêng: KTT thường không có quyền đọc phiếu KPI để tự đếm.
create or replace function public.payroll_lock_readiness(p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_open_reviews integer := 0;
begin
  if auth.uid() is null or not (public.can_function('admin.payroll') or public.can_function('admin.payroll_approve')) then
    raise exception 'Bạn không có quyền với kỳ lương.' using errcode = '42501';
  end if;
  if to_regclass('public.performance_reviews') is not null then
    execute 'select count(*) from public.performance_reviews where period_month = $1 and locked_at is null'
      into v_open_reviews using v_month;
  end if;
  return jsonb_build_object(
    'timesheet_locked', exists (
      select 1 from public.timesheet_periods p where p.month_start = v_month and p.status = 'LOCKED'
    ),
    'open_kpi_reviews', v_open_reviews,
    'last_closed_month', public.payroll_last_closed_month()
  );
end;
$$;

revoke all on function public.payroll_lock_readiness(date) from public;
grant execute on function public.payroll_lock_readiness(date) to authenticated;

-- KTT rút lại khi BGĐ chưa xử lý (ví dụ phát hiện sai ngay sau khi khoá).
create or replace function public.withdraw_payroll_run(p_run_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.payroll_runs%rowtype;
begin
  if auth.uid() is null or not public.can_function('admin.payroll') then
    raise exception 'Bạn không có quyền với kỳ lương.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Rút lại phải ghi lý do.' using errcode = '23514';
  end if;
  select * into v_run from public.payroll_runs where id = p_run_id for update;
  if v_run.status is distinct from 'LOCKED' then
    raise exception 'Chỉ rút lại được kỳ đang chờ Ban Giám đốc duyệt.' using errcode = '23514';
  end if;

  perform set_config('app.payroll_run_transition', 'on', true);
  update public.payroll_runs
  set status = 'CALCULATED', locked_by = null, locked_at = null, lock_fingerprint = null,
      review_note = 'Rút lại: ' || trim(p_reason)
  where id = p_run_id;
  perform set_config('app.payroll_run_transition', 'off', true);

  perform public.add_payroll_approval_event('RUN', p_run_id, 'WITHDRAWN', p_reason, null);
  perform public.write_payroll_audit('salary.run_withdraw', 'payroll_run', p_run_id::text,
    format('Rút lại kỳ lương %s: %s', to_char(v_run.month_start, 'MM/YYYY'), trim(p_reason)), null);
end;
$$;

revoke all on function public.withdraw_payroll_run(uuid, text) from public;
grant execute on function public.withdraw_payroll_run(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. BGĐ ký duyệt / từ chối chi trả (FR06.04.04, BR-PAY-010)
-- ---------------------------------------------------------------------------
create or replace function public.review_payroll_run(p_run_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.payroll_runs%rowtype;
  v_current text;
begin
  if auth.uid() is null or not public.can_function('admin.payroll_approve') then
    raise exception 'Chỉ Ban Giám đốc (chức năng Phê duyệt lương) được duyệt chi lương.' using errcode = '42501';
  end if;
  if p_decision not in ('APPROVED', 'REJECTED') then
    raise exception 'Quyết định không hợp lệ.' using errcode = '22023';
  end if;
  if not public.payroll_recent_auth(5, array['password', 'totp']) then
    raise exception 'Cần nhập lại mật khẩu để ký duyệt.' using errcode = '28000';
  end if;

  select * into v_run from public.payroll_runs where id = p_run_id for update;
  if v_run.id is null then
    raise exception 'Không tìm thấy kỳ lương.' using errcode = 'P0002';
  end if;
  if v_run.status <> 'LOCKED' then
    raise exception 'Kỳ lương không ở trạng thái chờ duyệt.' using errcode = '23514';
  end if;
  if v_run.locked_by = auth.uid() and not public.is_admin() then
    raise exception 'Người khoá kỳ không tự duyệt chi.' using errcode = '42501';
  end if;

  v_current := public.payroll_run_fingerprint(p_run_id);
  if v_current is distinct from v_run.lock_fingerprint then
    raise exception 'Số liệu phiếu lương đã khác lúc khoá — trả kỳ về cho Kế toán kiểm tra.' using errcode = '23514';
  end if;

  perform set_config('app.payroll_run_transition', 'on', true);
  if p_decision = 'APPROVED' then
    update public.payroll_runs
    set status = 'APPROVED', approved_by = auth.uid(), approved_at = now(),
        approval_fingerprint = v_current, review_note = nullif(trim(coalesce(p_note, '')), '')
    where id = p_run_id;
  else
    if length(trim(coalesce(p_note, ''))) < 3 then
      raise exception 'Từ chối phải ghi rõ lý do.' using errcode = '23514';
    end if;
    update public.payroll_runs
    set status = 'CALCULATED', locked_by = null, locked_at = null, lock_fingerprint = null,
        review_note = trim(p_note)
    where id = p_run_id;
  end if;
  perform set_config('app.payroll_run_transition', 'off', true);

  perform public.add_payroll_approval_event('RUN', p_run_id, p_decision, p_note,
    jsonb_build_object('fingerprint', v_current));
  perform public.write_payroll_audit(
    case when p_decision = 'APPROVED' then 'salary.run_approve' else 'salary.run_reject' end,
    'payroll_run', p_run_id::text,
    format('%s chi lương kỳ %s%s',
      case when p_decision = 'APPROVED' then 'Ký duyệt' else 'Từ chối' end,
      to_char(v_run.month_start, 'MM/YYYY'),
      case when nullif(trim(coalesce(p_note, '')), '') is null then '' else ': ' || trim(p_note) end),
    jsonb_build_object('fingerprint', v_current)
  );
end;
$$;

revoke all on function public.review_payroll_run(uuid, text, text) from public;
grant execute on function public.review_payroll_run(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Đã chi trả -> phát hành phiếu lương (FR06.04.05)
-- ---------------------------------------------------------------------------
create or replace function public.mark_payroll_run_paid(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.payroll_runs%rowtype;
  v_slips integer;
begin
  if auth.uid() is null or not public.can_function('admin.payroll') then
    raise exception 'Bạn không có quyền với kỳ lương.' using errcode = '42501';
  end if;
  select * into v_run from public.payroll_runs where id = p_run_id for update;
  if v_run.status is distinct from 'APPROVED' then
    raise exception 'Chỉ xác nhận chi trả kỳ đã được Ban Giám đốc duyệt (BR-PAY-010).' using errcode = '23514';
  end if;

  perform set_config('app.payroll_run_transition', 'on', true);
  update public.payroll_runs
  set status = 'PAID', paid_at = now(), paid_by = auth.uid(), published_at = now()
  where id = p_run_id;
  perform set_config('app.payroll_run_transition', 'off', true);

  select count(*) into v_slips from public.payslips where run_id = p_run_id;
  perform public.add_payroll_approval_event('RUN', p_run_id, 'PAID', null, jsonb_build_object('published', v_slips));
  perform public.write_payroll_audit('salary.run_paid', 'payroll_run', p_run_id::text,
    format('Xác nhận đã chi trả kỳ %s, phát hành %s phiếu lương', to_char(v_run.month_start, 'MM/YYYY'), v_slips), null);
  return v_slips;
end;
$$;

revoke all on function public.mark_payroll_run_paid(uuid) from public;
grant execute on function public.mark_payroll_run_paid(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. BR-PAY-009: khoá lương là khoá cứng dữ liệu đầu vào của tháng đó
-- ---------------------------------------------------------------------------
create or replace function public.guard_timesheet_reopen_after_payroll()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'LOCKED' and new.status <> 'LOCKED'
     and public.payroll_month_closed(old.month_start) then
    raise exception 'Kỳ lương tháng % đã khoá — không mở lại kỳ công được (BR-PAY-009).',
      to_char(old.month_start, 'MM/YYYY') using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists timesheet_periods_payroll_lock on public.timesheet_periods;
create trigger timesheet_periods_payroll_lock
before update on public.timesheet_periods
for each row execute function public.guard_timesheet_reopen_after_payroll();

create or replace function public.guard_month_input_after_payroll()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date;
  v_json jsonb := to_jsonb(coalesce(new, old));
begin
  v_month := coalesce((v_json ->> 'period_month')::date, (v_json ->> 'month_start')::date);
  if v_month is not null and public.payroll_month_closed(v_month) then
    raise exception 'Kỳ lương tháng % đã khoá — dữ liệu của tháng này không sửa được nữa (BR-PAY-009).',
      to_char(v_month, 'MM/YYYY') using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    v_json := to_jsonb(old);
    v_month := coalesce((v_json ->> 'period_month')::date, (v_json ->> 'month_start')::date);
    if v_month is not null and public.payroll_month_closed(v_month) then
      raise exception 'Kỳ lương tháng % đã khoá — dữ liệu của tháng này không sửa được nữa (BR-PAY-009).',
        to_char(v_month, 'MM/YYYY') using errcode = '23514';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists payroll_inputs_payroll_lock on public.payroll_inputs;
create trigger payroll_inputs_payroll_lock
before insert or update or delete on public.payroll_inputs
for each row execute function public.guard_month_input_after_payroll();

do $do$
begin
  if to_regclass('public.performance_reviews') is not null then
    execute 'drop trigger if exists performance_reviews_payroll_lock on public.performance_reviews';
    execute 'create trigger performance_reviews_payroll_lock
      before insert or update or delete on public.performance_reviews
      for each row execute function public.guard_month_input_after_payroll()';
  end if;
end;
$do$;

-- Cầu nối KPI (M05) -> số liệu lương tháng (FR06.04.01).
--
-- Migration 20260930140000 và 20260930180000 viết lại hàm này nhưng ghi vào
-- cột `payroll_inputs.value` — bảng chỉ có `quantity` — và quên bật cờ
-- `app.kpi_payroll_sync` mà trigger `guard_kpi_payroll_inputs_readonly` đòi.
-- Hệ quả: KHOÁ PHIẾU KPI NÀO CŨNG LỖI SQL, % KPI không bao giờ sang được lương.
-- Viết lại đúng cột, đúng cờ, giữ nguyên ngữ nghĩa "chỉ đẩy KPI_PCT".
create or replace function public.sync_kpi_review_to_payroll_inputs(
  p_review public.performance_reviews
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_review.period_month is null then
    return;
  end if;

  perform set_config('app.kpi_payroll_sync', 'on', true);
  insert into public.payroll_inputs (user_id, month_start, code, quantity, note)
  values (
    p_review.user_id, p_review.period_month, 'KPI_PCT', coalesce(p_review.final_pct, 0),
    'Tự động từ phiếu KPI đã khoá.'
  )
  on conflict (user_id, month_start, code)
  do update set quantity = excluded.quantity, note = excluded.note, updated_at = now();
  perform set_config('app.kpi_payroll_sync', 'off', true);
end;
$fn$;

-- Điều chỉnh của kỳ đã khoá cũng không sửa được (trước chỉ chặn từ lúc duyệt).
create or replace function public.guard_payroll_adjustment_period()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  target_month date;
begin
  if tg_op = 'DELETE' then target_month := old.month_start; else target_month := new.month_start; end if;
  if public.payroll_month_closed(target_month)
     or (tg_op = 'UPDATE' and public.payroll_month_closed(old.month_start)) then
    raise exception 'Kỳ lương tháng % đã khoá — ghi điều chỉnh vào kỳ chưa khoá.', to_char(target_month, 'MM/YYYY')
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$fn$;

-- FR06.04.02: điều chỉnh bắt buộc có lý do giải trình.
alter table public.payroll_adjustments drop constraint if exists payroll_adjustments_reason_required;
alter table public.payroll_adjustments
  add constraint payroll_adjustments_reason_required check (length(trim(reason)) >= 3) not valid;

create or replace function public.audit_payroll_adjustment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payroll_adjustments%rowtype := coalesce(new, old);
begin
  perform public.write_payroll_audit(
    'salary.adjustment_' || lower(tg_op), 'payroll_adjustment', v_row.id::text,
    format('%s điều chỉnh %s %s kỳ %s: %s',
      case tg_op when 'INSERT' then 'Thêm' when 'UPDATE' then 'Sửa' else 'Xoá' end,
      case when v_row.kind = 'RECOVERY' then '+' else '−' end,
      replace(to_char(v_row.amount, 'FM999,999,999,999'), ',', '.'),
      to_char(v_row.month_start, 'MM/YYYY'), v_row.reason),
    case when tg_op = 'UPDATE' then jsonb_build_object('changes', public.payroll_row_diff(to_jsonb(old), to_jsonb(new))) end,
    v_row.user_id
  );
  return v_row;
end;
$$;

drop trigger if exists payroll_adjustments_audit on public.payroll_adjustments;
create trigger payroll_adjustments_audit
after insert or update or delete on public.payroll_adjustments
for each row execute function public.audit_payroll_adjustment();

-- ---------------------------------------------------------------------------
-- 8. Quyền đọc / ghi theo đúng chức năng, và riêng tư của phiếu lương
-- ---------------------------------------------------------------------------
-- Nhân viên chỉ xem phiếu của mình (BR-PAY-011), chỉ khi kỳ đã chi trả và
-- phát hành, và chỉ khi VỪA xác thực lại trong 15 phút (FR06.04.05: nhập lại
-- mật khẩu khi mở chi tiết). Ban Giám đốc đọc được để xem xét quỹ lương.
drop policy if exists payroll_runs_read on public.payroll_runs;
create policy payroll_runs_read on public.payroll_runs
for select to authenticated using (
  public.can_function('admin.payroll') or public.can_function('admin.payroll_approve')
);

drop policy if exists payroll_runs_manage on public.payroll_runs;
create policy payroll_runs_manage on public.payroll_runs
for all to authenticated
using (public.can_function('admin.payroll'))
with check (public.can_function('admin.payroll'));

-- Kỳ đã phát hành chưa. PHẢI là security definer: nhân viên không có quyền
-- đọc `payroll_runs`, mà điều kiện con trong policy chạy bằng quyền của người
-- đang truy vấn. Policy cũ viết `exists (select … from payroll_runs)` thẳng
-- trong policy nên với nhân viên điều kiện đó LUÔN rỗng — phiếu đã duyệt chưa
-- từng hiện được cho người lao động, màn của họ chỉ thấy bản tạm tính.
create or replace function public.payroll_run_published(p_run_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.payroll_runs r
    where r.id = p_run_id and r.status = 'PAID' and r.published_at is not null
  );
$$;

revoke all on function public.payroll_run_published(uuid) from public;
grant execute on function public.payroll_run_published(uuid) to authenticated;

drop policy if exists payslips_read on public.payslips;
create policy payslips_read on public.payslips
for select to authenticated using (
  public.can_function('admin.payroll')
  or public.can_function('admin.payroll_approve')
  or (
    user_id = auth.uid()
    and public.payroll_recent_auth(15)
    and public.payroll_run_published(run_id)
  )
);

drop policy if exists payslip_lines_read on public.payslip_lines;
create policy payslip_lines_read on public.payslip_lines
for select to authenticated using (
  exists (
    select 1 from public.payslips s
    where s.id = payslip_lines.payslip_id
      and (
        public.can_function('admin.payroll')
        or public.can_function('admin.payroll_approve')
        or (s.user_id = auth.uid() and public.payroll_recent_auth(15) and public.payroll_run_published(s.run_id))
      )
  )
);

-- Số liệu tháng: người được giao "Số liệu lương tháng" phải ghi được (trước
-- chỉ người có chức năng Bảng lương).
drop policy if exists payroll_inputs_read on public.payroll_inputs;
create policy payroll_inputs_read on public.payroll_inputs
for select to authenticated using (
  public.can_function('admin.payroll') or public.can_function('admin.payroll_inputs')
  or public.can_function('admin.payroll_approve')
  or (user_id = auth.uid() and public.payroll_recent_auth(15))
);
drop policy if exists payroll_inputs_manage on public.payroll_inputs;
create policy payroll_inputs_manage on public.payroll_inputs
for all to authenticated
using (public.can_function('admin.payroll') or public.can_function('admin.payroll_inputs'))
with check (public.can_function('admin.payroll') or public.can_function('admin.payroll_inputs'));

-- Điều chỉnh lương trước đây mở theo quyền module `attendance` — trưởng nhóm
-- (ngầm có `attendance`) đọc và sửa được truy lĩnh / truy thu của cả công ty.
drop policy if exists payroll_adjustments_read on public.payroll_adjustments;
create policy payroll_adjustments_read on public.payroll_adjustments
for select to authenticated using (
  public.can_function('admin.payroll') or public.can_function('admin.payroll_adjustments')
  or public.can_function('admin.payroll_approve')
  or (user_id = auth.uid() and public.payroll_recent_auth(15))
);
drop policy if exists payroll_adjustments_manage on public.payroll_adjustments;
create policy payroll_adjustments_manage on public.payroll_adjustments
for all to authenticated
using (public.can_function('admin.payroll_adjustments'))
with check (public.can_function('admin.payroll_adjustments'));

-- Trạng thái phiếu của chính mình, kể cả khi CHƯA xác thực lại — để màn
-- "Lương của tôi" nói được "đã có phiếu, nhập mật khẩu để xem" thay vì im lặng.
create or replace function public.get_my_payslip_status(p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_run public.payroll_runs%rowtype;
  v_has boolean;
begin
  if auth.uid() is null then
    raise exception 'Chưa đăng nhập.' using errcode = '42501';
  end if;
  select * into v_run from public.payroll_runs where month_start = date_trunc('month', p_month)::date;
  v_has := v_run.id is not null and exists (
    select 1 from public.payslips s where s.run_id = v_run.id and s.user_id = auth.uid()
  );
  return jsonb_build_object(
    'published', v_run.status = 'PAID' and v_run.published_at is not null and v_has,
    'published_at', v_run.published_at,
    'in_progress', v_run.id is not null and v_run.status in ('CALCULATED', 'LOCKED', 'APPROVED'),
    'reauth_required', not public.payroll_recent_auth(15),
    'reauth_window_minutes', 15
  );
end;
$$;

revoke all on function public.get_my_payslip_status(date) from public;
grant execute on function public.get_my_payslip_status(date) to authenticated;

-- Phiếu đã phát hành của chính mình, kèm các dòng. Cùng điều kiện với policy
-- (phát hành + vừa xác thực lại), gói một lần gọi cho màn nhân viên — họ không
-- đọc được `payroll_runs` để tự tra kỳ nào là tháng nào.
create or replace function public.get_my_payslip(p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_slip public.payslips%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Chưa đăng nhập.' using errcode = '42501';
  end if;
  if not public.payroll_recent_auth(15) then
    raise exception 'Nhập lại mật khẩu để xem chi tiết phiếu lương.' using errcode = '28000';
  end if;

  select s.* into v_slip
  from public.payslips s
  join public.payroll_runs r on r.id = s.run_id
  where s.user_id = auth.uid()
    and r.month_start = date_trunc('month', p_month)::date
    and r.status = 'PAID' and r.published_at is not null;

  if v_slip.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'payslip', to_jsonb(v_slip),
    'lines', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.sequence)
      from public.payslip_lines l
      where l.payslip_id = v_slip.id and l.kind <> 'EMPLOYER_COST'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_my_payslip(date) from public;
grant execute on function public.get_my_payslip(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Tài khoản nhận lương và mẫu file ngân hàng (FR06.04.04)
-- ---------------------------------------------------------------------------
create table if not exists public.employee_bank_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  bank_code text not null check (bank_code ~ '^[A-Z][A-Z0-9_]*$'),
  bank_name text not null check (length(trim(bank_name)) > 0),
  account_number text not null check (account_number ~ '^[0-9]{6,20}$'),
  account_holder text not null check (length(trim(account_holder)) > 0),
  branch text,
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists employee_bank_accounts_touch on public.employee_bank_accounts;
create trigger employee_bank_accounts_touch
before update on public.employee_bank_accounts
for each row execute function public.touch_payroll_updated_at();

-- Đổi tài khoản nhận lương là thao tác hay bị lợi dụng nhất trong chi lương —
-- phải để lại vết. Số tài khoản che bớt trong câu tóm tắt.
create or replace function public.audit_employee_bank_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.employee_bank_accounts%rowtype := coalesce(new, old);
begin
  perform public.write_payroll_audit(
    'salary.bank_account_' || lower(tg_op), 'employee_bank_account', v_row.user_id::text,
    format('%s tài khoản nhận lương %s ***%s',
      case tg_op when 'INSERT' then 'Khai' when 'UPDATE' then 'Đổi' else 'Xoá' end,
      v_row.bank_name, right(v_row.account_number, 4)),
    case when tg_op = 'UPDATE' then jsonb_build_object('changes', public.payroll_row_diff(to_jsonb(old), to_jsonb(new))) end,
    v_row.user_id
  );
  return v_row;
end;
$$;

drop trigger if exists employee_bank_accounts_audit on public.employee_bank_accounts;
create trigger employee_bank_accounts_audit
after insert or update or delete on public.employee_bank_accounts
for each row execute function public.audit_employee_bank_account();

alter table public.employee_bank_accounts enable row level security;
drop policy if exists employee_bank_accounts_read on public.employee_bank_accounts;
create policy employee_bank_accounts_read on public.employee_bank_accounts
for select to authenticated using (
  user_id = auth.uid() or public.can_function('admin.payroll') or public.can_function('admin.payroll_schemes')
);
drop policy if exists employee_bank_accounts_manage on public.employee_bank_accounts;
create policy employee_bank_accounts_manage on public.employee_bank_accounts
for all to authenticated
using (public.can_function('admin.payroll_schemes') or public.can_function('admin.payroll'))
with check (public.can_function('admin.payroll_schemes') or public.can_function('admin.payroll'));
grant select, insert, update, delete on public.employee_bank_accounts to authenticated;

-- Mẫu file chi lương theo ngân hàng. Bố cục cột là DỮ LIỆU: mỗi ngân hàng
-- (và mỗi hợp đồng e-banking) một kiểu, đổi mẫu không phải sửa code.
create table if not exists public.payroll_bank_templates (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]*$'),
  name text not null,
  /* [{header: 'Số tài khoản', field: 'account_number'}, ...]. Trường hợp lệ:
     seq, employee_code, account_holder, account_number, bank_name, bank_code,
     branch, amount, description. */
  columns jsonb not null check (jsonb_typeof(columns) = 'array' and jsonb_array_length(columns) > 0),
  /* {MM}, {YYYY}, {EMPLOYEE_CODE}, {NAME} được thay khi xuất. */
  description_template text not null default 'Luong thang {MM}/{YYYY}',
  /* Phần lớn cổng e-banking không nhận dấu tiếng Việt trong tên / nội dung. */
  strip_diacritics boolean not null default true,
  sheet_name text not null default 'Danh sach chi luong',
  note text,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists payroll_bank_templates_touch on public.payroll_bank_templates;
create trigger payroll_bank_templates_touch
before update on public.payroll_bank_templates
for each row execute function public.touch_payroll_updated_at();

insert into public.payroll_bank_templates (code, name, columns, description_template, note, sort_order)
values
  ('VIETINBANK', 'VietinBank — Chi lương (eFAST)',
   '[{"header": "STT", "field": "seq"},
     {"header": "So tai khoan", "field": "account_number"},
     {"header": "Ten nguoi huong", "field": "account_holder"},
     {"header": "So tien", "field": "amount"},
     {"header": "Noi dung", "field": "description"},
     {"header": "Ngan hang huong", "field": "bank_name"}]'::jsonb,
   'Luong thang {MM}/{YYYY} {EMPLOYEE_CODE}',
   'Bố cục cột theo mẫu chi lương phổ biến của VietinBank eFAST — đối chiếu lại với file mẫu ngân hàng cấp theo hợp đồng trước khi dùng thật.',
   10),
  ('BIDV', 'BIDV — Chi lương (iBank)',
   '[{"header": "STT", "field": "seq"},
     {"header": "Ten nguoi huong", "field": "account_holder"},
     {"header": "So tai khoan nguoi huong", "field": "account_number"},
     {"header": "So tien", "field": "amount"},
     {"header": "Noi dung chuyen tien", "field": "description"},
     {"header": "Ngan hang", "field": "bank_name"},
     {"header": "Chi nhanh", "field": "branch"}]'::jsonb,
   'Luong thang {MM}/{YYYY} {EMPLOYEE_CODE}',
   'Bố cục cột theo mẫu chi lương phổ biến của BIDV iBank — đối chiếu lại với file mẫu ngân hàng cấp theo hợp đồng trước khi dùng thật.',
   20)
on conflict (code) do nothing;

alter table public.payroll_bank_templates enable row level security;
drop policy if exists payroll_bank_templates_read on public.payroll_bank_templates;
create policy payroll_bank_templates_read on public.payroll_bank_templates
for select to authenticated using (public.can_payroll());
drop policy if exists payroll_bank_templates_manage on public.payroll_bank_templates;
create policy payroll_bank_templates_manage on public.payroll_bank_templates
for all to authenticated
using (public.can_function('admin.payroll'))
with check (public.can_function('admin.payroll'));
grant select, insert, update, delete on public.payroll_bank_templates to authenticated;

-- Ghi vết mỗi lần xuất file chuyển khoản. Chỉ xuất được khi BGĐ đã duyệt
-- (BR-PAY-010): file chuyển khoản trước lúc duyệt là lệnh chi chưa được phép.
create or replace function public.record_payroll_bank_export(
  p_run_id uuid, p_template_code text, p_rows integer, p_total numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.payroll_runs%rowtype;
begin
  if auth.uid() is null or not public.can_function('admin.payroll') then
    raise exception 'Bạn không có quyền xuất file chi lương.' using errcode = '42501';
  end if;
  select * into v_run from public.payroll_runs where id = p_run_id;
  if v_run.status not in ('APPROVED', 'PAID') then
    raise exception 'Chỉ xuất file ngân hàng khi Ban Giám đốc đã ký duyệt chi (BR-PAY-010).' using errcode = '23514';
  end if;
  perform public.add_payroll_approval_event('RUN', p_run_id, 'BANK_EXPORTED', null,
    jsonb_build_object('template', p_template_code, 'rows', p_rows, 'total', p_total));
  perform public.write_payroll_audit('salary.bank_export', 'payroll_run', p_run_id::text,
    format('Xuất file chi lương %s kỳ %s: %s dòng, tổng %s', p_template_code, to_char(v_run.month_start, 'MM/YYYY'),
      p_rows, replace(to_char(p_total, 'FM999,999,999,999,999'), ',', '.')),
    null);
end;
$$;

revoke all on function public.record_payroll_bank_export(uuid, text, integer, numeric) from public;
grant execute on function public.record_payroll_bank_export(uuid, text, integer, numeric) to authenticated;
