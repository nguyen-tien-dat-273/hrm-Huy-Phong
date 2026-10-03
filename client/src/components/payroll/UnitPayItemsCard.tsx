// ============================================================================
// Chọn khoản lương cho cả ĐƠN VỊ.
// ----------------------------------------------------------------------------
// Danh mục khoản khai một lần; ở đây mỗi đơn vị chọn những khoản áp cho cả
// đơn vị. Mọi người thuộc đơn vị thừa hưởng, kể cả người mới vào sau — đó là
// điểm khác quan trọng so với gán từng người: không ai bị quên.
//
// Ai cần khác mặt bằng chung thì gán riêng ở modal Cơ chế lương; bản riêng
// ghi đè bản của đơn vị cho cùng một khoản (xem `mergeUnitAndEmployeeItems`).
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Building2, ChevronRight, Plus, Trash2, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { PayrollFormulaBuilder } from '@/components/payroll/PayrollFormulaBuilder';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { formatVND } from '@/lib/utils';
import { sampleFormulaScope } from '@/lib/payroll';
import { validateFormula } from '@/lib/payrollFormula';
import { deleteUnitPayItem, saveUnitPayItem } from '@/lib/payrollData';
import type { PayrollParams } from '@/lib/payrollSettings';
import type { OrganizationUnit, PayComponent, Profile, UnitPayItem } from '@/types';

interface UnitPayItemsCardProps {
  components: PayComponent[];
  unitItems: UnitPayItem[];
  profiles: Profile[];
  params: PayrollParams;
  /** Ngày đầu tháng đang xem — mặc định cho ngày hiệu lực. */
  defaultEffectiveFrom: string;
  actorId: string | null;
  onChanged: () => void;
  onEditEmployee: (profile: Profile) => void;
}

interface Draft {
  id?: string;
  unit_id: string;
  component_id: string;
  amount: string;
  formula: string;
  effective_from: string;
  note: string;
}

