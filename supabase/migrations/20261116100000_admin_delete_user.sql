-- ============================================================================
-- Xoá tài khoản nhân sự không còn báo "Database error deleting user".
-- ----------------------------------------------------------------------------
-- Xoá auth.users -> cascade xoá profiles -> cascade xoá dữ liệu của người đó
-- (hồ sơ lương, đầu vào lương, chấm công, KPI...). Ba chỗ làm hỏng chuỗi này:
--
--  1. Trigger nhật ký lương (write_payroll_audit) chạy khi các dòng lương bị
--     xoá theo, và ghi audit_logs.target_user_id = người VỪA bị xoá. Hồ sơ đã
--     mất nên khoá ngoại audit_logs_target_user_id_fkey báo lỗi 23503. Lỗi
--     này dính cả với tài khoản không có dữ liệu gì.
--  2. Một số khoá ngoại trỏ vào profiles để RESTRICT / NO ACTION (người tạo
--     đề xuất tuyển dụng, người duyệt bước đào tạo, người sửa công...), nên
--     ai từng thao tác các mục đó thì không xoá được.
--  3. Các trigger bảo vệ (kỳ công đã khoá, phiếu lương đã khoá, nhật ký KPI
--     chỉ ghi thêm, thẻ việc đã hoàn thành...) chặn việc xoá dây chuyền.
--
-- Cách sửa:
--  1. audit_logs: trước khi chèn, actor_id / target_user_id trỏ vào hồ sơ không
--     còn tồn tại thì để NULL (giữ id cũ trong details) thay vì làm hỏng giao
--     dịch đang chạy.
--  2. Khoá ngoại RESTRICT / NO ACTION trỏ vào profiles hoặc auth.users: cột
--     "của chính người đó" (user_id, employee_id, profile_id) -> CASCADE; cột
--     chỉ ghi "ai đã làm" -> SET NULL, giữ lại bản ghi.
--  3. Hàm admin_delete_user(p_user, p_actor): tạm tắt trigger người dùng trên
--     các bảng nằm trong chuỗi xoá, xoá auth.users, bật lại trigger rồi ghi
--     một dòng nhật ký. Cả hàm là một giao dịch: lỗi ở đâu thì không mất gì.
--     Chỉ service_role gọi được (API /api/admin-users đã kiểm tra quyền).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. audit_logs không còn làm hỏng giao dịch khi người được nhắc tới đã bị xoá
-- ---------------------------------------------------------------------------
create or replace function public.audit_logs_drop_missing_profiles()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.target_user_id is not null
     and not exists (select 1 from public.profiles p where p.id = new.target_user_id) then
    new.details := coalesce(new.details, '{}'::jsonb)
      || jsonb_build_object('deleted_target_user_id', new.target_user_id);
    new.target_user_id := null;
  end if;
  if new.actor_id is not null
     and not exists (select 1 from public.profiles p where p.id = new.actor_id) then
    new.details := coalesce(new.details, '{}'::jsonb)
      || jsonb_build_object('deleted_actor_id', new.actor_id);
    new.actor_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists audit_logs_00_drop_missing_profiles on public.audit_logs;
create trigger audit_logs_00_drop_missing_profiles
before insert on public.audit_logs
for each row execute function public.audit_logs_drop_missing_profiles();

-- ---------------------------------------------------------------------------
-- 2. Khoá ngoại RESTRICT / NO ACTION trỏ vào profiles / auth.users
-- ---------------------------------------------------------------------------
do $$
declare
  fk record;
  v_cascade boolean;
begin
  for fk in
    select c.oid, c.conname, c.conrelid::regclass as tbl, c.confrelid::regclass as ref,
           a.attname as col, a.attnotnull as notnull,
           exists (
             select 1 from pg_constraint pk
             where pk.conrelid = c.conrelid and pk.contype = 'p' and a.attnum = any (pk.conkey)
           ) as in_pk
    from pg_constraint c
    join pg_namespace n on n.oid = (select relnamespace from pg_class where oid = c.conrelid)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and n.nspname = 'public'
      and c.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
      and c.confdeltype in ('r', 'a')
      and cardinality(c.conkey) = 1
  loop
    v_cascade := fk.in_pk or fk.col in ('user_id', 'employee_id', 'profile_id');
    if not v_cascade and fk.notnull then
      execute format('alter table %s alter column %I drop not null', fk.tbl, fk.col);
    end if;
    execute format('alter table %s drop constraint %I', fk.tbl, fk.conname);
    execute format(
      'alter table %s add constraint %I foreign key (%I) references %s(id) on delete %s',
      fk.tbl, fk.conname, fk.col, fk.ref, case when v_cascade then 'cascade' else 'set null' end
    );
    raise notice '%.% -> on delete %', fk.tbl, fk.col, case when v_cascade then 'cascade' else 'set null' end;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Hàm xoá tài khoản
