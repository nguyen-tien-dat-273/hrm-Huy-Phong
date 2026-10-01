import { CheckCircle2, LockKeyhole } from 'lucide-react';
import { PERMISSION_FUNCTIONS } from '@/config/permissionCoverage';
import type { AdminPermission } from '@/lib/permissions';

/** Hiển thị các màn hình/nghiệp vụ thực tế nằm trong một quyền module. */
export function PermissionFunctionList({ permission, compact = false }: { permission: AdminPermission; compact?: boolean }) {
  return (
    <div className={`mt-2 grid gap-1.5 ${compact ? 'sm:grid-cols-1' : 'sm:grid-cols-2'}`}>
      {PERMISSION_FUNCTIONS[permission].map((item) => (
        <div key={item.label} className="flex items-start gap-1.5 rounded-lg bg-white/70 px-2 py-1.5 text-[11px] leading-snug text-slate-500">
          {item.adminOnly ? <LockKeyhole className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" /> : <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />}
          <span>{item.label}{item.adminOnly && <em className="ml-1 not-italic text-amber-600">· Chỉ Admin/CEO</em>}{item.functionCode && <em className="ml-1 not-italic text-indigo-600">· Có thể cấp riêng</em>}</span>
        </div>
      ))}
    </div>
  );
}
