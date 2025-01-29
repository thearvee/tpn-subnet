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

if [ "$REBUILD" = true ]; then

    # Rebuild validator image
    cd validator
    docker build -t sybil-validator:nightly . --no-cache

    # Rebuild miner image
    cd ../miner
    docker build -t sybil-miner:nightly . --no-cache
fi

# Go back to the root directory
cd $DIR

# Make sure the sqlite db exists
touch database.sqlite

# Docker compose up
docker compose up -d

# Attach to containers for logs
docker compose logs -f