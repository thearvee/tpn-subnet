# TPN Federated Network

Docker Compose setup for running TPN (The Privacy Network) federated nodes.

## Node Types

The TPN federated network consists of three types of nodes:

- **Validators** - Validators in the Bittensor network that set emission weights
- **Mining Pools** - Miners in the Bittensor network that allow workers to serve config files
- **Workers** - Off-chain nodes that offer VPN config files to the TPN network through mining pools

## Quick Start

The below commands assume you are inside a cloned version of the TPN repository, for example through `cd ~/tpn-subnet/federated-container`.

1. Copy the environment file and configure it:
   ```bash
   # Select the appropriate templste
   cp .env.{worker,miner,validator} .env
   # Edit .env with your specific configuration
   ```

2. Start the appropriate node type:

   **For Validators or Mining Pools:**
   ```bash
   docker-compose up -d
   ```

   **For Workers (includes WireGuard):**
   ```bash
   docker-compose --profile worker up -d
   ```

## Architecture

### Shared Components

All node types include:

- **tpn-federated**: Main application container
- **swag**: Reverse proxy with SSL/TLS termination (optional)
- **postgres**: Database for storing network state
- **watchtower**: Automatic container updates
- **autoheal**: Container health monitoring and restart

### Worker-Specific Components

Worker nodes additionally include:

- **wireguard**: VPN container for serving VPN configurations

### Networks

The setup uses three Docker networks with specific IP subnets for deterministic local request detection:

- **tpn-internal** (172.20.0.0/16): Internal connectivity only, isolated from internet
- **tpn-external** (172.21.0.0/16): Contains only the reverse proxy
- **tpn-neuron** (172.22.0.0/16): Allows neuron requests but blocks external traffic

## Configuration

### Required Environment Variables

See `.env.example` for a complete list of configuration options. Note the required and optional sections. Setting these incompletely will result in missing rewards.

## API Endpoints

### Shared endpoints

- `GET /` - Health endpoint with version and uptime
- `GET /api/countries?format=json|text&type=code|name` - list the countries available through children pools/workers
- `GET /api/stats/` - Get statistics like how many nodes there are er country and so forth
- `GET /api/lease/new?format=json|text&lease_seconds=&geo=any|countrycode&whitelist=ip1,ip2&blacklist=ip1,ip2` - Endpoint to receive a config file, this endpoint is permissioned and can for example only be called by the relevant mining pool on workers etc.
- |

### Shared Endpoints (miner + validator)

- `POST /protocol/broadcast/neurons` - Reveive data from the neuron runnin on the same machine
- `GET /protocol/stats` - Get statistics and current memory values or the running container
- `GET /protocol/stats` - TPN cache for debugging
- `GET /protocol/challenge/new` - Generate a new challenge
- `GET /protocol/challenge/:challenge` - Endpoint to get the solution to a challenge
- `GET /protocol/challenge/:challenge/:solution` - Endpoint that checks if a challenge/response pair is correct

### Validator Endpoints

- `POST /validator/broadcast/workers` - Endpoint miners use to submit their worker list to validators
- `POST /validator/broadcast/mining_pool` - Endpoint where mining pools announce their metadata to validators
- `GET /validator/score/mining_pools` - Endpoint that the neuron uses to get the latest scores of the mining pools

### Mining Pool Endpoints

- `POST /miner/broadcast/worker` - The endpoint where workers register with mining pools

## Monitoring

- Health checks are configured for critical services
- Autoheal monitors container health and restarts failed containers
- Watchtower automatically updates containers
- Check service status: `docker-compose ps`

## Troubleshooting

**Check service health:**
```bash
docker compose ps
docker inspect <container_name> --format='{{.State.Health.Status}}'
```

**View detailed logs:**
```bash
docker compose logs --tail=100 tpn-federated
```

**Test network connectivity:**
```bash
docker compose exec tpn-federated ping postgres
```

**Database connection test:**
```bash
docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT version();"
```

## Security Considerations

Note: this depends wildly on how you customise the setup

- The `tpn-internal` network is isolated from the internet
- Only the SWAG reverse proxy is exposed externally
- All inter-service communication happens over private networks
- SSL/TLS termination is handled by SWAG
- Sensitive environment variables should be properly secured

## Development

For development, you may want to build the `tpn-federated` image locally:

```bash
# If you have a Dockerfile
docker build -t tpn-federated:latest .

# Then start services
docker-compose up -d
```