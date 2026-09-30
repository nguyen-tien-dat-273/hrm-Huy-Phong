-- ============================================================================
-- Bỏ hẳn OKR (performance_goals).
-- ----------------------------------------------------------------------------
-- BRD Huy Phong v1.0 đặt tên phân hệ 6 là "Quản lý KPI & Đánh giá" — không có
-- OKR ở bất kỳ yêu cầu nào từ RC6.1 tới RC6.4.
--
-- `performance_goals` là mô hình khác hẳn: giao một mục tiêu số cho từng
-- người rồi kéo thanh trượt cập nhật tiến độ. Nó KHÔNG tham gia tính final_pct,
-- không ảnh hưởng xếp loại, không đẩy sang bảng lương. Giao diện của nó đã gỡ
-- từ trước; bảng còn lại là dữ liệu chết.
--
-- ⚠️ MIGRATION NÀY XOÁ DỮ LIỆU, KHÔNG HOÀN TÁC ĐƯỢC.
-- Chạy câu dưới TRƯỚC để biết mình sắp xoá bao nhiêu dòng:
--
--   select count(*) from public.performance_goals;
--
-- Nếu số đó khác 0 và bạn còn cần, hãy xuất ra file trước khi chạy tiếp.
-- ============================================================================

-- In số dòng sắp mất ra NOTICE, để người chạy thấy ngay cả khi quên chạy câu
-- kiểm tra ở trên.
do $do$
declare
  v_count bigint := 0;
begin
  if to_regclass('public.performance_goals') is null then
    raise notice 'Bảng performance_goals không tồn tại — không có gì để xoá.';
    return;
  end if;

  execute 'select count(*) from public.performance_goals' into v_count;
  raise notice 'Sắp xoá bảng performance_goals cùng % dòng dữ liệu.', v_count;
end;
$do$;

drop table if exists public.performance_goals cascade;
