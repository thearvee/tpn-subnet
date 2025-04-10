#!/bin/bash

# Check for update crontab
if ! crontab -l | grep -q "update_validator.sh"; then
    (crontab -l 2> /dev/null; echo "0 * * * * ~/tpn-subnet/scripts/update_validator.sh") | crontab -
fi

# Update the TPN repository
cd ~/tpn-subnet
REPO_UP_TO_DATE=$(git pull 2>&1 | grep -c "Already up to date.")

# Pull the latest docker images, store whether there was an update
docker compose -f node-stack/validator/validator.docker-compose.yml pull

# Restart the validator docker container
docker compose -f node-stack/validator/validator.docker-compose.yml up -d

# Restart the pm2 process
if [ "$REPO_UP_TO_DATE" -eq 0 ]; then
    echo "Repository has changes, restarting pm2 process..."
    pm2 restart tpn_validator
else
    echo "No changes in the repository, skipping pm2 restart."
fi