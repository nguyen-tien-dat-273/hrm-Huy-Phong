// ============================================================================
// Bộ cơ chế mẫu — danh sách dòng đặt tên sẵn để copy cho nhiều người.
// ----------------------------------------------------------------------------
//   Danh sách  → bấm một bộ để mở; ô cuối "Tên bộ mới" để tạo thêm.
//   Chi tiết   → tên bộ, "Copy từ", các dòng (cùng bộ soạn với cơ chế của người).
//
// Bộ mẫu chỉ là nơi để SAO CHÉP: người đã copy rồi thì sửa bộ mẫu không đổi cơ chế
// của họ. Bộ mẫu không có tháng hiệu lực.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Layers, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { SchemeCopyMenu } from '@/components/payroll/SchemeCopyMenu';
import { SchemeRowsEditor } from '@/components/payroll/SchemeRowsEditor';
import { SchemeSaveBar } from '@/components/payroll/SchemeSaveBar';
import {
  draftOfMechanism, draftOfStored, payloadOfDraft, type SchemeDraftRow,
} from '@/components/payroll/schemeDraft';
import { monthEndOf } from '@/components/payroll/schemeWorkbench';
import { useSchemeWorkbench } from '@/components/payroll/useSchemeWorkbench';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { resolveMechanismRows } from '@/lib/payrollScheme';
import { schemeSourceOf } from '@/lib/payrollRun';
import { deleteSchemeTemplate, saveSchemeTemplate, type PayrollWorkspace } from '@/lib/payrollData';
import type { PayScheme, Profile } from '@/types';

interface SchemeTemplatesProps {
  data: PayrollWorkspace;
  /** Tháng đang xem — chỉ để tính thử số trong bộ mẫu. */
  monthStart: string;
  canManage: boolean;
  onChanged: () => void;
}

export function SchemeTemplates({ data, monthStart, canManage, onChanged }: SchemeTemplatesProps) {
  const { toast } = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const scheme = openId ? data.schemes.find((row) => row.id === openId) ?? null : null;

  const create = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    const { id, error } = await saveSchemeTemplate(null, name, []);
    setBusy(false);
    if (error || !id) { toast('Không tạo được bộ cơ chế: ' + error, 'error'); return; }
    setNewName('');
    setOpenId(id);
    onChanged();
  };

  if (scheme) {
    return (
      <TemplateEditor
        key={scheme.id}
        scheme={scheme}
        data={data}
        monthStart={monthStart}
        canManage={canManage}
        onBack={() => setOpenId(null)}
        onChanged={onChanged}
      />
    );
  }

  const countOf = (id: string) => data.schemeItems.filter((item) => item.scheme_id === id).length;

  return (
    <Card className="!rounded-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Layers className="h-4 w-4 text-slate-400" /> Bộ cơ chế mẫu</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.schemes.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => setOpenId(row.id)}
            className="flex min-h-11 w-full items-center gap-3 rounded-none border-2 border-slate-300 bg-white px-3 text-left text-sm font-bold text-slate-900 transition hover:border-indigo-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          >
            <span className="min-w-0 flex-1 truncate">{row.name}</span>
            <span className="shrink-0 text-xs font-semibold text-slate-400">{countOf(row.id)} dòng</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          </button>
        ))}
        {canManage && (
          <form
            className="flex min-h-11 items-center gap-2 rounded-none border-2 border-dashed border-slate-300 bg-white px-3 dark:border-slate-600 dark:bg-slate-800"
            onSubmit={(event) => { event.preventDefault(); void create(); }}
          >
            <Plus className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              disabled={busy}
              placeholder="Gõ tên bộ mới rồi Enter…"
              aria-label="Tên bộ cơ chế mới"
              className="min-w-0 flex-1 bg-transparent py-2 text-sm font-semibold outline-none placeholder:font-normal placeholder:text-slate-400"
            />
          </form>
        )}
        {data.schemes.length === 0 && !canManage && (
          <p className="rounded-none border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">Chưa có bộ cơ chế nào.</p>
        )}
      </CardContent>
    </Card>
  );
}

