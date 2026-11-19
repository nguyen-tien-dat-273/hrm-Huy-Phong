import { CheckCircle2 } from 'lucide-react';
import { STAFF_FUNCTIONS } from '@/lib/permissions';

/** Phần quyền cá nhân mặc định, không cần cấp trong quyền quản trị. */
export function StaffFunctionSummary() {
  return (
    <details className="group rounded-none border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
      <summary className="cursor-pointer list-none text-xs font-semibold text-emerald-800 marker:hidden">
        <span className="inline-flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          Chức năng khu nhân viên mặc định ({STAFF_FUNCTIONS.length})
          <span className="text-[11px] font-normal text-emerald-700">(không cần gán quyền)</span>
        </span>
      </summary>
      <div className="mt-2 grid gap-1.5 border-t border-emerald-200/70 pt-2 sm:grid-cols-2">
        {STAFF_FUNCTIONS.map((label) => (
          <div key={label} className="flex items-start gap-1.5 text-[11px] leading-snug text-emerald-900">
            <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
