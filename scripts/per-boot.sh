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
