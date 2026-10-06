// ============================================================================
// Khai cách tính một khoản lương, đọc như một dòng phương trình.
// ----------------------------------------------------------------------------
//     Lương công  =  [ Lương cơ bản ]  ×  [ Ngày hưởng lương ]  × [ ]  ÷100
//
// Năm ô, bốn ô sau đều bỏ trống được:
//
//   vế tiền   số khai riêng, một khoản khác, một mức hệ thống (tiền một giờ,
//             lương thời gian...), tổng mấy khoản cộng lại, hoặc KHÔNG CÓ —
//             khi cả khoản chính là con số quản lý nhập (Thưởng, Phạt).
//   số liệu   ngày công, giờ công, KPI%, hay số liệu tháng tự đặt.
//   hệ số     con số nhân thêm, ví dụ ×2 của làm thêm giờ.
//   ÷100      khi vế tiền hoặc số liệu khai theo phần trăm.
//   chia công chuẩn   hai ô tiền ở dưới, chỉ hiện khi số liệu là ngày công.
//
// Bỏ trống cả bốn ô sau thì khoản đó là khoản CỐ ĐỊNH — không cần một nút
// chọn loại riêng.
//
// VÌ SAO NHIỀU Ô ĐẾN THẾ: bản đầu chỉ có `tiền × số liệu`, và 12 trong 14 công
// thức công ty đang dùng không khai nổi bằng nó (xem khối kiểm chứng "công
// thức THẬT của công ty" trong `lib/__tests__/flows.check.ts`). Bốn ô kia là
// đúng những gì còn thiếu, không phải thêm cho đủ bộ.
//
// CÁ NHÂN HOÁ: ô vế tiền chỉ liệt kê khoản đã khai cho NGƯỜI ĐANG XEM. Khoản
// lương gán theo từng người, nên `LUONG_CB` trong công thức chỉ có số khi
// chính người đó cũng được gán khoản đó. Trỏ vào khoản chưa khai cho họ thì
// engine tính phần ấy bằng 0đ — đúng về số nhưng rất dễ nhầm, nên nói trước
// thay vì để phát hiện lúc đã trả lương thiếu.
//
// Số liệu tháng không phải khai thêm ở đâu: màn "Số liệu lương tháng" quét
// công thức của mọi khoản đã gán, thấy một biến lạ là tự dựng cột nhập liệu và
// đặt tên cột theo tên khoản dùng biến đó.
//
// Công thức sinh ra, lưu và xoá nằm ở hàng tiêu đề của khoản (do
// `PaySchemeModal` dựng), không nằm trong này — để mọi khoản có cùng một hàng
// thao tác ở cùng một chỗ.
// ============================================================================

