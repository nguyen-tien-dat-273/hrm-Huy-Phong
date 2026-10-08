-- ONLY run this in a disposable/staging Supabase project, never production.
-- Demo login: demo.admin@example.test / DemoAdmin123!

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '00000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'demo.admin@example.test',
  extensions.crypt('DemoAdmin123!', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"name":"Demo Admin"}'::jsonb,
  now(),
  now()
)
on conflict (id) do update
set email = excluded.email,
    encrypted_password = excluded.encrypted_password,
    email_confirmed_at = excluded.email_confirmed_at,
    raw_app_meta_data = excluded.raw_app_meta_data,
    raw_user_meta_data = excluded.raw_user_meta_data,
    updated_at = now();

insert into public.profiles (
  id,
  name,
  email,
  role,
  is_active,
  must_change_password
)
values (
  '00000000-0000-4000-8000-000000000001',
  'Demo Admin',
  'demo.admin@example.test',
  'admin',
  true,
  false
)
on conflict (id) do update
set name = excluded.name,
    email = excluded.email,
    role = excluded.role,
    is_active = excluded.is_active,
    must_change_password = excluded.must_change_password;
