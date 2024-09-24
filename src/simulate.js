import CONFIG from "./config.js";
import {
  decodeSqrtPriceX96,
  expandDecimals,
  calculatePositionFees,
  getTokensAmountFromDepositAmountUSD,
  getLiquidityDelta,
  estimateFee,
  encodeSqrtPriceX96,
  calculateImpermanentLoss,
} from "./pool-math.js";
import {
  getPrice,
  getPoolMetadata,
  sumTradeVolume,
  processIntervals,
} from "./db-utils.js";
import bn from "bignumber.js";
import { mm } from "./misc-utils.js";

async function getDecodedPriceAt(pool, timestamp) {
  return expandDecimals(
    decodeSqrtPriceX96(await getPrice(pool.id, timestamp)),
    pool.token0Decimals - pool.token1Decimals
  );
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
  const pool = await getPoolMetadata(position.poolType, position.poolAddress);

  const openPrice = position.openPrice
    ? p(position.openPrice)
    : await getDecodedPriceAt(pool, position.openTime);

  console.log("Position value (USD):", position.amountUSD);
  // when print, invert the price again to
  // show the user the expected format
  console.log("Entry price:", p(openPrice));

  const { amount0, amount1 } = getTokensAmountFromDepositAmountUSD(
    openPrice,
    ...mm(p(position.priceHigh), p(position.priceLow)),
    1,
    1 / openPrice,
    position.amountUSD
  );

  printPosition(pool, [amount0, amount1]);

  const deltaL = getLiquidityDelta(
    openPrice,
    ...mm(p(position.priceHigh), p(position.priceLow)),
    amount0,
    amount1,
    pool.token0Decimals,
    pool.token1Decimals
  );

  console.log("openTime:", position.openTime);
  console.log("closeTime:", position.closeTime);
  console.log("Calculating fees");

  const feeBlocks = await processIntervals(
    (liq, vol) => {
      return estimateFee(deltaL, liq, vol, pool.feeTier);
    },
    pool.id,
    position.openTime,
    position.closeTime,
    ...mm(
      encodePriceDec(p(position.priceLow), pool),
      encodePriceDec(p(position.priceHigh), pool)
    )
  );

  // print new line after the dots
  if (CONFIG.SHOW_SIMULATION_PROGRESS) console.log("");

  const feesCollected = bn.sum(...feeBlocks).toNumber();

  console.log("Fees collected by position (USD):", feesCollected);

  const closePrice = position.closePrice
    ? p(position.closePrice)
    : await getDecodedPriceAt(pool, position.closeTime);

  console.log("Exit price:", p(closePrice));

  const impermanentLoss = calculateImpermanentLoss(closePrice, openPrice);
  const newAmountUSD =
    position.amountUSD * (1 + impermanentLoss) + feesCollected;

  console.log(
    "Impermanent loss (%):",
    // Display with 0.01% precision
    Math.round(impermanentLoss * 100 * 100) / 100
  );
  console.log("Position value after IL (USD):", newAmountUSD);

  const { amount0: newAmount0, amount1: newAmount1 } =
    getTokensAmountFromDepositAmountUSD(
      closePrice,
      ...mm(p(position.priceHigh), p(position.priceLow)),
      1,
      1 / closePrice,
      newAmountUSD
    );

  printPosition(pool, [newAmount0, newAmount1]);

  const diffAmount = newAmountUSD - position.amountUSD;
  console.log("Total PnL (USD):", diffAmount);
}

simulatePosition(CONFIG.position);
