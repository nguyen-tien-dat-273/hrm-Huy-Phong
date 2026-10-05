// ============================================================================
// Nhật ký các lô nhập file chấm công.
// ----------------------------------------------------------------------------
// `import_attendance_file` ghi mỗi lần nhập vào `attendance_import_batches`,
// nhưng trước đây không màn nào đọc — bảng chỉ có đường ghi.
//
// Nó cần thiết vì nhập file là thao tác GHI ĐÈ dữ liệu chấm công hàng loạt,
// và cái toast báo "đã thêm 37 ngày công" biến mất sau vài giây. Khi tháng sau
// có người thắc mắc vì sao công của mình lệch, phải tra được: file nào, ai
// nhập, lúc nào, bao nhiêu dòng bị bỏ.
//
// Chưa chạy migration thì lặng lẽ không hiện gì — màn hình máy chấm công vẫn
// dùng bình thường, chỉ chưa có nhật ký.
// ============================================================================

import { useEffect, useState } from 'react';
import { FileClock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/utils';
import type { Profile } from '@/types';

interface Batch {
  id: string;
  file_name: string;
  received_rows: number;
  accepted_rows: number;
  skipped_rows: number;
  inserted_rows: number;
  updated_rows: number;
  imported_by: string | null;
  created_at: string;
}

export function AttendanceImportHistory({ profiles }: { profiles: Profile[] }) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!supabase) return;
      const { data, error } = await supabase
        .from('attendance_import_batches')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) {
        setSupported(false);
        return;
      }
      setBatches((data || []) as Batch[]);
    };
    void load();
  }, []);

  if (!supported || batches.length === 0) return null;

  const nameOf = (userId: string | null) =>
    profiles.find((person) => person.id === userId)?.name ?? 'Không rõ';

  return (
    <Card>
      <CardContent className="space-y-3">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
          <FileClock className="h-3.5 w-3.5" />
          10 lô nhập file gần nhất
        </p>
        <div className="divide-y divide-slate-50">
          {batches.map((batch) => (
            <div key={batch.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-xs">
              <span className="min-w-0 flex-1 truncate font-semibold text-slate-800">{batch.file_name}</span>
              <span className="text-slate-500">
                {/* Bốn con số này mới trả lời được "file đó đã làm gì": đọc bao
                    nhiêu, nhận bao nhiêu, thêm mới và sửa bao nhiêu. Chỉ hiện
                    "đã nhập xong" thì tra lại không ra gì. */}
                đọc {batch.received_rows} · thêm <strong className="text-slate-700">{batch.inserted_rows}</strong>
                {batch.updated_rows > 0 && <> · sửa giờ vào <strong className="text-slate-700">{batch.updated_rows}</strong></>}
                {batch.skipped_rows > 0 && <> · <span className="font-semibold text-amber-600">bỏ {batch.skipped_rows}</span></>}
              </span>
              <span className="shrink-0 text-slate-400">
                {nameOf(batch.imported_by)} · {formatDateTime(batch.created_at)}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
