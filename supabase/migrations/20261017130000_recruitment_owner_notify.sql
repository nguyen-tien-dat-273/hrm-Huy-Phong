-- F01.03: người phụ trách đề xuất tuyển dụng (hiring_manager_id) và người lập
-- đề xuất (requested_by) được báo khi có hồ sơ, được chọn/đổi người phụ trách,
-- và được xem CV của ứng viên thuộc đề xuất mình.

-- ---------------------------------------------------------------------------
-- 1. Thông báo cho người phụ trách + người đề xuất
-- ---------------------------------------------------------------------------
create or replace function public.notify_recruitment_owners(
  target_requisition uuid, notice_type text, notice_title text, notice_message text
)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (id, user_id, type, title, message, created_by)
  select gen_random_uuid(), owner_id, notice_type, notice_title, notice_message, auth.uid()
  from (
    select distinct unnest(array[r.requested_by, r.hiring_manager_id]) as owner_id
    from public.recruitment_requisitions r
    where r.id = target_requisition
  ) owners
  join public.profiles p on p.id = owners.owner_id and p.is_active
  -- Người tự nhập ứng viên thì không cần báo lại cho chính mình.
  where owners.owner_id is distinct from auth.uid();
$$;
revoke all on function public.notify_recruitment_owners(uuid, text, text, text) from public, anon, authenticated;

-- Mọi nguồn tạo ứng viên (form HRM, Google Forms, HR nhập tay) đều đi qua đây.
create or replace function public.trg_notify_new_recruitment_candidate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_recruitment_owners(
    new.requisition_id,
    'recruitment_candidate_new',
    'Hồ sơ ứng tuyển mới',
    coalesce((select r.title from public.recruitment_requisitions r where r.id = new.requisition_id), 'Tuyển dụng')
      || ' · ' || new.full_name
  );
  return new;
end;
$$;
revoke all on function public.trg_notify_new_recruitment_candidate() from public;
drop trigger if exists recruitment_candidate_notify_owners on public.recruitment_candidates;
create trigger recruitment_candidate_notify_owners
after insert on public.recruitment_candidates
for each row execute function public.trg_notify_new_recruitment_candidate();

-- BR-006: ứng viên nộp lại cùng email -> CV mới gắn vào hồ sơ cũ (uploaded_by null).
create or replace function public.trg_notify_recruitment_resubmission()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cand record;
begin
  if new.uploaded_by is not null then return new; end if;
  if not exists (
    select 1 from public.recruitment_candidate_documents d
    where d.candidate_id = new.candidate_id and d.id <> new.id
  ) then
    return new; -- CV đầu tiên: đã báo ở trigger tạo ứng viên.
  end if;
  select c.requisition_id, c.full_name, r.title into cand
  from public.recruitment_candidates c
  join public.recruitment_requisitions r on r.id = c.requisition_id
  where c.id = new.candidate_id;
  perform public.notify_recruitment_owners(
    cand.requisition_id, 'recruitment_candidate_resubmit',
    'Ứng viên nộp lại hồ sơ', cand.title || ' · ' || cand.full_name
  );
  return new;
end;
$$;
revoke all on function public.trg_notify_recruitment_resubmission() from public;
drop trigger if exists recruitment_candidate_document_notify on public.recruitment_candidate_documents;
create trigger recruitment_candidate_document_notify
after insert on public.recruitment_candidate_documents
for each row execute function public.trg_notify_recruitment_resubmission();

-- ---------------------------------------------------------------------------
-- 2. Người lập đề xuất chọn người phụ trách (trước đây buộc = chính mình)
-- ---------------------------------------------------------------------------
drop policy if exists recruitment_requisitions_create on public.recruitment_requisitions;
create policy recruitment_requisitions_create on public.recruitment_requisitions for insert to authenticated
  with check (
    (public.can('projects') or public.can('users'))
    and requested_by = auth.uid()
    and exists (select 1 from public.profiles p where p.id = hiring_manager_id and p.is_active)
    and status in ('DRAFT', 'SUBMITTED')
  );

-- ---------------------------------------------------------------------------
-- 3. Người phụ trách / người đề xuất đọc được CV ứng viên của đề xuất mình
-- ---------------------------------------------------------------------------
create or replace function public.can_read_candidate_document(target_candidate uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1
    from public.recruitment_candidates c
    join public.recruitment_requisitions r on r.id = c.requisition_id
    where c.id = target_candidate
      and (r.requested_by = auth.uid() or r.hiring_manager_id = auth.uid())
  );
$$;
revoke all on function public.can_read_candidate_document(uuid) from public, anon;
grant execute on function public.can_read_candidate_document(uuid) to authenticated;

drop policy if exists recruitment_candidate_documents_owner_read on public.recruitment_candidate_documents;
create policy recruitment_candidate_documents_owner_read on public.recruitment_candidate_documents
  for select to authenticated
  using (public.can_read_candidate_document(candidate_id));

drop policy if exists candidate_documents_storage_owner_read on storage.objects;
create policy candidate_documents_storage_owner_read on storage.objects for select to authenticated
  using (
    bucket_id = 'candidate-documents'
    and exists (
      select 1 from public.recruitment_candidate_documents d
      where d.storage_path = storage.objects.name
        and public.can_read_candidate_document(d.candidate_id)
    )
  );

notify pgrst, 'reload schema';
