// Thanh lưu cố định đáy trang khi cơ chế đang soạn có thay đổi.

import { Save, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface SchemeSaveBarProps {
  issueCount: number;
  /** Chữ bên trái khi mọi dòng đều hợp lệ. */
  message: string;
  saving: boolean;
  saveLabel: string;
  onSave: () => void;
  onCancel: () => void;
}

export function SchemeSaveBar({ issueCount, message, saving, saveLabel, onSave, onCancel }: SchemeSaveBarProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur-md print:hidden dark:border-slate-700 dark:bg-slate-900/95">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 lg:pl-64">
        <p className={`flex items-center gap-1.5 text-sm ${issueCount > 0 ? 'text-red-600' : 'text-slate-600 dark:text-slate-300'}`}>
          {issueCount > 0
            ? <><TriangleAlert className="h-4 w-4" /> {issueCount} dòng chưa hợp lệ</>
            : <><Save className="h-4 w-4" /> {message}</>}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={saving}>Huỷ thay đổi</Button>
          <Button onClick={onSave} disabled={saving || issueCount > 0}>
            <Save className="h-4 w-4" /> {saving ? 'Đang lưu…' : saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
