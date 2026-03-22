# Workspace EC2 Instance

Remote development environment running on AWS EC2, accessible via Tailscale VPN.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  AWS eu-west-2                                      │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  EC2: t3.medium (Ubuntu 24.04 LTS)            │  │
│  │                                               │  │
│  │  /dev/sda1  — 30 GB gp3 (root, encrypted)    │  │
│  │  /dev/xvdf  — 100 GB gp3 (data, encrypted)   │  │
│  │               mounted at /home/ubuntu/work    │  │
│  │                                               │  │
│  │  Software: Node 22, Docker, Claude Code       │  │
│  │  Network:  Tailscale (outbound only, no SG    │  │
│  │            inbound rules)                     │  │
│  │  Auth:     OpenSSH + authorized_keys          │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  SSM Parameter Store                                │
│  ├─ /workspace/tailscale-auth-key                   │
│  └─ /workspace/claude-oauth-token                   │
└─────────────────────────────────────────────────────┘
         │
         │ Tailscale WireGuard tunnel (outbound-initiated)
         │
    ┌────┴────┐
    │  Your   │  SSH as `ubuntu` via Tailscale hostname
    │ device  │  claude-workspace.<tailnet>.ts.net
    └─────────┘
```

## Prerequisites

Before deploying, store two secrets in SSM Parameter Store (eu-west-2):

```bash
# Tailscale auth key (generate at https://login.tailscale.com/admin/settings/keys)
aws ssm put-parameter \
  --name /workspace/tailscale-auth-key \
  --type SecureString \
  --value "tskey-auth-..." \
  --region eu-west-2

# Claude Code OAuth token
aws ssm put-parameter \
  --name /workspace/claude-oauth-token \
  --type SecureString \
  --value "<token>" \
  --region eu-west-2
```

## Deploy

```bash
npm run cdk -- deploy WorkspaceEc2Stack --region eu-west-2
```

This creates the EC2 instance, attaches the data volume, and runs `scripts/user-data.sh` which provisions all software and joins the Tailscale network.

## Connecting via SSH

### From any SSH client (Terminus, Blink, terminal)

```
Host:  claude-workspace.<your-tailnet>.ts.net
User:  ubuntu
Auth:  ECDSA key matching the public key in user-data.sh
Port:  22 (default)
```

The Tailscale app must be running on your connecting device to resolve the hostname.

### SSH config (optional, for terminal use)

```ssh-config
Host workspace
  HostName claude-workspace.<your-tailnet>.ts.net
  User ubuntu
  IdentityFile ~/.ssh/id_ecdsa
```

Then: `ssh workspace`

## How Access Works

1. **Network layer** — Tailscale creates a WireGuard tunnel between your device and the instance. The security group has zero inbound rules; all connectivity goes through Tailscale's encrypted mesh.
2. **SSH layer** — OpenSSH on the instance authenticates using the ECDSA public key provisioned in `/home/ubuntu/.ssh/authorized_keys` by `user-data.sh`.
3. **No Tailscale SSH** — The `--ssh` flag is intentionally omitted from `tailscale up`. Tailscale provides the network only; OpenSSH handles authentication. This ensures compatibility with any standard SSH client.

## SSM Parameters

| Parameter | Purpose | Rotation |
|-----------|---------|----------|
| `/workspace/tailscale-auth-key` | Joins instance to tailnet on first boot | Replace in SSM, then reprovision or run `tailscale up` manually |
| `/workspace/claude-oauth-token` | Claude Code authentication | Refreshed automatically on each reboot by `workspace-boot.service` |

## Data Volume

The 100 GB data volume at `/home/ubuntu/work` has `removalPolicy: RETAIN` — it survives stack destruction. This is where persistent work should live.

If the instance is replaced (e.g., instance type change), the volume must be manually reattached or a new volume created. The user-data script handles formatting (only if unformatted) and mounting automatically.

## Per-Boot Service

`workspace-boot.service` runs on every boot and:
- Ensures Tailscale is connected
- Mounts the data volume if not already mounted
- Refreshes the Claude Code token from SSM

Logs: `journalctl -u workspace-boot.service`

## Reprovisioning

User-data only runs on **first boot**. To re-run provisioning:

```bash
# Option 1: Terminate and redeploy (data volume is retained)
npm run cdk -- deploy WorkspaceEc2Stack --region eu-west-2

