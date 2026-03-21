#!/bin/bash
set -euxo pipefail

REGION="eu-west-2"

# ============================================================
# System packages
# ============================================================
apt-get update
apt-get install -y \
  build-essential git curl wget unzip jq htop tmux \
  apt-transport-https ca-certificates gnupg lsb-release

# ============================================================
# Mount data volume
# ============================================================
DATA_DEVICE="/dev/xvdf"
DATA_MOUNT="/home/ubuntu/work"

# Format only if not already formatted
if ! blkid "$DATA_DEVICE"; then
  mkfs.ext4 "$DATA_DEVICE"
fi

mkdir -p "$DATA_MOUNT"
echo "$DATA_DEVICE $DATA_MOUNT ext4 defaults,nofail 0 2" >> /etc/fstab
mount -a
chown ubuntu:ubuntu "$DATA_MOUNT"

# ============================================================
# Node.js (LTS via NodeSource)
# ============================================================
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# ============================================================
# Docker
# ============================================================
curl -fsSL https://get.docker.com | sh
usermod -aG docker ubuntu

# ============================================================
# Claude Code
# ============================================================
npm install -g @anthropic-ai/claude-code

# ============================================================
# Tailscale
# ============================================================
curl -fsSL https://tailscale.com/install.sh | sh

TS_AUTH_KEY=$(aws ssm get-parameter \
  --name /workspace/tailscale-auth-key \
  --with-decryption --query Parameter.Value --output text \
  --region "$REGION")

tailscale up --auth-key="$TS_AUTH_KEY" --hostname=claude-workspace --ssh

# ============================================================
# Claude Code auth
# ============================================================
CLAUDE_TOKEN=$(aws ssm get-parameter \
  --name /workspace/claude-oauth-token \
  --with-decryption --query Parameter.Value --output text \
  --region "$REGION")

# Set for all sessions
echo "CLAUDE_CODE_OAUTH_TOKEN=$CLAUDE_TOKEN" >> /etc/environment

# Skip onboarding wizard
sudo -u ubuntu mkdir -p /home/ubuntu/.claude
echo '{"completedOnboarding":true}' > /home/ubuntu/.claude/.claude.json
chown -R ubuntu:ubuntu /home/ubuntu/.claude

# ============================================================
# Per-boot systemd service
# ============================================================
cat > /etc/systemd/system/workspace-boot.service <<'EOF'
[Unit]
Description=Workspace per-boot setup
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/workspace-boot.sh
RemainAfterExit=true

[Install]
WantedBy=multi-user.target
EOF

# Install per-boot script
cp /dev/stdin /usr/local/bin/workspace-boot.sh <<'BOOT'
#!/bin/bash
set -euxo pipefail

# Ensure Tailscale is up
tailscale status || tailscale up --hostname=claude-workspace --ssh

# Ensure data volume is mounted
mountpoint -q /home/ubuntu/work || mount -a

# Refresh Claude token from SSM (in case it was rotated)
CLAUDE_TOKEN=$(aws ssm get-parameter \
  --name /workspace/claude-oauth-token \
  --with-decryption --query Parameter.Value --output text \
  --region eu-west-2 2>/dev/null || true)

if [ -n "$CLAUDE_TOKEN" ]; then
  sed -i '/CLAUDE_CODE_OAUTH_TOKEN/d' /etc/environment
  echo "CLAUDE_CODE_OAUTH_TOKEN=$CLAUDE_TOKEN" >> /etc/environment
fi
BOOT

chmod +x /usr/local/bin/workspace-boot.sh
systemctl enable workspace-boot.service

echo "=== Workspace provisioning complete ==="
