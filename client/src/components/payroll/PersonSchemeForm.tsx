// ============================================================================
// Cơ chế lương của MỘT nhân sự — form nằm thẳng trên trang, không hộp thoại.
// ----------------------------------------------------------------------------
// Danh sách dòng của riêng người này (cùng kiểu dòng với bộ cơ chế mẫu). "Copy
// từ" chép toàn bộ dòng của một bộ mẫu hoặc của một nhân viên khác sang đây;
// sau khi chép là của người này, sửa thoải mái không ảnh hưởng nơi chép.
//
// Lưu là áp dụng ngay từ tháng đang xem (các tháng trước giữ nguyên). Bản lưu là
// TOÀN BỘ dòng của người từ tháng áp dụng.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FlaskConical, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { BankAccountCard } from '@/components/payroll/BankAccountCard';
import { SchemeCopyMenu } from '@/components/payroll/SchemeCopyMenu';
import { SchemeRowsEditor, schemeRowDomId } from '@/components/payroll/SchemeRowsEditor';
import { SchemeSaveBar } from '@/components/payroll/SchemeSaveBar';
import {
  draftOfMechanism, draftOfPayload, draftOfStored, payloadOfDraft, sameDraft, type SchemeDraftRow,
} from '@/components/payroll/schemeDraft';
import { monthEndOf, monthText } from '@/components/payroll/schemeWorkbench';
import { useSchemeWorkbench } from '@/components/payroll/useSchemeWorkbench';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { formatFormulaNumber } from '@/lib/formulaTokens';
import { getTodayString } from '@/lib/utils';
import { firstEditableMonth } from '@/lib/payrollSettings';
import { earliestSchemeMonth, missingLabel, personalItemsAt, resolveMechanismRows } from '@/lib/payrollScheme';
import { schemeSourceOf } from '@/lib/payrollRun';
import { saveScheme, type PayrollWorkspace } from '@/lib/payrollData';
import type { EmployeeBankAccount, PayScheme, Profile } from '@/types';

interface PersonSchemeFormProps {
  person: Profile;
  data: PayrollWorkspace;
  monthStart: string;
  lastClosedMonth: string | null;
  canManage: boolean;
  account: EmployeeBankAccount | null;
  /** Tên đơn vị của người — chỉ để hiển thị. */
  unitName: string | null;
  onBack?: () => void;
  onSaved: () => void;
  onAccountSaved: () => void;
  /** Mở Bảng lương tháng, đúng hàng của người này, để nhập số liệu tháng. */
  onOpenInputs: () => void;
  onDryRun: () => void;
}