import { useMemo, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { evaluateFormula } from '@/lib/payrollFormula';
import { formatVND } from '@/lib/utils';
import {
  buildPayFormula, parsePayFormula,
  DEFAULT_GUIDED, isDayCount, MONEY_RATES, SYSTEM_VARIABLES,
  type GuidedPayFormula,
} from '@/lib/payItemFormula';
import type { PayComponent } from '@/types';

/** Giá trị riêng của ô vế tiền, không trùng mã khoản nào. */
const NHAP_TAY = '__SO__';
const KHONG_CO = '__KHONG__';
const CONG_GOP = '__TONG__';

interface Props {
  /** Tên khoản đang khai — vế trái của phương trình. */
  componentName: string;
  /** Công thức hiện tại, dạng chuỗi — thứ thật sự được lưu và chạy. */
  formula: string;
  onFormulaChange: (next: string) => void;
  /** Số tiền khai riêng cho người này (biến `MUC_RIENG`). */
  amount: string;
  onAmountChange: (next: string) => void;
  components: PayComponent[];
  /** Khoản đang khai — tự loại ra để không tham chiếu chính nó. */
  selfCode?: string | null;
  /** Mã các khoản ĐÃ khai cho chính người này. */
  assignedCodes: readonly string[];
  sampleScope: Readonly<Record<string, number>>;
}

export function PayItemFormulaPicker({
  componentName, formula, onFormulaChange, amount, onAmountChange,
  components, selfCode, assignedCodes, sampleScope,
}: Props) {
  const usable = useMemo(
    () => components.filter((item) => item.is_active && item.code && item.code !== selfCode),
    [components, selfCode],
  );
  const codes = useMemo(() => usable.map((item) => item.code), [usable]);
  /** Mọi mã khoản trong danh mục, để biết một mã là khoản hay là số liệu. */
  const catalogCodes = useMemo(() => new Set(codes), [codes]);

  const assigned = useMemo(() => new Set(assignedCodes), [assignedCodes]);
  /** Chỉ các khoản ĐÃ khai cho chính người này. */
  const daKhai = useMemo(
    () => usable.filter((item) => assigned.has(item.code)),
    [usable, assigned],
  );

  /**
   * Mã số liệu tháng mà công ty đã dùng ở đâu đó trong danh mục.
   *
   * Nhãn PHẢI kèm mã. Số liệu tháng lấy tên theo khoản dùng nó, nên khoản
   * "Lương vận chuyển" (`LUONG_VAN_CHUYEN`) và số chuyến của nó (`SO_CHUYEN`)
   * hiện ra hai dòng TRÙNG TÊN trong cùng một ô chọn — một dòng là tiền, một
   * dòng là số đếm, chọn nhầm là sai tiền mà nhìn không ra.
   */
  const inputCodes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of components) {
      if (item.is_active && item.input_code && !seen.has(item.input_code)) {
        seen.set(item.input_code, `${item.name} (${item.input_code})`);
      }
    }
    return [...seen].map(([code, label]) => ({ code, label }));
  }, [components]);
  const inputCodeList = useMemo(() => inputCodes.map((item) => item.code), [inputCodes]);

  const guided = parsePayFormula(formula, codes, inputCodeList) ?? DEFAULT_GUIDED;
  const set = (patch: Partial<GuidedPayFormula>) =>
    onFormulaChange(buildPayFormula({ ...guided, ...patch }));

  const scope = useMemo(
    () => ({ ...sampleScope, MUC_RIENG: Number(amount || 0) }),
    [sampleScope, amount],
  );
  const valueOf = (prorate: boolean) => {
    try {
      return evaluateFormula(buildPayFormula({ ...guided, prorate }), scope).value;
    } catch {
      return null;
    }
  };

  const source = guided.source;

  /**
   * Có mở phần "nhân thêm" ra không.
   *
   * Phần lớn khoản chỉ là một con số cố định. Bày sẵn cả ô số liệu, ô hệ số và
   * nút ÷100 cho mọi khoản thì người khai phải lướt qua bốn ô không bao giờ
   * dùng. Giấu đi, chỉ hiện khi công thức THẬT SỰ có nhân chia, hoặc khi người
   * dùng tự bấm mở.
   *
   * `moRong` là trạng thái riêng chứ không suy từ công thức: vừa bấm mở thì
   * công thức vẫn chưa có gì để suy ra, suy lại là nó đóng sập ngay.
   */
  const [moRong, setMoRong] = useState(false);
  const coNhanChia = !!guided.variable || !!guided.coefficient || guided.percent;
  // Không có vế tiền thì số liệu là tất cả những gì còn lại — không giấu được.
  const hienNhan = moRong || coNhanChia || source.kind === 'NONE';
  /**
   * Đang ở chế độ cộng gộp — trạng thái RIÊNG, không suy từ công thức.
   *
   * Tổng của MỘT mã sinh ra chuỗi y hệt một mã lẻ (`LUONG_VAN_CHUYEN`), nên
   * đọc lại nó ra `CODE` chứ không ra `SUM`. Suy từ công thức thì vừa bấm
   * "Cộng nhiều khoản" là màn hình nhảy ngay về một khoản đơn, các nút cộng
   * biến mất, và không bao giờ cộng được mã thứ hai.
   */
  const [gopThuCong, setGopThuCong] = useState(false);

  /** Các mã đang cộng; `null` nghĩa là không ở chế độ cộng gộp. */
  const sumCodes: string[] | null = source.kind === 'SUM' ? [...source.codes]
    : !gopThuCong ? null
    // Vừa bật gộp từ một khoản lẻ: chính khoản đó là thành viên đầu tiên.
    : source.kind === 'CODE' ? [source.code]
    : [];
  const dangGop = sumCodes !== null;

  /** Giá trị đang chọn ở ô vế tiền. */
  const sourceValue = dangGop ? CONG_GOP
    : source.kind === 'FIXED' ? NHAP_TAY
    : source.kind === 'NONE' ? KHONG_CO
    : source.kind === 'SUM' ? CONG_GOP
    : source.code;

  /** Các mã mà công thức đang trỏ tới. */
  const referenced = sumCodes ?? (source.kind === 'CODE' ? [source.code] : []);
  /**
   * Khoản mà CHÍNH NGƯỜI NÀY chưa được gán.
   *
   * Chỉ xét mã nằm trong danh mục: mức hệ thống và số liệu tháng không gán
   * theo người nên không bao giờ thiếu.
   */
  const thieu = referenced.filter((code) => catalogCodes.has(code) && !assigned.has(code));

  /**
   * Khoản đang được chọn nhưng KHÔNG còn trong danh sách đã khai.
   *
   * Xảy ra khi công thức lưu từ trước trỏ tới một khoản, rồi khoản đó bị bỏ
   * tick. Nếu không đưa nó vào danh sách thì `<select>` không tìm thấy giá trị
   * và tự hiện dòng đầu — màn hình nói một đằng, công thức lưu một nẻo, và
   * bấm Lưu là ghi đè mất. Nên vẫn liệt kê, kèm chữ nói rõ nó chưa khai.
   */
  const nguonLac = source.kind === 'CODE' && thieu.includes(source.code)
    ? usable.find((item) => item.code === source.code) ?? null
    : null;

  const onSource = (value: string) => {
    if (value === CONG_GOP) {
      setGopThuCong(true);
      // Đang trỏ một khoản thì GIỮ NGUYÊN công thức, khoản đó thành thành viên
      // đầu. Không thì mở ra với danh sách rỗng để người dùng tự tick.
      if (source.kind !== 'CODE') set({ source: { kind: 'SUM', codes: [] } });
      return;
    }
    setGopThuCong(false);
    if (value === NHAP_TAY) return set({ source: { kind: 'FIXED' } });
    if (value === KHONG_CO) {
      // Không có vế tiền thì PHẢI có số liệu, nếu không công thức rỗng. Và
      // không còn gì để chia cho ngày công chuẩn.
      const fallback = guided.variable ?? inputCodeList[0] ?? 'PAID_DAYS';
      return set({ source: { kind: 'NONE' }, variable: fallback, prorate: false });
    }
    set({ source: { kind: 'CODE', code: value } });
  };

  /** Bật/tắt một mã trong phép cộng gộp. */
  const toggleSum = (code: string) => {
    if (!sumCodes) return;
    const next = sumCodes.includes(code)
      ? sumCodes.filter((item) => item !== code)
      : [...sumCodes, code];
    set({ source: { kind: 'SUM', codes: next } });
  };

  /**
   * Bỏ focus khi lăn chuột trên ô chọn.
   *
   * Một `<select>` ĐANG FOCUS mà lăn chuột qua là trình duyệt đổi luôn giá trị
   * của nó. Modal này dài, cuộn là thao tác bình thường, nên sau khi bấm vào
   * một ô chọn rồi cuộn tiếp là công thức lương của người ta đổi mà không ai
   * bấm gì — rồi bấm "Lưu cơ chế lương" là ghi thẳng xuống database. Đã dựng
   * lại được trên máy: nguồn tự nhảy từ MUC_RIENG sang INSURANCE_BASE.
   *
   * Bỏ focus thay vì chặn `wheel`: chặn thì trang không cuộn được nữa.
   */
  const boFocusKhiLan = (event: React.WheelEvent<HTMLSelectElement>) => {
    if (document.activeElement === event.currentTarget) event.currentTarget.blur();
  };

  // `min-w` chứ KHÔNG phải `min-w-0`: năm ô không vừa một dòng trong modal, và
  // với `min-w-0` thì flex co chúng lại thay vì xuống dòng — ô chọn teo còn hai
  // ký tự ("Nh▾"), không đọc được đang chọn gì. Có mức sàn thì nó wrap.
  const slot = 'min-w-[150px] flex-1 rounded-lg border px-2.5 py-1.5 text-sm outline-none transition'
    + ' focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20';
  const tone = thieu.length > 0 ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white';

  /** Mã dùng được trong phép cộng gộp: khoản của người này + mức hệ thống. */
  const sumChoices = [
    ...daKhai.map((item) => ({ code: item.code, label: item.name })),
    ...MONEY_RATES,
  ];

  return (
    <div className="space-y-2.5">
      {/* --- Dòng phương trình --- */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="shrink-0 text-sm font-bold text-slate-800">{componentName}</span>
        <span className="shrink-0 text-base text-slate-400">=</span>

        <select
          value={sourceValue}
          onChange={(event) => onSource(event.target.value)}
          onWheel={boFocusKhiLan}
          className={`${slot} ${tone}`}
        >
          <option value={NHAP_TAY}>Nhập số cố định…</option>
          <option value={KHONG_CO}>Không có — chỉ lấy số liệu</option>
          <option value={CONG_GOP}>Cộng nhiều khoản…</option>
          {daKhai.length > 0 && (
            <optgroup label="Khoản đã khai cho người này">
              {daKhai.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}
            </optgroup>
          )}
          <optgroup label="Mức hệ thống">
            {MONEY_RATES.map((item) => (
              <option key={item.code} value={item.code}>{item.label}</option>
            ))}
          </optgroup>
          {inputCodes.length > 0 && (
            <optgroup label="Số liệu quản lý nhập hằng tháng">
              {inputCodes.map((item) => (
                <option key={item.code} value={item.code}>{item.label}</option>
              ))}
            </optgroup>
          )}
          {nguonLac && (
            <option value={nguonLac.code}>{nguonLac.name} — chưa khai cho người này</option>
          )}
        </select>

        {source.kind === 'FIXED' && (
          <input
            inputMode="decimal"
            placeholder="VD: 200000"
            value={amount}
            onChange={(event) => onAmountChange(event.target.value.replace(/[^\d]/g, ''))}
            className={`${slot} border-indigo-300 bg-white font-mono`}
          />
        )}

        {hienNhan ? (
          <>
          <span className="shrink-0 text-base text-slate-400">×</span>

          <select
            value={guided.variable ?? ''}
            onChange={(event) => set({
              variable: event.target.value || null,
              // Không nhân thì không có gì để chia; để sót cờ này lại sẽ sinh ra
              // `(MUC_RIENG / STANDARD_DAYS)` cụt đuôi ở lần bật lại sau.
              prorate: event.target.value ? guided.prorate : false,
            })}
            // Không có vế tiền thì số liệu là tất cả những gì còn lại — bỏ trống
            // nữa là công thức rỗng.
            onWheel={boFocusKhiLan}
            disabled={source.kind === 'NONE'}
            className={`${slot} border-slate-200 bg-white disabled:opacity-60`}
          >
            <option value="">Không nhân</option>
            <optgroup label="Lấy tự động từ chấm công và KPI">
              {SYSTEM_VARIABLES.map((item) => (
                <option key={item.code} value={item.code}>{item.label}</option>
              ))}
            </optgroup>
            {inputCodes.length > 0 && (
              <optgroup label="Số liệu quản lý nhập hằng tháng">
                {inputCodes.map((item) => (
                  <option key={item.code} value={item.code}>{item.label}</option>
                ))}
              </optgroup>
            )}
          </select>

          <span className="shrink-0 text-base text-slate-400">×</span>

          <input
            inputMode="decimal"
            placeholder="hệ số"
            value={guided.coefficient ?? ''}
            onChange={(event) => set({
              coefficient: event.target.value.replace(/[^\d.]/g, '') || null,
            })}
            className="w-[72px] shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-center font-mono text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          />

          <button
            type="button"
            onClick={() => set({ percent: !guided.percent })}
            aria-pressed={guided.percent}
            title="Chia 100 — dùng khi khai theo phần trăm"
            className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-sm font-bold transition ${
              guided.percent
                ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                : 'border-slate-200 text-slate-400 hover:border-indigo-300'
            }`}
          >
            ÷100
          </button>

          {/* Bấm hiện được thì phải bấm ẩn được.
              Ẩn là XOÁ LUÔN phần nhân chia, không phải chỉ giấu đi: giấu mà
              vẫn tính thì khoản trông như một con số cố định trong khi phiếu
              lương ra số khác. Công thức ở hàng trên đổi ngay nên thấy được
              mình vừa bỏ gì. Khoản không có vế tiền thì số liệu LÀ cả công
              thức, ẩn đi là còn lại rỗng — nên không cho ẩn. */}
          {source.kind !== 'NONE' && (
            <button
              type="button"
              onClick={() => {
                setMoRong(false);
                set({ variable: null, coefficient: null, percent: false, prorate: false });
              }}
              title="Bỏ phần nhân chia, quay về một con số"
              className="shrink-0 rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-[11px] font-bold text-slate-400 transition hover:border-red-300 hover:text-red-600"
            >
              Ẩn
            </button>
          )}
          </>
        ) : (
          /* Khoản chỉ nhập một con số thì bốn ô kia là nhiễu: người
             khai phải lướt qua chúng mỗi lần mà không bao giờ dùng. */
          <button
            type="button"
            onClick={() => setMoRong(true)}
            className="shrink-0 rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-[11px] font-bold text-slate-400 transition hover:border-indigo-400 hover:text-indigo-600"
          >
            × nhân thêm
          </button>
        )}
      </div>

      {/* --- Chọn các khoản để cộng gộp --- */}
      {sumCodes && (
        <div className="flex flex-wrap gap-1.5 rounded-lg bg-slate-50 px-2.5 py-2">
          {sumChoices.map((item) => {
            const on = sumCodes.includes(item.code);
            return (
              <button
                key={item.code}
                type="button"
                onClick={() => toggleSum(item.code)}
                aria-pressed={on}
                className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
                  on
                    ? 'border-indigo-600 bg-white text-indigo-700'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-indigo-300'
                }`}
              >
                {on ? '− ' : '+ '}{item.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Lấy số từ khoản mà người này chưa khai thì phần đó bằng 0đ. Nói ngay,
          vì phát hiện lúc xem phiếu lương là đã trả thiếu rồi. */}
      {thieu.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-800">
          <TriangleAlert className="mt-0.5 h-3 w-3 flex-shrink-0" />
          Người này chưa được khai {thieu.join(', ')}, nên phần đó tính bằng 0đ. Tick lại ở
          danh mục bên trên, hoặc chọn nguồn khác.
        </p>
      )}

      {/* Hai cách hiểu con số, kèm tiền thật của từng cách. Chỉ có nghĩa khi
          nhân với ngày công: "8tr × 22 công" ra 176 triệu, "8tr ÷ 24,5 × 22"
          ra 7,18 triệu — lệch 24,5 lần. */}
      {isDayCount(guided.variable) && source.kind !== 'NONE' && (
        <div className="flex flex-wrap gap-1.5">
          {([
            [false, 'Tiền của 1 ngày', valueOf(false)],
            [true, 'Tiền của cả tháng', valueOf(true)],
          ] as const).map(([prorate, label, value]) => (
            <button
              key={label}
              type="button"
              onClick={() => set({ prorate })}
              aria-pressed={guided.prorate === prorate}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                guided.prorate === prorate
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                  : 'border-slate-200 text-slate-500 hover:border-indigo-300'
              }`}
            >
              {label}
              {value != null && <span className="ml-1.5 font-mono">{formatVND(value)}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
