// ============================================================================
// KPI của từng người: đi xuống cây tổ chức tới đúng một nhân sự.
// ----------------------------------------------------------------------------
//   Khối / doanh nghiệp  ->  phòng ban  ->  bộ phận  ->  NHÂN VIÊN  ->  bộ KPI
//
// Đơn vị lấy thẳng từ Cơ cấu tổ chức, không khai lại. Phòng ban nào chưa dựng
// ở đó thì ở đây cũng không có — đúng như vậy: một nơi khai, mọi nơi đọc.
//
// KPI thuộc về NGƯỜI, không phải một bộ dùng chung rồi gán xuống. Mỗi người
// một bộ thì tiêu chí bám đúng việc họ làm, và sửa cho một người không động
// tới ai khác. Đó là lý do màn này không còn danh sách bộ dùng chung, cũng
// không còn nút gán cho cả phòng.
//
// Những bộ cũ gán theo đơn vị hoặc theo vị trí VẪN có hiệu lực dưới database
// (`kpi_scheme_for` giữ nguyên thứ tự ưu tiên) — khu riêng của mỗi người nói
// rõ họ đang thừa hưởng bộ nào, và tạo bộ riêng sẽ thay thế nó.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Building2, ChevronRight, Target, TriangleAlert, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { KpiTemplateEditor } from '@/components/kpi/KpiTemplateEditor';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { formatDate, getTodayString } from '@/lib/utils';
import type { Profile } from '@/types';

interface Unit { id: string; code: string | null; name: string; unit_type: string; parent_id: string | null }
interface Template { id: string; code: string; name: string; is_active: boolean; position_id: string | null }
interface Scheme { id: string; user_id: string; template_id: string; effective_from: string }
interface UnitScheme { id: string; unit_id: string; template_id: string; effective_from: string }
interface Criterion { id: string; template_id: string; name: string; weight_percent: number; is_active: boolean }

