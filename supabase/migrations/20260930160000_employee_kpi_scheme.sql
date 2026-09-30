-- ============================================================================
-- Cơ chế KPI theo TỪNG NGƯỜI, điều hướng theo phòng ban.
-- ----------------------------------------------------------------------------
-- Luồng mong muốn: chọn phòng ban -> chọn người trong phòng -> đặt cơ chế KPI
-- riêng cho người đó. Giống hệt cách Cơ chế lương đang làm.
--
-- Hiện trạng: bộ KPI gán theo VỊ TRÍ (`kpi_position_templates.position_id`),
-- nên mọi người cùng chức danh buộc phải dùng chung một bộ. Không đặt riêng
-- được cho một người, mà thực tế hai nhân viên cùng vị trí vẫn có thể được
-- giao trọng tâm khác nhau.
--
-- Bảng này KHÔNG thay thế mẫu theo vị trí — nó là lớp GÁN nằm trên. Thứ tự
-- ưu tiên khi mở phiếu chấm:
--   1. Bộ gán riêng cho người (bảng này)
--   2. Mẫu khớp vị trí của người đó
--   3. Không có -> người chấm tự chọn
--
-- Có ngày hiệu lực như cơ chế lương: đổi bộ KPI giữa năm là TẠO BẢN GHI MỚI,
-- các kỳ đã chấm giữ nguyên bộ cũ. Sửa đè sẽ làm phiếu cũ đổi cách tính sau
-- khi đã chốt, và không ai đối chiếu ra.
-- ============================================================================

create table if not exists public.employee_kpi_schemes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  template_id uuid not null references public.kpi_position_templates(id) on delete restrict,

  effective_from date not null default current_date,
  note text,

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Một người không có hai bộ KPI cùng ngày hiệu lực - nếu không thì không
  -- xác định được bộ nào thắng.
  unique (user_id, effective_from)
);

create index if not exists employee_kpi_schemes_user_idx
  on public.employee_kpi_schemes(user_id, effective_from desc);

comment on table public.employee_kpi_schemes is
  'Bộ KPI gán riêng cho từng người, có ngày hiệu lực. Thắng mẫu khớp theo vị trí.';

drop trigger if exists employee_kpi_schemes_touch on public.employee_kpi_schemes;
create trigger employee_kpi_schemes_touch
before update on public.employee_kpi_schemes
for each row execute function public.touch_payroll_updated_at();

-- ---------------------------------------------------------------------------
-- Bộ KPI đang áp cho một người tại một thời điểm
-- ---------------------------------------------------------------------------
create or replace function public.kpi_scheme_for(p_user uuid, p_on date default current_date)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    -- 1. Bản gán riêng có hiệu lực gần nhất tính tới ngày đang xét.
    (
      select s.template_id
      from public.employee_kpi_schemes s
      where s.user_id = p_user and s.effective_from <= p_on
      order by s.effective_from desc
      limit 1
    ),
    -- 2. Mẫu khớp vị trí, chỉ lấy mẫu đang bật.
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
  'Bộ KPI đang áp cho một người: ưu tiên bản gán riêng, sau đó tới mẫu theo vị trí. NULL = chưa có.';

revoke all on function public.kpi_scheme_for(uuid, date) from public;
grant execute on function public.kpi_scheme_for(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS - cùng phạm vi RC1.2
-- ---------------------------------------------------------------------------
alter table public.employee_kpi_schemes enable row level security;

-- Người xem được cơ chế KPI của chính mình; quản lý xem được người trong
-- phạm vi mình quản lý; Cấp 1 xem tất cả.
drop policy if exists employee_kpi_schemes_read on public.employee_kpi_schemes;
create policy employee_kpi_schemes_read on public.employee_kpi_schemes
for select to authenticated using (
  user_id = auth.uid()
  or public.is_admin()
  or public.manages_employee(user_id)
);

drop policy if exists employee_kpi_schemes_manage on public.employee_kpi_schemes;
create policy employee_kpi_schemes_manage on public.employee_kpi_schemes
for all to authenticated
using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.employee_kpi_schemes to authenticated;
