-- ============================================================================
-- M06 — Điều chỉnh lương gắn vào MỘT đầu mục của phiếu.
-- ----------------------------------------------------------------------------
-- Trước đây điều chỉnh chỉ là một dòng "tăng / giảm" ở cuối phiếu, không nói
-- cộng trừ vào khoản nào. `component_code` cho biết điều chỉnh này sửa số của
-- đầu mục nào (mã đầu mục trong danh mục lương); để trống = dòng điều chỉnh
-- riêng như cũ. Không đặt khoá ngoại: mã đầu mục có thể được đổi / ngưng dùng
-- sau này, còn điều chỉnh đã ghi vẫn phải đọc được.
-- ============================================================================

alter table public.payroll_adjustments
  add column if not exists component_code text;

comment on column public.payroll_adjustments.component_code is
  'Mã đầu mục mà điều chỉnh cộng / trừ vào. Trống: dòng điều chỉnh riêng ở cuối phiếu.';
