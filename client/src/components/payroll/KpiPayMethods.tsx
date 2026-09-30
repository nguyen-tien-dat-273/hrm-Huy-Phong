// ============================================================================
// Cách tính lương KPI.
// ----------------------------------------------------------------------------
// Ranh giới giữa hai module: KPI ra CON SỐ, lương ra TIỀN. Module KPI khoá
// phiếu chấm rồi đẩy sang `KPI_PCT` (0–120, đơn vị %). Việc quy con số đó
// thành tiền là của module lương, và mỗi bộ phận quy một kiểu.
//
// Trước màn này chỉ có ĐÚNG MỘT khoản `LUONG_KPI` với một công thức cứng
// `MUC_RIENG * KPI_PCT / 100`. Ai muốn kiểu khác — có ngưỡng, có trần, theo
// bậc thang — phải tự viết biểu thức vào ô công thức tự do, tức là phải biết
// tên biến và cú pháp của engine. Đó là rào chắn với người làm nhân sự.
//
// Ở đây mỗi cách tính là MỘT KHOẢN LƯƠNG thật trong danh mục, nhóm "Lương
// KPI". Form này chỉ hỏi tham số rồi SINH RA công thức; công thức sinh ra
// hiện ngay trên màn để đối chiếu, và engine tính đúng như mọi khoản khác —
// không có đường tính toán thứ hai chạy song song.
// ============================================================================

