// ============================================================================
// Hồ sơ cá nhân — dùng chung cho cả nhân viên và quản trị.
// ----------------------------------------------------------------------------
// Trước đây KHÔNG có trang này: đổi số điện thoại hay ảnh đại diện đều phải
// nhờ admin sửa hộ, dù policy `profiles_update_own` đã cho phép tự sửa từ lâu.
//
// Những gì KHÔNG sửa được ở đây (vai trò, quyền, hạn mức phép, phòng ban) được
// hiển thị dạng chỉ đọc kèm giải thích, thay vì giấu đi — người dùng cần biết
// mình đang có gì và hỏi ai khi cần đổi.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BadgeCheck, Building2, CalendarDays, KeyRound, Loader2, Mail, Phone,
  ShieldCheck, Trash2, Upload, User as UserIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useAuth } from '@/contexts/AuthContext';
import { PERMISSION_LABELS, isFullAdmin, isValidPermission } from '@/lib/permissions';
import { AVATAR_MAX_BYTES, AVATAR_MIME_TYPES, removeAvatar, updateOwnProfile, uploadAvatar } from '@/lib/profileSelf';
import { displayIdentifier } from '@/lib/identity';
import { formatDate } from '@/lib/utils';
import { fetchOwnWorkerProfile, type OwnWorkerProfile } from '@/lib/workerProfile';
import { WorkerProfileCards } from '@/components/profile/WorkerProfileCards';
import { OrgContact } from '@/components/OrgContact';
import { PhoneNotificationCard } from '@/components/PhoneNotificationCard';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Quản trị viên',
  ceo: 'Ban giám đốc',
  staff: 'Nhân viên',
};

