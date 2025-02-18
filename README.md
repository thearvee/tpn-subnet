# TPN - Tao Private Network

The TPN subnet coordinares miners that offer VPN connections in a wide variety of geographic locations.

In the TPN subnet, there are two kinds of nodes:

- **Miners**: These nodes offer VPN connections to users and are rewarded for their service
- **Validators**: These nodes validate the work of miners and act as an interface to end users

If you want to contribute to the TPN subnet, the easiers way to do so it to run a miner. This page will explain how to run a miner and a validator. Keep in mind that you should:

- Decide if you want to run a miner or a validator
- Make sure you have the necessary hardware for the miner or validator
- Running a miner is easier than running a validator

**CURRENT SUBNET STATUS**

The TPN is currently in bootstrap mode. This means that miners do not yet offer VPN connections, but are incentivited to get their infrastructure up and running.

## Running a miner

Note that your rewards depend on the uniqueness of the location of your miner. Once you have chosen a location, either as a hosted VPS or as physical hardware, you can start the miner.

### 1: Installing dependencies

Requirements:

- Linux OS (Ubuntu LTS recommended)
- 1 CPU core
- 512MB RAM
- Publically accessible IP address

To install the miner, start by setting up the required software. Execute the following commands:

```bash
# Install the required system dependencies
sudo apt update
sudo apt install -y git python3 python3-venv python3-pip
sudo apt upgrade -y # OPTIONAL, this updated system packages

# Install docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add the current user to docker for rootless docker running
if [ -z "$USER" ]; then
    USER=$(whoami)
fi
sudo groupadd docker || echo "Docker group already exists, proceeding"
sudo usermod -aG docker $USER
newgrp docker
sudo service docker start

# Install node and pm2
sudo apt install -y nodejs npm
npm install -g pm2

# Clone the TPN repository, it contains all the required code
git clone https://github.com/beyond-stake/tpn-subnet.git

# Install the required python dependencies
cd tpn-subnet
python3 -m venv venv
source venv/bin/activate
pip3 install -r requirements.txt
export PYTHONPATH=.

```

### 2: Configure keys

The next step is to configure the Bittensor keys for your miner. Note that these keys are stored in the `~/.bittensor` directory. You have 2 options:

1. Copy existing cold and hotkeys to `~/.bittensor`
2. Generate a new coldkey and hotkey

If you have existing keys that you are deploying, copy them in the following structure:

```bash
~/.bittensor/
├── tpn_coldkey # This directory name is how btcli knows the name of your coldkey
│   ├── coldkeypub.txt # This file contains your public coldkey, NOT THE PRIVATE KEY, the miner machine does not need the private key
|   └── hotkeys # This directory contains the private keys of your hotkeys
|       ├── hotkey # This file contains the private key of your hotkey in json format
```

If you want to generate new keys, execute the following commands:

```bash
btcli w new_coldkey --wallet.name tpn_coldkey
btcli w new_hotkey --wallet.name tpn_hotkey
``` 

Note that the above will generate a private key for your coldkey as well. This is a key with security implications and should be stored securely. Ideally you delete it from your miner server after backing it up safely.

### 3: Run the miner software stack

This consists out of two components:

1. A miner neuron that is managed through `pm2`
2. A miner docker container that is managed through `docker`

