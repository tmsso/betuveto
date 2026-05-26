#!/bin/bash
# OpenClaw Host Hardening - Phase 2 (Manual Execution Required)
# Run this when you have local console or stable network access.

echo "--- Starting Phase 2 Hardening ---"

# 1. Update OpenClaw to latest version
echo "Updating OpenClaw..."
openclaw update

# 2. Configure Firewall (UFW)
# CAUTION: Ensure you are on the local network (192.168.1.x)
echo "Configuring UFW firewall..."
sudo apt-get update && sudo apt-get install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 192.168.1.0/24 to any port 22 proto tcp comment 'Allow local SSH'
sudo ufw allow from 192.168.1.0/24 to any port 3000 proto tcp comment 'Allow local Web Service'

# 3. Enable Firewall
echo "Enabling firewall..."
sudo ufw --force enable

echo "--- Hardening Phase 2 Complete ---"
sudo ufw status verbose