function TemplateEditor({ scheme, data, monthStart, canManage, onBack, onChanged }: {
  scheme: PayScheme;
  data: PayrollWorkspace;
  monthStart: string;
  canManage: boolean;
  onBack: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const readOnly = !canManage;
  const monthEnd = monthEndOf(monthStart);

  const saved = useMemo(
    () => data.schemeItems.filter((item) => item.scheme_id === scheme.id).map((item) => draftOfStored(item.component_id, item)),
    [data.schemeItems, scheme.id],
  );
  const savedKey = JSON.stringify(saved);

  const [name, setName] = useState(scheme.name);
  const [rows, setRows] = useState<SchemeDraftRow[]>(saved);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (dirty) return;
    setRows(saved);
    setName(scheme.name);
  }, [savedKey, scheme.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const workbench = useSchemeWorkbench({ data, month: monthStart, rows, allowBlank: true });
  const source = useMemo(() => schemeSourceOf(data), [data]);
  const autoFilled = useMemo(
    () => new Set([...data.kpiCodes, ...data.timesheetCodes].map((code) => code.toUpperCase())),
    [data.kpiCodes, data.timesheetCodes],
  );
  const copyPeople = useMemo(
    () => data.profiles.filter((person) => resolveMechanismRows(person, source, monthStart, monthEnd).length > 0),
    [data.profiles, monthEnd, monthStart, source],
  );

  const change = (next: SchemeDraftRow[]) => { setRows(next); setDirty(true); };

  const confirmReplace = async (from: string) => {
    if (rows.length === 0) return true;
    return confirm({
      title: `Copy cơ chế của ${from}?`,
      message: `${rows.length} dòng đang có sẽ được thay bằng cơ chế của ${from}. Chưa lưu cho tới khi bấm Lưu.`,
      confirmLabel: 'Copy',
    });
  };
  const copyTemplate = async (from: PayScheme) => {
    if (!(await confirmReplace(from.name))) return;
    change(data.schemeItems
      .filter((item) => item.scheme_id === from.id && workbench.componentById.get(item.component_id)?.is_active)
      .map((item) => draftOfStored(item.component_id, item)));
  };
  const copyPerson = async (person: Profile) => {
    if (!(await confirmReplace(person.name))) return;
    change(resolveMechanismRows(person, source, monthStart, monthEnd).map(draftOfMechanism));
  };

  const handleSave = async () => {
    if (!name.trim()) { toast('Bộ cơ chế cần có tên.', 'warning'); return; }
    if (workbench.issueCount > 0) { toast('Còn dòng chưa hợp lệ — sửa các dòng tô đỏ trước.', 'warning'); return; }
    setSaving(true);
    const { error } = await saveSchemeTemplate(scheme.id, name.trim(), payloadOfDraft(rows, { blankAsPerPerson: true }));
    setSaving(false);
    if (error) { toast('Không lưu được: ' + error, 'error'); return; }
    toast(`Đã lưu bộ cơ chế “${name.trim()}”.`, 'success');
    setDirty(false);
    onChanged();
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: `Xoá bộ “${scheme.name}”?`,
      message: 'Người đã copy bộ này vẫn giữ nguyên cơ chế của họ.',
      confirmLabel: 'Xoá',
      danger: true,
    });
    if (!ok) return;
    const error = await deleteSchemeTemplate(scheme.id);
    if (error) { toast('Không xoá được: ' + error, 'error'); return; }
    toast(`Đã xoá bộ “${scheme.name}”.`, 'success');
    onBack();
    onChanged();
  };

  return (
    <>
      <Card className="!rounded-none">
        <CardHeader className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="ghost" onClick={onBack} aria-label="Quay lại danh sách bộ cơ chế">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <input
            value={name}
            readOnly={readOnly}
            onChange={(event) => { setName(event.target.value); setDirty(true); }}
            aria-label="Tên bộ cơ chế"
            className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-lg font-black text-slate-900 outline-none hover:border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:text-slate-100"
          />
          {!readOnly && (
            <>
              <SchemeCopyMenu
                templates={data.schemes.filter((row) => row.id !== scheme.id)}
                people={copyPeople}
                onPickTemplate={(from) => void copyTemplate(from)}
                onPickPerson={(person) => void copyPerson(person)}
              />
              <Button size="sm" variant="ghost" onClick={() => void handleDelete()} aria-label="Xoá bộ cơ chế" title="Xoá bộ cơ chế">
                <Trash2 className="h-4 w-4 text-slate-400" />
              </Button>
            </>
          )}
        </CardHeader>
        <CardContent>
          <SchemeRowsEditor
            data={data}
            workbench={workbench}
            rows={rows}
            onChange={change}
            readOnly={readOnly}
            onCatalogChanged={onChanged}
            autoFilledCodes={autoFilled}
            blankPlaceholder="Để trống = điền riêng cho từng người"
          />
        </CardContent>
      </Card>

      {dirty && !readOnly && (
        <SchemeSaveBar
          issueCount={workbench.issueCount}
          message="Chưa lưu"
          saving={saving}
          saveLabel="Lưu bộ cơ chế"
          onSave={() => void handleSave()}
          onCancel={() => { setDirty(false); setRows(saved); setName(scheme.name); }}
        />
      )}
    </>
  );
}
