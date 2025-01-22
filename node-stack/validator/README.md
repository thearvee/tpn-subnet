# Sybil network validator stack

## Running in docker

Docker run:

```bash
docker run \
    -p 3000:3000 \
    -e LOG_LEVEL=info \
    -e MAXMIND_LICENSE_KEY="" \
    -e PUBLIC_URL="http://localhost:3000" \
    -v "$(pwd)/database.sqlite:/app/database.sqlite" \
    sybil-network:nightly
```

Docker compose:

```yaml
version: '3.7'
services:
    sybil-network:
        image: sybil-network:nightly
        ports:
            - "3000:3000"
        # You may also create a .env file in the same folder as the docker-compose.yml file
        environment:
            LOG_LEVEL: info
            MAXMIND_LICENSE_KEY:
            PUBLIC_URL: "http://localhost:3000"
        volumes:
            - ./database.sqlite:/app/database.sqlite
```
## Development

Required variables in `.env` file:

```bash
# .env
LOGLEVEL=info,warn,error
MAXMIND_LICENSE_KEY= # Make a free account on maxmind.com and generate a license key in account settings
PUBLIC_URL= # The URL where the app is hosted, may be an ip or domain based url starting with http:// or https://
```

Building docker file:

```docker build -t sybil-network:nightly . --no-cache```