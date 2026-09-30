// ============================================================================
// Cơ chế KPI: chọn phòng ban -> chọn người -> gán bộ KPI riêng.
// ----------------------------------------------------------------------------
// Cùng cấu trúc với Cơ chế lương, và cố ý như vậy: hai màn trả lời cùng một
// dạng câu hỏi ("ai trong phòng này đã được thiết lập chưa"), nên bày giống
// nhau thì người dùng học một lần dùng được cả hai.
//
// Thứ tự ưu tiên khi mở phiếu chấm, hiển thị thẳng trên từng dòng:
//   1. Bộ gán riêng cho người  -> nhãn "Gán riêng"
//   2. Mẫu khớp vị trí          -> nhãn "Theo vị trí"
//   3. Không có gì              -> cảnh báo cam
//
// Gán riêng là TẠO BẢN GHI MỚI theo ngày hiệu lực, không sửa đè. Các kỳ đã
// chấm giữ nguyên bộ cũ — sửa đè sẽ làm phiếu đã chốt đổi cách tính mà không
// ai đối chiếu ra.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Target, TriangleAlert } from 'lucide-react';
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

interface Template { id: string; code: string; name: string; is_active: boolean; position_id: string | null }
interface Scheme { id: string; user_id: string; template_id: string; effective_from: string }

export function KpiSchemeBoard() {
  const { users } = useAuth();
  const { toast } = useToast();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [units, setUnits] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [supported, setSupported] = useState(true);

  const [target, setTarget] = useState<Profile | null>(null);
  const [draft, setDraft] = useState({ template_id: '', effective_from: getTodayString() });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!supabase) return;
    setLoading(true);
    const [tplRes, schemeRes, unitRes] = await Promise.all([
      supabase.from('kpi_position_templates').select('id, code, name, is_active, position_id').order('name'),
      supabase.from('employee_kpi_schemes').select('*').order('effective_from', { ascending: false }),
      supabase.from('organization_units').select('id, name').order('name'),
    ]);
    if (schemeRes.error) { setSupported(false); setLoading(false); return; }
    setTemplates((tplRes.data || []) as Template[]);
    setSchemes((schemeRes.data || []) as Scheme[]);
    setUnits((unitRes.data || []) as { id: string; name: string }[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const tplById = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);

  /** Bản gán riêng mới nhất của một người, nếu có. */
  const ownScheme = (userId: string) =>
    schemes.find((s) => s.user_id === userId);

  /** Mẫu khớp vị trí — phương án lùi khi chưa gán riêng. */
  const byPosition = (person: Profile) =>
    templates.find((t) => t.is_active && t.position_id && t.position_id === person.position_id);

  const groups = useMemo(() => {
    const map = new Map<string, Profile[]>();
    users.filter((u) => u.is_active).forEach((u) => {
      const key = u.unit_id || '';
      map.set(key, [...(map.get(key) || []), u]);
    });
    return [...map.entries()].sort(([a], [b]) => {
      if (!a) return 1;
      if (!b) return -1;
      return (units.find((u) => u.id === a)?.name || '').localeCompare(
        units.find((u) => u.id === b)?.name || '', 'vi');
    });
  }, [users, units]);

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

  const activeTemplates = templates.filter((t) => t.is_active);
  const missing = users.filter((u) => u.is_active && !ownScheme(u.id) && !byPosition(u)).length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3">
        <p className="text-sm leading-relaxed text-blue-900">
          Chọn phòng ban, rồi gán bộ KPI cho từng người. Ai chưa gán riêng sẽ dùng mẫu khớp
          <strong> vị trí </strong>của họ; không có mẫu nào khớp thì không mở được phiếu chấm.
        </p>
      </div>

      {missing > 0 && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
          {missing} nhân sự chưa có bộ KPI nào — cả gán riêng lẫn mẫu theo vị trí đều trống.
        </p>
      )}

      {groups.map(([unitId, people]) => (
        <Card key={unitId || 'none'}>
          <CardContent className="p-0">
            <div className="border-b border-slate-100 px-5 py-3">
              <p className="text-sm font-bold text-slate-800">
                {unitId ? units.find((u) => u.id === unitId)?.name ?? 'Đơn vị đã xoá' : 'Chưa gán đơn vị'}
              </p>
              <p className="text-xs text-slate-500">{people.length} nhân sự</p>
            </div>
            <ul className="divide-y divide-slate-50">
              {people.map((person) => {
                const own = ownScheme(person.id);
                const fallback = byPosition(person);
                const tpl = own ? tplById.get(own.template_id) : fallback;
                return (
                  <li key={person.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
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
          </CardContent>
        </Card>
      ))}

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
    </div>
  );
}
