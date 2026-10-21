// ============================================================================
// Biểu đồ Gantt cho tác vụ của một dự án.
// ----------------------------------------------------------------------------
// Tự vẽ bằng CSS grid thay vì kéo thư viện Gantt về: bundle đã 1.1MB, mà thư
// viện Gantt phổ biến nào cũng thêm 150–300KB cho những thứ ta không dùng
// (kéo thả đổi ngày, phụ thuộc giữa tác vụ, xuất PDF).
// ============================================================================

import { useMemo, useState } from 'react';
import { CalendarRange, TriangleAlert, Users as UsersIcon, ListFilter } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { Avatar } from '@/components/ui/Avatar';
import { barColor, ganttBars, ganttRange, tasksWithoutDates } from '@/lib/gantt';
import { TASK_STATUSES, formatDate } from '@/lib/utils';
import type { Profile, Task } from '@/types';

type GroupMode = 'assignee' | 'status';

/** Bề rộng một ngày. Đủ hẹp để thấy được một quý, đủ rộng để bấm trúng. */
const DAY_WIDTH = 28;
const LABEL_WIDTH = 220;

interface Props {
  tasks: Task[];
  profiles: Profile[];
  onSelectTask?: (task: Task) => void;
}

export function GanttChart({ tasks, profiles, onSelectTask }: Props) {
  const [mode, setMode] = useState<GroupMode>('assignee');

  const range = useMemo(() => ganttRange(tasks), [tasks]);
  const bars = useMemo(() => (range ? ganttBars(tasks, range) : []), [tasks, range]);
  const undated = useMemo(() => tasksWithoutDates(tasks), [tasks]);

  const groups = useMemo(() => {
    if (!range) return [];
    if (mode === 'status') {
      return TASK_STATUSES.map((s) => ({
        key: s.value,
        label: s.label,
        profile: undefined as Profile | undefined,
        bars: bars.filter((b) => b.task.status === s.value),
      })).filter((g) => g.bars.length > 0);
    }

    const byUser = new Map<string, typeof bars>();
    for (const b of bars) {
      const key = b.task.assignee_id ?? '__none__';
      byUser.set(key, [...(byUser.get(key) ?? []), b]);
    }
    return [...byUser.entries()].map(([key, list]) => {
      const profile = profiles.find((p) => p.id === key);
      return {
        key,
        label: profile?.name ?? 'Chưa giao ai',
        profile,
        bars: list,
      };
    }).sort((a, b) => a.label.localeCompare(b.label, 'vi'));
  }, [bars, mode, profiles, range]);

  if (!range) {
    return (
      <EmptyState
        icon={<CalendarRange className="w-8 h-8" />}
        title="Chưa vẽ được tiến độ"
        description="Chưa có tác vụ nào khai ngày bắt đầu hoặc hạn chót. Mở một tác vụ và điền ngày để nó hiện lên đây."
      />
    );
  }

  const gridWidth = range.days.length * DAY_WIDTH;

  // Nhãn tháng: gộp các ngày cùng tháng thành một ô tiêu đề.
  const months: { label: string; span: number }[] = [];
  for (const d of range.days) {
    const label = d.date.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' });
    const last = months[months.length - 1];
    if (last && last.label === label) last.span += 1;
    else months.push({ label, span: 1 });
  }

  return (
    <div className="space-y-3">
      {/* Thanh điều khiển */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-slate-200 p-0.5 bg-white">
          <button
            onClick={() => setMode('assignee')}
            className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-sm transition-colors ${
              mode === 'assignee' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <UsersIcon className="w-3.5 h-3.5" /> Theo người
          </button>
          <button
            onClick={() => setMode('status')}
            className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-sm transition-colors ${
              mode === 'status' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <ListFilter className="w-3.5 h-3.5" /> Theo trạng thái
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 ml-auto text-xs text-slate-500">
          {[
            ['bg-slate-400', 'Cần làm'],
            ['bg-blue-500', 'Đang làm'],
            ['bg-amber-500', 'Đang duyệt'],
            ['bg-emerald-500', 'Hoàn thành'],
            ['bg-red-500', 'Quá hạn'],
          ].map(([cls, label]) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <span className={`w-3 h-2.5 rounded-sm ${cls}`} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {undated.length > 0 && (
        <div className="flex items-start gap-2.5 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <TriangleAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            {undated.length} tác vụ chưa có ngày nên không nằm trên biểu đồ:{' '}
            <strong>{undated.slice(0, 3).map((t) => t.title).join(', ')}</strong>
            {undated.length > 3 && ` và ${undated.length - 3} tác vụ khác`}.
          </span>
        </div>
      )}

      {/* Vùng cuộn ngang. Cột tên dính trái để cuộn xa vẫn biết đang xem ai. */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-x-auto bg-white dark:bg-slate-900">
        <div style={{ minWidth: LABEL_WIDTH + gridWidth }}>
          {/* Hàng tháng */}
          <div className="flex border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/70">
            <div
              className="flex-shrink-0 sticky left-0 z-20 bg-slate-50/70 dark:bg-slate-800/70 border-r border-slate-100 dark:border-slate-800"
              style={{ width: LABEL_WIDTH }}
            />
            {months.map((m, i) => (
              <div
                key={i}
                className="text-xs font-semibold text-slate-600 dark:text-slate-300 px-2 py-1.5 border-r border-slate-100 dark:border-slate-800 truncate"
                style={{ width: m.span * DAY_WIDTH }}
              >
                {m.label}
              </div>
            ))}
          </div>

          {/* Hàng ngày */}
          <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/40">
            <div
              className="flex-shrink-0 sticky left-0 z-20 bg-slate-50/40 dark:bg-slate-800/40 border-r border-slate-100 dark:border-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider"
              style={{ width: LABEL_WIDTH }}
            >
              Tác vụ
            </div>
            {range.days.map((d) => (
              <div
                key={d.key}
                className={`text-center text-[11px] py-1.5 border-r border-slate-100 dark:border-slate-800 ${
                  d.isToday ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-bold'
                  : d.isWeekend ? 'bg-slate-100/60 dark:bg-slate-800/60 text-slate-400 dark:text-slate-500'
                  : 'text-slate-500 dark:text-slate-400'
                }`}
                style={{ width: DAY_WIDTH }}
              >
                {d.date.getDate()}
              </div>
            ))}
          </div>

          {/* Các nhóm */}
          {groups.map((group) => (
            <div key={group.key}>
              <div className="flex items-center bg-slate-50/60 border-b border-slate-100">
                <div
                  className="flex-shrink-0 sticky left-0 z-20 bg-slate-50/60 border-r border-slate-100 px-3 py-2 flex items-center gap-2"
                  style={{ width: LABEL_WIDTH }}
                >
                  {group.profile && <Avatar name={group.profile.name} url={group.profile.avatar_url} size="sm" />}
                  <span className="text-sm font-semibold text-slate-700 truncate">{group.label}</span>
                  <span className="text-xs text-slate-400 ml-auto">{group.bars.length}</span>
                </div>
                <div style={{ width: gridWidth }} />
              </div>

              {group.bars.map((bar) => (
                <div key={bar.task.id} className="flex items-center border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                  <div
                    className="flex-shrink-0 sticky left-0 z-20 bg-white border-r border-slate-100 px-3 py-2"
                    style={{ width: LABEL_WIDTH }}
                  >
                    <button
                      onClick={() => onSelectTask?.(bar.task)}
                      className="text-sm text-slate-700 hover:text-blue-600 transition-colors truncate block w-full text-left"
                      title={bar.task.title}
                    >
                      {bar.task.title}
                    </button>
                  </div>

                  {/* Lưới ngày làm nền, thanh nằm đè lên bằng position absolute. */}
                  <div className="relative flex" style={{ width: gridWidth, height: 36 }}>
                    {range.days.map((d) => (
                      <div
                        key={d.key}
                        className={`border-r border-slate-50 h-full ${
                          d.isToday ? 'bg-blue-50/70' : d.isWeekend ? 'bg-slate-50/70' : ''
                        }`}
                        style={{ width: DAY_WIDTH }}
                      />
                    ))}

                    <button
                      onClick={() => onSelectTask?.(bar.task)}
                      className={`absolute top-1/2 -translate-y-1/2 h-5 rounded-md ${barColor(bar)} hover:brightness-110 transition-all shadow-sm`}
                      style={{ left: bar.offset * DAY_WIDTH + 2, width: bar.span * DAY_WIDTH - 4 }}
                      title={`${bar.task.title}\n${formatDate(bar.task.start_date)} → ${formatDate(bar.task.due_date)}${bar.overdue ? '\nQUÁ HẠN' : ''}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
