-- Người phụ trách một mục checklist phải mở được quy trình chứa mục đó.
-- Trước migration này họ nhận notification lifecycle_task nhưng RLS chặn
-- employee_lifecycle_processes, nên trang /staff/growth luôn rỗng.
--
-- Không viết EXISTS trực tiếp từ policy process sang bảng checklist: policy
-- checklist vốn đã tham chiếu ngược process và PostgreSQL sẽ phát hiện RLS
-- đệ quy. Hàm hẹp bên dưới chạy với quyền chủ sở hữu, chỉ trả boolean và cố
-- định search_path để không làm lộ dữ liệu checklist.

create or replace function public.owns_lifecycle_checklist(target_process_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.employee_checklist_items item
    where item.process_id = target_process_id
      and item.owner_id = auth.uid()
  );
$$;

revoke all on function public.owns_lifecycle_checklist(uuid) from public;
grant execute on function public.owns_lifecycle_checklist(uuid) to authenticated;

drop policy if exists lifecycle_read on public.employee_lifecycle_processes;
create policy lifecycle_read on public.employee_lifecycle_processes
for select to authenticated
using (
  user_id = auth.uid()
  or mentor_id = auth.uid()
  or public.can_function('admin.employee_lifecycle')
  or public.owns_lifecycle_checklist(id)
);

drop policy if exists checklist_read on public.employee_checklist_items;
create policy checklist_read on public.employee_checklist_items
for select to authenticated
using (
  owner_id = auth.uid()
  or exists (
    select 1
    from public.employee_lifecycle_processes process
    where process.id = process_id
      and (
        process.user_id = auth.uid()
        or process.mentor_id = auth.uid()
        or public.can_function('admin.employee_lifecycle')
      )
  )
);

-- Người được giao quản lý địa điểm phải bật/tắt được đúng cờ GPS nằm trên
-- cùng màn hình. Không mở quyền sửa các feature flag kỹ thuật khác.
drop policy if exists flags_geofence_location_manager on public.feature_flags;
create policy flags_geofence_location_manager on public.feature_flags
for update to authenticated
using (
  key = 'geofence_attendance'
  and public.can_function('admin.work_locations')
)
with check (
  key = 'geofence_attendance'
  and public.can_function('admin.work_locations')
);
