// ============================================================================
// Cơ chế KPI: đi xuống theo cây tổ chức rồi mới đặt cho từng người.
// ----------------------------------------------------------------------------
//   Khối / doanh nghiệp  ->  phòng ban  ->  bộ phận  ->  nhân viên  ->  gán bộ KPI
//
// Đơn vị lấy thẳng từ Cơ cấu tổ chức, không khai lại. Phòng ban nào chưa dựng
// ở đó thì ở đây cũng không có — đúng như vậy: một nơi khai, mọi nơi đọc.
//
// Danh sách phẳng của bản trước đổ hết mọi phòng ban ra cùng lúc. Công ty vài
// chục đơn vị thì màn đó dài vô tận và không cho thấy cái gì thuộc cái gì.
// Đi xuống từng cấp giữ đúng hình dạng bộ máy mà người dùng đã dựng.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Building2, ChevronRight, Target, TriangleAlert, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input, Select } from '@/components/ui/Input';
import { Avatar } from '@/components/ui/Avatar';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { formatDate, getTodayString } from '@/lib/utils';
import type { Profile } from '@/types';

interface Unit { id: string; name: string; unit_type: string; parent_id: string | null }
interface Template { id: string; code: string; name: string; is_active: boolean; position_id: string | null }
interface Scheme { id: string; user_id: string; template_id: string; effective_from: string }

export function KpiSchemeBoard() {
  const { users } = useAuth();
  const { toast } = useToast();

  const [units, setUnits] = useState<Unit[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [supported, setSupported] = useState(true);

  /** Đường đi hiện tại, từ gốc xuống. Rỗng = đang ở danh sách khối. */
  const [path, setPath] = useState<Unit[]>([]);

  const [target, setTarget] = useState<Profile | null>(null);
  const [draft, setDraft] = useState({ template_id: '', effective_from: getTodayString() });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!supabase) return;
    setLoading(true);
    const [unitRes, tplRes, schemeRes] = await Promise.all([
      supabase.from('organization_units').select('id, name, unit_type, parent_id').eq('is_active', true).order('name'),
      supabase.from('kpi_position_templates').select('id, code, name, is_active, position_id').order('name'),
      supabase.from('employee_kpi_schemes').select('*').order('effective_from', { ascending: false }),
    ]);
    if (schemeRes.error) { setSupported(false); setLoading(false); return; }
    setUnits((unitRes.data || []) as Unit[]);
    setTemplates((tplRes.data || []) as Template[]);
    setSchemes((schemeRes.data || []) as Scheme[]);
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

  const save = async () => {
    if (!supabase || !target || !draft.template_id) return;
    setSaving(true);
    const { error } = await supabase.from('employee_kpi_schemes').upsert({
      user_id: target.id,
      template_id: draft.template_id,
      effective_from: draft.effective_from,
    }, { onConflict: 'user_id,effective_from' });
    setSaving(false);
    if (error) return toast(describeDbError(error), 'error');
    toast(`Đã gán bộ KPI cho ${target.name}.`, 'success');
    setTarget(null);
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
            onClick={() => setPath([])}
            className={`font-semibold transition ${path.length === 0 ? 'text-slate-800' : 'text-indigo-600 hover:text-indigo-700'}`}
          >
            Toàn công ty
          </button>
          {path.map((unit, index) => (
            <span key={unit.id} className="flex items-center gap-1.5">
              <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
              <button
                type="button"
                onClick={() => setPath(path.slice(0, index + 1))}
                className={`font-semibold transition ${index === path.length - 1 ? 'text-slate-800' : 'text-indigo-600 hover:text-indigo-700'}`}
              >
                {unit.name}
              </button>
            </span>
          ))}
        </div>

        {path.length === 0 && (
          <p className="text-xs leading-relaxed text-slate-500">
            Đơn vị lấy từ <strong>Cơ cấu tổ chức</strong>. Bấm xuống tới phòng ban có người, rồi gán
            bộ KPI cho từng nhân sự. Ai chưa gán riêng sẽ dùng mẫu khớp <strong>vị trí</strong> của họ.
          </p>
        )}

        {/* ---- Đơn vị con ---- */}
        {subUnits.length > 0 && (
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
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                </button>
              );
            })}
          </div>
        )}

        {/* ---- Nhân sự tại cấp này ---- */}
        {people.length > 0 && (
          <div className="rounded-xl border border-slate-200">
            <p className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-xs font-bold text-slate-700">
              <Users className="h-3.5 w-3.5" />
              {current ? `Nhân sự thuộc ${current.name}` : 'Chưa gán đơn vị'}
              <span className="font-normal text-slate-400">({people.length})</span>
            </p>
            <ul className="divide-y divide-slate-50">
              {people.map((person) => {
                const own = ownScheme(person.id);
                const fallback = byPosition(person);
                const tpl = own ? tplById.get(own.template_id) : fallback;
                return (
                  <li key={person.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <Avatar name={person.name} url={person.avatar_url} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-800">{person.name}</p>
                      <p className="truncate text-xs text-slate-500">
                        {tpl ? tpl.name : <span className="font-bold text-amber-600">Chưa có bộ KPI</span>}
                        {own && ` · từ ${formatDate(own.effective_from)}`}
                      </p>
                    </div>
                    {tpl && (
                      <Badge className={own ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600'}>
                        {own ? 'Gán riêng' : 'Theo vị trí'}
                      </Badge>
                    )}
                    <Button size="sm" variant="outline" onClick={() => {
                      setTarget(person);
                      setDraft({
                        template_id: own?.template_id ?? fallback?.id ?? '',
                        effective_from: getTodayString(),
                      });
                    }}>
                      <Target className="h-3.5 w-3.5" /> {own ? 'Đổi bộ' : 'Gán riêng'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {subUnits.length === 0 && people.length === 0 && (
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

      <Modal open={!!target} onClose={() => setTarget(null)} title={`Bộ KPI cho ${target?.name ?? ''}`} size="md">
        <div className="space-y-4">
          <Select label="Bộ KPI" value={draft.template_id}
            onChange={(e) => setDraft({ ...draft, template_id: e.target.value })}>
            <option value="">Chọn bộ KPI…</option>
            {activeTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>

          <Input label="Áp dụng từ ngày" type="date" value={draft.effective_from}
            onChange={(e) => setDraft({ ...draft, effective_from: e.target.value })} />

          <p className="rounded-lg bg-blue-50 px-3.5 py-2.5 text-xs leading-relaxed text-blue-800">
            Đây là tạo bản ghi mới theo ngày hiệu lực, không sửa đè. Các kỳ đã chấm trước ngày này
            giữ nguyên bộ cũ.
          </p>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTarget(null)} disabled={saving}>Hủy</Button>
            <Button theme="admin" onClick={() => void save()} disabled={saving || !draft.template_id}>
              {saving ? 'Đang lưu…' : 'Gán bộ KPI'}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
