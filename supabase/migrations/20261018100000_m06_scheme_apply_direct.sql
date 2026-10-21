-- ============================================================================
-- Cơ chế lương: lưu là áp dụng ngay, không qua Ban Giám đốc duyệt.
-- ----------------------------------------------------------------------------
-- Người có chức năng thiết lập cơ chế (BGĐ, quản trị, kế toán trưởng) khi bấm
-- "Lưu & áp dụng" thì đề xuất được ghi thẳng vào bảng cơ chế, không còn bước
-- chờ ký. Bản nháp vẫn giữ nguyên. Đề xuất đang chờ duyệt từ trước vẫn duyệt
-- được qua `review_payroll_scheme_request`.
-- Vết kiểm toán và dấu vân tay nội dung vẫn ghi như khi duyệt.
-- ============================================================================

create or replace function public.save_payroll_scheme_request(
  p_request_id uuid,
  p_target_type text,
  p_user_id uuid,
  p_unit_id uuid,
  p_effective_from date,
  p_payload jsonb,
  p_note text,
  p_submit boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_request public.payroll_scheme_requests%rowtype;
  v_target uuid := coalesce(p_user_id, p_unit_id);
  v_id uuid;
  v_fingerprint text;
begin
  if auth.uid() is null or not public.can_function('admin.payroll_schemes') then
    raise exception 'Bạn không có quyền thiết lập cơ chế lương.' using errcode = '42501';
  end if;
  if p_target_type not in ('USER', 'UNIT') then
    raise exception 'Đối tượng không hợp lệ.' using errcode = '22023';
  end if;

  perform public.payroll_validate_scheme_payload(p_target_type, v_target, p_effective_from, p_payload, coalesce(p_submit, false));

  if p_request_id is null then
    if exists (
      select 1 from public.payroll_scheme_requests r
      where r.target_type = p_target_type and coalesce(r.user_id, r.unit_id) = v_target
        and r.status in ('DRAFT', 'SUBMITTED', 'REJECTED')
    ) then
      raise exception 'Đối tượng này đang có một bản nháp chưa xử lý xong — mở bản đó để sửa.' using errcode = '23505';
    end if;
    insert into public.payroll_scheme_requests (target_type, user_id, unit_id, effective_from, payload, note)
    values (
      p_target_type,
      case when p_target_type = 'USER' then p_user_id end,
      case when p_target_type = 'UNIT' then p_unit_id end,
      p_effective_from, p_payload, nullif(trim(coalesce(p_note, '')), '')
    )
    returning * into v_request;
  else
    select * into v_request from public.payroll_scheme_requests where id = p_request_id for update;
    if v_request.id is null then
      raise exception 'Không tìm thấy bản lưu.' using errcode = 'P0002';
    end if;
    if v_request.status not in ('DRAFT', 'REJECTED') then
      raise exception 'Bản này đã xử lý — không sửa được.' using errcode = '23514';
    end if;
    if v_request.target_type <> p_target_type or coalesce(v_request.user_id, v_request.unit_id) <> v_target then
      raise exception 'Không đổi được đối tượng.' using errcode = '22023';
    end if;
    update public.payroll_scheme_requests
    set effective_from = p_effective_from,
        payload = p_payload,
        note = nullif(trim(coalesce(p_note, '')), ''),
        status = 'DRAFT'
    where id = p_request_id
    returning * into v_request;
  end if;

  v_id := v_request.id;
  perform public.add_payroll_approval_event('SCHEME', v_id, 'SAVED', null,
    jsonb_build_object('effective_from', p_effective_from));

  if coalesce(p_submit, false) then
    v_fingerprint := encode(digest(
      p_target_type || '|' || v_target::text || '|' || p_effective_from::text || '|' || p_payload::text,
      'sha256'), 'hex');

    -- apply_payroll_scheme_request lấy người ghi từ submitted_by.
    v_request.submitted_by := auth.uid();
    perform public.apply_payroll_scheme_request(v_request);

    update public.payroll_scheme_requests
    set status = 'APPROVED', submitted_by = auth.uid(), submitted_at = now(),
        reviewed_by = auth.uid(), reviewed_at = now(), review_note = null,
        approval_fingerprint = v_fingerprint, applied_at = now()
    where id = v_id;

    perform public.add_payroll_approval_event('SCHEME', v_id, 'APPROVED', p_note,
      jsonb_build_object('fingerprint', v_fingerprint, 'direct', true));
    perform public.write_payroll_audit(
      'salary.scheme_apply', 'payroll_scheme_request', v_id::text,
      format('Áp dụng cơ chế lương %s từ %s', v_request.code, to_char(p_effective_from, 'MM/YYYY')),
      jsonb_build_object('payload', p_payload, 'fingerprint', v_fingerprint), p_user_id
    );
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_payroll_scheme_request(uuid, text, uuid, uuid, date, jsonb, text, boolean) from public;
grant execute on function public.save_payroll_scheme_request(uuid, text, uuid, uuid, date, jsonb, text, boolean) to authenticated;
