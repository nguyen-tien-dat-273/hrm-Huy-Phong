-- Thiết bị nhận Web Push của từng tài khoản. Endpoint là định danh bí mật do
-- trình duyệt cấp; không cho người dùng đọc hoặc sửa thiết bị của người khác.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_read_own on public.push_subscriptions;
create policy push_subscriptions_read_own on public.push_subscriptions
for select to authenticated using (user_id = auth.uid());

drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own on public.push_subscriptions
for delete to authenticated using (user_id = auth.uid());

grant select, delete on public.push_subscriptions to authenticated;

-- Cùng một trình duyệt chỉ có một endpoint. SECURITY DEFINER cho phép chuyển
-- endpoint sang tài khoản vừa đăng nhập mà không cho client tự chọn user_id.
create or replace function public.save_my_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if length(p_endpoint) < 20 or length(p_p256dh) < 20 or length(p_auth) < 8 then
    raise exception 'invalid_push_subscription';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, nullif(left(p_user_agent, 500), ''))
  on conflict (endpoint) do update set
    user_id = auth.uid(),
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_agent = excluded.user_agent,
    updated_at = now();
end;
$$;

revoke all on function public.save_my_push_subscription(text, text, text, text) from public;
grant execute on function public.save_my_push_subscription(text, text, text, text) to authenticated;

-- Ghi người tạo để API chỉ được đẩy đúng các thông báo do phiên hiện tại vừa
-- tạo, không thể mượn API để gửi tùy ý cho toàn công ty.
alter table public.notifications
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists push_sent_at timestamptz;

create index if not exists notifications_created_by_idx
  on public.notifications(created_by, created_at desc);

-- Chuông trên giao diện phải nhảy ngay khi hàng thông báo được tạo. Thêm có
-- điều kiện vì môi trường cũ có thể đã bật realtime cho bảng này từ trước.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
