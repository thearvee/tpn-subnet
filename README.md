# TPN - Tao Private Network

The TPN subnet coordinates miners that offer VPN connections in a wide variety of geographic locations.

In the TPN subnet, there are three kinds of nodes:

- **Workers**: These are easy to run nodes that provide VPN connections and get rewarded by mining pools
- **Miners**: These nodes offer the VPN connections that workers provide and are given subnet emissions, they are responsible for distributing those rewards to workers however they see fit
- **Validators**: These nodes validate the work of miners and act as an interface to end users

If you want to contribute to the TPN subnet, the easiers way to do so it to run a worker. This requires only a server and no bittensor activity at all. This page will explain how to run a worker, a miner, or a validator. Keep in mind that you should:

- Decide if you want to run a worker, miner, or a validator
- Make sure you have the necessary hardware for the worker, miner, or validator
- Running a worker is easiest, running a mining pool is harder, and running a validator is hardest

**CURRENT SUBNET STATUS**

> [!CAUTION]
> This documentation is a work in public alpha. Expect things to break. Specifically the validator instructions are currently unstable due to development pace.

## Preparing your machine

Before starting your server, please prepare your machine by setting up the required enrivonment.

### 1: Installing dependencies

Requirements:

- Linux OS (Ubuntu LTS recommended)
- 2 CPU cores
- 1-2GB RAM for a worker, 4-8GB RAM for a mining pool, 8-16GB RAM for a validator
- 10-20 GB disk space for a worker, 50GB disk space for a mining pool or validator
- Publically accessible IP address

All servers share some of the same dependencies. No matter which you choose to run, please install the dependencies by executing the following commands:

```bash
# Install the required system dependencies
sudo apt update
sudo apt install -y git
sudo apt upgrade -y # OPTIONAL, this updated system packages

# Install docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh


# Install wireguard and wireguard-tools, these are commonly preinstalled on Ubuntu
sudo apt install -y wireguard wireguard-tools
sudo modprobe wireguard

# Clone the TPN repository, it contains all the required code
cd ~
git clone https://github.com/taofu-labs/tpn-subnet.git
# Add the current user to docker for rootless docker running
if [ -z "$USER" ]; then
    USER=$(whoami)
fi
sudo groupadd docker &> /dev/null
sudo usermod -aG docker $USER
newgrp docker << EOF
    sudo service docker start
EOF
```

For miners and validators (NOT workers), you also need to install python and Bittensor components:

```bash
# Install python, node and pm2
sudo apt install -y nodejs npm python3 python3-venv python3-pip
npm install -g pm2

# Install the required python dependencies
cd tpn-subnet
python3 -m venv venv
source venv/bin/activate
pip3 install -r requirements.txt
export PYTHONPATH=.
```

### 2: Configure keys (mining pool/validator only)

The next step is to configure the Bittensor keys for your miner and/or validator. Note that these keys are stored in the `~/.bittensor` directory. You have 2 options:

1. Copy existing cold and hotkeys to `~/.bittensor`
2. Generate a new coldkey and hotkey

If you have existing keys that you are deploying, copy them in the following structure:

```bash
~/.bittensor/
├── tpn_coldkey # This directory name is how btcli knows the name of your coldkey
│   ├── coldkeypub.txt # This file contains your public coldkey, NOT THE PRIVATE KEY, the miner machine does not need the private key
|   └── hotkeys # This directory contains the private keys of your hotkeys
|       ├── tpn_hotkey # This file contains the private key of your hotkey in json format
```

If you want to generate new keys, execute the following commands:

```bash
btcli w new_coldkey --wallet.name tpn_coldkey
btcli w new_hotkey --wallet.name tpn_hotkey
``` 

Note that the above will generate a private key for your coldkey as well. This is a key with security implications and should be stored securely. Ideally you delete it from your miner server after backing it up safely.

### 3: Configure your environment

You need so set some settings so make sure your server operates how you want. This influences things like on what address you get paid and so forth.

```bash
cd tpn-subnet/federated-container
# Select the appropriate template
cp .env.{worker,miner,validator}.example .env
# Edit .env with your specific configuration
nano .env
```

Take note of the mandatory and optional sections. For miners and validators, you need to get these two external API keys:

- Make an account at https://lite.ip2location.com/. Set it as the `IP2LOCATION_DOWNLOAD_TOKEN` environment variable in the docker compose file. Add this in the specified location in the `.env` file you copied above.
- Make an account at https://www.maxmind.com and generate a license key in account settings. Add this in the specified location in the `.env` file you copied above.

## Running a worker

A worker is just a docker image with some settings.

> [!NOTE]
> Before doing this, set up your .env file correctly. See the section "3: Configure your environment"


To start the worker run:

```bash
# These lines are optional but recommended, they tell the docker container how much memory it can safely use on your system
QUARTER_OF_FREE_RAM=$(($(free -m | awk 'NR==2{print $2}') * 3 / 4))
export CONTAINER_MAX_PROCESS_RAM_MB="$QUARTER_OF_FREE_RAM"

# NOTE: this assumes you are in the tpn-subnet directory
cd tpn-subnet
docker compose -f federated-container/docker-compose.yml --profile worker up -d
```

To update your worker, run:

```bash
# Run the update script, this assumes the tpn repository is located at ~/tpn-subnet
bash ~/tpn-subnet/scripts/update_node.sh
```

> [!CAUTION]
> The update script can be customised, for details run `bash ~/tpn-subnet/scripts/update_node.sh --help`


