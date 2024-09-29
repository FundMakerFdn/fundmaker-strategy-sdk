import CONFIG from "./config.js";
import {
  decodeSqrtPriceX96,
  expandDecimals,
  calculatePositionFees,
  getTokensAmountFromDepositAmountUSD,
  getLiquidityDelta,
  estimateFee,
  encodeSqrtPriceX96,
} from "./pool-math.js";
import {
  getPrices,
  getPoolMetadata,
  sumTradeVolume,
  processIntervals,
} from "./db-utils.js";
import bn from "bignumber.js";
import { mm } from "./misc-utils.js";

async function getDecodedPrices(pool, timestamp) {
  const prices = await getPrices(pool.id, timestamp);
  return {
    ...prices,
    price: +expandDecimals(
      decodeSqrtPriceX96(prices.sqrtPriceX96),
      pool.token0Decimals - pool.token1Decimals
    ),
  };
}

const encodePriceDec = (price, pool) =>
  encodeSqrtPriceX96(
    expandDecimals(price, pool.token1Decimals - pool.token0Decimals)
  );

function printPosition(pool, [amount0, amount1]) {
  console.log(`Position ${pool.token0Symbol}: ${amount0}`);
  console.log(`Position ${pool.token1Symbol}: ${amount1}`);
}

export async function simulatePosition(position) {
  const p = position.invPrices ? (p) => 1 / p : (p) => p;
  let pool, open, close;
  try {
    pool = await getPoolMetadata(position.poolType, position.poolAddress);
    open = await getDecodedPrices(pool, position.openTime);
    close = await getDecodedPrices(pool, position.closeTime);
  } catch (err) {
    console.error("Failed to read local DB, please fetch the data");
    return;
  }

  const priceHigh = open.price + (open.price * position.uptickPercent) / 100;
  const priceLow = open.price - (open.price * position.downtickPercent) / 100;

  console.log("Position value (USD):", position.amountUSD);
  console.log("Entry price:", p(open.price));
  console.log("Price low, high:", ...mm(p(priceHigh), p(priceLow)));
  console.log("Token prices at open:", open.price0, open.price1);

  // Calculate initial position
  const current = getTokensAmountFromDepositAmountUSD(
    open.price,
    priceLow,
    priceHigh,
    open.price0,
    open.price1,
    position.amountUSD
  );
  printPosition(pool, [current.amount0, current.amount1]);

  // Calculate liquidity delta
  const deltaL = getLiquidityDelta(
    open.price,
    priceLow,
    priceHigh,
    current.amount0,
    current.amount1,
    pool.token0Decimals,
    pool.token1Decimals
  );

  console.log("Calculating fees");
  const feeBlocks = await processIntervals(
    (liq, vol, feeTier) => {
      return estimateFee(deltaL, liq, vol, feeTier);
    },
    pool,
    position,
    ...mm(encodePriceDec(priceLow, pool), encodePriceDec(priceHigh, pool))
  );
  if (CONFIG.SHOW_SIMULATION_PROGRESS) console.log("");
  const feesCollected = bn.sum(...feeBlocks).toNumber();
  console.log("Fees collected by position (USD):", feesCollected);

  console.log("Exit price:", p(close.price));
  console.log("Token prices at close:", close.price0, close.price1);

  // Calculate future position
  const future = getTokensAmountFromDepositAmountUSD(
    close.price,
    priceLow,
    priceHigh,
    close.price0,
    close.price1,
    position.amountUSD + feesCollected
  );

  // Strategy A: Holding tokens
  const valueUSDToken0A = current.amount0 * close.price0;
  const valueUSDToken1A = current.amount1 * close.price1;
  const totalValueA = valueUSDToken0A + valueUSDToken1A;
  const percentageA =
    (100 * (totalValueA - position.amountUSD)) / position.amountUSD;

  // Strategy B: Providing liquidity
  const valueUSDToken0B = future.amount0 * close.price0;
  const valueUSDToken1B = future.amount1 * close.price1;
  const totalValueB = valueUSDToken0B + valueUSDToken1B + feesCollected;
  const percentageB =
    (100 * (totalValueB - position.amountUSD)) / position.amountUSD;

  // Calculate Impermanent Loss
  const IL = Math.abs(totalValueA - (valueUSDToken0B + valueUSDToken1B));
  const ILPercentage = (100 * IL) / totalValueA;

  // Calculate PnL
  const PnLBA = totalValueB - totalValueA;
  const PnL = totalValueB - position.amountUSD;

  if (CONFIG.VERBOSE) {
    console.log("Strategy A (Holding tokens):");
    console.log(`  Total value: ${totalValueA}`);
    console.log(`  Percentage change: ${percentageA}%`);

    console.log("Strategy B (Providing liquidity):");
    console.log(`  Total value: ${totalValueB}`);
    console.log(`  Percentage change: ${percentageB}%`);

    console.log(`Impermanent Loss: ${IL} (${ILPercentage}%)`);
  }
  printPosition(pool, [future.amount0, future.amount1]);
  console.log("Total PnL (USD):", PnL);
  console.log("Position value (USD):", totalValueB);
}

simulatePosition(CONFIG.position);
