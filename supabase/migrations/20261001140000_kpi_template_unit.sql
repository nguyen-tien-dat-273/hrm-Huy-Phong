-- ============================================================================
-- Bo KPI gan thang vao PHONG BAN.
-- ----------------------------------------------------------------------------
-- Truoc day bo KPI chi co `block_code` - mot nhan tu do kieu "Van phong" /
-- "Kinh doanh". Nhan do khong tro toi don vi nao that trong so do to chuc,
-- nen he thong khong biet bo KPI ay danh cho ai, va phai co MOT MAN RIENG de
-- di gan tung phong, tung nguoi.
--
-- Gan thang `unit_id` thi khai xong la biet ngay ap cho ai: moi nguoi trong
-- phong do. Mo bo KPI ra la thay danh sach nhan su, khong phai doan.
--
-- `block_code` GIU LAI: no van dung de nhom cac bo KPI lai khi liet ke, va
-- du lieu cu dang dung no.
-- ============================================================================

alter table public.kpi_position_templates
  add column if not exists unit_id uuid references public.organization_units(id) on delete set null;

create index if not exists kpi_position_templates_unit_idx
  on public.kpi_position_templates(unit_id) where unit_id is not null;

comment on column public.kpi_position_templates.unit_id is
  'Phong ban ma bo KPI nay danh cho. Moi nguoi trong phong do dung bo nay tru khi duoc gan rieng.';

-- ---------------------------------------------------------------------------
-- Bo KPI dang ap cho mot nguoi
-- ---------------------------------------------------------------------------
-- Thu tu uu tien, tu hep toi rong:
--   1. Ban gan rieng cho nguoi          (employee_kpi_schemes)
--   2. Ban gan cho don vi               (unit_kpi_schemes)
--   3. Bo KPI khai THANG cho don vi do  (kpi_position_templates.unit_id)  <- moi
--   4. Mau khop vi tri                  (kpi_position_templates.position_id)
--
-- Buoc 3 chen vao TRUOC buoc 4 chu khong thay the no: mot cong ty co the
-- vua khai bo theo phong, vua co mau rieng cho mot vi tri dac thu trong
-- phong do - va cai rieng hon phai thang.
create or replace function public.kpi_scheme_for(p_user uuid, p_on date default current_date)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  with recursive lineage as (
    select u.id, u.parent_id, 1 as depth
    from public.organization_units u
    join public.profiles p on p.id = p_user
    where u.id = p.unit_id
    union all
    select parent.id, parent.parent_id, child.depth + 1
    from lineage child
    join public.organization_units parent on parent.id = child.parent_id
    where child.depth < 10
  )
  select coalesce(
    -- 1. Ban gan rieng cho nguoi, hieu luc gan nhat.
    (
      select s.template_id
      from public.employee_kpi_schemes s
      where s.user_id = p_user and s.effective_from <= p_on
      order by s.effective_from desc
      limit 1
    ),
    -- 2. Ban gan cho don vi, uu tien don vi GAN nhat roi toi cap tren.
    (
      select s.template_id
      from public.unit_kpi_schemes s
      join lineage l on l.id = s.unit_id
      where s.effective_from <= p_on
      order by l.depth asc, s.effective_from desc
      limit 1
    ),
    -- 3. Bo KPI khai thang cho don vi, cung uu tien don vi gan nhat.
    (
      select t.id
      from public.kpi_position_templates t
      join lineage l on l.id = t.unit_id
      where t.is_active
      order by l.depth asc, t.created_at desc
      limit 1
    ),
    -- 4. Mau khop vi tri.
    (
      select t.id
      from public.kpi_position_templates t
      join public.profiles p on p.id = p_user
      where t.position_id is not null
        and t.position_id = p.position_id
        and t.is_active
      limit 1
    )
  );
$$;

comment on function public.kpi_scheme_for(uuid, date) is
  'Bo KPI dang ap: gan rieng > gan theo don vi > bo khai thang cho don vi > mau theo vi tri.';

revoke all on function public.kpi_scheme_for(uuid, date) from public;
grant execute on function public.kpi_scheme_for(uuid, date) to authenticated;
