-- ============================================================================
-- Gộp Chu kỳ đánh giá vào phiếu chấm: kỳ là một THÁNG, không phải một thực thể.
-- ----------------------------------------------------------------------------
-- `performance_cycles` chỉ đang làm đúng một việc có ích: nói cho bảng lương
-- biết kết quả này thuộc tháng nào. Mọi thứ còn lại của nó (tên, ngày bắt đầu,
-- ngày kết thúc, trạng thái) là lớp bọc quanh con số ấy.
--
-- Nó cũng không dính gì tới bộ tiêu chí KPI: chu kỳ không tham chiếu bộ nào,
-- bộ không biết chu kỳ nào tồn tại. Hai thứ chỉ gặp nhau ở bước chấm. Vậy mà
-- nút "Chu kỳ đánh giá" lại nằm ở vị trí hành động chính của trang, khiến
-- người dùng tưởng đó là bước khởi đầu.
--
-- Tệ hơn, nó tạo ra một cái bẫy thật: chu kỳ "Quý 3" bắt đầu 01/07 thì kết quả
-- rơi vào kỳ lương THÁNG 07, dù đang chấm cho tháng 09 — vì cầu nối lấy
-- date_trunc('month', cycle.start_date).
--
-- Sau migration này kỳ chấm là một cột `period_month` ngay trên phiếu, giống
-- hệt cách Bảng lương dùng tháng: chọn trên màn hình, không phải tạo trước.
--
-- `performance_cycles` GIỮ LẠI, không xoá: phiếu cũ đang trỏ vào nó, và xoá
-- là mất dấu vết kỳ nào đã chấm. Nó thành dữ liệu lịch sử, không còn ai tạo.
-- ============================================================================

alter table public.performance_reviews
  add column if not exists period_month date;

comment on column public.performance_reviews.period_month is
  'Tháng của kỳ chấm (ngày đầu tháng). Thay cho cycle_id — kỳ là một tháng, không phải một thực thể.';

-- Chuyển dữ liệu cũ: lấy tháng từ chu kỳ mà phiếu đang trỏ tới.
update public.performance_reviews r
set period_month = date_trunc('month', c.start_date)::date
from public.performance_cycles c
where r.cycle_id = c.id and r.period_month is null;

-- Phiếu không còn chu kỳ hợp lệ (chu kỳ đã xoá): lùi về tháng tạo phiếu, để
-- không có dòng nào mất kỳ.
update public.performance_reviews
set period_month = date_trunc('month', coalesce(updated_at, now()))::date
where period_month is null;

alter table public.performance_reviews
  alter column period_month set not null,
  alter column period_month set default date_trunc('month', current_date)::date;

alter table public.performance_reviews
  add constraint performance_review_period_is_month
  check (period_month = date_trunc('month', period_month)::date)
  not valid;

-- Chu kỳ không còn bắt buộc. Phiếu mới tạo ra sẽ để trống cột này.
alter table public.performance_reviews
  alter column cycle_id drop not null;

-- Một người một phiếu mỗi tháng. Ràng buộc cũ khoá theo (cycle_id, user_id)
-- không còn nghĩa khi cycle_id để trống.
alter table public.performance_reviews
  drop constraint if exists performance_reviews_cycle_id_user_id_key;
-- Phong truong hop moi truong nay co chi muc roi, khong gan voi rang buoc nao.
drop index if exists performance_reviews_cycle_id_user_id_key;
create unique index if not exists performance_reviews_period_user_idx
  on public.performance_reviews(period_month, user_id);

-- ---------------------------------------------------------------------------
-- Cầu nối sang lương lấy tháng TRỰC TIẾP
-- ---------------------------------------------------------------------------
-- Bớt một bước là bớt một chỗ để sai. Không còn cảnh chu kỳ đặt tên một đằng,
-- tháng lương rơi một nẻo.
create or replace function public.sync_kpi_review_to_payroll_inputs(
  p_review public.performance_reviews
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_review.period_month is null then
    return;
  end if;

  insert into public.payroll_inputs (user_id, month_start, code, value, note)
  values (
    p_review.user_id, p_review.period_month, 'KPI_PCT', coalesce(p_review.final_pct, 0),
    'Tự động từ phiếu KPI đã khoá.'
  )
  on conflict (user_id, month_start, code)
  do update set value = excluded.value, note = excluded.note;
end;
$fn$;
