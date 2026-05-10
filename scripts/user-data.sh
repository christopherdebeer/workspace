#!/bin/bash
set -euxo pipefail

# SSM runs with a minimal PATH — include common install locations
export PATH="/usr/local/bin:/usr/bin:/bin:/snap/bin:$PATH"

REGION="eu-west-2"

# ============================================================
# System packages
# ============================================================
apt-get update
apt-get install -y \
  build-essential git curl wget unzip jq htop tmux \
  apt-transport-https ca-certificates gnupg lsb-release

# ============================================================
# AWS CLI
# ============================================================
if ! command -v aws &>/dev/null; then
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscli.zip
  unzip -qo /tmp/awscli.zip -d /tmp
  /tmp/aws/install
  rm -rf /tmp/awscli.zip /tmp/aws
else
  echo "AWS CLI already installed: $(aws --version)"
fi

# ============================================================
# Mount data volume
# ============================================================
DATA_MOUNT="/home/ubuntu/work"

if ! mountpoint -q "$DATA_MOUNT"; then
  # On Nitro instances (t3, etc.) /dev/xvdf appears as /dev/nvme1n1
  # Wait up to 60s for the volume to be attached by CloudFormation
  echo "Waiting for data volume to appear..."
  TRIES=0
  DATA_DEVICE=""
  while [ $TRIES -lt 30 ]; do
    for dev in /dev/xvdf /dev/nvme1n1; do
      if [ -b "$dev" ]; then
        DATA_DEVICE="$dev"
        break 2
      fi
    done
    TRIES=$((TRIES + 1))
    sleep 2
  done

  if [ -z "$DATA_DEVICE" ]; then
    echo "ERROR: Data volume never appeared" >&2
    exit 1
  fi

  echo "Found data volume at $DATA_DEVICE"

  # Format only if not already formatted
  if ! blkid "$DATA_DEVICE"; then
    mkfs.ext4 "$DATA_DEVICE"
  fi

  mkdir -p "$DATA_MOUNT"
  # Add to fstab only if not already present
  grep -q "$DATA_DEVICE" /etc/fstab || \
    echo "$DATA_DEVICE $DATA_MOUNT ext4 defaults,nofail 0 2" >> /etc/fstab
  mount -a
  chown ubuntu:ubuntu "$DATA_MOUNT"
else
  echo "Data volume already mounted at $DATA_MOUNT"
fi

# ============================================================
# Node.js (LTS via NodeSource)
# ============================================================
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
else
  echo "Node.js already installed: $(node --version)"
fi

# ============================================================
# Docker
# ============================================================
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  usermod -aG docker ubuntu
else
  echo "Docker already installed: $(docker --version)"
fi

# ============================================================
# Claude Code
# ============================================================
npm install -g @anthropic-ai/claude-code

# ============================================================
# Tailscale
# ============================================================
if ! command -v tailscale &>/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi

TS_AUTH_KEY=$(aws ssm get-parameter \
  --name /workspace/tailscale-auth-key \
  --with-decryption --query Parameter.Value --output text \
  --region "$REGION")

tailscale up --auth-key="$TS_AUTH_KEY" --hostname=claude-workspace --reset

# ============================================================
# User: c15r (primary SSH user, home on persistent volume)
# ============================================================
C15R_HOME="/home/ubuntu/work/home/c15r"
mkdir -p "$C15R_HOME"

if ! id c15r &>/dev/null; then
  useradd -s /bin/bash -G sudo,docker -d "$C15R_HOME" c15r
  echo "c15r ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/c15r
else
  # Update home directory if user already exists (e.g. after reprovision)
  usermod -d "$C15R_HOME" c15r
fi

chown c15r:c15r "$C15R_HOME"

SSH_KEY='ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBJlPZ/bLdWOIdsDHSTuOEhPcA0tlGZzjHAIeKK8C6o88I6LG10MsW3IOXly6leQxWDJZS6Va8XcYGcxuCkPN/94= #ssh.id - @c15r'
mkdir -p "$C15R_HOME/.ssh"
grep -qF "$SSH_KEY" "$C15R_HOME/.ssh/authorized_keys" 2>/dev/null || \
  echo "$SSH_KEY" > "$C15R_HOME/.ssh/authorized_keys"
chmod 700 "$C15R_HOME/.ssh"
chmod 600 "$C15R_HOME/.ssh/authorized_keys"
chown -R c15r:c15r "$C15R_HOME/.ssh"

# ============================================================
# Claude Code auth
# ============================================================
CLAUDE_TOKEN=$(aws ssm get-parameter \
  --name /workspace/claude-oauth-token \
  --with-decryption --query Parameter.Value --output text \
  --region "$REGION")

# Set for all sessions (replace if exists)
sed -i '/CLAUDE_CODE_OAUTH_TOKEN/d' /etc/environment
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
export PATH="/usr/local/bin:/usr/bin:/bin:/snap/bin:$PATH"

# Ensure Tailscale is up
tailscale status || tailscale up --hostname=claude-workspace --reset

# Ensure data volume is mounted (handles both xvdf and NVMe naming)
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