## Running a mining pool

The miner consists out of two components:

1. A miner docker container that is managed through `docker`
2. A miner neuron that is managed through `pm2`

To start the miner docker container, three things must be done: setting up an env and starting docker. Docker will know to run as a mining pool due to your `.env` settings. 


> [!NOTE]
> Before doing this, set up your .env file correctly. See the section "3: Configure your environment"

```bash
# Copy the example .env
cd tpn-subnet
cp federated-container/.env.worker federated-container/.env

# Edit the values in there
nano .env
```

Then start docker compose like so:

```bash
# These lines are optional but recommended, they tell the docker container how much memory it can safely use on your system
QUARTER_OF_FREE_RAM=$(($(free -m | awk 'NR==2{print $2}') * 3 / 4))
export CONTAINER_MAX_PROCESS_RAM_MB="$QUARTER_OF_FREE_RAM"

# NOTE: this assumes you are in the tpn-subnet directory
docker compose -f federated-container/docker-compose.yml up -d
```

To start the miner neuron:

```bash
# NOTE: this assumes you are in the tpn-subnet director
export PYTHONPATH=. && pm2 start "python3 neurons/miner.py \
    --netuid 65 \ # 65 for mainnet, 279 for testnet
    --subtensor.network finney \ # Finney means mainnet, test means testnet
    --wallet.name tpn_coldkey \
    --wallet.hotkey tpn_hotkey \
    --logging.info \
    --axon.port 8091 \
    --blacklist.force_validator_permit" --name tpn_miner
```

### Updating your miner

The miner automatically updates some components periodically, but not all. You should regularly run the following commands to keep your miner up to date:

```bash
# Run the update script, this assumes the tpn repository is located at ~/tpn-subnet
bash ~/tpn-subnet/scripts/update_node.sh
```

> [!CAUTION]
> The update script can be customised, for details run `bash ~/tpn-subnet/scripts/update_node.sh --help`

## Running a validator

Validators are the interface between end users and miners. They send work requests to miners, which the miners complete and submit to the validator. Running a validator is more complicated than a miner and requires more setup than a miner.

### Step 1: Register the validator key on chain

You must announce your intention to run a validator on chain by running the following command:

```bash
btcli s register --wallet.name tpn_coldkey --hotkey tpn_hotkey --netuid 65 # 65 for mainnet, 279 for testnet
```

### Step 2: Configure the validator settings

The validator neuron needs you to supply a WanDB API key. You can get one by signing up at [WanDB](https://wandb.ai/site). Once you have the key, add it to your environment by running the code below:

```bash
# 🚨 Change the below to your API key
WANDB_API_KEY=xxxx

# Determine the default login shell using the SHELL env variable
shell=$(basename "$SHELL")
export_line="export WANDB_API_KEY=$WANDB_API_KEY"

# For bash: if the default shell is bash, add the export_line to ~/.bashrc if not present
if [[ "$shell" == "bash" ]]; then
  # Check if the exact export_line exists in ~/.bashrc
  if ! grep -Fxq "$export_line" ~/.bashrc; then
    echo "$export_line" >> ~/.bashrc  # Append if not found
    echo "Added '$export_line' to ~/.bashrc"
  else
    echo "'$export_line' already exists in ~/.bashrc"
  fi
fi

# For zsh: if the default shell is zsh, add the export_line to ~/.zshrc if not present
if [[ "$shell" == "zsh" ]]; then
  # Check if the exact export_line exists in ~/.zshrc
  if ! grep -Fxq "$export_line" ~/.zshrc; then
    echo "$export_line" >> ~/.zshrc  # Append if not found
    echo "Added '$export_line' to ~/.zshrc"
  else
    echo "'$export_line' already exists in ~/.zshrc"
  fi
fi

# Run the export line in the current shell
eval $export_line
```

### Step 3: Start the validator

The validator also consists out of two components:

1. A validator docker container that is managed through `docker`
2. A validator neuron that is managed through `pm2`

To start the docker container run the command below. Docker will know to run as a validator due to your `.env` settings.


> [!NOTE]
> Before doing this, set up your .env file correctly. See the section "3: Configure your environment"


```bash
# These lines are optional but recommended, they tell the docker container how much memory it can safely use on your system
QUARTER_OF_FREE_RAM=$(($(free -m | awk 'NR==2{print $2}') * 3 / 4))
export CONTAINER_MAX_PROCESS_RAM_MB="$QUARTER_OF_FREE_RAM"

# NOTE: this assumes you are in the tpn-subnet directory
docker compose -f federated-container/docker-compose.yml up -d
```

To start the validator neuron:

```bash
# NOTE: this assumes you are in the tpn-subnet director
export PYTHONPATH=. && pm2 start "python3 neurons/validator.py \
    --netuid 65 \ # 65 for mainnet, 279 for testnet
    --subtensor.network finney \ # Finney means mainnet, test means testnet
    --wallet.name tpn_coldkey \
    --wallet.hotkey tpn_hotkey \
    --logging.info \
    --axon.port 9000 \
    --neuron.vpermit 10000 \
    --force_validator_permit" --name tpn_validator
```

### Updating your validator

The validator automatically updates some components periodically, but not all. You should regularly run the following commands to keep your validator up to date:

```bash
# Run the update script, this assumes the tpn repository is located at ~/tpn-subnet
bash ~/tpn-subnet/scripts/update_node.sh
```

> [!CAUTION]
> The update script can be customised, for details run `bash ~/tpn-subnet/scripts/update_node.sh --help`
