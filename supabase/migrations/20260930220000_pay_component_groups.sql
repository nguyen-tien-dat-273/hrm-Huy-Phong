-- ============================================================================
-- Nhom khoan luong, don trung khoan cong doan, tra lai dau tieng Viet.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Nhom: mot cap giua "loai" va tung khoan
-- ---------------------------------------------------------------------------
-- Danh muc dang chi gom theo `kind` - Khoan cong / Khoan tru / Chi phi doanh
-- nghiep. Ba nhom do la cach KE TOAN nhin, khong phai cach nguoi lam luong
-- nhin. Trong "Khoan cong" cua Huy Phong co it nhat nam cum tach bach:
--
--   Luong san luong : luong van chuyen, luong doanh so
--   Lam them gio    : ngay thuong, chu nhat/le, cong them sau 22h
--   Phu cap         : van phong, van chuyen theo ngay, cong tac theo tinh
--   Luong KPI       : quy tu KPI% sang tien
--   Thuong          : thuong thang
--
-- KHONG dung `parent_id` tro vao chinh bang nay: lam vay thi "Phu cap" tro
-- thanh mot khoan luong that, va engine phai tra loi cau hoi "khoan cha tinh
-- ra bao nhieu tien" - trong khi no chi la mot cai tieu de. Mot cot ten nhom
-- la du, va khong the sinh ra vong tron cha-con.
alter table public.payroll_components
  add column if not exists group_name text;

comment on column public.payroll_components.group_name is
  'Ten nhom de gom cac khoan cung co che lai voi nhau. Chi de sap xep danh muc, khong tham gia tinh toan.';

create index if not exists payroll_components_group_idx
  on public.payroll_components(group_name, sort_order);

-- ---------------------------------------------------------------------------
-- 2. Don khoan cong doan bi trung
-- ---------------------------------------------------------------------------
-- Migration 20260928100000 da dung san `QUY_CONG_DOAN` voi ghi chu ro rang:
-- cong thuc moi co ve luong thoi gian, "CHUA DU cho khoi Kinh doanh (thieu
-- ve doanh so). Sua formula khi L08-L10 co ma."
--
-- Migration 20260930210000 them dung hai ma do (LUONG_VAN_CHUYEN,
-- LUONG_DOANH_SO) nhung lai tao mot khoan MOI `PHI_CONG_DOAN` thay vi cap
-- nhat khoan da cho san. Ket qua la hai khoan cung tinh mot thu nam canh
-- nhau trong danh muc - ai gan nham ca hai thi nguoi lao dong bi tru hai lan.
--
-- Xu ly: hoan thien `QUY_CONG_DOAN` dung nhu no da cho, roi bo ban trung.
update public.payroll_components
   set formula = '(BASE_WORK + LUONG_VAN_CHUYEN + LUONG_DOANH_SO) * 0.01',
       note = '1% tren luong thoi gian cong luong doanh so/van chuyen, theo quy tac cua cong ty. '
              'Luu y: theo quy dinh, kinh phi cong doan 2% la doanh nghiep dong (khoan ER_UNION_FUND), '
              'con khoan tru vao luong nguoi lao dong la doan phi cong doan 1% tren luong dong BHXH (khoan UNION_FEE). '
              'Cong ty dang dung mot co so tinh khac ca hai - giu hay bo la quyet dinh cua cong ty.'
 where code = 'QUY_CONG_DOAN';

-- Chi xoa khi ban goc da duoc cap nhat, va chi khi chua ai duoc gan khoan do.
do $$
declare
  v_id uuid;
  v_used integer;
begin
  select id into v_id from public.payroll_components where code = 'PHI_CONG_DOAN';
  if v_id is null then
    return;
  end if;

  select count(*) into v_used from public.employee_pay_items where component_id = v_id;
  if v_used > 0 then
    -- Da co nguoi duoc gan: khong xoa sau lung nguoi dung, chi tat di va noi ro.
    update public.payroll_components
       set is_active = false,
           name = 'Phi cong doan (trung - dung QUY_CONG_DOAN)',
           note = 'Khoan nay trung voi QUY_CONG_DOAN. Da tat. Chuyen ' || v_used
                  || ' nguoi dang duoc gan sang QUY_CONG_DOAN roi xoa khoan nay.'
     where id = v_id;
    raise notice 'PHI_CONG_DOAN dang duoc gan cho % nguoi - da tat thay vi xoa.', v_used;
  else
    delete from public.payroll_components where id = v_id;
    raise notice 'Da xoa khoan trung PHI_CONG_DOAN.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Tra lai dau tieng Viet cho ten hien thi
-- ---------------------------------------------------------------------------
-- Migration 20260930210000 viet ten khong dau de tranh loi ma hoa khi dan tay
-- vao SQL Editor. Nhung rui ro do nam o ky tu SAP CHU (dau ba cham, nhay cong,
-- gach dai), khong phai o chu tieng Viet - ca he thong deu dung tieng Viet co
-- dau binh thuong. Ten hien thi thi nguoi dung doc hang ngay.
update public.payroll_components set name = 'Lương vận chuyển' where code = 'LUONG_VAN_CHUYEN';
update public.payroll_components set name = 'Lương doanh số' where code = 'LUONG_DOANH_SO';
update public.payroll_components set name = 'Làm thêm giờ ngày thường' where code = 'LUONG_OT_THUONG';
update public.payroll_components set name = 'Làm thêm giờ chủ nhật / ngày lễ' where code = 'LUONG_OT_LE';
update public.payroll_components set name = 'Cộng thêm làm sau 22h' where code = 'CONG_THEM_DEM';
update public.payroll_components set name = 'Phụ cấp văn phòng' where code = 'PC_VAN_PHONG';
update public.payroll_components set name = 'Phụ cấp vận chuyển theo ngày' where code = 'PC_VAN_CHUYEN';
update public.payroll_components set name = 'Phụ cấp công tác theo tỉnh' where code = 'PC_CONG_TAC_TINH';
update public.payroll_components set name = 'Thưởng' where code = 'THUONG_THANG';
update public.payroll_components set name = 'Phạt' where code = 'PHAT_THANG';

-- ---------------------------------------------------------------------------
-- 4. Gom nhom cho cac khoan da co
-- ---------------------------------------------------------------------------
update public.payroll_components
   set group_name = case
     when code in ('LUONG_VAN_CHUYEN', 'LUONG_DOANH_SO') then 'Lương sản lượng'
     when code in ('LUONG_OT_THUONG', 'LUONG_OT_LE', 'CONG_THEM_DEM') then 'Làm thêm giờ'
     when code in ('PC_VAN_PHONG', 'PC_VAN_CHUYEN', 'PC_CONG_TAC_TINH') then 'Phụ cấp'
     when code = 'LUONG_KPI' then 'Lương KPI'
     when code = 'THUONG_THANG' then 'Thưởng'
     when code in ('PHAT_THANG', 'ADVANCE', 'PENALTY') then 'Khấu trừ khác'
     when code in ('QUY_CONG_DOAN', 'UNION_FEE', 'ER_UNION_FUND') then 'Công đoàn'
     else group_name
   end
 where group_name is null;
