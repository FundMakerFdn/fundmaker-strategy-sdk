# FundMaker Strategy SDK

## Getting started

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

## `yarn strategy`

_Alias for `node tools/strategy.js`_

The main tool, which executes liquidity providing strategies on cryptocurrency pools based on historical data. It processes input from CSV files, applies defined strategies, and outputs the results.

```
Usage: strategy [options]

Execute a strategy based on pools from the CSV file in the format of (poolType,poolAddress,startDate,endDate), and write output CSV with position history.

Options:
  -i, --input <inputCSV>         input CSV filename
  -s, --strategy <strategyJSON>  strategy JSON filename
  -o, --output <outputCSV>       output CSV filename
  -n, --no-checks                disable data integrity check & autofetching
  -h, --help                     display help for command
```

### Example

Let's assume we 2 input files: `input/pools.csv`, `input/strategy.json`, which look like this:

#### `input/pools.csv`

```
poolType,poolAddress,startDate,endDate
"uniswapv3","0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640","2024-09-01","2024-09-30"
```

Notice that `startDate` defaults to the creation date of the pool, `endDate` defaults to now. You can write the data in any format supported by JavaScripts' `new Date()` constructor.

#### `input/strategy.json`

```
[
  {
    "strategyName": "Strategy 1",
    "hoursCheckOpen": [11, 21],
    "volatilityThreshold": 20,
    "hoursCheckClose": [10],
    "positionOpenDays": 3,
    "priceRange": {
      "uptickPercent": 2,
      "downtickPercent": 3
    }
  }
]
```

You can have multiple strategies in the same file, each strategy will be backtested with each pool.

#### Running `yarn strategy`

`yarn strategy -i input/pools.csv -s input/strategy.json -o output.csv`

The command above runs the backtesting system and saves the result to `output.csv`, which would contain position history, and PnL % for each position. In the end, you will see the average PnL and Sharpe ratio for each strategy.

## `yarn pool-finder`

_Alias for `node tools/pool-finder.js`_

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
