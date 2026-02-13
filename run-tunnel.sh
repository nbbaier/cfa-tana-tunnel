#!/bin/bash
# Deploys the tunnel config and runs cloudflared locally
# Usage: ./run-tunnel.sh

bun alchemy deploy 2>&1 | grep "cloudflared tunnel run" | bash
