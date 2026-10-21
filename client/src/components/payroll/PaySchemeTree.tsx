// ============================================================================
// Cơ chế lương — ba thẻ:
//
//   Nhân sự          chọn đơn vị trên cây → danh sách người; bấm một người là mở
//                    thẳng cơ chế của người đó (có "Copy từ" bộ mẫu / người khác).
//   Bộ cơ chế mẫu    danh sách bộ đặt tên sẵn để copy cho nhiều người.
//   Phiếu lương      mẫu phiếu của đơn vị: mã, tiêu đề, đầu mục lên đầu phiếu.
//
// Lưu là áp dụng ngay, không qua duyệt. Danh sách cho thấy ai chưa có cơ chế,
// ai còn thiếu giá trị bắt buộc, để kế toán biết còn việc gì trước khi chạy lương.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, ChevronRight, FlaskConical, Search, Users } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { UnitTreeList, flattenUnitTree } from '@/components/payroll/UnitTree';
import { SchemeTemplates } from '@/components/payroll/SchemeTemplates';
import { PayslipLayoutEditor } from '@/components/payroll/PayslipLayoutEditor';
import { PersonSchemeForm } from '@/components/payroll/PersonSchemeForm';
import { Pager, clampPage } from '@/components/payroll/Pager';
import { descendantUnitIds } from '@/lib/orgUnits';
import { blankMechanismRows, missingLabel, resolveMechanismRows } from '@/lib/payrollScheme';
import { schemeSourceOf } from '@/lib/payrollRun';
import { stripVietnamese } from '@/lib/tableExport';
import { fetchBankAccounts, type PayrollWorkspace } from '@/lib/payrollData';
import type { EmployeeBankAccount, Profile } from '@/types';

type SchemeTab = 'people' | 'templates' | 'payslip';

interface PaySchemeTreeProps {
  data: PayrollWorkspace;
  monthStart: string;
  monthEnd: string;
  lastClosedMonth: string | null;
  canManage: boolean;
  /** Người cần mở thẳng (từ Bảng lương). */
  focusUserId?: string | null;
  /** Thẻ mở sẵn (từ trang tổng quan Thiết lập lương). */
  initialTab?: 'templates';
  onChanged: () => void;
  /** Mở hộp Chạy thử, có thể kèm người cần thử. */
  onDryRun: (personId?: string) => void;
}

const NO_UNIT = '__none__';
const PEOPLE_PER_PAGE = 15;

const stripTone = (text: string) => stripVietnamese(text).toLowerCase().trim();

