-- Nghỉ nửa ngày phải nói rõ nghỉ buổi nào để bảng công biết giờ vào/ra chuẩn.

alter table public.leave_requests
  add column if not exists half_day_period text;

-- Đơn nửa ngày cũ chưa chọn buổi: coi là nghỉ buổi chiều.
update public.leave_requests
   set half_day_period = 'afternoon'
 where half_day and half_day_period is null;

alter table public.leave_requests
  drop constraint if exists leave_requests_half_day_period_chk;
alter table public.leave_requests
  add constraint leave_requests_half_day_period_chk
  check (
    (half_day and half_day_period in ('morning', 'afternoon'))
    or (not half_day and half_day_period is null)
  );

comment on column public.leave_requests.half_day_period is
  'morning | afternoon — buổi được nghỉ khi half_day = true; null khi nghỉ cả ngày.';