export function KpiSchemeBoard({ actorId }: { actorId: string | null }) {
  const { users } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [units, setUnits] = useState<Unit[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [supported, setSupported] = useState(true);

  /** Đường đi hiện tại, từ gốc xuống. Rỗng = đang ở danh sách khối. */
  const [path, setPath] = useState<Unit[]>([]);

  /**
   * Nhân sự đang mở — một cấp nữa của đường đi, sau phòng ban.
   *
   * Danh sách người trong phòng chỉ nói được "có bộ hay chưa". Mở hẳn một
   * người ra mới trả lời được câu tiếp theo: bộ nào, tiêu chí gì, đến từ đâu,
   * và muốn làm riêng cho họ thì bấm vào đâu.
   */
  const [focusPerson, setFocusPerson] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);

  /**
   * Gán cho cả đơn vị.
   *
   * Một phòng 20 người cùng bộ KPI mà phải gán 20 lần thì người mới vào tháng
   * sau sẽ bị quên — và không ai thấy, vì chỗ duy nhất lộ ra là lúc mở phiếu
   * chấm của riêng người đó. Gán ở mức đơn vị rồi ai cần khác thì gán riêng
   * đè lên.
   */
  const [unitSchemes, setUnitSchemes] = useState<UnitScheme[]>([]);
  const [unitSchemesSupported, setUnitSchemesSupported] = useState(true);
  const [criteria, setCriteria] = useState<Criterion[]>([]);

  const load = async () => {
    if (!supabase) return;
    setLoading(true);
    const [unitRes, tplRes, schemeRes, unitSchemeRes, criteriaRes] = await Promise.all([
      supabase.from('organization_units').select('id, code, name, unit_type, parent_id').eq('is_active', true).order('name'),
      supabase.from('kpi_position_templates').select('id, code, name, is_active, position_id').order('name'),
      supabase.from('employee_kpi_schemes').select('*').order('effective_from', { ascending: false }),
      supabase.from('unit_kpi_schemes').select('*').order('effective_from', { ascending: false }),
      // Tiêu chí chỉ dùng để xem trước trong khu nhân sự: thấy ngay bộ này
      // chấm những gì, thay vì phải nhớ tên bộ rồi sang bước 1 tra lại.
      supabase.from('kpi_template_criteria').select('id, template_id, name, weight_percent, is_active').order('sort_order'),
    ]);
    if (schemeRes.error) { setSupported(false); setLoading(false); return; }
    setCriteria(((criteriaRes.data || []) as Criterion[]).filter((item) => item.is_active));
    setUnits((unitRes.data || []) as Unit[]);
    setTemplates((tplRes.data || []) as Template[]);
    setSchemes((schemeRes.data || []) as Scheme[]);
    // Chưa chạy migration 20260930190000 thì chỉ ẩn phần gán theo đơn vị,
    // phần gán từng người vẫn chạy như cũ.
    setUnitSchemesSupported(!unitSchemeRes.error);
    setUnitSchemes(unitSchemeRes.error ? [] : ((unitSchemeRes.data || []) as UnitScheme[]));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const tplById = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);
  const current = path[path.length - 1] ?? null;

  const childrenOf = (parentId: string | null) =>
    units.filter((u) => (u.parent_id ?? null) === parentId);

  /** Người treo THẲNG vào đơn vị này — không gồm đơn vị con. */
  const peopleIn = (unitId: string | null) =>
    users.filter((u) => u.is_active && (u.unit_id ?? null) === unitId);

  /** Đếm cả cây con, để thẻ đơn vị cho thấy bên trong có bao nhiêu người. */
  const headcount = (unitId: string): number =>
    peopleIn(unitId).length
    + childrenOf(unitId).reduce((sum, child) => sum + headcount(child.id), 0);

  const ownScheme = (userId: string) => schemes.find((s) => s.user_id === userId);
  const byPosition = (person: Profile) =>
    templates.find((t) => t.is_active && t.position_id && t.position_id === person.position_id);

  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);

  /** Bộ gán cho chính đơn vị này, không xét cấp trên. */
  const ownUnitScheme = (unitId: string) => unitSchemes.find((s) => s.unit_id === unitId);

  /**
   * Bộ mà một đơn vị đang thừa hưởng: của chính nó, hoặc của cấp trên gần
   * nhất. Đi đúng thứ tự mà `kpi_scheme_for()` dưới database dùng, để con số
   * trên màn khớp với cái phiếu chấm thật sự lấy.
   */
  const inheritedUnitScheme = (unitId: string | null): { scheme: UnitScheme; from: Unit } | null => {
    let cursor = unitId ? unitById.get(unitId) : undefined;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      const found = ownUnitScheme(cursor.id);
      if (found) return { scheme: found, from: cursor };
      cursor = cursor.parent_id ? unitById.get(cursor.parent_id) : undefined;
    }
    return null;
  };

  /** Bộ đang áp cho một người, đủ ba lớp — giống hàm dưới database. */
  const effectiveFor = (person: Profile) => {
    const own = ownScheme(person.id);
    if (own) return { tpl: tplById.get(own.template_id), source: 'Gán riêng' };
    const inherited = inheritedUnitScheme(person.unit_id ?? null);
    if (inherited) {
      return {
        tpl: tplById.get(inherited.scheme.template_id),
        source: `Theo đơn vị ${inherited.from.name}`,
      };
    }
    const fallback = byPosition(person);
    if (fallback) return { tpl: fallback, source: 'Theo vị trí' };
    return { tpl: undefined, source: '' };
  };

  /**
   * Tạo bộ KPI của riêng một người rồi gán luôn cho họ.
   *
   * Hai bước này phải đi liền: tạo xong mà quên gán thì bộ nằm đó không ai
   * dùng, còn người kia vẫn "chưa có bộ KPI" — đúng cái màn hình này sinh ra
   * để tránh.
   */
  const createPersonalTemplate = async (person: Profile) => {
    if (!supabase) return;
    setSaving(true);
    // Mã phải duy nhất trong toàn bảng. Lấy mã nhân viên nếu có, không thì
    // bỏ dấu tên rồi gắn đuôi từ id — tên trùng nhau là chuyện thường.
    const slug = (person.employee_code || person.name)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\u0111/g, 'd').replace(/\u0110/g, 'D')
      .toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'NV';
    const { data, error } = await supabase.from('kpi_position_templates').insert({
      code: `KPI-${slug}-${person.id.slice(0, 4).toUpperCase()}`,
      name: `KPI ${person.name}`,
      block_code: 'VAN_PHONG',
      // KHÔNG khai unit_id: khai vào là bộ này tự áp cho cả phòng, trong khi
      // nó là bộ của riêng một người.
      unit_id: null,
      default_kpi_amount: 0,
      score_method: 'WEIGHTED_PERCENT',
      result_floor_percent: 0,
      created_by: actorId,
    }).select('id').single();

    if (error || !data) {
      setSaving(false);
      return toast('Không tạo được bộ KPI: ' + describeDbError(error), 'error');
    }

    const { error: assignError } = await supabase.from('employee_kpi_schemes').upsert({
      user_id: person.id,
      template_id: data.id,
      effective_from: getTodayString(),
    }, { onConflict: 'user_id,effective_from' });
    setSaving(false);
    if (assignError) {
      return toast('Đã tạo bộ nhưng không gán được: ' + describeDbError(assignError), 'error');
    }
    toast(`Đã tạo bộ KPI riêng cho ${person.name}. Thêm tiêu chí cho đủ 100% rồi bật lên.`, 'success');
    await load();
  };

  /**
   * Bỏ bộ KPI riêng của một người, rồi dọn luôn cái bộ nếu nó chỉ của họ.
   *
   * Không dọn thì mỗi lần bỏ lại để lại một bộ mồ côi kèm nguyên đám tiêu
   * chí — vài tháng là bảng đầy những bộ không ai dùng mà không ai dám xoá
   * vì không biết nó của ai.
   *
   * Bộ đã từng dùng để chấm thì KHÔNG xoá, chỉ tắt: phiếu chấm cũ trỏ vào
   * nó, xoá đi là lịch sử mất chỗ dựa.
   */
  /**
   * Tạo một bộ KPI rồi gán cho TẤT CẢ nhân sự trong phòng.
   *
   * Vẫn đúng mô hình "KPI thuộc về người": một bộ, gán riêng cho từng người
   * trong phòng qua `employee_kpi_schemes`. Khác mỗi chỗ là khai một lần thay
   * vì lặp lại 20 lần cho phòng 20 người — và sửa tiêu chí thì cả phòng đổi
   * theo, đúng cái người dùng muốn khi nói "tạo KPI cho cả phòng ban".
   *
   * Người đã có bộ riêng thì GIỮ NGUYÊN: họ được khai riêng là có lý do, đè
   * lên là xoá mất công khai đó mà không ai hỏi.
   */
  const createTemplateForUnit = async (unit: Unit) => {
    if (!supabase) return;
    const targets = users.filter((person) => person.is_active && person.unit_id === unit.id);
    if (targets.length === 0) {
      return toast(`${unit.name} chưa có nhân sự nào.`, 'error');
    }
    const keepOwn = targets.filter((person) => ownScheme(person.id));
    const receivers = targets.filter((person) => !ownScheme(person.id));
    if (receivers.length === 0) {
      return toast('Mọi người trong phòng đều đã có bộ KPI riêng.', 'error');
    }

    const accepted = await confirm({
      title: `Tạo bộ KPI cho cả ${unit.name}?`,
      message: `Một bộ KPI chung cho ${receivers.length} người trong phòng — sửa tiêu chí thì cả `
        + 'nhóm đổi theo.'
        + (keepOwn.length > 0
          ? ` ${keepOwn.length} người đã có bộ riêng sẽ giữ nguyên bộ của họ.`
          : ''),
      confirmLabel: 'Tạo cho cả phòng',
    });
    if (!accepted) return;

    setSaving(true);
    const slug = unit.code || unit.name;
    const { data, error } = await supabase.from('kpi_position_templates').insert({
      code: `KPI-${slug.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\u0111/g, 'd').replace(/\u0110/g, 'D')
        .toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'PHONG'}`
        + `-${unit.id.slice(0, 4).toUpperCase()}`,
      name: `KPI ${unit.name}`,
      block_code: 'VAN_PHONG',
      // Khai unit_id để sau này nhìn ra bộ này sinh ra cho phòng nào; việc áp
      // cho ai vẫn do employee_kpi_schemes quyết, không phải cột này.
      unit_id: unit.id,
      default_kpi_amount: 0,
      score_method: 'WEIGHTED_PERCENT',
      result_floor_percent: 0,
      created_by: actorId,
    }).select('id').single();

    if (error || !data) {
      setSaving(false);
      return toast('Không tạo được bộ KPI: ' + describeDbError(error), 'error');
    }

    const { error: assignError } = await supabase.from('employee_kpi_schemes').upsert(
      receivers.map((person) => ({
        user_id: person.id, template_id: data.id, effective_from: getTodayString(),
      })),
      { onConflict: 'user_id,effective_from' },
    );
    setSaving(false);
    if (assignError) {
      return toast('Đã tạo bộ nhưng không gán được: ' + describeDbError(assignError), 'error');
    }
    toast(`Đã tạo bộ KPI cho ${receivers.length} người trong ${unit.name}. Thêm tiêu chí cho đủ 100% rồi bật lên.`, 'success');
    await load();
  };

  const clearPersonal = async (person: Profile, templateId: string) => {
    if (!supabase) return;
    const accepted = await confirm({
      title: `Bỏ bộ KPI riêng của ${person.name}?`,
      message: 'Tiêu chí đã khai sẽ mất theo. Nếu họ còn thuộc đơn vị hay vị trí có bộ KPI thì '
        + 'sẽ quay về dùng bộ đó.',
      confirmLabel: 'Bỏ bộ riêng',
      danger: true,
    });
    if (!accepted) return;

    setSaving(true);
    const { error } = await supabase.from('employee_kpi_schemes')
      .delete().eq('user_id', person.id).eq('template_id', templateId);
    if (error) {
      setSaving(false);
      return toast(describeDbError(error), 'error');
    }

    // Chỉ dọn bộ KHÔNG gắn phòng ban hay vị trí và không còn ai dùng — bộ
    // dùng chung thì để nguyên, người này chỉ thôi dùng nó.
    const template = tplById.get(templateId);
    const shared = !!template?.position_id
      || schemes.some((row) => row.template_id === templateId && row.user_id !== person.id)
      || unitSchemes.some((row) => row.template_id === templateId);

    if (!shared) {
      const { count } = await supabase.from('performance_reviews')
        .select('id', { count: 'exact', head: true }).eq('template_id', templateId);
      if ((count || 0) > 0) {
        await supabase.from('kpi_position_templates').update({ is_active: false }).eq('id', templateId);
      } else {
        await supabase.from('kpi_position_templates').delete().eq('id', templateId);
      }
    }

    setSaving(false);
    toast(`Đã bỏ bộ KPI riêng của ${person.name}.`, 'success');
    await load();
  };

  if (!supported) {
    return (
      <Card><CardContent>
        <p className="flex items-start gap-2.5 text-sm leading-relaxed text-amber-800">
          <TriangleAlert className="mt-0.5 h-5 w-5 flex-shrink-0" />
          Chưa chạy migration{' '}
          <code className="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-xs">
            20260930160000_employee_kpi_scheme.sql
          </code>.
        </p>
      </CardContent></Card>
    );
  }

  if (loading) return <Skeleton className="h-40" />;

  const subUnits = childrenOf(current?.id ?? null);
  const people = current ? peopleIn(current.id) : peopleIn(null);
  const activeTemplates = templates.filter((t) => t.is_active);

  return (
    <Card>
      <CardContent className="space-y-4">
        {/* ---- Đường đi ---- */}
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <button
            type="button"
            onClick={() => { setPath([]); setFocusPerson(null); }}
            className={`font-semibold transition ${path.length === 0 && !focusPerson ? 'text-slate-800' : 'text-indigo-600 hover:text-indigo-700'}`}
          >
            Toàn công ty
          </button>
          {path.map((unit, index) => (
            <span key={unit.id} className="flex items-center gap-1.5">
              <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
              <button
                type="button"
                onClick={() => { setPath(path.slice(0, index + 1)); setFocusPerson(null); }}
                className={`font-semibold transition ${index === path.length - 1 && !focusPerson ? 'text-slate-800' : 'text-indigo-600 hover:text-indigo-700'}`}
              >
                {unit.name}
              </button>
            </span>
          ))}
          {/* Nhân sự là một cấp của đường đi, không phải một modal bật lên:
              đứng trong đó vẫn phải biết mình đang ở phòng nào. */}
          {focusPerson && (
            <span className="flex items-center gap-1.5">
              <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
              <span className="font-semibold text-slate-800">{focusPerson.name}</span>
            </span>
          )}
        </div>

        {path.length === 0 && (
          <p className="text-xs leading-relaxed text-slate-500">
            Đơn vị lấy từ <strong>Cơ cấu tổ chức</strong>. Bấm xuống tới phòng ban, gán một bộ KPI
            cho <strong>cả phòng</strong>, rồi chỉ gán riêng cho ai cần khác. Thứ tự ưu tiên khi
            chấm: gán riêng → theo đơn vị (cấp gần nhất) → mẫu khớp vị trí.
          </p>
        )}

        {/* ---- Bộ KPI cho cả phòng ----
             Đứng ở một phòng ban, khai một lần cho cả phòng thay vì mở từng
             người. Vẫn là bộ gán riêng cho từng người, chỉ là gán một lượt. */}
        {!focusPerson && current && people.length > 0 && (() => {
          const covered = people.filter((person) => ownScheme(person.id)).length;
          return (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-indigo-100 bg-indigo-50/50 px-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-indigo-600">
                <Target className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-800">Bộ KPI của {current.name}</p>
                <p className="mt-0.5 text-[11px] text-slate-600">
                  {covered}/{people.length} người trong phòng đã có bộ KPI riêng.
                </p>
              </div>
              {covered < people.length && (
                <Button size="sm" disabled={saving} onClick={() => void createTemplateForUnit(current)}>
                  <Target className="h-3.5 w-3.5" />
                  {saving ? 'Đang tạo…' : `Tạo bộ cho ${people.length - covered} người còn lại`}
                </Button>
              )}
            </div>
          );
        })()}

        {/* ---- Khu riêng của một nhân sự ----
             KPI ở đây là của RIÊNG người này, không phải một bộ dùng chung
             rồi gán xuống. Mỗi người một bộ thì tiêu chí bám đúng việc họ
             làm — đó là lý do màn này không còn danh sách bộ dùng chung nữa. */}
        {focusPerson && (() => {
          const own = ownScheme(focusPerson.id);
          const tpl = own ? tplById.get(own.template_id) : undefined;
          const rows = tpl ? criteria.filter((item) => item.template_id === tpl.id) : [];
          const total = rows.reduce((sum, item) => sum + Number(item.weight_percent || 0), 0);
          const inheritedOnly = !own ? effectiveFor(focusPerson) : null;

          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-indigo-100 bg-indigo-50/50 px-4 py-3">
                <Avatar name={focusPerson.name} url={focusPerson.avatar_url} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-800">{focusPerson.name}</p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-600">
                    {tpl
                      ? <>{tpl.name} · {rows.length} tiêu chí · tổng {total.toFixed(0)}%</>
                      : inheritedOnly?.tpl
                        ? <>Đang dùng <strong>{inheritedOnly.tpl.name}</strong> ({inheritedOnly.source}) — tạo bộ riêng sẽ thay thế</>
                        : 'Chưa có bộ KPI nào'}
                  </p>
                </div>
                {own ? (
                  <Button size="sm" variant="ghost" disabled={saving}
                    onClick={() => void clearPersonal(focusPerson, own.template_id)}>
                    Xoá bộ riêng
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => void createPersonalTemplate(focusPerson)} disabled={saving}>
                    <Target className="h-3.5 w-3.5" /> {saving ? 'Đang tạo…' : 'Tạo bộ KPI riêng'}
                  </Button>
                )}
              </div>

              {/* Khai tiêu chí ngay tại đây, khoanh vào đúng bộ của người này.
                  Bật sang màn khác để khai rồi quay lại là làm đứt mạch giữa
                  "ai" và "chấm cái gì". */}
              {tpl ? (
                <KpiTemplateEditor actorId={actorId} scopeTemplateId={tpl.id} />
              ) : (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-200 py-10 text-center">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-50 text-slate-300">
                    <Target className="h-5 w-5" />
                  </span>
                  <p className="text-sm font-semibold text-slate-600">
                    {focusPerson.name} chưa có bộ KPI riêng
                  </p>
                  <p className="max-w-sm text-xs leading-relaxed text-slate-400">
                    Bấm <strong>Tạo bộ KPI riêng</strong> để mở một bộ của riêng họ, rồi khai tiêu
                    chí cho đủ 100% trọng số là chấm được.
                  </p>
                </div>
              )}
            </div>
          );
        })()}

        {/* ---- Đơn vị con ---- */}
        {!focusPerson && subUnits.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {subUnits.map((unit) => {
              const inside = headcount(unit.id);
              return (
                <button
                  key={unit.id}
                  type="button"
                  onClick={() => setPath([...path, unit])}
                  className="flex items-center gap-2.5 rounded-xl border-2 border-slate-200 px-3.5 py-3 text-left transition hover:border-indigo-400 hover:shadow-md"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                    <Building2 className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-slate-800">{unit.name}</span>
                    <span className="block text-[11px] text-slate-500">
                      {inside} nhân sự
                      {childrenOf(unit.id).length > 0 && ` · ${childrenOf(unit.id).length} đơn vị con`}
                    </span>
                    {unitSchemesSupported && (() => {
                      const applied = inheritedUnitScheme(unit.id);
                      if (!applied) return null;
                      const tpl = tplById.get(applied.scheme.template_id);
                      if (!tpl) return null;
                      return (
                        <span className="mt-0.5 block truncate text-[11px] font-semibold text-indigo-600">
                          {tpl.name}
                          {applied.from.id !== unit.id && ` (từ ${applied.from.name})`}
                        </span>
                      );
                    })()}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                </button>
              );
            })}
          </div>
        )}

        {/* ---- Nhân sự tại cấp này ---- */}
        {!focusPerson && people.length > 0 && (
          <div className="rounded-xl border border-slate-200">
            <p className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-xs font-bold text-slate-700">
              <Users className="h-3.5 w-3.5" />
              {current ? `Nhân sự thuộc ${current.name}` : 'Chưa gán đơn vị'}
              <span className="font-normal text-slate-400">({people.length})</span>
            </p>
            <ul className="divide-y divide-slate-50">
              {people.map((person) => {
                const own = ownScheme(person.id);
                const { tpl, source } = effectiveFor(person);
                return (
                  <li key={person.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <Avatar name={person.name} url={person.avatar_url} size="sm" />
                    {/* Bấm vào người → mở khu riêng của họ, thêm một cấp nữa
                        trong đường đi. */}
                    <button
                      type="button"
                      onClick={() => setFocusPerson(person)}
                      className="min-w-0 flex-1 rounded-lg px-1 py-0.5 text-left transition hover:bg-slate-50"
                    >
                      <p className="truncate text-sm font-bold text-slate-800">{person.name}</p>
                      <p className="truncate text-xs text-slate-500">
                        {tpl ? tpl.name : <span className="font-bold text-amber-600">Chưa có bộ KPI</span>}
                        {own && ` · từ ${formatDate(own.effective_from)}`}
                      </p>
                    </button>
                    {tpl && (
                      <Badge className={own ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600'}>
                        {source}
                      </Badge>
                    )}
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {!focusPerson && subUnits.length === 0 && people.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-50 text-slate-300">
              <Building2 className="h-5 w-5" />
            </span>
            <p className="text-sm font-semibold text-slate-600">
              {current ? `${current.name} chưa có đơn vị con hay nhân sự nào` : 'Chưa dựng cơ cấu tổ chức'}
            </p>
            <p className="max-w-sm text-xs leading-relaxed text-slate-400">
              Dựng phòng ban và gán nhân sự ở <strong>Cơ cấu tổ chức</strong>, rồi quay lại đây.
            </p>
          </div>
        )}
      </CardContent>

    </Card>
  );
}
