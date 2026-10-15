// ============================================================================
// Áp cơ chế lương theo SƠ ĐỒ TỔ CHỨC.
// ----------------------------------------------------------------------------
// Chọn đơn vị trên cây → danh sách nhân sự → một người → khai cơ chế và giá
// trị riêng. Cơ chế gán cho đơn vị đi xuống đơn vị con theo `unitLineage`,
// cùng quy ước với KPI.
//
// Mọi thay đổi ở đây là ĐỀ XUẤT chờ BGĐ duyệt — xem `PaySchemeModal`. Cây cho
// thấy ai đang chờ duyệt, ai chưa có cơ chế, ai còn thiếu giá trị bắt buộc,
// để kế toán biết còn việc gì trước khi chạy lương.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Building2, CreditCard, Search, Settings2, UserRound, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Avatar } from '@/components/ui/Avatar';
import { UnitTreeList, flattenUnitTree } from '@/components/payroll/UnitTree';
import { PaySchemeModal, type SchemeTarget } from '@/components/payroll/PaySchemeModal';
import { useToast } from '@/contexts/ToastContext';
import { payProfileForPeriod, type MechanismRow } from '@/lib/payroll';
import { describeFormula, formatFormulaNumber } from '@/lib/formulaTokens';
import { KIND_SIGN } from '@/lib/formulaEntries';
import {
  SCHEME_STATUS_LABEL, SCHEME_STATUS_TONE, openRequestFor, resolveMechanismRows, resolveTemplateFor,
  resolveTemplateForUnit, unitItemsAt,
} from '@/lib/payrollScheme';
import { computeForPerson, nameResolver, paramsForMonth, schemeSourceOf } from '@/lib/payrollRun';
import { useAppSettings } from '@/contexts/SettingsContext';
import { stripVietnamese } from '@/lib/tableExport';
import { fetchBankAccounts, saveBankAccount, type PayrollWorkspace } from '@/lib/payrollData';
import type { EmployeeBankAccount, OrganizationUnit, Profile } from '@/types';

interface PaySchemeTreeProps {
  data: PayrollWorkspace;
  monthStart: string;
  monthEnd: string;
  lastClosedMonth: string | null;
  canManage: boolean;
  onChanged: () => void;
}

const NO_UNIT = '__none__';

const stripTone = (text: string) => stripVietnamese(text).toLowerCase().trim();

/** Dòng "Từng người" mà người này chưa có giá trị. */
const missingOf = (rows: readonly MechanismRow[]) => rows.filter((row) => row.mode === 'PER_PERSON' && row.amount == null);

