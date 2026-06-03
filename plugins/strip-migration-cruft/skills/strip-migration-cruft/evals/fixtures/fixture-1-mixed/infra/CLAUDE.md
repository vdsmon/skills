# infra/

Non-compose host config. Pushed manually to target hosts.

## Critical gotchas

- **Cloud-init `cicustom user=` REPLACES Proxmox defaults** (no merge). Include `users:` block directly.
- **Scrutiny needs disk passthrough**: `/dev/sda` + `/dev/sdb` not visible to VM via virtiofs. Moved to privileged LXC 101 on `pve` (Wave 2); `disk.internal` proxies to `192.168.0.239:8085`.
- **Scrutiny disk device naming is NOT stable across reboots.** Kernel-assigned `/dev/sda`, `/dev/sdb` may swap.
