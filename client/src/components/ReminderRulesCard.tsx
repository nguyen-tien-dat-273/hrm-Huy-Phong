import { useCallback, useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { useToast } from '@/contexts/ToastContext';
import { supabase } from '@/lib/supabase';

interface ReminderRule {
  code: string;
  group_name: string;
  label: string;
  description: string;
  audience: string;
  enabled: boolean;
  param: number | null;
  param_unit: string | null;
  param_label: string | null;
}

/** Bật/tắt và chỉnh mốc từng loại nhắc nhở tự động (bảng reminder_rules). */
export function ReminderRulesCard() {
  const { toast } = useToast();
  const [rules, setRules] = useState<ReminderRule[]>([]);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('reminder_rules')
      .select('code, group_name, label, description, audience, enabled, param, param_unit, param_label')
      .order('sort_order');
    if (error) { setMissing(true); return; }
    setRules((data ?? []) as ReminderRule[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const patch = async (code: string, change: Partial<Pick<ReminderRule, 'enabled' | 'param'>>) => {
    if (!supabase) return;
    setRules((prev) => prev.map((r) => (r.code === code ? { ...r, ...change } : r)));
    const { error } = await supabase
      .from('reminder_rules')
      .update({ ...change, updated_at: new Date().toISOString() })
      .eq('code', code);
    if (error) {
      toast('Không lưu được cấu hình nhắc nhở.', 'error');
      void load();
    }
  };

  if (missing || rules.length === 0) return null;
  const groups = [...new Set(rules.map((r) => r.group_name))];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nhắc nhở tự động</CardTitle>
        <p className="text-xs text-slate-500">
          Hệ thống tự gửi thông báo (chuông và điện thoại) khi sắp đến hạn hoặc đang chờ xử lý. Cần bật “Gửi thông báo tự động” ở trên.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {groups.map((group) => (
          <div key={group}>
            <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Bell className="h-3.5 w-3.5" /> {group}
            </p>
            <div className="divide-y divide-slate-100">
              {rules.filter((r) => r.group_name === group).map((rule) => (
                <div key={rule.code} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">{rule.label}</p>
                    <p className="text-xs leading-relaxed text-slate-500">{rule.description}</p>
                    <p className="text-xs text-slate-400">Gửi cho: {rule.audience}</p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-3">
                    {rule.param !== null && rule.param_unit && (
                      <label className="flex items-center gap-1 text-xs text-slate-500">
                        <span className="hidden sm:inline">{rule.param_label}</span>
                        <input
                          type="number"
                          min={0}
                          value={rule.param}
                          onChange={(e) => setRules((prev) => prev.map((r) => (r.code === rule.code ? { ...r, param: Number(e.target.value) } : r)))}
                          onBlur={(e) => void patch(rule.code, { param: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                          className="h-8 w-16 rounded-lg border border-slate-200 px-2 text-right text-sm"
                        />
                        {rule.param_unit}
                      </label>
                    )}
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(e) => void patch(rule.code, { enabled: e.target.checked })}
                      className="h-5 w-5 cursor-pointer accent-indigo-600"
                      aria-label={rule.label}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
