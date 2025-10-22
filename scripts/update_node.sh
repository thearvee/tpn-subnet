#!/bin/bash

set -euo pipefail

cleanup() {
    if [ "${stash_created:-false}" = true ] && [ "${stash_popped:-false}" != true ]; then
        echo "Cleanup: attempting to pop temporary stash."
        git -C "${TPN_DIR:-.}" stash pop >/dev/null 2>&1 || echo "Cleanup: no stash to pop or pop failed."
    fi
}

trap cleanup EXIT

# Default values for flags
TPN_DIR=~/tpn-subnet
ENABLE_AUTOUPDATE=true
FORCE_RESTART=true
stash_created=false
stash_popped=false


# RAM settings
QUARTER_OF_FREE_RAM=$(($(free -m | awk 'NR==2{print $2}') * 3 / 4))
export CONTAINER_MAX_PROCESS_RAM_MB=${CONTAINER_MAX_PROCESS_RAM_MB:-$QUARTER_OF_FREE_RAM}

# Help message
print_help() {
  echo "Usage: $0 [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  --tpn_dir=PATH               Path to the TPN repository (default: ~/tpn-subnet)"
  echo "  --enable_autoupdate=true|false  Enable or disable crontab auto-update (default: true)"
  echo "  --force_restart=true|false     Force restart regardless of repository update (default: true)"
  echo "  --pm2_process_name=NAME        Name of the pm2 process to restart"
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

# First, load the environment variables in federated-container/.env
if [ -f "$TPN_DIR/federated-container/.env" ]; then
    set -a
    . "$TPN_DIR/federated-container/.env"
    set +a
else
    echo "Warning: .env file not found in $TPN_DIR/federated-container. Exiting."
    exit 1
fi

# Run mode settings
RUN_MODE="${RUN_MODE:-}"
if [ "$RUN_MODE" != "worker" ] && [ "$RUN_MODE" != "miner" ] && [ "$RUN_MODE" != "validator" ]; then
    echo "RUN_MODE must be one of worker, miner, or validator. Current value: '$RUN_MODE'." >&2
    exit 1
fi

# Set default pm2 process name if not provided
PM2_PROCESS_NAME=${PM2_PROCESS_NAME:-tpn_$RUN_MODE}

CURRENT_BRANCH=$(git -C "$TPN_DIR" rev-parse --abbrev-ref HEAD)
# Set the image tag based on the branch
if [ "$CURRENT_BRANCH" = "development" ]; then
    export TPN_IMAGE_TAG='latest-dev'
else
    export TPN_IMAGE_TAG='latest'
fi

# Generate docker command base
DOCKER_CMD=(docker compose -f "$TPN_DIR/federated-container/docker-compose.yml")

# If run mode is worker, add --profile worker
if [ "$RUN_MODE" = "worker" ]; then
    DOCKER_CMD+=(--profile worker)
fi

# Log out run details
SERVER_PUBLIC_HOST_VALUE="${SERVER_PUBLIC_HOST:-unknown}"
SERVER_PUBLIC_PORT_VALUE="${SERVER_PUBLIC_PORT:-unknown}"
echo "Updating $RUN_MODE node on branch $CURRENT_BRANCH, configured to run at $SERVER_PUBLIC_HOST_VALUE:$SERVER_PUBLIC_PORT_VALUE"
echo -n "Command base:"
printf ' %q' "${DOCKER_CMD[@]}"
printf '\n'

# Define the command to ensure in crontab
restart_command="0 * * * * $TPN_DIR/scripts/update_node.sh --force_restart=false"

if [ "$ENABLE_AUTOUPDATE" = "true" ]; then
    # Dump crontab, fallback to empty if none exists
    existing_cron=$(crontab -l 2>/dev/null || true)
    
    # Check if restart_command already exists
    if ! echo "$existing_cron" | grep -Fq "$restart_command"; then
        # Remove any old node update entries
        new_cron=$(printf "%s" "$existing_cron" | grep -v "scripts/update_node.sh" || true)

        # Add the correct restart_command
        printf "%s\n%s\n" "$new_cron" "$restart_command" | crontab -
    fi
else
    echo "Autoupdate disabled, skipping crontab check."
fi

# Stash local changes before pulling
echo "Stashing local changes before pulling on branch $CURRENT_BRANCH."
pre_stash_ref=$(git -C "$TPN_DIR" rev-parse --verify --quiet refs/stash || true)
if git -C "$TPN_DIR" stash push -m "Stash before update on $(date)" >/dev/null 2>&1; then
    post_stash_ref=$(git -C "$TPN_DIR" rev-parse --verify --quiet refs/stash || true)
    if [ "$pre_stash_ref" != "$post_stash_ref" ]; then
        stash_created=true
    else
        echo "No changes to stash."
    fi
else
    echo "Failed to stash changes, continuing anyway."
fi

# Update the TPN repository
cd "$TPN_DIR" || exit 1
pull_output=$(git pull 2>&1)
printf "%s\n" "$pull_output"
if printf "%s\n" "$pull_output" | grep -q "Already up to date."; then
    REPO_UP_TO_DATE=1
else
    REPO_UP_TO_DATE=0
fi

# Pop the stash if it was created
if [ "$stash_created" = true ]; then
    echo "Restoring stashed changes on branch $CURRENT_BRANCH."
    if git -C "$TPN_DIR" stash pop >/dev/null 2>&1; then
        stash_popped=true
    else
        echo "Failed to pop stash, continuing anyway."
    fi
fi

# If force_restart flag is true, pretend repo is not up to date
if [ "$FORCE_RESTART" = "true" ]; then
    echo "Force restart enabled, treating repository as changed."
    REPO_UP_TO_DATE=0
fi

# Pull the latest docker images
"${DOCKER_CMD[@]}" pull

# Restart the node docker container if needed
if [ "$REPO_UP_TO_DATE" -eq 0 ]; then
    echo "Repository has changes, force restarting docker process..."
    "${DOCKER_CMD[@]}" down
    echo "Pruning unused images..."
    docker image prune -f || echo "Failed to prune unused images."
    echo "Pruning unused networks..."
    docker network prune -f || echo "Failed to prune unused networks."
else
    echo "No changes in the repository, no need to force restart docker."
fi

# Bring node back up
"${DOCKER_CMD[@]}" up -d

# Restart the pm2 process if needed, only for non worker nodes
if [ "$RUN_MODE" != "worker" ]; then
    if [ "$REPO_UP_TO_DATE" -eq 0 ]; then
        echo "Repository has changes, restarting pm2 process $PM2_PROCESS_NAME..."
        pm2 restart "$PM2_PROCESS_NAME"
    else
        echo "No changes in the repository, skipping pm2 restart."
    fi
else
    echo "pm2 not relevant in worker mode, skipping pm2 restart."
fi

echo -e "\n✅ Update completed successfully"