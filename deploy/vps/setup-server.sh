#!/bin/sh
# ============================================================================
# Chuẩn bị VPS Ubuntu 22.04/24.04 mới cho HRM. Chạy MỘT LẦN bằng root:
#
#   sh setup-server.sh                 # cài đặt, chưa khoá SSH
#   sh setup-server.sh --harden-ssh    # chạy lại SAU KHI đã đăng nhập được bằng khoá với user deploy
#
# Làm gì:
#   1. Cập nhật hệ thống, cài công cụ (git, jq, ufw, fail2ban, unattended-upgrades…)
#   2. Múi giờ Asia/Ho_Chi_Minh
#   3. Swap 2 GB (VPS nhỏ cần chỗ đệm khi RAM đầy) + giảm swappiness
#   4. Docker Engine + Compose, giới hạn log container (không làm đầy ổ đĩa)
#   5. User `deploy` (nhóm docker, sudo), chép khoá SSH của root sang
#   6. Thư mục /opt/hrm, /opt/supabase, /opt/hrm-backups
#   7. Tường lửa: chỉ mở SSH, 80, 443
#   8. Tự cài bản vá bảo mật; fail2ban chặn dò mật khẩu SSH
#   9. (--harden-ssh) Tắt đăng nhập bằng mật khẩu và đăng nhập root qua SSH
#
# Chạy lại an toàn: bước nào đã làm thì bỏ qua.
# ============================================================================
set -eu

DEPLOY_USER="${DEPLOY_USER:-deploy}"
SWAP_SIZE="${SWAP_SIZE:-2G}"
HARDEN_SSH=0
for arg in "$@"; do
  case "$arg" in
    --harden-ssh) HARDEN_SSH=1 ;;
    *) echo "Tham số không hợp lệ: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m[LỖI] %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "Phải chạy bằng root (hoặc: sudo sh setup-server.sh)."
. /etc/os-release
case "${ID}:${VERSION_ID}" in
  ubuntu:22.04|ubuntu:24.04) ;;
  *) [ "${FORCE_OS:-0}" = "1" ] || die "Script viết cho Ubuntu 22.04/24.04 (máy này: ${PRETTY_NAME}). Đặt FORCE_OS=1 nếu chắc chắn." ;;
esac

# ---------------------------------------------------------------------------
if [ "$HARDEN_SSH" = "1" ]; then
  say "Khoá SSH: chỉ đăng nhập bằng khoá, cấm root"
  keys="/home/$DEPLOY_USER/.ssh/authorized_keys"
  [ -s "$keys" ] || die "$keys trống — sẽ tự khoá mình ngoài máy. Thêm khoá công khai cho $DEPLOY_USER trước."
  cat > /etc/ssh/sshd_config.d/00-hrm-hardening.conf <<'EOF'
# Tạo bởi HRM setup-server.sh --harden-ssh. File 00- đứng đầu nên thắng cấu hình cloud-init.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
  sshd -t || { rm -f /etc/ssh/sshd_config.d/00-hrm-hardening.conf; die "Cấu hình SSH lỗi, đã hoàn tác."; }
  systemctl reload ssh 2>/dev/null || systemctl restart ssh
  echo "Đã khoá. GIỮ cửa sổ SSH này, mở cửa sổ MỚI thử: ssh $DEPLOY_USER@<IP>"
  echo "Nếu không vào được: ở cửa sổ này chạy  rm /etc/ssh/sshd_config.d/00-hrm-hardening.conf && systemctl reload ssh"
  exit 0
fi

# ---------------------------------------------------------------------------
say "1/8 Cập nhật hệ thống và cài công cụ"
export DEBIAN_FRONTEND=noninteractive
apt-get -o DPkg::Lock::Timeout=900 update -q
# Nâng cấp toàn bộ hệ thống tải hàng trăm MB (với mạng chậm có thể mất hàng giờ). SKIP_UPGRADE=1
# bỏ qua; bản vá bảo mật vẫn được unattended-upgrades cài dần ở nền, hoặc chạy tay sau:
#   sudo apt-get upgrade -y
if [ "${SKIP_UPGRADE:-0}" = "1" ]; then
  echo "Bỏ qua nâng cấp toàn bộ hệ thống (SKIP_UPGRADE=1)."
else
  apt-get -o DPkg::Lock::Timeout=900 -y -q -o Dpkg::Options::=--force-confold upgrade
fi
apt-get -o DPkg::Lock::Timeout=900 -y -q install sudo ca-certificates curl git openssl jq ufw fail2ban unattended-upgrades

say "2/8 Múi giờ Asia/Ho_Chi_Minh"
timedatectl set-timezone Asia/Ho_Chi_Minh || warn "Không đặt được múi giờ (không ảnh hưởng HRM)."

say "3/8 Swap $SWAP_SIZE"
if swapon --show --noheadings | grep -q .; then
  echo "Đã có swap: $(swapon --show --noheadings | awk '{print $1" "$3}' | tr '\n' ' ')"