export function PaySchemeTree({ data, monthStart, monthEnd, lastClosedMonth, canManage, focusUserId, initialTab, onChanged, onDryRun }: PaySchemeTreeProps) {
  const [unitId, setUnitId] = useState<string | null>(() => (
    focusUserId ? data.profiles.find((row) => row.id === focusUserId)?.unit_id ?? null : null
  ));
  const [personId, setPersonId] = useState<string | null>(focusUserId ?? null);
  const [includeChildren, setIncludeChildren] = useState(false);
  const [tab, setTab] = useState<SchemeTab>(initialTab ?? 'people');
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

  const rowsOf = (person: Profile) => resolveMechanismRows(person, source, monthStart, monthEnd);

  const statusOf = (personRows: ReturnType<typeof rowsOf>): { label: string; tone: string; title?: string } => {
    if (personRows.length === 0) return { label: 'Chưa có cơ chế', tone: 'bg-red-50 text-red-600' };
    const names = blankMechanismRows(personRows).map((row) => row.component.name);
    if (names.length > 0) {
      return { label: missingLabel(names), title: `Còn trống: ${names.join(', ')}`, tone: 'bg-amber-50 text-amber-700' };
    }
    return { label: 'Đủ', tone: 'bg-emerald-50 text-emerald-700' };
  };

  const people = useMemo(() => {
    if (query.trim()) {
      const keyword = stripTone(query);
      return data.profiles.filter((person) => stripTone(person.name).includes(keyword)
        || stripTone(person.employee_code ?? '').includes(keyword));
    }
    if (unitId === NO_UNIT) return data.profiles.filter((person) => !person.unit_id || !activeUnitIds.has(person.unit_id));
    if (!unitId) return [];
    const ids = includeChildren ? descendantUnitIds(unitId, data.units) : new Set([unitId]);
    return data.profiles.filter((person) => person.unit_id && ids.has(person.unit_id));
  }, [activeUnitIds, data.profiles, data.units, includeChildren, query, unitId]);

  useEffect(() => { setPage(1); }, [unitId, query, includeChildren]);
  const currentPage = clampPage(page, people.length, PEOPLE_PER_PAGE);
  const pagePeople = people.slice((currentPage - 1) * PEOPLE_PER_PAGE, currentPage * PEOPLE_PER_PAGE);

  const unassignedCount = data.profiles.filter((person) => !person.unit_id || !activeUnitIds.has(person.unit_id)).length;
  const unit = unitId && unitId !== NO_UNIT ? data.units.find((row) => row.id === unitId) ?? null : null;
  const person = personId ? data.profiles.find((row) => row.id === personId) ?? null : null;

  const openPerson = (id: string) => setPersonId(id);
  const searching = query.trim().length > 0;

  const tabs = (
    <div className="inline-flex rounded-none bg-slate-100 p-1 no-print" role="tablist" aria-label="Cơ chế lương">
      {([
        ['people', 'Nhân sự'],
        ['templates', 'Bộ cơ chế mẫu'],
        ['payslip', 'Phiếu lương'],
      ] as const).map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={tab === value}
          onClick={() => { setTab(value); setPersonId(null); setQuery(''); }}
          className={`rounded-none px-3.5 py-1.5 text-sm font-semibold transition ${
            tab === value ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  if (tab === 'templates') {
    return (
      <div className="space-y-4">
        {tabs}
        <SchemeTemplates data={data} monthStart={monthStart} canManage={canManage} onChanged={onChanged} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {tabs}
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="lg:self-start">
          {tab === 'people' && (
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
          )}
          <div>
            <UnitTreeList
              rows={rows}
              selectedId={searching ? null : unitId}
              onSelect={(selected) => { setUnitId(selected.id); setPersonId(null); setQuery(''); }}
              meta={(row) => `${data.profiles.filter((p) => p.unit_id === row.id).length} người`}
            />
            {tab === 'people' && unassignedCount > 0 && (
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
          {tab === 'payslip' ? (
            <Card className="!rounded-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-slate-400" /> {unit?.name ?? 'Chọn đơn vị'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {unit && (
                  <PayslipLayoutEditor
                    key={unit.id}
                    data={data}
                    unit={unit}
                    monthStart={monthStart}
                    canManage={canManage}
                    onChanged={onChanged}
                  />
                )}
              </CardContent>
            </Card>
          ) : person ? (
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
                    {searching ? <Search className="h-4 w-4 text-slate-400" /> : <Building2 className="h-4 w-4 text-slate-400" />}
                    {searching ? `Kết quả tìm "${query.trim()}"` : unit?.name ?? (unitId === NO_UNIT ? 'Chưa gán đơn vị' : 'Chọn đơn vị')}
                  </CardTitle>
                </div>
                {unit && !searching && (
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                    <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" checked={includeChildren} onChange={(event) => setIncludeChildren(event.target.checked)} />
                    Gồm đơn vị con
                  </label>
                )}
                {unit && !searching && (
                  <Button size="sm" variant="outline" onClick={() => onDryRun(people[0]?.id)}>
                    <FlaskConical className="h-3.5 w-3.5" /> Chạy thử
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {people.length === 0 ? (
                  <p className="rounded-none border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                    {searching ? 'Không có nhân viên nào khớp.' : 'Đơn vị này chưa có nhân sự.'}
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-300 dark:border-slate-700 shadow-sm overflow-hidden">
                    <table className="w-full min-w-[420px] text-xs border-collapse">
                      <thead>
                        <tr className="border-b-2 border-[#bf1f2b] dark:border-[#e66a76] bg-[#fdf2f4] dark:bg-[#201114] text-left text-xs font-black uppercase tracking-wider text-[#5c0f16] dark:text-[#fde8ea] shadow-[inset_0_-2px_0_#bf1f2b] dark:shadow-[inset_0_-2px_0_#e66a76]">
                          <th className="py-1.5 px-2.5">Nhân viên</th>
                          <th className="border-l border-[#eed5d8] dark:border-[#4a1c22] py-1.5 px-2">Số dòng</th>
                          <th className="border-l border-[#eed5d8] dark:border-[#4a1c22] py-1.5 px-2">Tình trạng</th>
                          <th className="py-1.5 px-2 text-right" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-300 dark:divide-slate-800 bg-white dark:bg-slate-900">
                        {pagePeople.map((row) => {
                          const personRows = rowsOf(row);
                          const status = statusOf(personRows);
                          return (
                            <tr key={row.id} className="group cursor-pointer transition-colors hover:bg-slate-100/80 dark:hover:bg-slate-800/60" onClick={() => openPerson(row.id)}>
                              <td className="py-1.5 px-2.5">
                                <div className="min-w-0">
                                  <p className="truncate font-bold text-xs text-slate-900 dark:text-slate-100">{row.name}</p>
                                  <p className="truncate text-[10px] font-medium text-slate-500 dark:text-slate-400">{row.employee_code ?? '—'} · {row.department || '—'}</p>
                                </div>
                              </td>
                              <td className="border-l border-slate-300 dark:border-slate-700 py-1.5 px-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                                {personRows.length > 0 ? `${personRows.length} dòng` : <span className="text-slate-400 dark:text-slate-600">—</span>}
                              </td>
                              <td className="border-l border-slate-300 dark:border-slate-700 py-1.5 px-2">
                                <span className={`inline-block max-w-[14rem] truncate align-middle rounded-full px-2 py-0.5 text-[10px] font-bold ${status.tone}`} title={status.title}>{status.label}</span>
                              </td>
                              <td className="py-1.5 px-2 text-right text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200"><ChevronRight className="inline h-3.5 w-3.5" /></td>
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
    </div>
  );
}
