-- Thông tin liên hệ do chính người dùng cập nhật ở trang Hồ sơ cá nhân.
-- Giao diện đã có trường này nhưng schema production cũ chưa từng được thêm
-- cột, khiến PostgREST từ chối cả tên lẫn số điện thoại trong cùng request.

alter table public.profiles
  add column if not exists phone text;

alter table public.profiles
  drop constraint if exists profiles_phone_format;

alter table public.profiles
  add constraint profiles_phone_format check (
    phone is null
    or phone ~ '^[0-9+().[:space:]-]{6,20}$'
  );

comment on column public.profiles.phone is
  'So dien thoai lien he do nguoi dung tu cap nhat; khong dung de dang nhap.';

-- Supabase/PostgREST thường tự nhận DDL, nhưng gửi tín hiệu rõ ràng để phiên
-- đang mở không tiếp tục dùng schema cache cũ ngay sau khi migration chạy.
notify pgrst, 'reload schema';