export function PaySchemeTree({ data, monthStart, monthEnd, lastClosedMonth, canManage, onChanged }: PaySchemeTreeProps) {
  const [unitId, setUnitId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [includeChildren, setIncludeChildren] = useState(true);
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<SchemeTarget | null>(null);
  const [accounts, setAccounts] = useState<EmployeeBankAccount[]>([]);

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

  const profileOf = (person: Profile) => payProfileForPeriod(data.payProfiles.filter((row) => row.user_id === person.id), monthEnd);
  const rowsOf = (person: Profile) => resolveMechanismRows(person, profileOf(person), source, monthStart, monthEnd);

  const statusOf = (person: Profile, personRows: MechanismRow[]) => {
    const request = openRequestFor(data.schemeRequests, { type: 'USER', id: person.id });
    if (request) return { label: SCHEME_STATUS_LABEL[request.status], tone: SCHEME_STATUS_TONE[request.status] };
    if (personRows.length === 0) return { label: 'Chưa có cơ chế', tone: 'bg-red-50 text-red-600' };
    if (missingOf(personRows).length > 0) return { label: 'Thiếu giá trị', tone: 'bg-amber-50 text-amber-700' };
    return { label: 'Đủ', tone: 'bg-emerald-50 text-emerald-700' };
  };

  const pendingCount = (unit: OrganizationUnit) => {
    const ids = descendantsOf(unit.id);
    return data.profiles.filter((person) => person.unit_id && ids.has(person.unit_id)
      && openRequestFor(data.schemeRequests, { type: 'USER', id: person.id })?.status === 'SUBMITTED').length;
  };

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

  const unassignedCount = data.profiles.filter((person) => !person.unit_id || !activeUnitIds.has(person.unit_id)).length;
  const unit = unitId && unitId !== NO_UNIT ? data.units.find((row) => row.id === unitId) ?? null : null;
  const person = personId ? data.profiles.find((row) => row.id === personId) ?? null : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 p-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPersonId(null); }}
              placeholder="Tìm nhân viên theo tên / mã..."
              className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50/60 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
        </div>
        <div className="max-h-[640px] overflow-y-auto">
          <UnitTreeList
            rows={rows}
            selectedId={query.trim() ? null : unitId}
            onSelect={(selected) => { setUnitId(selected.id); setPersonId(null); setQuery(''); }}
            meta={(row) => `${data.profiles.filter((p) => p.unit_id === row.id).length} người`}
            badge={(row) => {
              const pending = pendingCount(row);
              return (
                <span className="flex shrink-0 items-center gap-1">
                  {pending > 0 && (
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700" title="Đề xuất chờ duyệt">
                      {pending}
                    </span>
                  )}
                </span>
              );
            }}
          />
          {unassignedCount > 0 && (
            <button
              type="button"
              onClick={() => { setUnitId(NO_UNIT); setPersonId(null); setQuery(''); }}
              className={`flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-left text-sm transition ${
                unitId === NO_UNIT && !query ? 'bg-indigo-50 font-bold text-indigo-800' : 'font-semibold text-slate-600 hover:bg-indigo-50/50'
              }`}
            >
              <Users className="h-4 w-4 text-slate-400" />
              <span className="flex-1">Chưa gán đơn vị</span>
              <span className="text-[11px] text-slate-400">{unassignedCount} người</span>
            </button>
          )}
        </div>
      </Card>

      <div className="min-w-0 space-y-4">
        {person ? (
          <PersonPanel
            person={person}
            data={data}
            personRows={rowsOf(person)}
            templateLabel={resolveTemplateFor(person, profileOf(person), source, monthStart).label}
            monthStart={monthStart}
            monthEnd={monthEnd}
            canManage={canManage}
            account={accounts.find((row) => row.user_id === person.id) ?? null}
            status={statusOf(person, rowsOf(person))}
            onBack={() => setPersonId(null)}
            onOpenScheme={() => setTarget({ type: 'USER', person })}
            onAccountSaved={reloadAccounts}
          />
        ) : (
          <Card>
            <CardHeader className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <CardTitle className="flex items-center gap-2">
                  {query.trim() ? <Search className="h-4 w-4 text-slate-400" /> : <Building2 className="h-4 w-4 text-slate-400" />}
                  {query.trim() ? `Kết quả tìm "${query.trim()}"` : unit?.name ?? (unitId === NO_UNIT ? 'Chưa gán đơn vị' : 'Chọn đơn vị')}
                </CardTitle>
                {unit && !query.trim() && (
                  <p className="mt-1 text-xs text-slate-500">
                    Cơ chế lương: {resolveTemplateForUnit(unit.id, source, monthStart).label}
                  </p>
                )}
              </div>
              {unit && !query.trim() && (
                <>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                    <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" checked={includeChildren} onChange={(event) => setIncludeChildren(event.target.checked)} />
                    Gồm đơn vị con
                  </label>
                  <Button size="sm" variant="outline" onClick={() => setTarget({ type: 'UNIT', unit })}>
                    <Settings2 className="h-4 w-4" /> {canManage ? 'Giá trị chung của đơn vị' : 'Xem giá trị chung'}
                  </Button>
                </>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {unit && !query.trim() && (
                <UnitItemsSummary data={data} unit={unit} monthStart={monthStart} monthEnd={monthEnd} />
              )}
              {people.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                  {query.trim() ? 'Không có nhân viên nào khớp.' : 'Đơn vị này chưa có nhân sự.'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        <th className="py-2 pr-3">Nhân viên</th>
                        <th className="py-2 pr-3">Cơ chế</th>
                        <th className="py-2 pr-3">Giá trị riêng</th>
                        <th className="py-2 pr-3">Tình trạng</th>
                        <th className="py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {people.map((row) => {
                        const personRows = rowsOf(row);
                        const status = statusOf(row, personRows);
                        const perPerson = personRows.filter((item) => item.mode === 'PER_PERSON');
                        const missing = missingOf(personRows);
                        return (
                          <tr key={row.id} className="cursor-pointer hover:bg-slate-50/70" onClick={() => setPersonId(row.id)}>
                            <td className="py-2 pr-3">
                              <div className="flex items-center gap-2">
                                <Avatar name={row.name} url={row.avatar_url} size="sm" />
                                <div className="min-w-0">
                                  <p className="truncate font-semibold text-slate-800">{row.name}</p>
                                  <p className="truncate text-[11px] text-slate-400">{row.employee_code ?? '—'} · {row.department || '—'}</p>
                                </div>
                              </div>
                            </td>
                            <td className="max-w-[12rem] truncate py-2 pr-3 text-xs text-slate-600">
                              {resolveTemplateFor(row, profileOf(row), source, monthStart).template?.name ?? '—'}
                            </td>
                            <td className="py-2 pr-3 text-xs">
                              {perPerson.length === 0
                                ? <span className="text-slate-400">—</span>
                                : missing.length > 0
                                  ? <span className="font-semibold text-amber-700" title={missing.map((item) => item.component.name).join(', ')}>Thiếu {missing.length}/{perPerson.length}</span>
                                  : <span className="text-slate-600">Đủ {perPerson.length}/{perPerson.length}</span>}
                            </td>
                            <td className="py-2 pr-3">
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${status.tone}`}>{status.label}</span>
                            </td>
                            <td className="py-2 text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(event) => { event.stopPropagation(); setTarget({ type: 'USER', person: row }); }}
                              >
                                {canManage ? 'Thiết lập' : 'Xem'}
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <PaySchemeModal
        open={!!target}
        target={target}
        data={data}
        viewMonth={monthStart}
        lastClosedMonth={lastClosedMonth}
        readOnly={!canManage}
        onClose={() => setTarget(null)}
        onSaved={onChanged}
      />
    </div>
  );
}

function UnitItemsSummary({ data, unit, monthStart, monthEnd }: {
  data: PayrollWorkspace; unit: OrganizationUnit; monthStart: string; monthEnd: string;
}) {
  const items = unitItemsAt(data.unitItems, unit.id, monthStart, monthEnd);
  const request = openRequestFor(data.schemeRequests, { type: 'UNIT', id: unit.id });
  const componentById = new Map(data.components.map((c) => [c.id, c]));
  if (items.length === 0 && !request) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-slate-50 px-3 py-2 text-xs">
      <span className="font-semibold text-slate-600">Giá trị chung của đơn vị:</span>
      {items.length === 0 && <span className="text-slate-400">chưa có</span>}
      {items.map((item) => (
        <span key={item.component_id} className="rounded bg-white px-1.5 py-0.5 font-semibold text-slate-700 shadow-sm">
          {componentById.get(item.component_id)?.name ?? '?'}
          {item.amount != null && <span className="ml-1 font-normal text-slate-500">{formatFormulaNumber(item.amount)}</span>}
          {item.formula && <span className="ml-1 font-normal text-slate-500">công thức riêng</span>}
        </span>
      ))}
      {request && (
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ${SCHEME_STATUS_TONE[request.status]}`}>
          Đề xuất {request.code}: {SCHEME_STATUS_LABEL[request.status]}
        </span>
      )}
    </div>
  );
}

function PersonPanel({
  person, data, personRows, templateLabel, monthStart, monthEnd, canManage, account, status, onBack, onOpenScheme, onAccountSaved,
}: {
  person: Profile;
  data: PayrollWorkspace;
  personRows: MechanismRow[];
  templateLabel: string;
  monthStart: string;
  monthEnd: string;
  canManage: boolean;
  account: EmployeeBankAccount | null;
  status: { label: string; tone: string };
  onBack: () => void;
  onOpenScheme: () => void;
  onAccountSaved: () => void;
}) {
  const request = openRequestFor(data.schemeRequests, { type: 'USER', id: person.id });
  const nameOf = nameResolver(data.components, null);
  const missing = missingOf(personRows);
  const app = useAppSettings();

  // Giá trị tính được của từng dòng theo số liệu thật của người này trong tháng.
  const lineByCode = useMemo(() => {
    const params = paramsForMonth(data, app, new Date(`${monthStart}T00:00:00`), monthStart);
    if (!params) return new Map<string, { amount: number; failed?: boolean }>();
    try {
      const { computed } = computeForPerson(person, data, params, new Date(`${monthStart}T00:00:00`), monthStart, monthEnd);
      return new Map(computed.lines.map((line) => [line.code, line]));
    } catch {
      return new Map<string, { amount: number; failed?: boolean }>();
    }
  }, [app, data, monthEnd, monthStart, person]);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="ghost" onClick={onBack} aria-label="Quay lại danh sách">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Avatar name={person.name} url={person.avatar_url} size="md" />
          <div className="min-w-0 flex-1">
            <CardTitle>{person.name}</CardTitle>
            <p className="text-xs text-slate-500">{person.employee_code ?? '—'} · {person.department || 'Chưa có bộ phận'}</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${status.tone}`}>{status.label}</span>
          <Button onClick={onOpenScheme}>
            <Settings2 className="h-4 w-4" /> {canManage ? 'Thiết lập cơ chế lương' : 'Xem cơ chế lương'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {request?.status === 'REJECTED' && request.review_note && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              Đề xuất {request.code} bị BGĐ từ chối: {request.review_note}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Fact label="Cơ chế lương" value={templateLabel} />
            <Fact label="Còn thiếu" value={missing.length === 0 ? 'Không' : missing.map((row) => row.component.name).join(', ')} />
          </div>
          <div className="rounded-xl border border-slate-200">
            <p className="border-b border-slate-100 px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
              Các dòng áp tháng {monthStart.slice(5, 7)}/{monthStart.slice(0, 4)} ({personRows.length})
            </p>
            {personRows.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-slate-500">Chưa có cơ chế — phiếu lương sẽ ra 0đ.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {personRows.map((row) => (
                  <li key={row.component.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                    <span className="w-4 text-center font-black text-slate-400">{KIND_SIGN[row.component.kind]}</span>
                    <span className="font-semibold text-slate-800">{row.component.name}</span>
                    {(() => {
                      const line = lineByCode.get(row.component.code);
                      return (
                        <span
                          title="Giá trị tính được theo số liệu thật của tháng"
                          className={`ml-auto shrink-0 text-right text-sm font-bold tabular-nums ${
                            line?.failed ? 'text-amber-600' : row.component.kind === 'DEDUCTION' ? 'text-red-600' : 'text-slate-900'
                          }`}
                        >
                          {line ? `${row.component.kind === 'DEDUCTION' ? '−' : ''}${formatFormulaNumber(line.amount)}` : '—'}
                        </span>
                      );
                    })()}
                    <span className={`w-full truncate text-right text-[11px] sm:w-auto sm:max-w-[40%] ${row.mode === 'PER_PERSON' && row.amount == null ? 'font-semibold text-red-600' : 'text-slate-600'}`}>
                      {row.mode === 'FORMULA'
                        ? (row.formula ? describeFormula(row.formula, nameOf) : 'chưa có công thức')
                        : row.mode === 'MONTHLY_INPUT'
                          ? 'nhập hằng tháng'
                          : row.amount != null ? formatFormulaNumber(row.amount)
                            : row.mode === 'PER_PERSON' ? 'chưa khai' : formatFormulaNumber(Number(row.component.default_amount ?? 0))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
      <BankAccountCard person={person} account={account} canManage={canManage} onSaved={onAccountSaved} />
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold text-slate-700" title={value}>{value}</p>
    </div>
  );
}

/** Tài khoản nhận lương — nguồn cho file chi lương ngân hàng. */
function BankAccountCard({ person, account, canManage, onSaved }: {
  person: Profile; account: EmployeeBankAccount | null; canManage: boolean; onSaved: () => void;
}) {
  const { toast } = useToast();
  const blank = () => ({
    bank_code: account?.bank_code ?? '',
    bank_name: account?.bank_name ?? '',
    account_number: account?.account_number ?? '',
    account_holder: account?.account_holder ?? stripVietnamese(person.name).toUpperCase(),
    branch: account?.branch ?? '',
  });
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setForm(blank()); }, [person.id, account?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const issues = {
    bank_code: /^[A-Z][A-Z0-9_]*$/.test(form.bank_code) ? undefined : 'Viết hoa không dấu, VD: VIETINBANK, BIDV.',
    bank_name: form.bank_name.trim() ? undefined : 'Bắt buộc.',
    account_number: /^\d{6,20}$/.test(form.account_number) ? undefined : 'Từ 6 đến 20 chữ số.',
    account_holder: form.account_holder.trim() ? undefined : 'Bắt buộc.',
  };
  const invalid = Object.values(issues).some(Boolean);
  const touched = JSON.stringify(form) !== JSON.stringify(blank());

  const save = async () => {
    if (invalid) return;
    setSaving(true);
    const error = await saveBankAccount({
      user_id: person.id,
      bank_code: form.bank_code,
      bank_name: form.bank_name.trim(),
      account_number: form.account_number,
      account_holder: form.account_holder.trim(),
      branch: form.branch.trim() || null,
    });
    setSaving(false);
    if (error) return toast('Không lưu được tài khoản: ' + error, 'error');
    toast('Đã lưu tài khoản nhận lương.', 'success');
    onSaved();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CreditCard className="h-4 w-4 text-slate-400" /> Tài khoản nhận lương</CardTitle>
      </CardHeader>
      <CardContent>
        {!account && !canManage ? (
          <p className="text-sm text-slate-500"><UserRound className="mr-1 inline h-4 w-4" />Chưa khai tài khoản.</p>
        ) : (
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => { event.preventDefault(); void save(); }}
          >
            <Input label="Mã ngân hàng" required disabled={!canManage} value={form.bank_code}
              onChange={(event) => setForm({ ...form, bank_code: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })}
              error={touched ? issues.bank_code : undefined} />
            <Input label="Tên ngân hàng" required disabled={!canManage} value={form.bank_name}
              onChange={(event) => setForm({ ...form, bank_name: event.target.value })}
              error={touched ? issues.bank_name : undefined} />
            <Input label="Số tài khoản" required inputMode="numeric" disabled={!canManage} value={form.account_number}
              onChange={(event) => setForm({ ...form, account_number: event.target.value.replace(/\D/g, '') })}
              error={touched ? issues.account_number : undefined} />
            <Input label="Chủ tài khoản" required disabled={!canManage} value={form.account_holder}
              onChange={(event) => setForm({ ...form, account_holder: event.target.value })}
              error={touched ? issues.account_holder : undefined} />
            <Input label="Chi nhánh" disabled={!canManage} value={form.branch}
              onChange={(event) => setForm({ ...form, branch: event.target.value })} />
            {canManage && (
              <div className="flex items-end justify-end gap-2">
                <Button type="button" variant="outline" disabled={!touched || saving} onClick={() => setForm(blank())}>Huỷ</Button>
                <Button type="submit" disabled={!touched || invalid || saving}>{saving ? 'Đang lưu…' : 'Lưu'}</Button>
              </div>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
