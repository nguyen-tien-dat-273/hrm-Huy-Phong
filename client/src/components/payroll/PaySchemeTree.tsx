// ============================================================================
// Cơ chế lương theo SƠ ĐỒ TỔ CHỨC.
// ----------------------------------------------------------------------------
// Chọn đơn vị trên cây → hai thẻ:
//
//   Nhân sự        danh sách người trong đơn vị — bấm một người là mở thẳng
//                  form cơ chế lương của người đó (khai riêng ngay trên trang).
//   Cơ chế chung   các dòng lương cả đơn vị cùng theo; đơn vị con thừa hưởng
//                  theo \`unitLineage\`, cùng quy ước với KPI.
//   Phiếu lương    mẫu phiếu của đơn vị: mã, tiêu đề, đầu mục lên đầu phiếu.
//
// Lưu là áp dụng ngay, không qua duyệt. Danh sách cho thấy ai chưa có cơ chế,
// ai còn thiếu giá trị bắt buộc, để kế toán biết còn việc gì trước khi chạy lương.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, ChevronRight, FlaskConical, Search, Users } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { UnitTreeList, flattenUnitTree } from '@/components/payroll/UnitTree';
import { UnitMechanismEditor } from '@/components/payroll/UnitMechanismEditor';
import { PayslipLayoutEditor } from '@/components/payroll/PayslipLayoutEditor';
import { PersonSchemeForm } from '@/components/payroll/PersonSchemeForm';
import { Pager, clampPage } from '@/components/payroll/Pager';
import { resolveMechanismRows, unitMechanismRows } from '@/lib/payrollScheme';
import { schemeSourceOf } from '@/lib/payrollRun';
import { stripVietnamese } from '@/lib/tableExport';
import { fetchBankAccounts, type PayrollWorkspace } from '@/lib/payrollData';
import type { EmployeeBankAccount, Profile } from '@/types';

interface PaySchemeTreeProps {
  data: PayrollWorkspace;
  monthStart: string;
  monthEnd: string;
  lastClosedMonth: string | null;
  canManage: boolean;
  /** Người cần mở thẳng (từ Bảng lương). */
  focusUserId?: string | null;
  onChanged: () => void;
  /** Mở hộp Chạy thử, có thể kèm người cần thử. */
  onDryRun: (personId?: string) => void;
}

const NO_UNIT = '__none__';
const PEOPLE_PER_PAGE = 15;

const stripTone = (text: string) => stripVietnamese(text).toLowerCase().trim();

