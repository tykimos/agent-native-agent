#!/usr/bin/env bash
# Create an Ubuntu 24.04 Azure VM for hosting ANA. Only SSH (22) is opened; ANA is exposed via Cloudflare Tunnel.
# Usage: RG=demo-rg VM_NAME=demo-vm LOCATION=koreacentral SIZE=Standard_B2as_v2 OUT_DIR=~/ana/connect ./azure-create-vm.sh
set -euo pipefail
RG=${RG:?resource group}; VM_NAME=${VM_NAME:?vm name}
LOCATION=${LOCATION:-koreacentral}; SIZE=${SIZE:-Standard_B2as_v2}
IMAGE=${IMAGE:-Ubuntu2404}; ADMIN=${ADMIN:-azureuser}; OUT_DIR=${OUT_DIR:-$HOME/ana/connect}
mkdir -p "$OUT_DIR"
az group create -n "$RG" -l "$LOCATION" -o none
az vm create -g "$RG" -n "$VM_NAME" -l "$LOCATION" --image "$IMAGE" --size "$SIZE" \
  --admin-username "$ADMIN" --generate-ssh-keys --security-type TrustedLaunch \
  --enable-secure-boot true --enable-vtpm true --public-ip-sku Standard --nsg-rule SSH -o json > "$OUT_DIR/$VM_NAME.create.json"
IP=$(az vm show -d -g "$RG" -n "$VM_NAME" --query publicIps -o tsv)
# az --generate-ssh-keys uses ~/.ssh/id_rsa; copy to a per-VM pem for the connect note
cp ~/.ssh/id_rsa "$OUT_DIR/${VM_NAME}_key.pem" && chmod 400 "$OUT_DIR/${VM_NAME}_key.pem"
echo "VM $VM_NAME ready: ssh -i $OUT_DIR/${VM_NAME}_key.pem $ADMIN@$IP"