export function UnitPayItemsCard({
  components, unitItems, profiles, params, defaultEffectiveFrom, actorId, onChanged, onEditEmployee,
}: UnitPayItemsCardProps) {
  const { toast } = useToast();
  const confirm = useConfirm();

  const [units, setUnits] = useState<OrganizationUnit[]>([]);
  const [unitsSupported, setUnitsSupported] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    void supabase
      .from('organization_units')
      .select('*')
      .eq('is_active', true)
      .order('name')
      .then(({ data, error }) => {
        setUnitsSupported(!error);
        setUnits((data || []) as OrganizationUnit[]);
      });
  }, []);

  const componentById = useMemo(
    () => new Map(components.map((component) => [component.id, component])),
    [components],
  );

  const formulaScope = useMemo(() => sampleFormulaScope(
    params,
    components.flatMap((component) => [component.code, component.input_code ?? '']).filter(Boolean),
  ), [components, params]);

  const formulaError = draft?.formula.trim()
    ? validateFormula(draft.formula, formulaScope)
    : null;

  // Đếm người mỗi đơn vị: con số này cho thấy ngay một lần gán ảnh hưởng bao
  // nhiêu người, thứ mà gán từng người không bao giờ nói được.
  const headcount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const person of profiles) {
      if (!person.unit_id) continue;
      counts.set(person.unit_id, (counts.get(person.unit_id) ?? 0) + 1);
    }
    return counts;
  }, [profiles]);

  const itemsByUnit = useMemo(() => {
    const grouped = new Map<string, UnitPayItem[]>();
    for (const item of unitItems) {
      const list = grouped.get(item.unit_id) ?? [];
      list.push(item);
      grouped.set(item.unit_id, list);
    }
    return grouped;
  }, [unitItems]);

  const unassignedCount = profiles.filter((person) => !person.unit_id).length;

  const openAssign = (unitId: string) => setDraft({
    unit_id: unitId,
    component_id: components.find((component) => component.is_active)?.id ?? '',
    amount: '', formula: '', effective_from: defaultEffectiveFrom, note: '',
  });

  const save = async () => {
    if (!draft) return;
    if (!draft.unit_id || !draft.component_id) {
      toast('Chọn đơn vị và khoản lương.', 'warning');
      return;
    }
    if (formulaError) {
      toast('Công thức chưa hợp lệ — sửa trước khi lưu.', 'warning');
      return;
    }

    setSaving(true);
    const error = await saveUnitPayItem({
      ...(draft.id ? { id: draft.id } : {}),
      unit_id: draft.unit_id,
      component_id: draft.component_id,
      amount: draft.amount ? Number(draft.amount) : null,
      formula: draft.formula.trim() || null,
      effective_from: draft.effective_from,
      note: draft.note.trim() || null,
      created_by: actorId,
    });
    setSaving(false);

    if (error) {
      toast('Lưu khoản của đơn vị thất bại: ' + error, 'error');
      return;
    }
    toast('Đã lưu khoản lương cho đơn vị.', 'success');
    setDraft(null);
    onChanged();
  };

  const remove = async (item: UnitPayItem) => {
    const unit = units.find((entry) => entry.id === item.unit_id);
    const people = headcount.get(item.unit_id) ?? 0;
    const ok = await confirm({
      title: `Bỏ khoản "${componentById.get(item.component_id)?.name ?? 'này'}" khỏi đơn vị?`,
      message:
        `${people} người thuộc ${unit?.name ?? 'đơn vị'} sẽ mất khoản này ở các kỳ lương CHƯA chốt. ` +
        'Ai được gán riêng khoản cùng loại thì không bị ảnh hưởng. Phiếu lương đã duyệt giữ nguyên.',
      confirmLabel: 'Bỏ khoản',
      danger: true,
    });
    if (!ok) return;

    const error = await deleteUnitPayItem(item.id);
    if (error) {
      toast('Xóa thất bại: ' + error, 'error');
      return;
    }
    toast('Đã bỏ khoản khỏi đơn vị.', 'success');
    onChanged();
  };

  if (!unitsSupported) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-slate-500">
          Chưa có cơ cấu tổ chức. Tạo đơn vị ở trang <strong>Cơ cấu tổ chức</strong> trước khi
          gán khoản lương theo phòng ban.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <div>
          <h3 className="text-base font-bold text-slate-800">Phòng ban và nhân viên</h3>
          <p className="mt-0.5 text-sm leading-relaxed text-slate-500">
            Chọn một phòng ban để đi vào danh sách nhân viên và thiết lập cơ chế lương cho từng người.
            Khoản áp dụng chung của phòng được quản lý trong cùng màn chi tiết.
          </p>
        </div>
      </div>

      {unassignedCount > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800">
          {unassignedCount} nhân sự chưa thuộc đơn vị nào nên <strong>không thừa hưởng</strong> khoản
          nào theo phòng ban. Gán đơn vị cho họ ở trang Cơ cấu tổ chức, hoặc gán khoản riêng
          từng người.
        </p>
      )}

      {units.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-slate-500">
            Chưa có đơn vị nào đang hoạt động.
          </CardContent>
        </Card>
      ) : (
        (selectedUnitId ? units.filter((unit) => unit.id === selectedUnitId) : units).map((unit) => {
          const items = itemsByUnit.get(unit.id) ?? [];
          const people = headcount.get(unit.id) ?? 0;
          const peopleInUnit = profiles
            .filter((person) => person.unit_id === unit.id)
            .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
          const isSelected = selectedUnitId === unit.id;
          return (
            <Card key={unit.id} className={`overflow-hidden transition-colors ${isSelected ? 'border-indigo-200' : ''}`}>
              <CardContent className="p-0">
                {isSelected ? (
                  <div className="border-b border-indigo-100 bg-indigo-50/60 px-5 py-4">
                    <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
                      <button
                        type="button"
                        onClick={() => setSelectedUnitId(null)}
                        className="inline-flex items-center gap-1.5 font-semibold text-indigo-600 transition hover:text-indigo-800"
                      >
                        <ArrowLeft className="h-3.5 w-3.5" /> Tất cả phòng ban
                      </button>
                      <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                      <span className="font-semibold text-slate-600">{unit.name}</span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white text-indigo-600 shadow-sm">
                          <Building2 className="h-5 w-5" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-base font-bold text-slate-900">{unit.name}</span>
                          <span className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                            <Users className="h-3.5 w-3.5" /> {people} nhân viên · {items.length} khoản chung
                          </span>
                        </span>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => openAssign(unit.id)}>
                        <Plus className="h-3.5 w-3.5" /> Gán khoản chung
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSelectedUnitId(unit.id)}
                    className="group flex w-full flex-wrap items-center justify-between gap-2 bg-slate-50 px-5 py-4 text-left transition-colors hover:bg-indigo-50/60"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors group-hover:bg-white group-hover:text-indigo-600 group-hover:shadow-sm">
                        <Building2 className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-slate-800">{unit.name}</span>
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                          <Users className="h-3.5 w-3.5" /> {people} người
                        </span>
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-xs text-slate-400">{items.length} khoản</span>
                      <ChevronRight className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-600" />
                    </span>
                  </button>
                )}

                {isSelected && (
                  <div id={`unit-pay-items-${unit.id}`}>
                    <div className="border-b border-slate-100">
                      <div className="flex items-center justify-between bg-white px-5 py-2.5">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          Nhân viên trong phòng
                        </p>
                        <span className="text-xs text-slate-400">{peopleInUnit.length} người</span>
                      </div>
                      {peopleInUnit.length === 0 ? (
                        <p className="px-5 py-5 text-sm italic text-slate-400">
                          Phòng ban này chưa có nhân viên.
                        </p>
                      ) : (
                        <ul className="divide-y divide-slate-50">
                          {peopleInUnit.map((person) => (
                            <li key={person.id}>
                              <button
                                type="button"
                                onClick={() => onEditEmployee(person)}
                                className="group flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-indigo-50/50"
                                aria-label={`Mở cơ chế lương của ${person.name}`}
                              >
                                <Avatar name={person.name} url={person.avatar_url} size="sm" />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-semibold text-slate-800">{person.name}</span>
                                  <span className="mt-0.5 block truncate text-xs text-slate-400">
                                    {person.employee_code || person.email}
                                  </span>
                                </span>
                                <span className="hidden text-xs font-semibold text-indigo-600 sm:block">Cơ chế lương</span>
                                <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-600" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="flex items-center justify-between bg-slate-50/60 px-5 py-2.5">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Khoản áp dụng chung
                      </p>
                      <span className="text-xs text-slate-400">{items.length} khoản</span>
                    </div>
                    {items.length === 0 ? (
                      <div className="flex flex-col items-start gap-3 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm text-slate-400">
                          Chưa gán khoản nào. Người trong đơn vị chỉ nhận lương gốc và khoản gán riêng.
                        </p>
                        <Button size="sm" variant="outline" onClick={() => openAssign(unit.id)}>
                          <Plus className="h-3.5 w-3.5" /> Gán khoản
                        </Button>
                      </div>
                    ) : (
                      <>
                        <ul className="divide-y divide-slate-50">
                          {items.map((item) => {
                            const component = componentById.get(item.component_id);
                            const amount = item.amount ?? component?.default_amount ?? 0;
                            return (
                              <li key={item.id} className="flex items-start justify-between gap-3 px-5 py-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold text-slate-800">
                                    {component?.name ?? 'Khoản đã bị xóa'}
                                  </p>
                                  <p className="mt-0.5 text-xs text-slate-500">
                                    {component?.calc_type === 'PERCENT'
                                      ? `${Number(amount)}% của ${component.base_code}`
                                      : formatVND(Number(amount))}
                                    {item.amount == null && ' (theo mức mặc định của danh mục)'}
                                    {' · từ '}{item.effective_from}
                                  </p>
                                  {item.formula && (
                                    <p className="mt-0.5 font-mono text-xs text-slate-400">{item.formula}</p>
                                  )}
                                  {item.note && (
                                    <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{item.note}</p>
                                  )}
                                </div>
                                <button
                                  onClick={() => remove(item)}
                                  className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                                  aria-label="Bỏ khoản khỏi đơn vị"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                        <div className="border-t border-slate-100 px-5 py-3">
                          <Button size="sm" variant="outline" onClick={() => openAssign(unit.id)}>
                            <Plus className="h-3.5 w-3.5" /> Gán thêm khoản
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}

      <Modal open={!!draft} onClose={() => setDraft(null)} title="Gán khoản lương cho đơn vị" size="md">
        {draft && (
          <div className="space-y-4">
            <div>
              <Select
                label="Đơn vị"
                value={draft.unit_id}
                onChange={(e) => setDraft({ ...draft, unit_id: e.target.value })}
              >
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name} ({headcount.get(unit.id) ?? 0} người)
                  </option>
                ))}
              </Select>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                Mọi người thuộc đơn vị sẽ được cộng khoản này vào phiếu lương của các kỳ chưa chốt.
              </p>
            </div>

            <Select
              label="Khoản lương"
              value={draft.component_id}
              onChange={(e) => setDraft({ ...draft, component_id: e.target.value })}
            >
              {components.filter((component) => component.is_active).map((component) => (
                <option key={component.id} value={component.id}>
                  {component.kind === 'DEDUCTION' ? '− ' : component.kind === 'EMPLOYER_COST' ? '◦ ' : '+ '}
                  {component.name}
                </option>
              ))}
            </Select>

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Mức riêng của đơn vị (trống = theo danh mục)"
                inputMode="decimal"
                placeholder={
                  componentById.get(draft.component_id)
                    ? String(Number(componentById.get(draft.component_id)!.default_amount))
                    : ''
                }
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value.replace(/[^\d.]/g, '') })}
              />
              <Input
                label="Áp dụng từ"
                type="date"
                value={draft.effective_from}
                onChange={(e) => setDraft({ ...draft, effective_from: e.target.value })}
              />
            </div>

            <PayrollFormulaBuilder
              label="Công thức chung của phòng ban (không bắt buộc)"
              value={draft.formula}
              onChange={(formula) => setDraft({ ...draft, formula })}
              sampleScope={formulaScope}
              components={components}
              defaultFormula={componentById.get(draft.component_id)?.formula}
            />

            <Textarea
              label="Ghi chú"
              rows={2}
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />

            <div className="flex gap-3 pt-1">
              <Button variant="outline" onClick={() => setDraft(null)} className="flex-1" disabled={saving}>
                Hủy
              </Button>
              <Button onClick={save} className="flex-1" disabled={saving || !!formulaError}>
                {saving ? 'Đang lưu…' : 'Lưu'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