else
  if { fallocate -l "$SWAP_SIZE" /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none; } \
     && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile; then
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "Đã bật swap /swapfile."
  else
    rm -f /swapfile
    warn "VPS không cho tạo swap (có thể là ảo hoá kiểu container). Chạy được nhưng dễ hết RAM hơn."
  fi
fi
cat > /etc/sysctl.d/99-hrm.conf <<'EOF'
# Chỉ dùng swap khi thật cần; giữ cache thư mục lâu hơn.
vm.swappiness=10
vm.vfs_cache_pressure=50
EOF
sysctl -q --system || true

say "4/8 Docker Engine + Compose"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
  rm -f /tmp/get-docker.sh
fi
if [ ! -f /etc/docker/daemon.json ]; then
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "local",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
  systemctl restart docker
else
  echo "Giữ nguyên /etc/docker/daemon.json đang có."
fi
systemctl enable --now docker >/dev/null 2>&1
compose_ver=$(docker compose version --short 2>/dev/null | sed 's/^v//')
[ -n "$compose_ver" ] || die "Chưa có docker compose plugin."
if [ "$(printf '%s\n%s\n' "2.24.4" "$compose_ver" | sort -V | head -1)" != "2.24.4" ]; then
  die "Docker Compose $compose_ver quá cũ (cần ≥ 2.24.4)."
fi
echo "Docker $(docker version --format '{{.Server.Version}}'), Compose $compose_ver"

say "5/8 User $DEPLOY_USER"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker,sudo "$DEPLOY_USER"
# Nhóm docker đã tương đương root, nên sudo không mật khẩu không làm yếu thêm;
# user này không có mật khẩu (chỉ đăng nhập bằng khoá).
echo "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-hrm-deploy
chmod 440 /etc/sudoers.d/90-hrm-deploy
visudo -cf /etc/sudoers.d/90-hrm-deploy >/dev/null || { rm -f /etc/sudoers.d/90-hrm-deploy; die "sudoers lỗi, đã hoàn tác."; }
home="/home/$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$home/.ssh"
if [ -s /root/.ssh/authorized_keys ] && [ ! -s "$home/.ssh/authorized_keys" ]; then
  install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /root/.ssh/authorized_keys "$home/.ssh/authorized_keys"
  echo "Đã chép khoá SSH của root sang $DEPLOY_USER."
fi
[ -s "$home/.ssh/authorized_keys" ] || warn "$DEPLOY_USER CHƯA có khoá SSH. Xem README.md (bước khoá SSH)."
echo "UID của $DEPLOY_USER: $(id -u "$DEPLOY_USER") (install-supabase.sh tự ghi vào BACKUP_UID/BACKUP_GID)."

say "6/8 Thư mục"
install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /opt/hrm /opt/supabase
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /opt/hrm-backups /opt/hrm/secrets
here=$(cd "$(dirname "$0")" && pwd)
if [ "$here" != "/opt/hrm" ] && [ -f "$here/compose.yaml" ] && [ ! -f /opt/hrm/compose.yaml ]; then
  cp -a "$here/." /opt/hrm/
  chown -R "$DEPLOY_USER:$DEPLOY_USER" /opt/hrm
  echo "Đã chép bộ cài từ $here sang /opt/hrm."
fi

say "7/8 Tường lửa (ufw): chỉ SSH, 80, 443"
# Mở đúng cổng SSH đang dùng (VPS có thể không dùng 22) — sai chỗ này là tự khoá mình ngoài.
ssh_ports=$(sshd -T 2>/dev/null | awk '$1 == "port" {print $2}' | sort -u)
[ -n "$ssh_ports" ] || ssh_ports=22
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
for p in $ssh_ports; do
  ufw limit "$p/tcp" >/dev/null   # cho phép SSH, chặn tạm IP thử kết nối dồn dập
  echo "SSH: cổng $p"
done
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status | sed -n '1,12p'
echo "Lưu ý: Docker tự mở cổng của container và VƯỢT QUA ufw — bộ cấu hình HRM chỉ mở 80/443 (Caddy);"
echo "      mọi cổng khác chỉ nghe trên 127.0.0.1. Đừng thêm 'ports:' ra 0.0.0.0 cho container khác."

say "8/8 Bản vá bảo mật tự động + fail2ban"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true
systemctl enable --now fail2ban >/dev/null 2>&1 || true

mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
disk_gb=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
say "XONG. RAM ${mem_mb} MB, ổ trống ${disk_gb} GB."
[ "$mem_mb" -ge 2200 ] || warn "RAM dưới 2.2 GB: Supabase rút gọn có thể không đủ."
cat <<EOF

Tiếp theo:
  1. Mở cửa sổ MỚI, thử:  ssh $DEPLOY_USER@<IP-VPS>    (phải vào được bằng khoá, không hỏi mật khẩu)
  2. Vào được rồi thì quay lại đây chạy:  sh setup-server.sh --harden-ssh
  3. Đăng nhập bằng $DEPLOY_USER, chạy:   sh /opt/hrm/install-supabase.sh <ten-mien>
EOF
