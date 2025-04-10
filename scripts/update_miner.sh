#!/bin/bash

# Update the TPN repository
cd ~/tpn-subnet
REPO_UP_TO_DATE=$(git pull 2>&1 | grep -c "Already up to date.")

# Check for update crontab
if ! crontab -l | grep -q "update_miner.sh"; then
    (crontab -l 2>/dev/null; echo "0 * * * * ~/tpn-subnet/scripts/update_miner.sh") | crontab -
fi

# Pull the latest docker images
docker compose -f node-stack/miner/miner.docker-compose.yml pull

# Restart the miner docker container
docker compose -f node-stack/miner/miner.docker-compose.yml up -d

# Restart the pm2 process
if [ "$REPO_UP_TO_DATE" -eq 0 ]; then
    echo "Repository has changes, restarting pm2 process..."
    pm2 restart tpn_miner
else
    echo "No changes in the repository, skipping pm2 restart."
fi
