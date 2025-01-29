# Store current directory
DIR=$(pwd)

# Ask if we want to rebuild the images
read -p "Do you want to rebuild the images? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]
then
    REBUILD=true
else
    REBUILD=false
fi

# Check if the docker images exist locally
if [ "$(docker images -q sybil-validator:nightly 2> /dev/null)" = "" ]; then
    echo "💡 Validator image not found, forcing rebuild..."
    REBUILD=true
fi
if [ "$(docker images -q sybil-miner:nightly 2> /dev/null)" = "" ]; then
    echo "💡 Miner image not found, forcing rebuild..."
    REBUILD=true
fi

if [ "$REBUILD" = true ]; then

    echo "💡 Rebuilding images..."

    # Rebuild validator image
    cd validator
    docker build -t sybil-validator:nightly . --no-cache

    # Rebuild miner image
    cd ../miner
    docker build -t sybil-miner:nightly . --no-cache
fi

# Go back to the root directory
cd $DIR

# If the containers are running, stop them
echo "💡 Stopping running containers if needed..."
docker compose down

# Make sure the sqlite db exists
touch database.sqlite

# Docker compose up
docker compose up -d

# Attach to containers for logs
docker compose logs -f