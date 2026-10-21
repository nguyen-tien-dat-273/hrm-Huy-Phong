-- Khai báo hồ sơ qua link: nhân viên mới tự điền, HR duyệt rồi cấp tài khoản.
-- Người ẩn danh chỉ gọi được hai hàm công khai bên dưới, không đọc/ghi bảng trực tiếp.

create table if not exists public.onboarding_links (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9]{8,32}$'),
  label text not null check (length(trim(label)) >= 2),
  is_active boolean not null default true,
  expires_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.onboarding_submissions (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.onboarding_links(id) on delete cascade,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
  full_name text not null check (length(trim(full_name)) >= 2),
  email text not null,
  phone text,
  date_of_birth date,
  gender text check (gender is null or gender in ('MALE','FEMALE','OTHER')),
  id_number text,
  tax_code text,
  bank_name text,
  bank_account text,
  hometown text,
  permanent_address text,
  current_address text,
  education_level text
    check (education_level is null or education_level in ('HIGH_SCHOOL','VOCATIONAL','COLLEGE','UNIVERSITY','POSTGRADUATE','OTHER')),
  school_name text,
  major text,
  graduation_year smallint check (graduation_year is null or graduation_year between 1950 and 2100),
  emergency_contact text,
  note text,
  review_note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  profile_id uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz not null default now()
);

create index if not exists onboarding_submissions_status_idx
  on public.onboarding_submissions(status, submitted_at desc);
-- Một email chỉ có một hồ sơ đang chờ duyệt: chặn bấm gửi hai lần và spam đơn giản.
create unique index if not exists onboarding_submissions_pending_email_uq
  on public.onboarding_submissions(lower(email)) where status = 'PENDING';

alter table public.onboarding_links enable row level security;
alter table public.onboarding_submissions enable row level security;

drop policy if exists onboarding_links_manage on public.onboarding_links;
create policy onboarding_links_manage on public.onboarding_links for all to authenticated
  using (public.can('users')) with check (public.can('users'));
drop policy if exists onboarding_submissions_manage on public.onboarding_submissions;
create policy onboarding_submissions_manage on public.onboarding_submissions for all to authenticated
  using (public.can('users')) with check (public.can('users'));

grant select, insert, update, delete on public.onboarding_links to authenticated;
grant select, insert, update, delete on public.onboarding_submissions to authenticated;

-- Thông tin công khai của link (chỉ nhãn + còn hiệu lực hay không).
create or replace function public.public_onboarding_link(p_code text)
returns table (label text, is_open boolean)
language sql stable security definer set search_path = public
as $$
  select l.label, (l.is_active and (l.expires_at is null or l.expires_at > now()))
  from public.onboarding_links l
  where l.code = p_code
  limit 1;
$$;
revoke all on function public.public_onboarding_link(text) from public;
grant execute on function public.public_onboarding_link(text) to anon, authenticated;

create or replace function public.submit_onboarding_profile(p_code text, p_data jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare
  v_link record;
  v_email text := lower(trim(coalesce(p_data->>'email', '')));
  v_name text := trim(coalesce(p_data->>'full_name', ''));
  v_id uuid;
  v_dob date;
  v_year smallint;
begin
  select * into v_link from public.onboarding_links where code = p_code;
  if v_link is null then
    raise exception 'Không tìm thấy đường dẫn khai báo này.' using errcode = 'no_data_found';
  end if;
  if not v_link.is_active or (v_link.expires_at is not null and v_link.expires_at <= now()) then
    raise exception 'Đường dẫn khai báo đã đóng hoặc hết hạn.' using errcode = 'check_violation';
  end if;
  if length(v_name) < 2 then
    raise exception 'Vui lòng nhập họ tên.' using errcode = 'check_violation';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Email không hợp lệ.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.profiles p where lower(p.email) = v_email) then
    raise exception 'Email này đã có tài khoản trong hệ thống.' using errcode = 'unique_violation';
  end if;
  if exists (select 1 from public.onboarding_submissions s where lower(s.email) = v_email and s.status = 'PENDING') then
    raise exception 'Hồ sơ của email này đang chờ duyệt.' using errcode = 'unique_violation';
  end if;

  begin v_dob := nullif(p_data->>'date_of_birth', '')::date; exception when others then v_dob := null; end;
  begin v_year := nullif(p_data->>'graduation_year', '')::smallint; exception when others then v_year := null; end;

  insert into public.onboarding_submissions (
    link_id, full_name, email, phone, date_of_birth, gender, id_number, tax_code,
    bank_name, bank_account, hometown, permanent_address, current_address,
    education_level, school_name, major, graduation_year, emergency_contact, note
  ) values (
    v_link.id, v_name, v_email,
    left(nullif(trim(p_data->>'phone'), ''), 20),
    v_dob,
    nullif(p_data->>'gender', ''),
    left(nullif(trim(p_data->>'id_number'), ''), 20),
    left(nullif(trim(p_data->>'tax_code'), ''), 20),
    left(nullif(trim(p_data->>'bank_name'), ''), 100),
    left(nullif(trim(p_data->>'bank_account'), ''), 30),
    left(nullif(trim(p_data->>'hometown'), ''), 200),
    left(nullif(trim(p_data->>'permanent_address'), ''), 300),
    left(nullif(trim(p_data->>'current_address'), ''), 300),
    nullif(p_data->>'education_level', ''),
    left(nullif(trim(p_data->>'school_name'), ''), 200),
    left(nullif(trim(p_data->>'major'), ''), 200),
    v_year,
    left(nullif(trim(p_data->>'emergency_contact'), ''), 300),
    left(nullif(trim(p_data->>'note'), ''), 1000)
  ) returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function public.submit_onboarding_profile(text, jsonb) from public;
grant execute on function public.submit_onboarding_profile(text, jsonb) to anon, authenticated;
