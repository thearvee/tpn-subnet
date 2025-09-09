# Manual testing instructions

This doc details how to test the federated stack in different modes.

Requirements:

- 3 publically accessible (VPS) servers
- [nvm](https://github.com/nvm-sh/nvm) installed

## Setup

Clone the repo and set it to the right branch:

```
BRANCH='feature/tpn-federated'
cd
git clone https://github.com/taofu-labs/tpn-subnet.git
cd tpn-subnet/federated-container
git checkout "$BRANCH"
```

Set up the right `.env` file and make sure to:

- Set `CI_VALIDATOR_IP_OVERRIDES` and `CI_MINER_IP_OVERRIDES` to a comma separated list or single ip of the other boxes
- Set `POSTGRES_HOST=localhost`
- Do not set any `MOCK_` response values, requests should be real

```
# note that miner is called pool (to prevent confusion to operators in prod)
type=worker|pool|validator
cp ".env.$type.example" ".env"

# Do not add any `MOCK_' values, use the ip addresses of the other boxes where relevand as miners/validators
echo "CI_MODE=true" >> ".env"
nano ".env"
```

Install the dependencies:

```
nvm install && nvm use && npm i
```

## Start stack

On each box run the following:

- worker: `docker compose -f docker-compose.yml -f docker-compose.ci.yml up -d postgres wireguard`
- miner/validator: `docker compose -f docker-compose.yml -f docker-compose.ci.yml up -d postgres` 

Then run the relevant npm start command, note that this will auto-pull changes you push to the branch, and will reload them into the node stack when changes are detected.

```
npm run start:worker|miner|validator
```

## Testing

There are two testing flows:

1. Just wait and look at the logs, this will show you if the daemons are calling and handling requests correctly. Influence this using `DAEMON_INTERVAL_SECONDS`.
2. Run testing suites: `npm run test:worker|miner|validator`