import { useMemo, useState } from 'react';
import { Plus, Target, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { deleteComponent, saveComponent } from '@/lib/payrollData';
import { formatVND } from '@/lib/utils';
import {
  MODE_HINT, MODE_LABEL, buildKpiFormula, describeKpiMethod,
  BLANK, num, type Draft, type Mode,
} from '@/lib/kpiPayFormula';
import type { PayComponent } from '@/types';

/** Nhóm dùng để nhận ra khoản nào là lương KPI. */
export const KPI_PAY_GROUP = 'Lương KPI';

/** Mã khoản sinh từ tên, giữ tiền tố để nhìn là biết thuộc lương KPI. */
function codeFrom(name: string, taken: string[]): string {
  const base = 'LUONG_KPI_' + (name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    .slice(0, 30) || 'MOI');
  if (!taken.includes(base)) return base;
  for (let i = 2; i < 100; i += 1) {
    if (!taken.includes(`${base}_${i}`)) return `${base}_${i}`;
  }
  return `${base}_${Date.now().toString().slice(-4)}`;
}

export interface KpiPayMethodsProps {
  components: PayComponent[];
  onChanged: () => void;
}

export function KpiPayMethods({ components, onChanged }: KpiPayMethodsProps) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const methods = useMemo(
    () => components
      .filter((item) => (item.group_name ?? '') === KPI_PAY_GROUP)
      .sort((a, b) => a.sort_order - b.sort_order),
    [components],
  );

  const handleSave = async () => {
    if (!draft) return;
    if (draft.name.trim().length < 2) {
      toast('Đặt tên cho cách tính này.', 'warning');
      return;
    }
    if (draft.mode === 'BAC_THANG' && draft.tiers.every((tier) => !num(tier.from) && !num(tier.pay))) {
      toast('Khai ít nhất một bậc.', 'warning');
      return;
    }

    const formula = buildKpiFormula(draft);
    const existing = draft.id ? components.find((item) => item.id === draft.id) : undefined;
    const code = existing?.code ?? codeFrom(draft.name, components.map((item) => item.code));
    const nextOrder = existing?.sort_order
      ?? components.reduce((max, item) => Math.max(max, item.sort_order), 200) + 5;

    setSaving(true);
    const error = await saveComponent({
      ...(draft.id ? { id: draft.id } : {}),
      code,
      name: draft.name.trim(),
      kind: 'EARNING',
      calc_type: 'FORMULA',
      formula,
      group_name: KPI_PAY_GROUP,
      // Mức lương KPI của từng người khai ở Cơ chế lương, không phải ở đây —
      // mức mặc định 0 buộc phải gán, thay vì âm thầm trả một con số chung.
      default_amount: 0,
      input_code: null,
      base_code: null,
      taxable: true,
      insurable: false,
      prorate: false,
      sort_order: nextOrder,
      ot_multiplier: null,
      tax_exempt_cap: null,
      max_amount: null,
      is_active: true,
      note: describeKpiMethod(draft),
    });
    setSaving(false);

    if (error) {
      toast('Lưu cách tính thất bại: ' + error, 'error');
      return;
    }
    toast(`Đã lưu cách tính "${draft.name}".`, 'success');
    setDraft(null);
    onChanged();
  };

  const handleDelete = async (component: PayComponent) => {
    const ok = await confirm({
      title: `Xóa cách tính "${component.name}"?`,
      message: 'Ai đang được gán cách tính này sẽ mất lương KPI ở các kỳ CHƯA chốt. '
        + 'Phiếu lương đã duyệt không đổi vì số liệu đã đóng băng.',
      confirmLabel: 'Xóa cách tính',
      danger: true,
    });
    if (!ok) return;
    const error = await deleteComponent(component.id);
    if (error) return toast('Xóa thất bại: ' + error, 'error');
    toast('Đã xóa cách tính.', 'success');
    onChanged();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-xs leading-relaxed text-slate-500">
          Module <strong className="text-slate-700">KPI &amp; đánh giá</strong> chỉ ra con số{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">KPI_PCT</code> khi
          phiếu chấm được khoá. Quy con số đó thành tiền là việc ở đây, và mỗi bộ phận có thể quy
          một kiểu. Mức lương KPI của từng người khai ở{' '}
          <strong className="text-slate-700">Cơ chế lương</strong>.
        </p>
        <Button onClick={() => setDraft({ ...BLANK })}>
          <Plus className="h-4 w-4" /> Thêm cách tính
        </Button>
      </div>

      {methods.length === 0 ? (
        <Card><CardContent>
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-50 text-slate-300">
              <Target className="h-5 w-5" />
            </span>
            <p className="text-sm font-semibold text-slate-600">Chưa có cách tính lương KPI nào</p>
            <p className="max-w-sm text-xs leading-relaxed text-slate-400">
              Bấm <strong>Thêm cách tính</strong> để khai. Khai xong nó nằm trong Danh mục khoản
              lương như mọi khoản khác, gán cho đơn vị hoặc từng người ở Cơ chế lương.
            </p>
          </div>
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {methods.map((method) => (
            <Card key={method.id}><CardContent className="space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800">{method.name}</p>
                  <code className="mt-0.5 block truncate font-mono text-[10px] text-slate-400">
                    {method.code}
                  </code>
                </div>
                <div className="flex flex-shrink-0 gap-1">
                  {/* Khoan he thong LUONG_KPI goc khong sua duoc qua man nay:
                      no khong sinh ra tu tham so nao nen doc nguoc lai thanh
                      tham so se phai doan. */}
                  {!method.is_system && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setDraft(readBack(method))}>
                        Sửa
                      </Button>
                      <button
                        onClick={() => void handleDelete(method)}
                        className="rounded p-1.5 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-600"
                        aria-label={`Xóa ${method.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {method.note && (
                <p className="text-xs leading-relaxed text-slate-500">{method.note}</p>
              )}

              <code className="block overflow-x-auto rounded-lg bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-600">
                {method.formula}
              </code>

              {method.default_amount > 0 && (
                <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-700">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  Đang có mức mặc định {formatVND(Number(method.default_amount))} cho toàn công ty.
                  Mức lương KPI nên khai riêng từng người ở Cơ chế lương.
                </p>
              )}
            </CardContent></Card>
          ))}
        </div>
      )}

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Sửa cách tính lương KPI' : 'Thêm cách tính lương KPI'}
        size="lg"
      >
        {draft && (
          <form
            className="space-y-4"
            onSubmit={(event) => { event.preventDefault(); void handleSave(); }}
          >
            <Input
              label="Tên cách tính"
              placeholder="VD: Khối kinh doanh — có ngưỡng 80%"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              autoFocus
            />

            <div>
              <p className="text-xs font-bold text-slate-700">Quy KPI% thành tiền theo kiểu</p>
              <div className="mt-2 space-y-2">
                {(Object.keys(MODE_LABEL) as Mode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setDraft({ ...draft, mode })}
                    aria-pressed={draft.mode === mode}
                    className={`block w-full rounded-lg border-2 px-3 py-2.5 text-left transition ${
                      draft.mode === mode
                        ? 'border-indigo-600 bg-indigo-50/40'
                        : 'border-slate-200 bg-white hover:border-indigo-300'
                    }`}
                  >
                    <span className="block text-xs font-bold text-slate-800">{MODE_LABEL[mode]}</span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">
                      {MODE_HINT[mode]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {(draft.mode === 'NGUONG' || draft.mode === 'DAT_KHONG') && (
              <Input
                label="Ngưỡng KPI% tối thiểu"
                inputMode="decimal"
                value={draft.threshold}
                onChange={(e) => setDraft({ ...draft, threshold: e.target.value.replace(/[^\d.]/g, '') })}
              />
            )}

            {draft.mode === 'BAC_THANG' ? (
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-xs font-bold text-slate-700">Các bậc</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                  Từ KPI% bao nhiêu trở lên thì trả bao nhiêu phần trăm mức lương KPI. Bậc cao
                  nhất khớp sẽ được áp; dưới bậc thấp nhất nhận 0đ.
                </p>
                <div className="mt-2.5 space-y-2">
                  {draft.tiers.map((tier, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-500">Từ</span>
                      <input
                        inputMode="decimal"
                        value={tier.from}
                        onChange={(e) => setDraft({
                          ...draft,
                          tiers: draft.tiers.map((item, i) => i === index
                            ? { ...item, from: e.target.value.replace(/[^\d.]/g, '') } : item),
                        })}
                        className="h-9 w-20 rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-indigo-500"
                      />
                      <span className="text-[11px] text-slate-500">% trở lên → trả</span>
                      <input
                        inputMode="decimal"
                        value={tier.pay}
                        onChange={(e) => setDraft({
                          ...draft,
                          tiers: draft.tiers.map((item, i) => i === index
                            ? { ...item, pay: e.target.value.replace(/[^\d.]/g, '') } : item),
                        })}
                        className="h-9 w-20 rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-indigo-500"
                      />
                      <span className="flex-1 text-[11px] text-slate-500">% mức lương KPI</span>
                      <button
                        type="button"
                        onClick={() => setDraft({ ...draft, tiers: draft.tiers.filter((_, i) => i !== index) })}
                        aria-label={`Xóa bậc ${index + 1}`}
                        className="rounded p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="mt-2.5"
                  onClick={() => setDraft({ ...draft, tiers: [...draft.tiers, { from: '', pay: '' }] })}
                >
                  <Plus className="h-3.5 w-3.5" />Thêm bậc
                </Button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Input
                    label="Trần KPI% — trống = không chặn"
                    inputMode="decimal"
                    placeholder="VD: 120"
                    value={draft.cap}
                    onChange={(e) => setDraft({ ...draft, cap: e.target.value.replace(/[^\d.]/g, '') })}
                  />
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                    Chấm vượt trần vẫn chỉ trả tới mức này.
                  </p>
                </div>
                <Input
                  label="Sàn KPI% — trống = không chặn"
                  inputMode="decimal"
                  placeholder="VD: 50"
                  value={draft.floor}
                  onChange={(e) => setDraft({ ...draft, floor: e.target.value.replace(/[^\d.]/g, '') })}
                />
              </div>
            )}

            {/* Cong thuc sinh ra hien ngay: nguoi khai doi chieu duoc voi cai
                ho dang lam tren giay, va ke toan sau nay doc duoc he thong
                dang tinh gi ma khong phai mo code. */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
              <p className="text-[11px] font-bold text-slate-600">Hệ thống sẽ tính</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-700">{describeKpiMethod(draft)}</p>
              <code className="mt-2 block overflow-x-auto rounded-lg bg-white px-3 py-2 font-mono text-[11px] text-slate-600">
                {buildKpiFormula(draft)}
              </code>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setDraft(null)} disabled={saving}>
                Hủy
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Đang lưu…' : 'Lưu cách tính'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

/**
 * Đọc ngược một khoản đã lưu về dạng tham số để sửa lại.
 *
 * Công thức là thứ được lưu, không phải tham số — nên đọc ngược chỉ khôi phục
 * được những gì nhận ra chắc chắn. Không đoán: cái nào không nhận ra thì mở
 * lại ở kiểu mặc định, và người dùng thấy ngay công thức mới sinh ra khác
 * công thức cũ trước khi bấm lưu.
 */
function readBack(component: PayComponent): Draft {
  const formula = component.formula ?? '';
  const capMatch = /MIN\([^,]+,\s*([\d.]+)\)/.exec(formula);
  const floorMatch = /MAX\(KPI_PCT,\s*([\d.]+)\)/.exec(formula);
  const thresholdMatch = /IF\(KPI_PCT >= ([\d.]+)/.exec(formula);

  const tierMatches = [...formula.matchAll(/IF\(KPI_PCT >= ([\d.]+), MUC_RIENG \* ([\d.]+) \/ 100/g)];
  const isTiered = tierMatches.length > 1;
  const isFlat = /IF\(KPI_PCT >= [\d.]+, MUC_RIENG,/.test(formula);

  const mode: Mode = isTiered ? 'BAC_THANG'
    : isFlat ? 'DAT_KHONG'
      : thresholdMatch ? 'NGUONG'
        : 'TY_LE';

  return {
    id: component.id,
    name: component.name,
    mode,
    cap: capMatch?.[1] ?? '',
    floor: floorMatch?.[1] ?? '',
    threshold: thresholdMatch?.[1] ?? '80',
    tiers: isTiered
      ? tierMatches.map((match) => ({ from: match[1], pay: match[2] }))
      : BLANK.tiers,
  };
}
