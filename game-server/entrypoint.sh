#!/bin/bash
# Custom entrypoint wrapper for the PZ game server.
# Runs configure-server.sh to apply .env settings, then launches the original init.

# Apply server configuration from environment variables
bash /home/steam/configure-server.sh

# Run the original init script
exec ./init.sh
