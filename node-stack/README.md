# Node stack

This folder contains the code for the miner and validator docker images.

In order to run it locally (for development purposes), make a `.env` based on the `.env.example`, then you can use the following command:

```bash
bash start.sh
```

This will start the miner and validator containers in a shared docker network. You can call the miner API at `http://localhost:3001` and the validator API at `http://localhost:3000`.

The endpoints of the containers are documented in the `miner` and `validator` folders.

## Testing if everything works

Start the containers with the command above, and then run:

```bash
cd miner
npn ci
npm run test
```

The tests should succeed.