export function PaySchemeTree({ data, monthStart, monthEnd, lastClosedMonth, canManage, focusUserId, onChanged, onDryRun }: PaySchemeTreeProps) {
  const [unitId, setUnitId] = useState<string | null>(() => (
    focusUserId ? data.profiles.find((row) => row.id === focusUserId)?.unit_id ?? null : null
  ));
  const [personId, setPersonId] = useState<string | null>(focusUserId ?? null);
  const [includeChildren, setIncludeChildren] = useState(false);
  const [tab, setTab] = useState<'people' | 'mechanism' | 'payslip'>('people');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [accounts, setAccounts] = useState<EmployeeBankAccount[]>([]);
  const navigate = useNavigate();

  const reloadAccounts = () => { void fetchBankAccounts().then(setAccounts); };
  useEffect(reloadAccounts, []);

  const source = useMemo(() => schemeSourceOf(data), [data]);
  const rows = useMemo(() => flattenUnitTree(data.units), [data.units]);
  const activeUnitIds = useMemo(() => new Set(rows.map((row) => row.unit.id)), [rows]);

  useEffect(() => {
    if (!unitId && rows.length > 0) setUnitId(rows[0].unit.id);
  }, [rows, unitId]);

  /** Đơn vị và mọi đơn vị con của nó (đi theo parent_id, chặn vòng). */
  const descendantsOf = (rootId: string): Set<string> => {
    const result = new Set([rootId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const unit of data.units) {
        if (unit.parent_id && result.has(unit.parent_id) && !result.has(unit.id)) {
          result.add(unit.id);
          grew = true;
        }
      }
    }
    return result;
  };

  const rowsOf = (person: Profile) => resolveMechanismRows(person, source, monthStart, monthEnd);

  const statusOf = (personRows: ReturnType<typeof rowsOf>) => {
    if (personRows.length === 0) return { label: 'Chưa có cơ chế', tone: 'bg-red-50 text-red-600' };
    const missing = personRows.filter((row) => row.mode === 'PER_PERSON' && row.amount == null).length;
    if (missing > 0) return { label: `Thiếu ${missing} giá trị`, tone: 'bg-amber-50 text-amber-700' };
    return { label: 'Đủ', tone: 'bg-emerald-50 text-emerald-700' };
  };

  const personalCount = (person: Profile) => new Set(
    data.items
      .filter((item) => item.user_id === person.id && item.effective_from <= monthEnd
        && (!item.effective_to || item.effective_to >= monthStart))
      .map((item) => item.component_id),
  ).size;

  const people = useMemo(() => {
    if (query.trim()) {
      const keyword = stripTone(query);
      return data.profiles.filter((person) => stripTone(person.name).includes(keyword)
        || stripTone(person.employee_code ?? '').includes(keyword));
    }
    if (unitId === NO_UNIT) return data.profiles.filter((person) => !person.unit_id || !activeUnitIds.has(person.unit_id));
    if (!unitId) return [];
    const ids = includeChildren ? descendantsOf(unitId) : new Set([unitId]);
    return data.profiles.filter((person) => person.unit_id && ids.has(person.unit_id));
  }, [activeUnitIds, data.profiles, includeChildren, query, unitId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setPage(1); }, [unitId, query, includeChildren]);
  const currentPage = clampPage(page, people.length, PEOPLE_PER_PAGE);
  const pagePeople = people.slice((currentPage - 1) * PEOPLE_PER_PAGE, currentPage * PEOPLE_PER_PAGE);

  const unassignedCount = data.profiles.filter((person) => !person.unit_id || !activeUnitIds.has(person.unit_id)).length;
  const unit = unitId && unitId !== NO_UNIT ? data.units.find((row) => row.id === unitId) ?? null : null;
  const person = personId ? data.profiles.find((row) => row.id === personId) ?? null : null;
  const unitRowCount = unit ? unitMechanismRows(unit.id, source, monthStart, monthEnd).size : 0;
  const unitPeopleCount = unit ? data.profiles.filter((p) => p.unit_id && descendantsOf(unit.id).has(p.unit_id)).length : 0;

  const openPerson = (id: string) => setPersonId(id);

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="lg:self-start">
        <div className="pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPersonId(null); }}
              placeholder="Tìm nhân viên theo tên / mã..."
              className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
        </div>
        <div>
          <UnitTreeList
            rows={rows}
            selectedId={query.trim() ? null : unitId}
            onSelect={(selected) => { setUnitId(selected.id); setPersonId(null); setQuery(''); }}
            meta={(row) => `${data.profiles.filter((p) => p.unit_id === row.id).length} người`}
          />
          {unassignedCount > 0 && (
            <button
              type="button"
              onClick={() => { setUnitId(NO_UNIT); setPersonId(null); setQuery(''); }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                unitId === NO_UNIT && !query ? 'bg-indigo-50 font-bold text-indigo-800' : 'font-semibold text-slate-600 hover:bg-indigo-50/50'
              }`}
            >
              <Users className="h-4 w-4 text-slate-400" />
              <span className="flex-1">Chưa gán đơn vị</span>
              <span className="text-[11px] text-slate-400">{unassignedCount} người</span>
            </button>
          )}
        </div>
      </div>

      <div className="min-w-0 space-y-4">
        {person ? (
          <PersonSchemeForm
            key={person.id}
            person={person}
            data={data}
            monthStart={monthStart}
            lastClosedMonth={lastClosedMonth}
            canManage={canManage}
            account={accounts.find((row) => row.user_id === person.id) ?? null}
            unitName={person.unit_id ? data.units.find((row) => row.id === person.unit_id)?.name ?? null : null}
            onBack={() => setPersonId(null)}
            onDryRun={() => onDryRun(person.id)}
            onSaved={onChanged}
            onAccountSaved={reloadAccounts}
            onOpenInputs={() => navigate(`/admin/payroll?month=${monthStart.slice(0, 7)}&user=${person.id}`)}
          />
        ) : (
          <Card className="!rounded-none">
            <CardHeader className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <CardTitle className="flex items-center gap-2">
                  {query.trim() ? <Search className="h-4 w-4 text-slate-400" /> : <Building2 className="h-4 w-4 text-slate-400" />}
                  {query.trim() ? `Kết quả tìm "${query.trim()}"` : unit?.name ?? (unitId === NO_UNIT ? 'Chưa gán đơn vị' : 'Chọn đơn vị')}
                </CardTitle>
              </div>
              {unit && !query.trim() && tab === 'people' && (
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" checked={includeChildren} onChange={(event) => setIncludeChildren(event.target.checked)} />
                  Gồm đơn vị con
                </label>
              )}
              {unit && !query.trim() && (
                <Button size="sm" variant="outline" onClick={() => onDryRun(people[0]?.id)}>
                  <FlaskConical className="h-3.5 w-3.5" /> Chạy thử
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {unit && !query.trim() && (
                <div className="inline-flex rounded-none bg-slate-100 p-1 no-print" role="tablist" aria-label="Đơn vị">
                  {([
                    ['people', 'Nhân sự'],
                    ['mechanism', 'Cơ chế chung'],
                    ['payslip', 'Phiếu lương'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={tab === value}
                      onClick={() => setTab(value)}
                      className={`rounded-none px-3.5 py-1.5 text-sm font-semibold transition ${
                        tab === value ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {unit && !query.trim() && tab === 'payslip' ? (
                <PayslipLayoutEditor
                  key={unit.id}
                  data={data}
                  unit={unit}
                  monthStart={monthStart}
                  canManage={canManage}
                  onChanged={onChanged}
                />
              ) : unit && !query.trim() && tab === 'mechanism' ? (
                <UnitMechanismEditor
                  key={unit.id}
                  data={data}
                  unit={unit}
                  monthStart={monthStart}
                  lastClosedMonth={lastClosedMonth}
                  canManage={canManage}
                  peopleCount={unitPeopleCount}
                  onChanged={onChanged}
                />
              ) : people.length === 0 ? (
                <p className="rounded-none border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                  {query.trim() ? 'Không có nhân viên nào khớp.' : 'Đơn vị này chưa có nhân sự.'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wider text-black">
                        <th className="py-2 pr-3">Nhân viên</th>
                        <th className="py-2 pr-3">Khai riêng</th>
                        <th className="py-2 pr-3">Tình trạng</th>
                        <th className="py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {pagePeople.map((row) => {
                        const status = statusOf(rowsOf(row));
                        const own = personalCount(row);
                        return (
                          <tr key={row.id} className="cursor-pointer hover:bg-slate-50/70" onClick={() => openPerson(row.id)}>
                            <td className="py-2 pr-3">
                              <div className="flex items-center gap-2">
                                <Avatar name={row.name} url={row.avatar_url} size="sm" />
                                <div className="min-w-0">
                                  <p className="truncate font-semibold text-slate-800">{row.name}</p>
                                  <p className="truncate text-[11px] text-slate-400">{row.employee_code ?? '—'} · {row.department || '—'}</p>
                                </div>
                              </div>
                            </td>
                            <td className="py-2 pr-3 text-xs text-slate-600">
                              {own > 0 ? `${own} dòng` : <span className="text-slate-400">—</span>}
                            </td>
                            <td className="py-2 pr-3">
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${status.tone}`}>{status.label}</span>
                            </td>
                            <td className="py-2 text-right text-slate-300"><ChevronRight className="inline h-4 w-4" /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <Pager page={currentPage} total={people.length} size={PEOPLE_PER_PAGE} noun="người" onPage={setPage} />
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
