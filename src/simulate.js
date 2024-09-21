import CONFIG from "./config.js";
import {
  decodeSqrtPriceX96,
  expandDecimals,
  calculatePositionFees,
  getTokensAmountFromDepositAmountUSD,
  getLiquidityDelta,
  estimateFee,
} from "./uniswap-math.js";
import {
  getPrice,
  getPoolMetadata,
  sumTradeVolume,
  processIntervals,
} from "./db-utils.js";
import bn from "bignumber.js";
import { mm } from "./misc-utils.js";

async function getDecodedPrice(pool, timestamp) {
  return expandDecimals(
    decodeSqrtPriceX96(await getPrice(pool.id, timestamp)),
    pool.token0Decimals - pool.token1Decimals
  );
}

function printPosition(pool, [amount0, amount1]) {
  console.log(`Position ${pool.token0Symbol}: ${amount0}`);
  console.log(`Position ${pool.token1Symbol}: ${amount1}`);
}

export async function simulatePosition(position) {
  const p = position.invPrices ? (p) => 1 / p : (p) => p;
  const pool = await getPoolMetadata(position.poolAddress);

  const openPrice = position.openPrice
    ? p(position.openPrice)
    : await getDecodedPrice(pool, position.openTime);

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

  const feeBlocks = await processIntervals(
    (liq, vol) => {
      return estimateFee(deltaL, liq, vol, pool.feeTier);
    },
    pool.id,
    position.openTime,
    position.closeTime
  );

  const feesCollected = bn.sum(...feeBlocks).toNumber();

  console.log("Fees collected by position (USD):", feesCollected);

  const newAmountUSD = position.amountUSD + feesCollected;
  console.log("Position value at closeTime (USD):", newAmountUSD);

  const closePrice = position.closePrice
    ? p(position.closePrice)
    : await getDecodedPrice(pool, position.closeTime);

  console.log("Exit price:", p(closePrice));

  const { amount0: newAmount0, amount1: newAmount1 } =
    getTokensAmountFromDepositAmountUSD(
      closePrice,
      ...mm(p(position.priceHigh), p(position.priceLow)),
      1,
      1 / closePrice,
      newAmountUSD
    );

  printPosition(pool, [newAmount0, newAmount1]);
}

simulatePosition(CONFIG.position);