-- ---------------------------------------------------------------------------
create or replace function public.admin_delete_user(p_user uuid, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_email text;
  v_code text;
  v_actor_name text;
  v_trg record;
  v_disabled jsonb := '[]'::jsonb;
  v_item jsonb;
  v_auth_deleted boolean := false;
begin
  if p_user is null then
    raise exception 'Thiếu tài khoản cần xoá.' using errcode = '22023';
  end if;
  if p_actor is not null and p_actor = p_user then
    raise exception 'Không thể xoá tài khoản đang đăng nhập.' using errcode = '42501';
  end if;

  select p.name, p.email, p.employee_code into v_name, v_email, v_code
  from public.profiles p where p.id = p_user;
  if not found then
    select u.email into v_email from auth.users u where u.id = p_user;
    if not found then
      raise exception 'Không tìm thấy tài khoản.' using errcode = 'P0002';
    end if;
  end if;
  if p_actor is not null then
    select p.name into v_actor_name from public.profiles p where p.id = p_actor;
  end if;

  -- Mỗi lần chỉ một thao tác xoá chạy, tránh hai giao dịch cùng tắt/bật trigger.
  perform pg_advisory_xact_lock(hashtext('public.admin_delete_user'));

  -- Bảng nằm trong chuỗi xoá: đi theo khoá ngoại CASCADE từ auth.users /
  -- profiles, cộng các bảng bị SET NULL / SET DEFAULT (bị UPDATE theo).
  for v_trg in
    with recursive reach(rel) as (
      select 'auth.users'::regclass::oid
      union
      select 'public.profiles'::regclass::oid
      union
      select c.conrelid::oid
      from pg_constraint c
      join reach r on c.confrelid::oid = r.rel
      where c.contype = 'f' and c.confdeltype = 'c'
    ),
    touched(rel) as (
      select rel from reach
      union
      select c.conrelid::oid
      from pg_constraint c
      join reach r on c.confrelid::oid = r.rel
      where c.contype = 'f' and c.confdeltype in ('n', 'd')
    )
    select t.tgrelid::regclass::text as rel, t.tgname::text as tgname
    from pg_trigger t
    join touched x on x.rel = t.tgrelid::oid
    join pg_class cl on cl.oid = t.tgrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where not t.tgisinternal
      and t.tgenabled <> 'D'
      and n.nspname = 'public'
  loop
    execute format('alter table %s disable trigger %I', v_trg.rel, v_trg.tgname);
    v_disabled := v_disabled || jsonb_build_object('rel', v_trg.rel, 'tg', v_trg.tgname);
  end loop;

  delete from auth.users where id = p_user;
  v_auth_deleted := found;
  if not v_auth_deleted then
    delete from public.profiles where id = p_user;
  end if;

  -- Ràng buộc DEFERRABLE (nếu có) phải chạy xong trước khi ALTER TABLE lại.
  set constraints all immediate;

  for v_item in select * from jsonb_array_elements(v_disabled) loop
    execute format('alter table %s enable trigger %I', v_item->>'rel', v_item->>'tg');
  end loop;

  insert into public.audit_logs (
    actor_id, actor_name, action, entity_type, entity_id,
    target_user_id, target_name, summary, details
  ) values (
    p_actor, v_actor_name, 'user.delete', 'profile', p_user::text,
    null, coalesce(v_name, v_email),
    format('Xoá tài khoản %s', coalesce(nullif(v_name, ''), v_email, p_user::text)),
    jsonb_build_object('email', v_email, 'employee_code', v_code, 'auth_user_deleted', v_auth_deleted)
  );

  return jsonb_build_object('deleted', true, 'auth_user_deleted', v_auth_deleted);
end;
$$;

revoke all on function public.admin_delete_user(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_user(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