export function PersonSchemeForm({
  person, data, monthStart, lastClosedMonth, canManage, account, unitName, onBack, onSaved, onAccountSaved, onOpenInputs, onDryRun,
}: PersonSchemeFormProps) {
  const { toast } = useToast();
  const confirm = useConfirm();

  const minMonth = useMemo(() => earliestSchemeMonth(
    firstEditableMonth(lastClosedMonth, getTodayString()),
    data.items.filter((row) => row.user_id === person.id).map((row) => row.effective_from),
  ), [data.items, lastClosedMonth, person.id]);
  const month = monthStart >= minMonth ? monthStart : minMonth;
  const monthEnd = monthEndOf(month);

  const saved = useMemo(
    () => personalItemsAt(data.items, person.id, month, monthEnd).map(draftOfPayload),
    [data.items, month, monthEnd, person.id],
  );
  const savedKey = JSON.stringify(saved);

  const [rows, setRows] = useState<SchemeDraftRow[]>(saved);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Nạp lại khi đổi người / tháng / dữ liệu mới về — trừ khi đang sửa dở.
  useEffect(() => {
    if (dirty && !sameDraft(rows, saved)) return;
    setDirty(false);
    setRows(saved);
  }, [savedKey, person.id, month]); // eslint-disable-line react-hooks/exhaustive-deps

  const readOnly = !canManage;
  const workbench = useSchemeWorkbench({ data, month, rows, person });
  const source = useMemo(() => schemeSourceOf(data), [data]);
  const autoFilled = useMemo(
    () => new Set([...data.kpiCodes, ...data.timesheetCodes].map((code) => code.toUpperCase())),
    [data.kpiCodes, data.timesheetCodes],
  );

  const change = (next: SchemeDraftRow[]) => { setRows(next); setDirty(true); };

  // ---- Copy từ -----------------------------------------------------------------
  const copyPeople = useMemo(
    () => data.profiles.filter((other) => other.id !== person.id
      && resolveMechanismRows(other, source, month, monthEnd).length > 0),
    [data.profiles, month, monthEnd, person.id, source],
  );

  const confirmReplace = async (from: string) => {
    if (rows.length === 0) return true;
    return confirm({
      title: `Copy cơ chế của ${from}?`,
      message: `${rows.length} dòng đang có của ${person.name} sẽ được thay bằng cơ chế của ${from}. Chưa lưu cho tới khi bấm Lưu.`,
      confirmLabel: 'Copy',
    });
  };
  const copyTemplate = async (scheme: PayScheme) => {
    if (!(await confirmReplace(scheme.name))) return;
    change(data.schemeItems
      .filter((item) => item.scheme_id === scheme.id && workbench.componentById.get(item.component_id)?.is_active)
      .map((item) => draftOfStored(item.component_id, item)));
  };
  const copyPerson = async (other: Profile) => {
    if (!(await confirmReplace(other.name))) return;
    change(resolveMechanismRows(other, source, month, monthEnd).map(draftOfMechanism));
  };

  // ---- Lưu ---------------------------------------------------------------------
  const handleSave = async () => {
    if (workbench.issueCount > 0) { toast('Còn dòng chưa hợp lệ — sửa các dòng tô đỏ trước.', 'warning'); return; }
    if (!workbench.version) { toast(`Chưa có bộ tham số lương hiệu lực cho ${monthText(month)}.`, 'warning'); return; }
    setSaving(true);
    const error = await saveScheme({
      targetType: 'USER', userId: person.id, unitId: null, effectiveFrom: month, items: payloadOfDraft(rows),
    });
    setSaving(false);
    if (error) { toast('Không lưu được: ' + error, 'error'); return; }
    toast(`Đã lưu cơ chế lương của ${person.name} từ ${monthText(month)}.`, 'success');
    setDirty(false);
    onSaved();
  };

  // Đếm trên bản đang soạn để điền xong ô nào là nhãn đổi ngay.
  const blankRows = rows.filter((row) => row.mode === 'FORMULA' && !row.formula.trim() && row.amount == null
    && workbench.componentById.has(row.componentId));
  const blankNames = blankRows.map((row) => workbench.componentById.get(row.componentId)?.name ?? '');
  const status = rows.length === 0
    ? { label: 'Chưa có cơ chế', tone: 'bg-red-50 text-red-600' }
    : blankRows.length > 0
      ? { label: missingLabel(blankNames), tone: 'bg-amber-50 text-amber-700' }
      : { label: 'Đủ', tone: 'bg-emerald-50 text-emerald-700' };
  const jumpTo = (componentId: string) => {
    document.getElementById(schemeRowDomId(componentId))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const hasMonthly = rows.some((row) => row.mode === 'MONTHLY_INPUT');

  return (
    <>
      <Card className="!rounded-none">
        <CardHeader className="flex flex-wrap items-center gap-3">
          {onBack && (
            <Button size="sm" variant="ghost" onClick={onBack} aria-label="Quay lại danh sách">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <Avatar name={person.name} url={person.avatar_url} size="md" />
          <div className="min-w-0 flex-1">
            <CardTitle>Cơ chế của {person.name}</CardTitle>
            <p className="text-xs text-slate-500">
              {person.employee_code ?? '—'} · {unitName ?? (person.department || 'Chưa có đơn vị')}
            </p>
          </div>
          <span
            className={`max-w-[16rem] truncate rounded-full px-2.5 py-1 text-[11px] font-bold ${status.tone}`}
            title={blankNames.length > 0 ? `Còn trống: ${blankNames.join(', ')}` : undefined}
          >
            {status.label}
          </span>
          <Button size="sm" variant="outline" onClick={onDryRun}>
            <FlaskConical className="h-4 w-4" /> Chạy thử
          </Button>
          {hasMonthly && (
            <Button size="sm" variant="outline" onClick={onOpenInputs}>
              <SlidersHorizontal className="h-4 w-4" /> Số liệu tháng
            </Button>
          )}
          {!readOnly && (
            <SchemeCopyMenu
              templates={data.schemes}
              people={copyPeople}
              onPickTemplate={(scheme) => void copyTemplate(scheme)}
              onPickPerson={(other) => void copyPerson(other)}
            />
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {month > monthStart && (
            <p className="rounded-none bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Tháng {monthText(monthStart)} đã chốt lương — bản lưu sẽ áp dụng từ {monthText(month)}.
            </p>
          )}
          {!workbench.params && (
            <p className="flex items-start gap-2 rounded-none bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              Chưa có bộ tham số lương hiệu lực cho tháng này — khai ở Thông số chung để kiểm tra công thức.
            </p>
          )}
          {blankRows.length > 0 && (
            <div className="flex items-start gap-2 rounded-none border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <p className="leading-relaxed">
                <strong>Còn {blankRows.length} dòng chưa có giá trị</strong> — phiếu lương tính các dòng này bằng 0:{' '}
                {blankRows.map((row, index) => (
                  <span key={row.componentId}>
                    {index > 0 && ', '}
                    <button type="button" onClick={() => jumpTo(row.componentId)} className="font-bold underline underline-offset-2 hover:text-amber-700">
                      {blankNames[index]}
                    </button>
                  </span>
                ))}
                . Gõ một con số hoặc công thức vào ô viền đỏ rồi bấm Lưu.
              </p>
            </div>
          )}

          <SchemeRowsEditor
            data={data}
            workbench={workbench}
            rows={rows}
            onChange={change}
            readOnly={readOnly}
            onCatalogChanged={onSaved}
            autoFilledCodes={autoFilled}
          />

          {workbench.result && rows.length > 0 && (
            <p className="flex items-baseline justify-between gap-3 border-t border-slate-200 pt-3 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300">
              <span>Thực lĩnh nếu đi đủ công</span>
              <span className="text-lg font-black tabular-nums text-slate-900 dark:text-slate-100">{formatFormulaNumber(workbench.result.netPay)}</span>
            </p>
          )}
        </CardContent>
      </Card>

      <BankAccountCard person={person} account={account} canManage={canManage} onSaved={onAccountSaved} />

      {dirty && !readOnly && (
        <SchemeSaveBar
          issueCount={workbench.issueCount}
          message={`Chưa lưu — áp dụng từ ${monthText(month)}`}
          saving={saving}
          saveLabel="Lưu"
          onSave={() => void handleSave()}
          onCancel={() => { setDirty(false); setRows(saved); }}
        />
      )}
    </>
  );
}
