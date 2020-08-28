# decide-worker-node
Worker Node for the Decide Governance Engine.

## Setup

### Create .env file

In the root folder create a new file called .env and add the variables from the example below.

```
//example .env file

WORKER_ACCT_NAME=
WORKER_PUB_KEY=
WORKER_PRIV_KEY=
CHAIN_NAME=
RPC_ENDPOINT=
HYPERION_ENDPOINT=
```

## Run Docker

Run the docket container by executing the dockerfile:

`docker run ...`