# fundmaker-strategy-sdk

## Getting started

First, make sure you have `yarn` installed. `npm` could work too, but `yarn` is preferred for this project. Then, run the following:

```
npm install -g yarn  # install yarn if not installed
yarn install   # install dependencies
yarn generate  # generate drizzle migrations
yarn migrate   # create the local db
```

Next, you can edit `.env` and `src/config.js` to set the settings you need.

### .env example
```
UNISWAP_V3_SUBGRAPH_URL="https://gateway-arbitrum.network.thegraph.com/api/..."
```

After, you can use the commands below:

### `yarn start`

_Alias for `node src/index.js`_

Fetch the data in the period specified in the configuration file. May take some time for large periods.

### `yarn simulate`

_Alias for `node src/simulate.js`_

Simulate the position & fees for the period specified in the configuration file.
