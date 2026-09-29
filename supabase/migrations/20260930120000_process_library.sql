-- ============================================================================
-- RC3.1 / RC3.2 / RC3.5 — Thư viện quy trình điện tử.
-- ----------------------------------------------------------------------------
-- BRD Huy Phong v1.0:
--   RC3.1 (Cao) "Thư viện quy trình/quy định điện tử: lưu trữ file PDF quy
--         trình, quy chế, hướng dẫn vận hành công ty."
--   RC3.2 (Cao) "Phân quyền truy cập thư viện theo phòng ban (Kế toán,
--         Marketing, Kinh doanh...) và theo quy trình liên phòng ban."
--   RC3.5 (TB)  "Quản lý thời hiệu quy trình: khi ban hành quy trình mới thay
--         thế, quy trình cũ TỰ ĐỘNG hết hiệu lực trên thư viện."
--
-- Mục 2A đánh dấu RC3.5 là điểm bắt buộc tuỳ chỉnh, 1Office không có.
--
-- RC3.5 cưỡng chế bằng TRIGGER, không để giao diện tự nhớ. Cả điểm nghiệp vụ
-- của yêu cầu này nằm ở chữ "tự động": người ban hành bản mới đang bận nghĩ
-- về nội dung bản mới, không phải đi tìm bản cũ để tắt. Để họ tự nhớ thì thư
-- viện sẽ tồn tại hai bản cùng hiệu lực, và người đọc không biết theo bản nào.
-- ============================================================================

create table if not exists public.process_documents (
  id uuid primary key default gen_random_uuid(),

  code text not null,
  title text not null check (length(trim(title)) >= 3),
  /* Phiên bản do người ban hành đặt: "v1.0", "2026-01", "Lần 3"… Không ép
     định dạng vì mỗi công ty đánh số một kiểu. */
  version_label text not null default 'v1.0',

  category text not null default 'PROCESS'
    check (category in ('PROCESS', 'POLICY', 'GUIDE', 'FORM')),

  /* Đường dẫn file trong Supabase Storage. */
  file_path text,
  file_name text,

  /* NULL = quy trình LIÊN PHÒNG BAN, cả công ty đọc được (RC3.2). */
  unit_id uuid references public.organization_units(id) on delete set null,

  status text not null default 'ACTIVE'
    check (status in ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED')),

  effective_from date not null default current_date,
  /* Do trigger RC3.5 điền khi có bản thay thế; không nhập tay. */
  superseded_at timestamptz,

  /* Bản này thay thế bản nào. Chính là chỗ RC3.5 bám vào. */
  supersedes_id uuid references public.process_documents(id) on delete set null,

  summary text,
  published_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  /* Cùng một mã thì mỗi phiên bản chỉ tồn tại một lần. */
  unique (code, version_label),
  /* Không tự thay thế chính mình — vòng lặp một node. */
  constraint process_document_no_self_supersede check (supersedes_id is distinct from id)
);

create index if not exists process_documents_active_idx
  on public.process_documents(status, effective_from desc);
create index if not exists process_documents_unit_idx
  on public.process_documents(unit_id);

comment on table public.process_documents is
  'Thư viện quy trình, quy chế, hướng dẫn (RC3.1). unit_id NULL = liên phòng ban.';
comment on column public.process_documents.supersedes_id is
  'Bản bị thay thế. Trigger RC3.5 tự chuyển bản đó sang SUPERSEDED.';

-- ---------------------------------------------------------------------------
-- RC3.5 — Thời hiệu tự động
-- ---------------------------------------------------------------------------
create or replace function public.apply_process_supersede()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- Chỉ bản đã BAN HÀNH mới làm bản cũ hết hiệu lực. Bản nháp còn sửa được,
  -- để nó tắt bản đang chạy là cắt mất quy trình hiện hành của công ty.
  if new.supersedes_id is null or new.status <> 'ACTIVE' then
    return new;
  end if;

  update public.process_documents
    set status = 'SUPERSEDED',
        superseded_at = now(),
        updated_at = now()
  where id = new.supersedes_id
    and status <> 'SUPERSEDED';

  return new;
end;
$fn$;

drop trigger if exists process_documents_supersede on public.process_documents;
create trigger process_documents_supersede
after insert or update of status, supersedes_id on public.process_documents
for each row execute function public.apply_process_supersede();

-- Chặn chuỗi thay thế vòng: A thay B, B thay A. Không chặn thì trigger trên
-- sẽ tắt lẫn nhau và thư viện không còn bản nào hiệu lực.
create or replace function public.guard_process_supersede_cycle()
returns trigger
language plpgsql
stable
set search_path = public
as $fn$
declare
  v_cursor uuid;
  v_depth integer := 0;
begin
  if new.supersedes_id is null then
    return new;
  end if;

  v_cursor := new.supersedes_id;
  while v_cursor is not null and v_depth < 20 loop
    if v_cursor = new.id then
      raise exception 'Chuỗi thay thế quy trình bị lặp vòng — kiểm tra lại bản được thay thế.'
        using errcode = 'check_violation';
    end if;
    select supersedes_id into v_cursor from public.process_documents where id = v_cursor;
    v_depth := v_depth + 1;
  end loop;

  return new;
end;
$fn$;

drop trigger if exists process_documents_cycle_guard on public.process_documents;
create trigger process_documents_cycle_guard
before insert or update of supersedes_id on public.process_documents
for each row execute function public.guard_process_supersede_cycle();

drop trigger if exists process_documents_touch on public.process_documents;
create trigger process_documents_touch
before update on public.process_documents
for each row execute function public.touch_payroll_updated_at();

-- ---------------------------------------------------------------------------
-- RC3.2 — Phân quyền đọc theo phòng ban
-- ---------------------------------------------------------------------------
alter table public.process_documents enable row level security;

-- Đọc được nếu: là tài liệu liên phòng ban (unit_id NULL), HOẶC thuộc đúng
-- đơn vị của người đọc, HOẶC người đọc quản lý đơn vị đó, HOẶC là Cấp 1.
-- Bản nháp chỉ người ban hành và Cấp 1 thấy.
drop policy if exists process_documents_read on public.process_documents;
create policy process_documents_read on public.process_documents
for select to authenticated using (
  public.is_admin()
  or published_by = auth.uid()
  or (
    status <> 'DRAFT'
    and (
      unit_id is null
      or unit_id = (select p.unit_id from public.profiles p where p.id = auth.uid())
      or exists (
        select 1 from public.organization_units u
        where u.id = process_documents.unit_id and u.manager_id = auth.uid()
      )
    )
  )
);

drop policy if exists process_documents_manage on public.process_documents;
create policy process_documents_manage on public.process_documents
for all to authenticated
using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.process_documents to authenticated;
