import { ADMIN_FUNCTIONS, ADMIN_FUNCTION_CODES, type AdminFunctionCode } from '@/lib/permissions';

/** Chọn quyền chức năng nhạy cảm theo vai trò/vị trí, tách khỏi 8 quyền module. */
export function FunctionPermissionPicker({
  selected,
  onChange,
  disabled = false,
  hint = 'Chọn đúng nghiệp vụ cho vai trò hoặc vị trí này, không cần cấp toàn quyền.',
}: {
  selected: AdminFunctionCode[];
  onChange: (next: AdminFunctionCode[]) => void;
  disabled?: boolean;
  /** Cau mo ta doi theo noi dung: gan cho vi tri hay cho dung mot nguoi. */
  hint?: string;
}) {
  const toggle = (code: AdminFunctionCode) => {
    if (selected.includes(code)) onChange(selected.filter((item) => item !== code));
    else onChange([...selected, code]);
  };
  return (
    <fieldset disabled={disabled} className="mt-4 rounded-xl border border-violet-100 bg-violet-50/50 p-3">
      <legend className="px-1 text-sm font-semibold text-slate-700">Chức năng nâng cao có thể cấp riêng</legend>
      <p className="mb-2 text-xs text-slate-500">Admin/CEO luôn có sẵn. {hint}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {ADMIN_FUNCTION_CODES.map((code) => {
          const item = ADMIN_FUNCTIONS[code];
          const checked = selected.includes(code);
          return (
            <label key={code} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 transition-colors ${checked ? 'border-violet-300 bg-white' : 'border-transparent hover:border-violet-100 hover:bg-white/70'}`}>
              <input type="checkbox" checked={checked} onChange={() => toggle(code)} className="mt-0.5 h-4 w-4 accent-violet-600" />
              <span className="min-w-0"><span className="block text-sm font-medium text-slate-800">{item.label}</span><span className="block text-[11px] leading-snug text-slate-500">{item.description}</span></span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
