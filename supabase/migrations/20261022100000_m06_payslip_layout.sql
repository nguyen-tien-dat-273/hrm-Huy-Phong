-- M06: mẫu phiếu lương theo đơn vị.
--
-- Mỗi phòng ban một mẫu phiếu (Văn phòng dùng BL 01, Kinh doanh dùng BL 02…). Mẫu chỉ
-- quyết định CÁCH TRÌNH BÀY phiếu, không đổi cách tính:
--
--   form_code     mã mẫu in ở góc phải đầu phiếu (BL 01, BL 02…)
--   title         dòng tiêu đề dưới "Bảng thanh toán lương tháng" — trống thì lấy tên đơn vị
--   header        dòng trung gian hiện ở đầu phiếu, theo thứ tự: [{code, format}],
--                 format là number / money / percent (giá trị đã là %) / ratio (tỷ lệ 0–1,
--                 in ×100 %). Dòng trung gian không có ở đây thì
--                 nhân viên không thấy.
--   before_total  khoản trừ đứng trong bảng TRƯỚC dòng Tổng cộng (nhóm Phạt) và được trừ
--                 ngay trong Tổng cộng; khoản trừ còn lại (bảo hiểm, quỹ, thuế…) mỗi khoản
--                 một mục La Mã sau Tổng cộng.
--
-- Phần còn lại tự đánh số: khoản cộng chia mục I, II, III… theo nhóm của Danh mục, dòng
-- trong mục đánh 1, 2, 3… theo thứ tự cơ chế.
--
-- Đơn vị con không có mẫu riêng thì dùng mẫu của đơn vị cha gần nhất. Không có mẫu ở đâu
-- cả thì phiếu hiện dòng trung gian được đánh dấu "hiện trên phiếu lương" như trước.

create table if not exists public.payslip_layouts (
  unit_id uuid primary key references public.organization_units(id) on delete cascade,
  form_code text,
  title text,
  header jsonb not null default '[]'::jsonb,
  before_total text[] not null default '{}',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint payslip_layouts_header_array check (jsonb_typeof(header) = 'array')
);

comment on table public.payslip_layouts is
  'Mẫu phiếu lương của đơn vị: mã mẫu, tiêu đề, dòng hiện ở đầu phiếu, khoản trừ đứng trước Tổng cộng. Chỉ để trình bày.';

alter table public.payslip_layouts enable row level security;

drop policy if exists payslip_layouts_read on public.payslip_layouts;
create policy payslip_layouts_read on public.payslip_layouts
for select to authenticated using (true);

revoke insert, update, delete on public.payslip_layouts from authenticated, anon;
grant select on public.payslip_layouts to authenticated;

-- ---------------------------------------------------------------------------
-- Mẫu áp cho một đơn vị: của chính nó, không có thì của cấp trên gần nhất.
-- ---------------------------------------------------------------------------
create or replace function public.payslip_layout_of_unit(p_unit_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with recursive up as (
    select u.id, u.parent_id, 0 as depth from public.organization_units u where u.id = p_unit_id
    union all
    select p.id, p.parent_id, up.depth + 1
    from public.organization_units p join up on p.id = up.parent_id
    where up.depth < 50
  )
  select to_jsonb(l)
  from up join public.payslip_layouts l on l.unit_id = up.id
  order by up.depth
  limit 1;
$$;

revoke all on function public.payslip_layout_of_unit(uuid) from public;
grant execute on function public.payslip_layout_of_unit(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Lưu mẫu của một đơn vị. p_layout null = bỏ mẫu riêng, theo cấp trên.
-- ---------------------------------------------------------------------------
create or replace function public.save_payslip_layout(p_unit_id uuid, p_layout jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
begin
  if auth.uid() is null or not public.can_function('admin.payroll_schemes') then
    raise exception 'Bạn không có quyền thiết lập cơ chế lương.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organization_units where id = p_unit_id) then
    raise exception 'Không tìm thấy đơn vị.' using errcode = 'P0002';
  end if;

  if p_layout is null then
    delete from public.payslip_layouts where unit_id = p_unit_id;
    return;
  end if;

  if jsonb_typeof(coalesce(p_layout -> 'header', '[]'::jsonb)) <> 'array' then
    raise exception 'Danh sách dòng đầu phiếu không hợp lệ.' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(coalesce(p_layout -> 'header', '[]'::jsonb))
  loop
    if coalesce(v_item ->> 'code', '') = ''
       or coalesce(v_item ->> 'format', 'number') not in ('number', 'money', 'percent', 'ratio') then
      raise exception 'Dòng đầu phiếu không hợp lệ.' using errcode = '22023';
    end if;
  end loop;

  insert into public.payslip_layouts (unit_id, form_code, title, header, before_total, updated_by, updated_at)
  values (
    p_unit_id,
    nullif(trim(coalesce(p_layout ->> 'form_code', '')), ''),
    nullif(trim(coalesce(p_layout ->> 'title', '')), ''),
    coalesce(p_layout -> 'header', '[]'::jsonb),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_layout -> 'before_total', '[]'::jsonb))), '{}'),
    auth.uid(),
    now()
  )
  on conflict (unit_id) do update set
    form_code = excluded.form_code,
    title = excluded.title,
    header = excluded.header,
    before_total = excluded.before_total,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.save_payslip_layout(uuid, jsonb) from public;
