# Getting started

First, make sure you have `yarn` installed. `npm` could work too, but `yarn` is preferred for this project. Then, run the following:

```
npm install -g yarn  # install yarn if not installed
yarn install   # install dependencies
yarn generate  # generate drizzle migrations
yarn migrate   # create the local db
```

Next, you can edit `.env` and `src/config.js` to set the settings you need.

## .env example
```
SUBGRAPH_API_KEY="...your 32-symbol API key..."
```

After, you can use the commands below.

## `yarn start`

_Alias for `node src/index.js`_

Fetch the data in the period specified in the configuration file. May take some time for large periods.

## `yarn simulate`

_Alias for `node src/simulate.js`_

Simulate the position & fees for the period specified in the configuration file.

## `yarn pool-finder`

_Alias for `node src/pool-finder.js`_

Find pool contract address by pair token symbols' names.

Please note that `token0` and  `token1` order matters.

```
Usage: pool-finder [options] <token0> <token1> [feeTier]

Find the pool address by token symbols, ranked by TVL.

Arguments:
  token0                 token 0 symbol, _ means any
  token1                 token 1 symbol, _ means any
  feeTier                pool fee tier

Options:
  -t, --type <poolType>  pool type - uniswapv3 | thena (default: "uniswapv3")
  -h, --help             display help for command
```

### Usage examples

1. Find a specific pool: `yarn pool-finder usdc weth 500`. Output:
```
Searching...
Search results:

Pair USDC WETH 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640
Total Value Locked (USD): $431,368,361.80
Fee tier: 500 (0.0500000%)
```

2. List all available fee tiers for the pair: `yarn pool-finder usdc weth`

3. Find all pools with USDC as token1: `yarn pool-finder _ usdc`. Output:
```
[...]

Pair DAI USDC 0x5777d92f208679db4b9778590fa3cab3ac9e2168
Total Value Locked (USD): $75,454,086.55
Fee tier: 100 (0.0100000%)

Pair WBTC USDC 0x99ac8ca7087fa4a2a1fb6357269965a2014abc35
Total Value Locked (USD): $129,145,952.24
Fee tier: 3000 (0.300000%)
```

When there are multiple pools found, they are ordered by TVL (Total Value Locked), which is read from `totalValueLockedUSD` value returned by The Graph API.

4. Use Thena instead of the default (UniswapV3): `yarn pool-finder -t thena _ wbnb`

5. List all pools ranked by TVL: `yarn pool-finder _ _`

## yarn print-pools

_Alias for `node tools/pools-csv.js -p`_

Print a CSV file of all pools in the database.

## yarn export-pools

_Alias for `node tools/pools-csv.js -e`_

Export all saved pools to a CSV file. Usage: `yarn export-pools filename.csv`.

## yarn import-pools

_Alias for `node tools/pools-csv.js -i`_

Replace all saved pools with pools from the CSV file. Usage: `yarn import-pools filename.csv`.
