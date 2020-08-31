# decide-worker-node
Worker Node for the Decide Governance Engine.

## Setup

### Create .env file

In the root folder create a new file called .env and add the variables from the example below.

```
//example .env file

CHAIN_NAME=
GOV_ENGINE_ACCT=
WORKER_ACCT_NAME=
WORKER_PUB_KEY=
WORKER_PRIV_KEY=
RPC_ENDPOINT=
HYPERION_ENDPOINT=
```

- CHAIN_NAME: The blockchain network to connect to. Used for logging.

- GOV_ENGINE_ACCT: the account where the governance engine is deployed.

- WORKER_ACCT_NAME: the account executing the worker jobs.

- WORKER_PUB_KEY: the public key for the worker account.

- WORKER_PRIV_KEY: the private key for the worker account.

- RPC_ENDPOINT: The RPC API endpoint for submitting transactions.

- HYPERION_ENDPOINT: Hyperion Stream endpoint for listening to Governance Engine actions.

## Run Docker

Run the docker container by executing the dockerfile:

`docker run ...`