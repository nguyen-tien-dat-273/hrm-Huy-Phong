// ============================================================================
// Danh mục cách tính kết quả KPI.
// ----------------------------------------------------------------------------
// Trước đây danh mục này chỉ sống bên trong form khai bộ KPI: muốn xem công ty
// đang có những cách chấm nào phải mở một bộ KPI bất kỳ ra, và sửa thì không
// sửa được — chỉ thêm với xóa. Nó là một danh mục dùng chung, nên phải có chỗ
// đứng riêng như mọi danh mục khác.
//
// Một cách tính = BỐN THAM SỐ, không phải một nhánh code:
//   Quy đổi điểm : RATIO (điểm / thang) hoặc RAW (điểm thô)
//   Trọng số     : WEIGHTED (nhân)      hoặc EQUAL (bỏ qua)
//   Mẫu số       : NONE / WEIGHT_SUM / MAX_SUM
//   Hệ số        : nhân ra thang phần trăm
//
// Phép gộp điểm chạy trong PL/pgSQL (hàm `recalc_kpi_review`), nên KHÔNG dùng
// công thức tự do như khoản lương — nhúng một bộ đánh giá biểu thức vào đó
// vừa lớn vừa mở thêm một bề mặt tấn công.
// ============================================================================

import { useEffect, useState } from 'react';
import { Calculator, Lock, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import {
  BLANK_METHOD, DENOMINATOR_LABELS, FALLBACK_METHODS, NORMALIZE_LABELS, WEIGHT_LABELS,
  describeMethod, type ScoreMethod,
} from '@/lib/kpiScoreMethod';

type Form = typeof BLANK_METHOD & { editingCode?: string };

export function KpiScoreMethodCatalog() {
  const { toast } = useToast();
  const confirm = useConfirm();

  const [methods, setMethods] = useState<ScoreMethod[]>([]);
  const [templateUse, setTemplateUse] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [supported, setSupported] = useState(true);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!supabase) return;
    setLoading(true);
    const [methodRes, templateRes] = await Promise.all([
      supabase.from('kpi_score_methods').select('*').order('sort_order').order('name'),
      supabase.from('kpi_position_templates').select('score_method'),
    ]);
    if (methodRes.error) {
      setSupported(false);
      setMethods(FALLBACK_METHODS);
      setLoading(false);
      return;
    }
    setSupported(true);
    setMethods((methodRes.data || []) as ScoreMethod[]);

    // Đếm bộ KPI đang dùng: quyết định xóa được hay không, và nói rõ vì sao.
    const counts: Record<string, number> = {};
    for (const row of (templateRes.data || []) as { score_method: string | null }[]) {
      if (row.score_method) counts[row.score_method] = (counts[row.score_method] || 0) + 1;
    }
    setTemplateUse(counts);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => setForm({ ...BLANK_METHOD });

  const openEdit = (method: ScoreMethod) => setForm({
    editingCode: method.code,
    code: method.code,
    name: method.name,
    description: method.description ?? '',
    normalize_mode: method.normalize_mode,
    weight_mode: method.weight_mode,
    denominator_mode: method.denominator_mode,
    scale: String(Number(method.scale)),
  });

  const save = async () => {
    if (!supabase || !form) return;
    const code = form.code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!/^[A-Z][A-Z0-9_]*$/.test(code)) {
      return toast('Mã phải bắt đầu bằng chữ cái, chỉ gồm chữ in, số và dấu gạch dưới.', 'warning');
    }
    if (form.name.trim().length < 2) return toast('Cách tính phải có tên.', 'warning');
    const scale = Number(form.scale);
    if (!Number.isFinite(scale) || scale <= 0) return toast('Hệ số phải là số dương.', 'warning');

    const payload = {
      code,
      name: form.name.trim(),
      description: form.description.trim() || null,
      normalize_mode: form.normalize_mode,
      weight_mode: form.weight_mode,
      denominator_mode: form.denominator_mode,
      scale,
    };

    setSaving(true);
    // Sửa thì KHÔNG đụng vào `code`: mã là khóa ngoại mà các bộ KPI đang trỏ
    // tới. Đổi mã ở đây sẽ kéo theo cả chuỗi, nên mã khóa lại sau khi tạo.
    const { error } = form.editingCode
      ? await supabase.from('kpi_score_methods')
        .update({ ...payload, code: form.editingCode })
        .eq('code', form.editingCode)
      : await supabase.from('kpi_score_methods').insert({ ...payload, is_system: false, sort_order: 100 });
    setSaving(false);

    if (error) return toast('Không lưu được: ' + describeDbError(error), 'error');
    toast(form.editingCode ? 'Đã cập nhật cách tính.' : 'Đã thêm cách tính.', 'success');
    setForm(null);
    await load();
  };

  const remove = async (method: ScoreMethod) => {
    if (!supabase) return;
    const used = templateUse[method.code] || 0;
    if (used > 0) {
      return toast(
        `${used} bộ KPI đang dùng cách tính này. Đổi chúng sang cách khác trước đã.`,
        'warning',
      );
    }
    const ok = await confirm({
      title: `Xóa cách tính “${method.name}”?`,
      message: 'Chưa bộ KPI nào dùng nên xóa sẽ không ảnh hưởng phiếu chấm nào.',
      confirmLabel: 'Xóa cách tính',
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('kpi_score_methods').delete().eq('code', method.code);
    if (error) return toast('Không xóa được: ' + describeDbError(error), 'error');
    toast('Đã xóa cách tính.', 'success');
    await load();
  };

  if (loading) return <Skeleton className="h-48" />;

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h3 className="flex items-center gap-2 text-base font-bold text-slate-800">
              <Calculator className="h-4 w-4 text-indigo-500" />
              Danh mục cách tính kết quả
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Cách gộp điểm các tiêu chí thành một con số KPI%. Khai một lần ở đây, các bộ KPI
              chọn lại. Mỗi cách tính là <strong>bốn lựa chọn</strong>, không phải một công thức
              phải tự viết.
            </p>
          </div>
          {supported && (
            <Button theme="admin" onClick={openNew}>
              <Plus className="h-4 w-4" />Thêm cách tính
            </Button>
          )}
        </div>

        {!supported && (
          <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800">
            <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>
              Chưa chạy migration{' '}
              <code className="rounded bg-amber-100 px-1 py-0.5 font-mono">
                20260930190000_kpi_score_methods.sql
              </code>
              . Đang hiện hai cách mặc định, chưa thêm/sửa/xóa được.
            </span>
          </p>
        )}

        <div className="grid gap-3 lg:grid-cols-2">
          {methods.map((method) => {
            const used = templateUse[method.code] || 0;
            return (
              <div key={method.code} className="rounded-xl border-2 border-slate-200 p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-800">
                      {method.name}
                      {method.is_system && (
                        <span title="Cách tính hệ thống — sửa được nhưng không xóa được">
                          <Lock className="h-3.5 w-3.5 text-slate-300" />
                        </span>
                      )}
                    </p>
                    <code className="mt-0.5 block truncate font-mono text-[10px] text-slate-400">
                      {method.code}
                    </code>
                  </div>
                  {supported && (
                    <div className="flex flex-shrink-0 gap-1">
                      <button
                        onClick={() => openEdit(method)}
                        aria-label={`Sửa ${method.name}`}
                        className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {method.is_system ? (
                        <span className="p-1.5 text-slate-200" title="Cách tính hệ thống, không xóa được">
                          <Lock className="h-3.5 w-3.5" />
                        </span>
                      ) : (
                        <button
                          onClick={() => void remove(method)}
                          aria-label={`Xóa ${method.name}`}
                          className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <p className="mt-2 text-xs leading-relaxed text-slate-600">
                  {method.description || describeMethod(method)}
                </p>

                {/* Bon tham so hien ra thanh nhan: doc mo ta bang loi van co the
                    hieu nhieu nghia, con bon nhan nay la cai engine that su
                    dung de tinh. */}
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <Badge className="bg-slate-100 text-slate-600">{NORMALIZE_LABELS[method.normalize_mode]}</Badge>
                  <Badge className="bg-slate-100 text-slate-600">{WEIGHT_LABELS[method.weight_mode]}</Badge>
                  <Badge className="bg-slate-100 text-slate-600">{DENOMINATOR_LABELS[method.denominator_mode]}</Badge>
                  {Number(method.scale) !== 1 && (
                    <Badge className="bg-slate-100 text-slate-600">Nhân {Number(method.scale)}</Badge>
                  )}
                </div>

                <p className="mt-2.5 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
                  {used > 0 ? `${used} bộ KPI đang dùng` : 'Chưa bộ KPI nào dùng'}
                </p>
              </div>
            );
          })}
        </div>
      </CardContent>

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.editingCode ? 'Sửa cách tính kết quả' : 'Thêm cách tính kết quả'}
        size="lg"
      >
        {form && (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Input
                  label="Mã"
                  placeholder="VD: TRU_DIEM"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  disabled={!!form.editingCode}
                  required
                />
                {form.editingCode && (
                  <p className="mt-1 text-[11px] text-slate-400">
                    Mã khóa lại sau khi tạo — các bộ KPI đang trỏ vào mã này.
                  </p>
                )}
              </div>
              <Input
                label="Tên hiển thị"
                placeholder="VD: Trừ điểm theo lỗi"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>

            <Textarea
              label="Giải thích cho người khai KPI"
              rows={2}
              placeholder="Để trống thì hệ thống tự diễn giải từ bốn lựa chọn bên dưới."
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Điểm từng tiêu chí"
                value={form.normalize_mode}
                onChange={(e) => setForm({ ...form, normalize_mode: e.target.value as ScoreMethod['normalize_mode'] })}
              >
                {(Object.keys(NORMALIZE_LABELS) as ScoreMethod['normalize_mode'][]).map((key) => (
                  <option key={key} value={key}>{NORMALIZE_LABELS[key]}</option>
                ))}
              </Select>
              <Select
                label="Trọng số"
                value={form.weight_mode}
                onChange={(e) => setForm({ ...form, weight_mode: e.target.value as ScoreMethod['weight_mode'] })}
              >
                {(Object.keys(WEIGHT_LABELS) as ScoreMethod['weight_mode'][]).map((key) => (
                  <option key={key} value={key}>{WEIGHT_LABELS[key]}</option>
                ))}
              </Select>
              <Select
                label="Chia cho"
                value={form.denominator_mode}
                onChange={(e) => setForm({ ...form, denominator_mode: e.target.value as ScoreMethod['denominator_mode'] })}
              >
                {(Object.keys(DENOMINATOR_LABELS) as ScoreMethod['denominator_mode'][]).map((key) => (
                  <option key={key} value={key}>{DENOMINATOR_LABELS[key]}</option>
                ))}
              </Select>
              <Input
                label="Hệ số ra %"
                inputMode="decimal"
                value={form.scale}
                onChange={(e) => setForm({ ...form, scale: e.target.value.replace(/[^\d.]/g, '') })}
              />
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
              <p className="text-[11px] font-bold text-slate-600">Cách này sẽ tính là</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-700">
                {describeMethod({
                  normalize_mode: form.normalize_mode,
                  weight_mode: form.weight_mode,
                  denominator_mode: form.denominator_mode,
                  scale: Number(form.scale) || 1,
                })}
              </p>
            </div>

            {/* Sua mot cach tinh dang duoc dung se tinh LAI ket qua cua cac
                phieu chua khoa - noi truoc con hon de ke toan phat hien qua
                mot con so luong doi. */}
            {form.editingCode && (templateUse[form.editingCode] || 0) > 0 && (
              <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800">
                <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
                {templateUse[form.editingCode]} bộ KPI đang dùng cách tính này. Sửa xong, các phiếu
                chấm <strong>chưa khóa</strong> sẽ tính lại theo tham số mới. Phiếu đã khóa giữ
                nguyên kết quả cũ.
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setForm(null)} disabled={saving}>
                Hủy
              </Button>
              <Button type="submit" theme="admin" disabled={saving}>
                {saving ? 'Đang lưu…' : 'Lưu cách tính'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </Card>
  );
}
