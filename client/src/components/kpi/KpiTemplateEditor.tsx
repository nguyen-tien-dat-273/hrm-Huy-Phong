// ============================================================================
// Tự tạo bộ KPI và khai thang điểm để hệ thống tự chấm.
// ----------------------------------------------------------------------------
// Trước màn này, mẫu KPI và tiêu chí chỉ ra đời bằng migration — muốn thêm một
// tiêu chí là phải sửa code và deploy. Ở đây người dùng tự khai: đặt tên tiêu
// chí, cho trọng số, rồi khai từng mức điểm kèm NGƯỠNG SỐ. Có ngưỡng thì lúc
// chấm chỉ cần nhập số đo thực tế, hệ thống suy ra điểm.
//
// Hai ràng buộc do database giữ, màn này chỉ hiển thị sớm cho đỡ mất công:
//   - Tổng trọng số của mẫu phải đúng 100% mới bật được (guard_kpi_template_*).
//   - Điểm suy ra bị kẹp trong thang điểm của tiêu chí.
// Không tự kiểm ở client rồi bỏ qua ràng buộc dưới DB — client chỉ nói trước.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Info, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { KpiEvidenceBox } from '@/components/kpi/KpiEvidenceBox';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { describeLevelIssues, isAutoScorable, scoreFromLevels, type ScoreLevel } from '@/lib/kpiScoring';

interface Template {
  id: string;
  code: string;
  name: string;
  block_code: string;
  unit_id: string | null;
  default_kpi_amount: number;
  score_method: string;
  result_cap_percent: number | null;
  result_floor_percent: number;
  is_active: boolean;
  note: string | null;
}


interface RatingBand {
  id: string;
  code: string;
  label: string;
  min_pct: number;
  sort_order: number;
  /** NULL = bộ ngưỡng chung của công ty. */
  template_id: string | null;
}

interface Criteria {
  id: string;
  template_id: string;
  name: string;
  weight_percent: number;
  max_score: number;
  allow_over_standard: boolean;
  score_levels: ScoreLevel[];
  measure_unit: string | null;
  measure_hint: string | null;
  description: string | null;
  score_method: string | null;
  sort_order: number;
  is_active: boolean;
}

const BLANK_TEMPLATE = {
  code: '', name: '', block_code: 'VAN_PHONG', unit_id: '', default_kpi_amount: '0', note: '',
  score_method: 'WEIGHTED_PERCENT', result_cap_percent: '', result_floor_percent: '0',
};

/** Thang mặc định cho tiêu chí mới: đếm số lần sai, càng ít càng tốt. */
const DEFAULT_LEVELS: ScoreLevel[] = [
  { score: 4, max: 0, label: 'Không sai lần nào' },
  { score: 3, min: 1, max: 1, label: 'Sai 1 lần' },
  { score: 2, min: 2, max: 3, label: 'Sai 2-3 lần' },
  { score: 0, min: 4, label: 'Sai trên 3 lần' },
];

const BLANK_CRITERIA = {
  name: '', weight_percent: '', max_score: '4', allow_over_standard: false,
  measure_unit: 'lần', measure_hint: '',
  description: '',
  /** Rỗng = theo cách tính của cả bộ KPI. */
  score_method: '',
  levels: DEFAULT_LEVELS,
};

