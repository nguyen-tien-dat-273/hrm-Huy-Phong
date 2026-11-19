// ============================================================================
// Khối "Lịch họp & nhắc nhở sắp tới" — cho nhân viên xem trên dashboard.
// ----------------------------------------------------------------------------
// Gom sự kiện sắp tới của mọi dự án người dùng là thành viên (RLS tự lọc). Tự
// ẩn khi không có sự kiện nào để không chiếm chỗ. Nghe realtime nên trưởng nhóm
// vừa tạo lịch là hiện ngay.
// ============================================================================

import { useEffect, useState } from 'react';
import { CalendarClock, Bell, Building2, MapPin, Video } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { EVENT_TYPE_CONFIG, fetchUpcomingEvents, formatEventTime } from '@/lib/projectEvents';
import type { ProjectEvent } from '@/types';

export function UpcomingEventsCard() {
  const { profile } = useAuth();
  const [events, setEvents] = useState<ProjectEvent[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    setEvents(await fetchUpcomingEvents(5));
    setLoaded(true);
  };

  useEffect(() => {
    if (profile) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useRealtimeSync([{ table: 'project_events' }], load, {
    enabled: !!profile,
    channelKey: 'upcoming-events',
  });

  // Chưa tải xong hoặc không có gì → không chiếm chỗ trên dashboard.
  if (!loaded || events.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="inline-flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-blue-600" />
            Lịch họp &amp; nhắc nhở sắp tới
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-slate-50">
          {events.map((ev) => {
            const cfg = EVENT_TYPE_CONFIG[ev.type];
            const isLink = !!ev.location && /^https?:\/\//.test(ev.location);
            return (
              <div key={ev.id} className="flex items-start gap-3 px-5 py-3.5">
                <div className={`w-9 h-9 rounded-none flex items-center justify-center flex-shrink-0 ${cfg.color}`}>
                  {ev.type === 'meeting' ? <CalendarClock className="w-4.5 h-4.5" /> : <Bell className="w-4.5 h-4.5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">{ev.title}</span>
                    <Badge className={cfg.color}>{cfg.label}</Badge>
                    {ev.project?.name && <span className="text-xs text-slate-600">· {ev.project.name}</span>}
                  </div>
                  <p className="text-xs font-medium text-slate-600 mt-0.5">{formatEventTime(ev.start_at)}</p>
                  {ev.client_name && (
                    <p className="text-xs text-slate-600 flex items-center gap-1.5 mt-0.5">
                      <Building2 className="w-3.5 h-3.5 text-slate-600" /> {ev.client_name}
                    </p>
                  )}
                  {ev.location && (
                    <p className="text-xs text-slate-600 flex items-center gap-1.5 mt-0.5">
                      {isLink ? <Video className="w-3.5 h-3.5 text-slate-600" /> : <MapPin className="w-3.5 h-3.5 text-slate-600" />}
                      {isLink
                        ? <a href={ev.location!} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate">Link tham gia</a>
                        : <span className="truncate">{ev.location}</span>}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