# Option 2: Run via SSM on a live instance
aws ssm send-command \
  --instance-ids <instance-id> \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["bash /var/lib/cloud/instance/scripts/part-001"]' \
  --region eu-west-2
```

## Managing SSH Keys

The authorized key is in `scripts/user-data.sh`. To add or rotate keys:

1. Edit the `SSH_KEY` variable (or add additional keys) in `user-data.sh`
2. Redeploy the stack, or SSH in and edit `/home/ubuntu/.ssh/authorized_keys` directly for immediate effect

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `aws: command not found` during provision | SSM uses minimal PATH | Fixed — script exports PATH and installs AWS CLI v2 |
| SSH "end of file" after auth methods | Tailscale SSH intercepting connection | Fixed — `--ssh` flag removed from `tailscale up` |
| Can't resolve `claude-workspace.*.ts.net` | Tailscale not running on your device | Start the Tailscale app |
| SSH "Permission denied (publickey)" | Wrong user or key mismatch | Connect as `ubuntu`, verify key matches |
| Data volume not mounted after replace | New instance, old volume in different AZ | Snapshot volume, create in new AZ, reattach |

---

## Addendum: Migrating to Tailscale SSH

The current setup uses OpenSSH with a static key for simplicity. If Tailscale proves to be a reliable and permanent part of the stack, migrating to Tailscale SSH is recommended for stronger security and simpler key management.

### What Tailscale SSH changes

- **Auth model shifts** from SSH keys to Tailscale identity. Your device's Tailscale login is your credential — no keys to manage, rotate, or lose.
- **Access control** moves to Tailscale ACLs (centralized, auditable) instead of per-instance `authorized_keys` files.
- **Short-lived certificates** replace long-lived SSH keys under the hood.

### Migration steps

1. **Add SSH ACLs** in the Tailscale admin console (`Access Controls`):

   ```json
   {
     "ssh": [
       {
         "action": "accept",
         "src":    ["autogroup:member"],
         "dst":    ["tag:workspace"],
         "users":  ["ubuntu"]
       }
     ]
   }
   ```

2. **Tag the node** — update `tailscale up` to advertise a tag:

   ```bash
   tailscale up --auth-key="$TS_AUTH_KEY" --hostname=claude-workspace --advertise-tags=tag:workspace --ssh
   ```

3. **Keep OpenSSH as fallback** — don't remove the authorized key. If Tailscale's control plane is unreachable, you can still SSH via the instance's public IP (add a temporary SG rule) or use SSM Session Manager.

4. **Remove the hardcoded key** from `user-data.sh` once confident (optional, reduces attack surface).

### When to migrate

Consider migrating when:
- You've been using Tailscale for 2+ weeks without connectivity issues
- You want to add additional devices without editing `authorized_keys`
- You want to grant temporary access to collaborators via Tailscale sharing

### Trade-offs to evaluate

| | OpenSSH (current) | Tailscale SSH (future) |
|---|---|---|
| **Key management** | Manual — key in script | None — identity-based |
| **Multi-device** | Add each key to script | Any tailnet device works |
| **Revocation** | Edit authorized_keys | Remove from tailnet (instant) |
| **Dependency** | OpenSSH only | Tailscale control plane |
| **Offline access** | Works with public IP + SG rule | Requires Tailscale connectivity |
| **Client support** | Any SSH client | Any SSH client (Tailscale is transparent) |
| **Audit trail** | SSH logs only | Tailscale admin + SSH logs |