export function KpiTemplateEditor({
  actorId,
  scopeTemplateId,
}: {
  actorId: string | null;
  /**
   * Chỉ biên tập ĐÚNG một bộ KPI, bỏ hết phần danh sách và nút tạo.
   *
   * Dùng khi màn này nhúng trong khu riêng của một nhân sự: ở đó bộ KPI là
   * của chính người đang mở, bày thêm danh sách mọi bộ trong công ty chỉ làm
   * người dùng tưởng mình đang sửa cái dùng chung.
   */
  scopeTemplateId?: string | null;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [criteria, setCriteria] = useState<Criteria[]>([]);
  const [bands, setBands] = useState<RatingBand[]>([]);
  const [units, setUnits] = useState<{ id: string; name: string; parent_id: string | null }[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string; avatar_url: string | null; unit_id: string | null; position_id: string | null }[]>([]);
  const [schemes, setSchemes] = useState<{ user_id: string; template_id: string }[]>([]);
  const [bandDraft, setBandDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [supported, setSupported] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [templateModal, setTemplateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [templateForm, setTemplateForm] = useState(BLANK_TEMPLATE);

  const [criteriaModal, setCriteriaModal] = useState<string | null>(null);
  const [editingCriteria, setEditingCriteria] = useState<Criteria | null>(null);
  const [criteriaForm, setCriteriaForm] = useState(BLANK_CRITERIA);
  const [tryValue, setTryValue] = useState('');

  const load = async () => {
    if (!supabase) return;
    setLoading(true);
    const [templateRes, criteriaRes, bandRes, unitRes, peopleRes, schemeRes] = await Promise.all([
      supabase.from('kpi_position_templates').select('*').order('name'),
      supabase.from('kpi_template_criteria').select('*').order('sort_order'),
      supabase.from('kpi_rating_bands').select('*').order('sort_order'),
      supabase.from('organization_units').select('id, name, parent_id').eq('is_active', true).order('name'),
      supabase.from('profiles').select('id, name, avatar_url, unit_id, position_id').eq('is_active', true).order('name'),
      supabase.from('employee_kpi_schemes').select('user_id, template_id'),
    ]);
    if (templateRes.error || criteriaRes.error) {
      setSupported(false);
      setLoading(false);
      return;
    }
    setTemplates((templateRes.data || []) as Template[]);
    setCriteria((criteriaRes.data || []) as Criteria[]);
    // Bảng ngưỡng có thể chưa có cột template_id (chưa chạy migration
    // 20260929110000). Khi đó bỏ qua phần ngưỡng riêng, phần còn lại vẫn chạy.
    setBands(bandRes.error ? [] : ((bandRes.data || []) as RatingBand[]));
    setUnits((unitRes.data || []) as typeof units);
    setPeople((peopleRes.data || []) as typeof people);
    // Thiếu bảng = chưa chạy migration; khi đó dòng Phòng ban để trống thay
    // vì làm hỏng cả màn.
    setSchemes(schemeRes.error ? [] : ((schemeRes.data || []) as { user_id: string; template_id: string }[]));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Tên phòng ban của những người đang dùng bộ KPI này.
   *
   * Đọc ngược từ `employee_kpi_schemes` chứ không đọc `unit_id` của bộ: bộ
   * KPI thuộc về NGƯỜI, nên phòng ban đúng là phòng của chính những người
   * đang dùng nó — thứ đã khai một lần ở Cơ cấu tổ chức.
   */
  const assignedUnitNames = (templateId?: string) => {
    if (!templateId) return [];
    const userIds = new Set(
      schemes.filter((row) => row.template_id === templateId).map((row) => row.user_id),
    );
    const unitIds = new Set(
      people.filter((person) => userIds.has(person.id) && person.unit_id)
        .map((person) => person.unit_id as string),
    );
    return [...unitIds]
      .map((id) => units.find((unit) => unit.id === id)?.name)
      .filter((name): name is string => Boolean(name));
  };

  /** Nguoi treo THANG vao don vi nay - khong gom don vi con. */
  const peopleInUnit = (unitId: string) => people.filter((person) => person.unit_id === unitId);

  const criteriaByTemplate = useMemo(() => {
    const map = new Map<string, Criteria[]>();
    criteria.forEach((item) => map.set(item.template_id, [...(map.get(item.template_id) || []), item]));
    return map;
  }, [criteria]);

  const weightOf = (templateId: string) =>
    (criteriaByTemplate.get(templateId) || [])
      .filter((item) => item.is_active)
      .reduce((sum, item) => sum + Number(item.weight_percent), 0);

  const visibleTemplates = scopeTemplateId
    ? templates.filter((item) => item.id === scopeTemplateId)
    : templates;

  // ---- Mẫu ----------------------------------------------------------------
  const openNewTemplate = (unitId?: string | null) => {
    setEditingTemplate(null);
    setTemplateForm({ ...BLANK_TEMPLATE, unit_id: unitId || '' });
    setTemplateModal(true);
  };



  const openEditTemplate = (template: Template) => {
    setEditingTemplate(template);
    setTemplateForm({
      code: template.code,
      name: template.name,
      block_code: template.block_code,
      unit_id: template.unit_id ?? '',
      default_kpi_amount: String(Number(template.default_kpi_amount)),
      note: template.note ?? '',
      score_method: template.score_method ?? 'WEIGHTED_PERCENT',
      result_cap_percent: template.result_cap_percent == null ? '' : String(Number(template.result_cap_percent)),
      result_floor_percent: String(Number(template.result_floor_percent ?? 0)),
    });
    setTemplateModal(true);
  };

  const saveTemplate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    const payload = {
      code: templateForm.code.trim().toUpperCase(),
      name: templateForm.name.trim(),
      block_code: templateForm.block_code,
      // Rong = chua gan phong ban nao. Khai duoc phong thi bo KPI tu ap cho
      // moi nguoi trong phong do, khong phai di gan tung nguoi.
      unit_id: templateForm.unit_id || null,
      default_kpi_amount: Number(templateForm.default_kpi_amount || '0'),
      score_method: templateForm.score_method,
      result_cap_percent: templateForm.result_cap_percent === '' ? null : Number(templateForm.result_cap_percent),
      result_floor_percent: Number(templateForm.result_floor_percent || '0'),
      note: templateForm.note.trim() || null,
      ...(editingTemplate ? {} : { created_by: actorId }),
    };
    const { error } = editingTemplate
      ? await supabase.from('kpi_position_templates').update(payload).eq('id', editingTemplate.id)
      : await supabase.from('kpi_position_templates').insert(payload);
    setSaving(false);
    if (error) return toast('Không lưu được bộ KPI: ' + describeDbError(error), 'error');
    toast(editingTemplate ? 'Đã cập nhật bộ KPI.' : 'Đã tạo bộ KPI.', 'success');
    setTemplateModal(false);
    await load();
  };

  const toggleActive = async (template: Template) => {
    if (!supabase) return;
    const total = weightOf(template.id);
    if (!template.is_active && Math.abs(total - 100) > 0.01) {
      return toast(`Tổng trọng số đang là ${total}%, phải đúng 100% mới bật được.`, 'warning');
    }
    const { error } = await supabase
      .from('kpi_position_templates')
      .update({ is_active: !template.is_active })
      .eq('id', template.id);
    if (error) return toast('Không đổi được trạng thái: ' + describeDbError(error), 'error');
    await load();
  };

  const removeTemplate = async (template: Template) => {
    const ok = await confirm({
      title: `Xoá bộ KPI "${template.name}"?`,
      message: 'Các tiêu chí bên trong bị xoá theo. Phiếu đã chấm bằng bộ này vẫn giữ nguyên kết quả.',
      confirmLabel: 'Xoá',
      danger: true,
    });
    if (!ok || !supabase) return;
    const { error } = await supabase.from('kpi_position_templates').delete().eq('id', template.id);
    if (error) return toast('Không xoá được: ' + describeDbError(error), 'error');
    await load();
  };

  // ---- Tiêu chí -----------------------------------------------------------
  const openNewCriteria = (templateId: string) => {
    setEditingCriteria(null);
    setCriteriaForm(BLANK_CRITERIA);
    setTryValue('');
    setCriteriaModal(templateId);
  };

  const openEditCriteria = (item: Criteria) => {
    setEditingCriteria(item);
    setCriteriaForm({
      name: item.name,
      weight_percent: String(Number(item.weight_percent)),
      max_score: String(Number(item.max_score)),
      allow_over_standard: item.allow_over_standard ?? false,
      measure_unit: item.measure_unit ?? '',
      measure_hint: item.measure_hint ?? '',
      description: item.description ?? '',
      score_method: item.score_method ?? '',
      levels: Array.isArray(item.score_levels) && item.score_levels.length > 0
        ? item.score_levels
        : DEFAULT_LEVELS,
    });
    setTryValue('');
    setCriteriaModal(item.template_id);
  };

  const saveCriteria = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase || !criteriaModal) return;

    const maxScore = Number(criteriaForm.max_score || '0');
    const overflow = criteriaForm.levels.find((level) => Number(level.score) > maxScore);
    if (overflow) {
      return toast(`Mục tiêu ${overflow.score} điểm vượt thang ${maxScore} của tiêu chí này.`, 'warning');
    }

    setSaving(true);
    const payload = {
      template_id: criteriaModal,
      name: criteriaForm.name.trim(),
      weight_percent: Number(criteriaForm.weight_percent || '0'),
      max_score: maxScore,
      allow_over_standard: criteriaForm.allow_over_standard,
      description: criteriaForm.description.trim() || null,
      // Rỗng = để trống, tức là theo cách tính của cả bộ KPI.
      score_method: criteriaForm.score_method || null,
      measure_unit: criteriaForm.measure_unit.trim() || null,
      measure_hint: criteriaForm.measure_hint.trim() || null,
      // Bỏ mức rỗng do người dùng thêm rồi để trống — lưu vào chỉ làm thang
      // điểm có một dòng vô nghĩa mà lúc chấm không ai hiểu.
      score_levels: criteriaForm.levels.filter((level) => level.label || level.min != null || level.max != null),
      sort_order: editingCriteria?.sort_order ?? (criteriaByTemplate.get(criteriaModal)?.length ?? 0) * 10 + 100,
    };
    const { error } = editingCriteria
      ? await supabase.from('kpi_template_criteria').update(payload).eq('id', editingCriteria.id)
      : await supabase.from('kpi_template_criteria').insert(payload);
    setSaving(false);
    if (error) return toast('Không lưu được tiêu chí: ' + describeDbError(error), 'error');
    toast('Đã lưu tiêu chí.', 'success');
    setCriteriaModal(null);
    await load();
  };

  const removeCriteria = async (item: Criteria) => {
    const ok = await confirm({
      title: `Xoá tiêu chí "${item.name}"?`,
      message: 'Tiêu chí đã có điểm chấm thì database sẽ chặn xoá — khi đó hãy tắt nó thay vì xoá.',
      confirmLabel: 'Xoá',
      danger: true,
    });
    if (!ok || !supabase) return;
    const { error } = await supabase.from('kpi_template_criteria').delete().eq('id', item.id);
    if (error) return toast('Không xoá được: ' + describeDbError(error), 'error');
    await load();
  };

  const globalBands = useMemo(
    () => bands.filter((band) => band.template_id == null).sort((a, b) => a.sort_order - b.sort_order),
    [bands],
  );
  const bandsOf = (templateId: string) =>
    bands.filter((band) => band.template_id === templateId).sort((a, b) => a.sort_order - b.sort_order);

  /** Chép bộ chung làm điểm xuất phát, thay vì bắt khai lại từ con số không. */
  const createOwnBands = async (templateId: string) => {
    if (!supabase) return;
    if (globalBands.length === 0) {
      return toast('Chưa có bộ ngưỡng chung để chép. Chạy migration KPI trước.', 'warning');
    }
    const { error } = await supabase.from('kpi_rating_bands').insert(
      globalBands.map((band) => ({
        code: band.code,
        label: band.label,
        min_pct: band.min_pct,
        sort_order: band.sort_order,
        template_id: templateId,
      })),
    );
    if (error) return toast('Không tạo được ngưỡng riêng: ' + describeDbError(error), 'error');
    await load();
  };

  const saveBand = async (band: RatingBand, minPct: number) => {
    if (!supabase) return;
    const { error } = await supabase
      .from('kpi_rating_bands')
      .update({ min_pct: minPct, updated_at: new Date().toISOString() })
      .eq('id', band.id);
    if (error) return toast('Không lưu được ngưỡng: ' + describeDbError(error), 'error');
    await load();
  };

  const dropOwnBands = async (templateId: string) => {
    const ok = await confirm({
      title: 'Bỏ bộ ngưỡng riêng?',
      message: 'Bộ KPI này sẽ quay về dùng ngưỡng xếp loại chung của công ty.',
      confirmLabel: 'Bỏ ngưỡng riêng',
      danger: true,
    });
    if (!ok || !supabase) return;
    const { error } = await supabase.from('kpi_rating_bands').delete().eq('template_id', templateId);
    if (error) return toast('Không bỏ được: ' + describeDbError(error), 'error');
    await load();
  };

  const updateLevel = (index: number, patch: Partial<ScoreLevel>) => {
    setCriteriaForm((prev) => ({
      ...prev,
      levels: prev.levels.map((level, i) => (i === index ? { ...level, ...patch } : level)),
    }));
  };

  const levelIssues = describeLevelIssues(criteriaForm.levels);
  /**
   * Don vi do hien ngay sau moi o so trong bang muc tieu.
   *
   * De doc thanh cau: "4 diem khi dat tu 98 % den ...". Khong doan la "%":
   * tieu chi dem so lan sai thi don vi la "lan", va ghi nham % lam nguoi cham
   * nhap sai hang don vi.
   */
  const unitSuffix = criteriaForm.measure_unit.trim();
  const autoScorable = isAutoScorable(criteriaForm.levels);
  const tryScore = tryValue === '' ? null : scoreFromLevels(criteriaForm.levels, Number(tryValue));

  if (!supported) return null;
  if (loading) return <Skeleton className="h-28" />;

  return (
    <>
      <Card>
        <CardContent className="space-y-4">
          {!scopeTemplateId && (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Bộ tiêu chí KPI</h3>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                  Tự khai tiêu chí và thang điểm. Mức nào có ngưỡng số thì lúc chấm chỉ cần nhập số đo
                  thực tế — hệ thống tự ra điểm.
                </p>
              </div>
              <Button size="sm" onClick={() => openNewTemplate()}>
                <Plus className="h-4 w-4" /> Tạo bộ KPI
              </Button>
            </div>
          )}

          {visibleTemplates.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
              Chưa có bộ KPI nào. Tạo một bộ, thêm tiêu chí cho đủ 100% trọng số rồi bật lên là chấm được.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {visibleTemplates.map((template) => {
                const rows = criteriaByTemplate.get(template.id) || [];
                const total = weightOf(template.id);
                const balanced = Math.abs(total - 100) < 0.01;
                // Đã khoanh vào đúng một bộ thì mở sẵn: bắt bấm thêm một nhát
                // để xem thứ duy nhất trên màn là thừa.
                const isOpen = scopeTemplateId ? true : openId === template.id;

                return (
                  <div key={template.id}>
                    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                      {!scopeTemplateId && (
                        <button
                          type="button"
                          onClick={() => setOpenId(isOpen ? null : template.id)}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
                          aria-label={isOpen ? `Thu gọn ${template.name}` : `Mở ${template.name}`}
                        >
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-slate-800">{template.name}</p>
                        <p className="truncate text-xs text-slate-500">
                          {template.code} · {rows.length} tiêu chí
                          {template.result_cap_percent != null && ` · trần ${Number(template.result_cap_percent)}%`}
                        </p>
                      </div>
                      <Badge className={balanced ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}>
                        {total}%
                      </Badge>
                      <Badge className={template.is_active ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-500'}>
                        {template.is_active ? 'Đang dùng' : 'Tắt'}
                      </Badge>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => void toggleActive(template)}>
                          {template.is_active ? 'Tắt' : 'Bật'}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => openEditTemplate(template)} aria-label={`Sửa ${template.name}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {!scopeTemplateId && (
                          <Button size="sm" variant="danger" onClick={() => void removeTemplate(template)} aria-label={`Xoá ${template.name}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {isOpen && (
                      <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
                        {/* Nhan su cua phong ban duoc gan bo KPI nay. Khai
                            xong ma khong thay ai la dau hieu phong do chua co
                            nguoi - biet ngay thay vi doi toi luc mo phieu
                            cham moi phat hien. */}
                        {template.unit_id && (
                          <div className="mb-3 rounded-lg border border-slate-200 bg-white p-3">
                            <p className="text-[11px] font-bold text-slate-600">
                              Nhân sự dùng bộ này
                              <span className="ml-1 font-normal text-slate-400">
                                ({peopleInUnit(template.unit_id).length})
                              </span>
                            </p>
                            {peopleInUnit(template.unit_id).length === 0 ? (
                              <p className="mt-1 text-[11px] leading-relaxed text-amber-700">
                                Phòng này chưa có nhân sự nào. Gán người vào phòng ở Cơ cấu tổ chức
                                thì họ tự dùng bộ KPI này.
                              </p>
                            ) : (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {peopleInUnit(template.unit_id).map((person) => (
                                  <span
                                    key={person.id}
                                    className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700"
                                  >
                                    {person.name}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {!balanced && (
                          <p className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                            Tổng trọng số {total}%, còn thiếu {(100 - total).toFixed(2)}% mới bật được bộ này.
                          </p>
                        )}

                        <div className="space-y-2">
                          {rows.map((item) => {
                            const auto = isAutoScorable(item.score_levels);
                            return (
                              <div key={item.id} className="rounded-lg bg-white px-3 py-2.5">
                                <div className="flex flex-wrap items-center gap-3">
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-semibold text-slate-800">{item.name}</p>
                                  <p className="text-[11px] text-slate-400">
                                    Trọng số {Number(item.weight_percent)}% · thang {Number(item.max_score)} ·{' '}
                                    {auto
                                      ? `${(item.score_levels || []).length} mục tiêu, tự chấm`
                                      : 'chấm tay'}
                                    {!item.is_active && ' · đã tắt'}
                                  </p>
                                </div>
                                <Button size="sm" variant="secondary" onClick={() => openEditCriteria(item)} aria-label={`Sửa ${item.name}`}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button size="sm" variant="danger" onClick={() => void removeCriteria(item)} aria-label={`Xoá ${item.name}`}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                                </div>

                                {/* Minh chung cua TIEU CHI: mo ta cai gi duoc
                                    tinh la dat. Nhan vien doc duoc truoc khi
                                    tu cham, nguoi duyet doi chieu luc chot. */}
                                <div className="mt-2">
                                  <KpiEvidenceBox
                                    criteriaId={item.id}
                                    uploadedBy={actorId}
                                    label="Minh chứng mẫu"
                                    hint="Mô tả hoặc file cho thấy thế nào là đạt tiêu chí này."
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <Button size="sm" variant="outline" className="mt-3" onClick={() => openNewCriteria(template.id)}>
                          <Plus className="h-3.5 w-3.5" /> Thêm tiêu chí
                        </Button>

                        {/* ---- Ngưỡng xếp loại ---- */}
                        {bands.length > 0 && (() => {
                          const own = bandsOf(template.id);
                          const shown = own.length > 0 ? own : globalBands;
                          return (
                            <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="text-xs font-bold text-slate-700">Ngưỡng xếp loại</p>
                                  <p className="mt-0.5 text-[11px] text-slate-500">
                                    {own.length > 0
                                      ? 'Bộ riêng của bộ KPI này.'
                                      : 'Đang dùng ngưỡng chung của công ty.'}
                                  </p>
                                </div>
                                {own.length > 0 ? (
                                  <Button size="sm" variant="ghost" onClick={() => void dropOwnBands(template.id)}>
                                    Về dùng ngưỡng chung
                                  </Button>
                                ) : (
                                  <Button size="sm" variant="outline" onClick={() => void createOwnBands(template.id)}>
                                    Khai ngưỡng riêng
                                  </Button>
                                )}
                              </div>

                              <div className="mt-2.5 flex flex-wrap gap-2">
                                {shown.map((band) => (
                                  <div key={band.id} className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5">
                                    <span className="text-[11px] font-semibold text-slate-700">{band.label}</span>
                                    <span className="text-[11px] text-slate-400">từ</span>
                                    {own.length > 0 ? (
                                      <input
                                        inputMode="decimal"
                                        aria-label={`Ngưỡng ${band.label}`}
                                        value={bandDraft[band.id] ?? String(Number(band.min_pct))}
                                        onChange={(e) => setBandDraft((prev) => ({
                                          ...prev, [band.id]: e.target.value.replace(/[^\d.]/g, ''),
                                        }))}
                                        onBlur={(e) => {
                                          const value = Number(e.target.value || '0');
                                          if (value !== Number(band.min_pct)) void saveBand(band, value);
                                        }}
                                        className="h-7 w-14 rounded border border-slate-200 bg-white px-1.5 text-right text-[11px] tabular-nums outline-none focus:border-indigo-500"
                                      />
                                    ) : (
                                      <span className="text-[11px] font-bold tabular-nums text-slate-600">
                                        {Number(band.min_pct)}
                                      </span>
                                    )}
                                    <span className="text-[11px] text-slate-400">%</span>
                                  </div>
                                ))}
                              </div>

                              {own.length === 0 && (
                                <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                                  Khai ngưỡng riêng khi bộ phận này có chuẩn khác mặt bằng chung — ví dụ
                                  khối kinh doanh đòi 90% mới đạt A trong khi khối kho lấy 80%.
                                </p>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- Modal bộ KPI ---- */}
      <Modal open={templateModal} onClose={() => setTemplateModal(false)} title={editingTemplate ? 'Sửa bộ KPI' : 'Tạo bộ KPI'}>
        <form onSubmit={saveTemplate} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Tên bộ KPI" required
              placeholder="VD: Nhân viên kinh doanh"
              value={templateForm.name}
              onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
            />
            <Input
              label="Mã (viết hoa, không dấu)" required
              placeholder="VD: KD_NVKD"
              value={templateForm.code}
              onChange={(e) => setTemplateForm({ ...templateForm, code: e.target.value.toUpperCase() })}
            />
          </div>
          {/* ---- Phòng ban, CHỈ ĐỌC ----
               Không cho chọn ở đây. Nhân sự đã được gán phòng ban ở Cơ cấu tổ
               chức rồi; bày thêm một ô chọn phòng tại đây là mở ra khả năng
               hai nơi nói hai điều khác nhau về cùng một người, và không ai
               biết nơi nào đúng. Dòng này chỉ đọc lại sự thật đó. */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5">
            <p className="text-xs font-semibold text-slate-700">Phòng ban</p>
            {(() => {
              const names = assignedUnitNames(editingTemplate?.id);
              if (!editingTemplate) {
                return (
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    Theo phòng ban của người được gán bộ KPI này — lấy từ Cơ cấu tổ chức.
                  </p>
                );
              }
              return names.length > 0 ? (
                <p className="mt-1 text-sm font-medium text-slate-800">{names.join(', ')}</p>
              ) : (
                <p className="mt-1 text-[11px] leading-relaxed text-amber-700">
                  Chưa ai dùng bộ này, hoặc người dùng nó chưa được gán phòng ban ở Cơ cấu tổ chức.
                </p>
              );
            })()}
          </div>

          <Textarea
            label="Ghi chú"
            value={templateForm.note}
            onChange={(e) => setTemplateForm({ ...templateForm, note: e.target.value })}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setTemplateModal(false)}>Hủy</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu'}</Button>
          </div>
        </form>
      </Modal>

      {/* ---- Modal thêm khối ---- */}
      {/* ---- Modal tiêu chí + thang điểm ---- */}
      <Modal open={criteriaModal !== null} onClose={() => setCriteriaModal(null)} title={editingCriteria ? 'Sửa tiêu chí' : 'Thêm tiêu chí'} size="lg">
        <form onSubmit={saveCriteria} className="space-y-4">
          <Input
            label="Tên tiêu chí" required
            placeholder="VD: Sai sót khi nhập đơn hàng"
            value={criteriaForm.name}
            onChange={(e) => setCriteriaForm({ ...criteriaForm, name: e.target.value })}
          />

          <Textarea
            label="Mô tả tiêu chí"
            rows={2}
            placeholder="Đo cái gì, lấy số ở đâu, thế nào là đạt. VD: Đếm số đơn nhập sai trong tháng, lấy từ sổ kho."
            value={criteriaForm.description}
            onChange={(e) => setCriteriaForm({ ...criteriaForm, description: e.target.value })}
          />

          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              label="Trọng số (%)" required inputMode="decimal"
              value={criteriaForm.weight_percent}
              onChange={(e) => setCriteriaForm({ ...criteriaForm, weight_percent: e.target.value.replace(/[^\d.]/g, '') })}
            />
            <Input
              label="Thang điểm tối đa" required inputMode="decimal"
              value={criteriaForm.max_score}
              onChange={(e) => setCriteriaForm({ ...criteriaForm, max_score: e.target.value.replace(/[^\d.]/g, '') })}
            />
            <label className="flex items-start gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={criteriaForm.allow_over_standard}
                onChange={(e) => setCriteriaForm({ ...criteriaForm, allow_over_standard: e.target.checked })}
                className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300"
              />
              <span>
                Cho chấm vượt thang điểm
                <span className="block text-[11px] leading-relaxed text-slate-400">
                  Ví dụ chấm 4,5 trên thang 4 khi làm vượt yêu cầu. Trần thật nằm ở tổng KPI
                  (120%), không ở từng tiêu chí. Chỉ bật khi tiêu chí có mô tả mức vượt.
                </span>
              </span>
            </label>
            <Input
              label="Đơn vị số đo"
              placeholder="lần, %, ngày…"
              value={criteriaForm.measure_unit}
              onChange={(e) => setCriteriaForm({ ...criteriaForm, measure_unit: e.target.value })}
            />
          </div>
          <Input
            label="Ghi chú"
            placeholder="VD: Đếm đơn hàng bị sai trong kỳ, không tính đơn khách tự huỷ."
            value={criteriaForm.measure_hint}
            onChange={(e) => setCriteriaForm({ ...criteriaForm, measure_hint: e.target.value })}
          />

          {/* ---- Mục tiêu ----
               Mỗi dòng là một mục tiêu: đạt tới ngưỡng này thì được chừng này
               điểm. Khai ngưỡng số thì lúc chấm chỉ cần nhập kết quả thực tế,
               hệ thống tự ra điểm — không ai phải tự quy đổi trong đầu rồi
               cãi nhau xem quy đúng chưa. */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold text-slate-700">Mục tiêu của tiêu chí này</p>
              <Button
                type="button" size="sm" variant="outline"
                onClick={() => setCriteriaForm((prev) => ({ ...prev, levels: [...prev.levels, { score: 0, label: '' }] }))}
              >
                <Plus className="h-3.5 w-3.5" /> Thêm mục tiêu
              </Button>
            </div>

            <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
              <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              Đọc theo dòng: được mấy điểm khi đạt từ bao nhiêu đến bao nhiêu — tính cả
              hai đầu. Bỏ trống một đầu là đầu đó không chặn. Dòng không điền số nào thì
              phải chấm tay.
            </p>

            <div className="mt-3 space-y-2">
              {criteriaForm.levels.map((level, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-2.5 py-2">
                  <input
                    inputMode="decimal" aria-label={`Điểm của mục tiêu ${index + 1}`}
                    placeholder="Điểm"
                    value={level.score == null ? '' : String(level.score)}
                    onChange={(e) => updateLevel(index, { score: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })}
                    className="h-8 w-16 rounded-lg border border-slate-200 px-2 text-right text-xs tabular-nums outline-none focus:border-indigo-500"
                  />
                  <span className="text-[11px] text-slate-400">điểm khi đạt</span>
                  <input
                    inputMode="decimal" aria-label={`Từ, mục tiêu ${index + 1}`}
                    placeholder="—"
                    value={level.min == null ? '' : String(level.min)}
                    onChange={(e) => {
                      const clean = e.target.value.replace(/[^\d.-]/g, '');
                      updateLevel(index, { min: clean === '' ? null : Number(clean) });
                    }}
                    className="h-8 w-20 rounded-lg border border-slate-200 px-2 text-right text-xs tabular-nums outline-none focus:border-indigo-500"
                  />
                  {/* Don vi lay tu chinh o "Don vi do" ben tren, khong doan
                      la %: tieu chi dem so lan sai thi "%" la sai han. */}
                  {unitSuffix && <span className="text-[11px] text-slate-500">{unitSuffix}</span>}
                  <span className="text-[11px] text-slate-400">đến</span>
                  <input
                    inputMode="decimal" aria-label={`Đến, mục tiêu ${index + 1}`}
                    placeholder="—"
                    value={level.max == null ? '' : String(level.max)}
                    onChange={(e) => {
                      const clean = e.target.value.replace(/[^\d.-]/g, '');
                      updateLevel(index, { max: clean === '' ? null : Number(clean) });
                    }}
                    className="h-8 w-20 rounded-lg border border-slate-200 px-2 text-right text-xs tabular-nums outline-none focus:border-indigo-500"
                  />
                  {unitSuffix && <span className="text-[11px] text-slate-500">{unitSuffix}</span>}
                  <input
                    aria-label={`Mô tả mục tiêu ${index + 1}`}
                    placeholder="Mô tả, hiện cho người chấm"
                    value={level.label ?? ''}
                    onChange={(e) => updateLevel(index, { label: e.target.value })}
                    className="h-8 min-w-[160px] flex-1 rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => setCriteriaForm((prev) => ({ ...prev, levels: prev.levels.filter((_, i) => i !== index) }))}
                    aria-label={`Bỏ mục tiêu ${index + 1}`}
                    className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {levelIssues.map((issue) => (
              <p key={issue} className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-700">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />{issue}
              </p>
            ))}

            {/* Thử ngay tại chỗ: thang điểm sai chỉ lộ ra khi đã chấm thật và
                ai đó thắc mắc vì sao điểm trống. */}
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
              <span className="text-[11px] font-semibold text-slate-600">Thử:</span>
              <span className="text-[11px] text-slate-500">số đo</span>
              <input
                inputMode="decimal" aria-label="Số đo thử"
                value={tryValue}
                onChange={(e) => setTryValue(e.target.value.replace(/[^\d.-]/g, ''))}
                className="h-8 w-24 rounded-lg border border-slate-200 px-2 text-right text-xs tabular-nums outline-none focus:border-indigo-500"
              />
              {criteriaForm.measure_unit && <span className="text-[11px] text-slate-400">{criteriaForm.measure_unit}</span>}
              <span className="text-[11px] text-slate-500">→</span>
              {tryValue === '' ? (
                <span className="text-[11px] text-slate-400">nhập một số để xem ra mấy điểm</span>
              ) : tryScore == null ? (
                <span className="text-[11px] font-semibold text-amber-700">
                  không mức nào phủ — thang điểm còn hở
                </span>
              ) : (
                <strong className="text-xs tabular-nums text-indigo-700">
                  {tryScore}/{criteriaForm.max_score} điểm
                </strong>
              )}
            </div>

            {!autoScorable && (
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                Chưa mục tiêu nào khai ngưỡng số, nên tiêu chí này vẫn phải chấm tay.
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setCriteriaModal(null)}>Hủy</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu tiêu chí'}</Button>
          </div>
        </form>
      </Modal>

      {/* ---- Khai mot cach tinh moi: bon o chon, khong viet cong thuc ---- */}
    </>
  );
}
