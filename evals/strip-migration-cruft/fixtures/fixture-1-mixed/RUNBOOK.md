# VFIO / iGPU Passthrough Runbook (Story 28)

**Goal**: pass the Intel UHD 630 iGPU from the Proxmox host into VM 100.

**Risk tier**: HIGH. Recovery from a bad Phase 1 or Phase 2 requires console access via a Debian rescue USB.

**Status**: EXECUTED on 2026-05-07.

## Phase 1 — Enable IOMMU (low-risk, fully reversible)

Phase 1 only enables the IOMMU subsystem in the kernel. The iGPU is still owned by `i915`.

### 1.1 — Capture the iGPU PCI ID

```bash
ssh pve 'lspci -nn | grep -i VGA'
```

### 1.2 — Edit /etc/default/grub on the host

```bash
ssh pve 'sed -i "s/^GRUB_CMDLINE_LINUX_DEFAULT=.*/GRUB_CMDLINE_LINUX_DEFAULT=\"quiet intel_iommu=on iommu=pt\"/" /etc/default/grub'
```

### 1.3 — Reboot

```bash
ssh pve 'systemctl reboot'
```

## Phase 2 — Bind iGPU to vfio-pci (point of no return for console video)

Phase 2 makes the host hand the iGPU to `vfio-pci` instead of `i915` at boot.

### 2.1 — Create /etc/modprobe.d/vfio.conf

```bash
ssh pve "echo 'options vfio-pci ids=8086:9bc8' > /etc/modprobe.d/vfio.conf"
```

### 2.2 — Reboot

```bash
ssh pve 'systemctl reboot'
```

## Phase 3 — Attach iGPU to VM 100

```bash
ssh pve 'qm set 100 --hostpci0 0000:00:02.0,pcie=1'
```

Phase 3 done. Mark Story 28 complete in `docs/archive/wave-2/INDEX.md`.