/** Dòng thông tin chỉ đọc. */
function ReadOnlyRow({ icon, label, value, hint }: {
  icon: React.ReactNode; label: string; value: React.ReactNode; hint?: string;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <div className="text-sm font-medium text-slate-800 break-words">{value}</div>
        {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
      </div>
    </div>
  );
}

export function ProfilePage() {
  const { profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [worker, setWorker] = useState<OwnWorkerProfile | null>(null);

  useEffect(() => {
    setName(profile?.name ?? '');
    setPhone(profile?.phone ?? '');
  }, [profile?.name, profile?.phone]);

  // Hồ sơ người lao động và giấy tờ của chính mình. Nạp rời khỏi `profile` vì
  // không phải ai cũng có — người làm văn phòng thì truy vấn này trả về rỗng
  // và các thẻ bên dưới tự ẩn đi.
  useEffect(() => {
    if (!profile?.id) return;
    let alive = true;
    void fetchOwnWorkerProfile(profile.id).then((data) => { if (alive) setWorker(data); });
    return () => { alive = false; };
  }, [profile?.id]);

  const dirty = useMemo(
    () => name !== (profile?.name ?? '') || phone !== (profile?.phone ?? ''),
    [name, phone, profile?.name, profile?.phone],
  );

  if (!profile) return null;

  const save = async () => {
    setSaving(true);
    const { error } = await updateOwnProfile(profile.id, { name, phone });
    setSaving(false);

    if (error) {
      toast(error, 'error');
      return;
    }
    await refreshProfile();
    toast('Đã lưu hồ sơ', 'success');
  };

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    const { error } = await uploadAvatar(profile.id, file, profile.avatar_url);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';

    if (error) {
      toast(error, 'error');
      return;
    }
    await refreshProfile();
    toast('Đã cập nhật ảnh đại diện', 'success');
  };

  const dropAvatar = async () => {
    const ok = await confirm({
      title: 'Gỡ ảnh đại diện?',
      message: 'Hồ sơ sẽ hiển thị bằng chữ cái đầu của tên bạn.',
      confirmLabel: 'Gỡ ảnh',
      danger: true,
    });
    if (!ok) return;

    setUploading(true);
    const { error } = await removeAvatar(profile.id, profile.avatar_url);
    setUploading(false);

    if (error) {
      toast(error, 'error');
      return;
    }
    await refreshProfile();
    toast('Đã gỡ ảnh đại diện', 'success');
  };

  const grantedPermissions = profile.permissions.filter(isValidPermission);

  return (
    <div className="max-w-3xl space-y-6">
      {/* ---- Ảnh đại diện ---- */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-5 pt-6">
          <div className="relative">
            <Avatar name={profile.name} url={profile.avatar_url} size="lg" />
            {uploading && (
              <div className="absolute inset-0 rounded-full bg-white/70 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-lg font-display font-bold text-slate-800 truncate">{profile.name}</p>
            <p className="text-sm text-slate-500">
              {ROLE_LABELS[profile.role] ?? profile.role}
              {profile.department && ` · ${profile.department}`}
            </p>
          </div>

          <div className="flex gap-2">
            <input
              ref={fileRef}
              type="file"
              accept={AVATAR_MIME_TYPES.join(',')}
              className="hidden"
              onChange={(e) => void pickAvatar(e.target.files?.[0])}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Upload className="w-4 h-4" />
              {profile.avatar_url ? 'Đổi ảnh' : 'Tải ảnh lên'}
            </Button>
            {profile.avatar_url && (
              <Button variant="ghost" onClick={dropAvatar} disabled={uploading}>
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>

          {/* Ghi chú về ảnh nằm cạnh nút tải ảnh. Trước đây nó bị đặt dưới ô
              "Số điện thoại" ở thẻ bên dưới, nên đọc như một ràng buộc của
              trường số điện thoại. */}
          <p className="w-full text-xs text-slate-500">
            Ảnh tối đa {Math.round(AVATAR_MAX_BYTES / 1024 / 1024)} MB, định dạng JPG/PNG/WEBP/GIF.
          </p>
        </CardContent>
      </Card>

      {/* ---- Sửa được ---- */}
      <Card>
        <CardHeader>
          <CardTitle>Thông tin cá nhân</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input label="Họ và tên" value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            label="Số điện thoại"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0912 345 678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <div className="flex gap-2 pt-1">
            <Button theme={isFullAdmin(profile) ? 'admin' : 'staff'} onClick={save} disabled={!dirty || saving}>
              {saving ? 'Đang lưu…' : 'Lưu thay đổi'}
            </Button>
            {dirty && (
              <Button
                variant="ghost"
                onClick={() => { setName(profile.name); setPhone(profile.phone ?? ''); }}
                disabled={saving}
              >
                Hoàn tác
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <PhoneNotificationCard />

      {/* ---- Chỉ đọc ---- */}
      <Card>
        <CardHeader>
          <CardTitle>Thông tin tài khoản</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-slate-50">
          <ReadOnlyRow
            icon={<UserIcon className="w-4 h-4" />}
            label="Tên đăng nhập"
            value={displayIdentifier(profile.email)}
            hint="Do quản trị viên cấp — không tự đổi được."
          />
          <ReadOnlyRow
            icon={<Mail className="w-4 h-4" />}
            label="Email"
            value={profile.email}
          />
          <ReadOnlyRow
            icon={<BadgeCheck className="w-4 h-4" />}
            label="Vai trò"
            value={ROLE_LABELS[profile.role] ?? profile.role}
            hint="Muốn đổi vai trò hoặc phòng ban, liên hệ quản trị viên."
          />
          <ReadOnlyRow
            icon={<Building2 className="w-4 h-4" />}
            label="Phòng ban"
            value={profile.department || <span className="text-slate-400">Chưa đặt</span>}
          />
          <ReadOnlyRow
            icon={<CalendarDays className="w-4 h-4" />}
            label="Hạn mức phép năm"
            value={`${profile.annual_leave_quota} ngày`}
            hint="Do quản lý nghỉ phép đặt."
          />
          <ReadOnlyRow
            icon={<Phone className="w-4 h-4" />}
            label="Ngày vào hệ thống"
            value={formatDate(profile.created_at)}
          />
        </CardContent>
      </Card>

      {/* ---- Hồ sơ lao động + giấy tờ, chỉ hiện với người có hồ sơ ---- */}
      {worker && <WorkerProfileCards data={worker} />}

      {/* ---- Quyền, chỉ hiện khi có ---- */}
      {(isFullAdmin(profile) || grantedPermissions.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Quyền truy cập</CardTitle>
          </CardHeader>
          <CardContent>
            {isFullAdmin(profile) ? (
              <div className="flex items-center gap-2.5 text-sm text-slate-600">
                <ShieldCheck className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                Toàn quyền trên hệ thống.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {grantedPermissions.map((p) => (
                  <Badge key={p} className="bg-blue-100 text-blue-700">
                    {PERMISSION_LABELS[p].label}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---- Bảo mật ---- */}
      <Card>
        <CardHeader>
          <CardTitle>Bảo mật</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center">
                <KeyRound className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-800">Mật khẩu</p>
                <p className="text-xs text-slate-500">Đổi mật khẩu cần nhập lại mật khẩu hiện tại.</p>
              </div>
            </div>
            <Button variant="outline" onClick={() => navigate('/change-password')}>
              Đổi mật khẩu
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Trang này nhắc "liên hệ quản trị viên" ở bốn chỗ; đây là nơi nói rõ
          liên hệ bằng cách nào. Tự ẩn khi Cấu hình chưa nhập gì. */}
      <OrgContact prefix="Cần đổi thông tin không tự sửa được, liên hệ" className="px-1" />
    </div>
  );
}
