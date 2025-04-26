#!/bin/bash

# Default values for flags
TPN_DIR=~/tpn-subnet
ENABLE_AUTOUPDATE=false
FORCE_RESTART=true
PM2_PROCESS_NAME=tpn_validator

# Help message
print_help() {
  echo "Usage: $0 [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  --tpn_dir=PATH               Path to the TPN repository (default: ~/tpn-subnet)"
  echo "  --enable_autoupdate=true|false  Enable or disable crontab auto-update (default: false)"
  echo "  --force_restart=true|false     Force restart regardless of repository update (default: true)"
  echo "  --pm2_process_name=NAME        Name of the pm2 process to restart (default: tpn_validator)"
  echo "  --help                         Show this help message and exit"
  exit 0
}

# Parse command-line arguments
for arg in "$@"; do
  case $arg in
    --tpn_dir=*)
      TPN_DIR="${arg#*=}"
      shift
      ;;
    --enable_autoupdate=*)
      ENABLE_AUTOUPDATE="${arg#*=}"
      shift
      ;;
    --force_restart=*)
      FORCE_RESTART="${arg#*=}"
      shift
      ;;
    --pm2_process_name=*)
      PM2_PROCESS_NAME="${arg#*=}"
      shift
      ;;
    --help|-h)
      print_help
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Use --help to see available options."
      exit 1
      ;;
  esac
done

# Check for TPN repository
if [ ! -d "$TPN_DIR" ]; then
    echo "TPN repository not found at $TPN_DIR. Please clone it first."
    exit 1
fi

# Optionally check/add crontab entry if autoupdate is enabled
if [ "$ENABLE_AUTOUPDATE" = "true" ]; then
    if ! crontab -l | grep -q "$TPN_DIR/scripts/update_validator.sh"; then
        (crontab -l 2>/dev/null; echo "0 * * * * $TPN_DIR/scripts/update_validator.sh") | crontab -
    fi
else
    echo "Autoupdate disabled, skipping crontab check."
fi

# Update the TPN repository
cd "$TPN_DIR" || exit 1
REPO_UP_TO_DATE=$(git pull 2>&1 | grep -c "Already up to date.")

# If force_restart flag is true, pretend repo is not up to date
if [ "$FORCE_RESTART" = "true" ]; then
    echo "Force restart enabled, treating repository as changed."
    REPO_UP_TO_DATE=0
fi

# Pull the latest docker images
docker compose -f node-stack/validator/validator.docker-compose.yml pull

# Restart the validator docker container if needed
if [ "$REPO_UP_TO_DATE" -eq 0 ]; then
    echo "Repository has changes, force restarting docker process..."
    docker compose -f node-stack/validator/validator.docker-compose.yml down
    echo "Pruning unused images..."
    docker image prune -f || echo "Failed to prune unused images."
    echo "Pruning unused networks..."
    docker network prune -f || echo "Failed to prune unused networks."
else
    echo "No changes in the repository, no need to force restart docker."
fi

# Bring validator back up
docker compose -f node-stack/validator/validator.docker-compose.yml up -d

# Restart the pm2 process if needed
if [ "$REPO_UP_TO_DATE" -eq 0 ]; then
    echo "Repository has changes, restarting pm2 process $PM2_PROCESS_NAME..."
    pm2 restart "$PM2_PROCESS_NAME"
else
    echo "No changes in the repository, skipping pm2 restart."
fi
