# SSH into Workspace from iOS

Connect to the EC2 workspace host from an iPhone/iPad using Tailscale and Terminus.

## Prerequisites

- Tailscale account joined to the same tailnet as the workspace instance
- iOS device with Tailscale and Terminus installed

## 1. Install Tailscale on iOS

1. Install **Tailscale** from the App Store
2. Sign in with the same account/tailnet used for the workspace
3. Toggle the VPN on — the workspace host (`claude-workspace`) should appear in your device list

## 2. Install Terminus on iOS

1. Install **Terminus** from the App Store
2. Open Terminus and go to **Settings > Keys**

## 3. Add your SSH key

You have two connection methods:

### Option A: Tailscale SSH (recommended, no key needed)

Tailscale SSH is enabled on the host (`tailscale up --ssh`). If your Tailscale ACLs permit SSH:

1. In Terminus, create a new host:
   - **Hostname:** `claude-workspace` (Tailscale MagicDNS) or the Tailscale IP (check the Tailscale app)
   - **Username:** `ubuntu`
   - **Authentication:** None (Tailscale handles it)

> Note: Terminus may need to use the Tailscale IP address directly if MagicDNS resolution isn't working. Find it in the Tailscale iOS app under the device list.

### Option B: SSH key authentication

If Tailscale SSH ACLs aren't configured, use your ECDSA key:

1. In Terminus, go to **Settings > Keys > Add Key**
2. Paste your private key (the counterpart to the public key provisioned on the host)
3. Create a new host:
   - **Hostname:** `claude-workspace` or Tailscale IP
   - **Username:** `ubuntu`
   - **Authentication:** Select your imported key

The corresponding public key is already in `/home/ubuntu/.ssh/authorized_keys` on the host.

## 4. Connect

1. Ensure Tailscale VPN is active on your iOS device
2. Open Terminus and tap the host entry
3. You should get a shell as `ubuntu@claude-workspace`

## Troubleshooting

| Issue | Fix |
|---|---|
| Host not found | Check Tailscale is connected on both devices. Use IP instead of hostname. |
| Connection refused | Instance may be stopped. Start it via the `instance.yml` GitHub Action (workflow_dispatch > start). |
| Permission denied | Verify your key is correct, or check Tailscale SSH ACLs in the admin console. |
| Timeout | Ensure both devices are on the same tailnet. Check security group allows outbound (it does by default). |