grant execute on function public.save_payslip_layout(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Phiếu của nhân viên: trả kèm mẫu của đơn vị; dòng trung gian theo mẫu.
-- ---------------------------------------------------------------------------
create or replace function public.get_my_payslip(p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_slip public.payslips%rowtype;
  v_layout jsonb;
  v_header text[];
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

  v_layout := public.payslip_layout_of_unit((select p.unit_id from public.profiles p where p.id = auth.uid()));
  if v_layout is not null then
    v_header := array(select h ->> 'code' from jsonb_array_elements(v_layout -> 'header') h);
  end if;

  return jsonb_build_object(
    'payslip', to_jsonb(v_slip),
    'layout', v_layout,
    -- Kèm nhóm danh mục của từng dòng: nhân viên không đọc được danh mục, mà
    -- phiếu dạng mẫu cần nhóm để chia mục I, II, III…
    'lines', coalesce((
      select jsonb_agg(
        to_jsonb(l) || jsonb_build_object('category_name', g.name, 'category_sort', g.sort_order)
        order by l.sequence
      )
      from public.payslip_lines l
      left join public.payroll_components pc on pc.code = l.code
      left join public.payroll_component_categories g on g.code = pc.category_code
      where l.payslip_id = v_slip.id
        and l.kind <> 'EMPLOYER_COST'
        and (
          l.kind <> 'INFO'
          or (v_layout is not null and l.code = any(v_header))
          or (v_layout is null and exists (
            select 1 from public.payroll_components c
            where c.code = l.code and c.show_on_payslip and c.report_tag is distinct from 'INSURANCE_EMPLOYER'
          ))
        )
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_my_payslip(date) from public;
grant execute on function public.get_my_payslip(date) to authenticated;

-- ---------------------------------------------------------------------------
-- Gieo sẵn theo hai mẫu giấy: đơn vị gốc dùng BL 01, Kinh doanh dùng BL 02.
-- Đơn vị đã có mẫu thì giữ.
-- ---------------------------------------------------------------------------
do $seed$
declare
  v_penalties text[] := array(
    select code from public.payroll_components
    where code in ('PHAT_DI_MUON_VE_SOM', 'PHAT_BAO_CAO', 'PHAT_DI_MUON') order by sort_order
  );
begin
  insert into public.payslip_layouts (unit_id, form_code, title, header, before_total)
  select u.id, 'BL 01', null,
         '[{"code": "LUONG_CO_BAN", "format": "money"}]'::jsonb,
         v_penalties
  from public.organization_units u
  where u.parent_id is null
  on conflict (unit_id) do nothing;

  -- Đơn vị Kinh doanh trên cùng — cùng cách chọn với migration gieo bảng lương mẫu.
  insert into public.payslip_layouts (unit_id, form_code, title, header, before_total)
  select u.id, 'BL 02', null,
         '[{"code": "LUONG_CO_BAN", "format": "money"},
           {"code": "DOANH_SO_KHOAN", "format": "money"},
           {"code": "TY_LE_DAT_DS", "format": "percent"}]'::jsonb,
         v_penalties
  from public.organization_units u
  where u.parent_id is not null and u.name ilike '%kinh doanh%'
    and not exists (
      with recursive up as (
        select p.id, p.parent_id, p.name from public.organization_units p where p.id = u.parent_id
        union all
        select p.id, p.parent_id, p.name from public.organization_units p join up on p.id = up.parent_id
      )
      select 1 from up where up.name ilike '%kinh doanh%'
    )
  on conflict (unit_id) do nothing;
end;
$seed$;
