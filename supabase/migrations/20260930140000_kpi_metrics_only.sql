-- ============================================================================
-- KPI chỉ sinh THÔNG SỐ; tiền lương do module lương tính.
-- ----------------------------------------------------------------------------
-- Ranh giới đúng theo yêu cầu của chủ dự án:
--   KPI ra CON SỐ  -> KPI_PCT (phần trăm kết quả)
--   Lương ra TIỀN  -> khoản LUONG_KPI trong Danh mục khoản lương
--
-- Hiện trạng lệch: `kpi_position_templates.default_kpi_amount` là một con số
-- TIỀN LƯƠNG nằm trong module KPI, và nó được đẩy sang bảng lương dưới tên
-- KPI_TARGET. Hệ quả:
--   - Tăng mức lương KPI cho một người phải vào sửa MẪU KPI, mà mẫu dùng
--     chung cho mọi người cùng vị trí -> sửa cho một người là đổi cả nhóm.
--   - Hai nơi cùng giữ tiền lương: Cơ chế lương và mẫu KPI. Kế toán không
--     biết sửa ở đâu.
--
-- Sau migration này:
--   - KPI chỉ đẩy KPI_PCT sang payroll_inputs.
--   - Mức lương KPI của từng người khai như MỌI khoản lương khác: gán khoản
--     LUONG_KPI ở Cơ chế lương (cho đơn vị hoặc cho từng người).
--   - Công thức dùng biến MUC_RIENG = mức gán cho chính khoản đó.
--
-- `default_kpi_amount` GIỮ NGUYÊN, không xoá: nó đang là nguồn duy nhất của
-- mức lương KPI hiện có. Xoá là mất dữ liệu. Nó trở thành giá trị mặc định
-- gợi ý, không còn tham gia tính lương.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Công thức khoản Lương KPI đọc mức riêng của từng người
-- ---------------------------------------------------------------------------
update public.payroll_components
set formula = 'MUC_RIENG * KPI_PCT / 100',
    note = 'Mức lương KPI khai ở Cơ chế lương (gán cho đơn vị hoặc từng người). '
        || 'KPI_PCT do module KPI đẩy sang khi khoá phiếu chấm. '
        || 'MUC_RIENG = mức tiền gán cho chính khoản này.'
where code = 'LUONG_KPI';

-- Mức mặc định của danh mục = 0: buộc phải gán mức cho người hoặc đơn vị,
-- thay vì âm thầm trả một con số chung cho cả công ty.
update public.payroll_components
set default_amount = 0
where code = 'LUONG_KPI' and default_amount > 0;

-- ---------------------------------------------------------------------------
-- 2. Khoá phiếu KPI chỉ đẩy KPI_PCT
-- ---------------------------------------------------------------------------
create or replace function public.sync_kpi_review_to_payroll_inputs(
  p_review public.performance_reviews
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_month_start date;
begin
  select date_trunc('month', c.start_date)::date into v_month_start
  from public.performance_cycles c
  where c.id = p_review.cycle_id;

  if v_month_start is null then
    return;
  end if;

  -- Chỉ con số kết quả. Tiền lương là việc của module lương.
  insert into public.payroll_inputs (user_id, month_start, code, value, note)
  values (
    p_review.user_id, v_month_start, 'KPI_PCT', coalesce(p_review.final_pct, 0),
    'Tự động từ phiếu KPI đã khoá.'
  )
  on conflict (user_id, month_start, code)
  do update set value = excluded.value, note = excluded.note;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Dọn KPI_TARGET đã đẩy sang trước đây
-- ---------------------------------------------------------------------------
-- Để lại thì bảng Số liệu lương tháng còn một cột không công thức nào dùng,
-- và người sau sẽ mất thời gian tìm xem nó phục vụ cái gì.
delete from public.payroll_inputs where code = 'KPI_TARGET';

comment on column public.kpi_position_templates.default_kpi_amount is
  'Mức lương KPI gợi ý của vị trí. KHÔNG còn tham gia tính lương — mức thật khai ở Cơ chế lương, khoản LUONG_KPI.';
