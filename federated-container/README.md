# TPN Federated Network

Docker Compose setup for running TPN (The Privacy Network) federated nodes.

## Node Types

The TPN federated network consists of three types of nodes:

- **Validators** - Validators in the Bittensor network that set emission weights
- **Mining Pools** - Miners in the Bittensor network that allow workers to serve config files
- **Workers** - Off-chain nodes that offer VPN config files to the TPN network through mining pools

## Quick Start

1. Copy the environment file and configure it:
   ```bash
   cp .env.example .env
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
- **swag**: Reverse proxy with SSL/TLS termination
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

See `.env.example` for a complete list of configuration options.

**Essential variables:**
- `POSTGRES_PASSWORD`: Database password
- `SERVER_PUBLIC_URL`: Your public domain
- `MAXMIND_LICENSE_KEY`: For GeoIP lookups
- `IP2LOCATION_DOWNLOAD_TOKEN`: Alternative GeoIP service

**Node-specific variables:**

*Validators:*
- All shared variables

*Mining Pools:*
- `MINING_POOL_WEBSITE_URL`: Terms and conditions URL
- `MINING_POOL_REWARDS`: Reward structure description

*Workers:*
- `MINING_POOL`: IP address, UID, or 'auto'
- `PAYMENT_ADDRESS_EVM`: Ethereum-compatible address
- `PAYMENT_ADDRESS_BITTENSOR`: Bittensor wallet address

### SSL/TLS Configuration

The SWAG container handles SSL certificate generation. Configure these variables:

- `DOMAIN_NAME`: Your domain
- `EMAIL`: Email for Let's Encrypt
- `VALIDATION`: Validation method (http, dns, etc.)

## API Endpoints

### Shared Endpoints

- `POST /protocol/broadcast/miners` - Receive miner data (worker exempt)
- `POST /protocol/broadcast/validators` - Receive validator data (worker exempt)
- `GET /protocol/stats` - TPN cache for debugging
- `GET /` - Health endpoint with version and uptime

### Validator Endpoints

- `GET /api/config/new` - Get optimized worker config
- `GET /api/countries` - List available countries

### Mining Pool Endpoints

- `GET /pool/config/new` - Get worker config (validators only)
- `GET /pool/countries` - List pool's available countries

### Worker Endpoints

- `GET /worker/config/new` - Serve config files

## Management Commands

**View logs:**
```bash
docker-compose logs -f [service_name]
```

**Restart services:**
```bash
docker-compose restart [service_name]
```

**Update containers:**
```bash
docker-compose pull
docker-compose up -d
```

**Stop all services:**
```bash
docker-compose down
```

**Remove all data (careful!):**
```bash
docker-compose down -v
```

## Monitoring

- Health checks are configured for critical services
- Autoheal monitors container health and restarts failed containers
- Watchtower automatically updates containers
- Check service status: `docker-compose ps`

## Troubleshooting

**Check service health:**
```bash
docker-compose ps
docker inspect <container_name> --format='{{.State.Health.Status}}'
```

**View detailed logs:**
```bash
docker-compose logs --tail=100 tpn-federated
```

**Test network connectivity:**
```bash
docker-compose exec tpn-federated ping postgres
```

**Database connection test:**
```bash
docker-compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT version();"
```

## Security Considerations

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