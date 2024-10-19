import CONFIG from "./config.js";
import {
  decodePrice,
  getTokensAmountFromDepositAmountUSD,
  getLiquidityDelta,
  estimateFee,
  calculateIL,
  PRICE_MIN,
  PRICE_MAX,
} from "./pool-math.js";
import { getPrices, getPoolMetadata, getAllTrades } from "./db-utils.js";
import bn from "bignumber.js";
import { incPercent, decPercent, mm } from "./misc-utils.js";

async function getDecodedPrices(pool, timestamp) {
  const prices = await getPrices(pool.id, timestamp);
  const price = decodePrice(prices.sqrtPriceX96, pool);
  return {
    ...prices,
    price,
  };
}

const log = (...args) => CONFIG.VERBOSE && console.log(...args);

function printPosition(pool, [amount0, amount1]) {
  log(`Position ${pool.token0Symbol}: ${amount0}`);
  log(`Position ${pool.token1Symbol}: ${amount1}`);
}

function calculatePriceRange(currentPrice, pos) {
  let price = {};
  if (pos.fullRange) {
    price = {
      high: PRICE_MAX,
      low: PRICE_MIN,
    };
  } else {
    price = {
      high: incPercent(currentPrice, pos.priceRange.uptickPercent),
      low: decPercent(currentPrice, pos.priceRange.downtickPercent),
    };
  }
  let rebalance = { high: PRICE_MAX, low: PRICE_MIN };
  if (pos.rebalance) {
    rebalance = {
      high: incPercent(currentPrice, pos.rebalance.uptickPercent),
      low: decPercent(currentPrice, pos.rebalance.downtickPercent),
    };
  }
  return {
    price,
    rebalance,
  };
}

export async function simulatePosition(position) {
  if (!position.amountUSD) position.amountUSD = CONFIG.DEFAULT_POS_USD;
  const p = true ? (p) => 1 / p : (p) => p;
  let pool, open, close;

  try {
    pool = await getPoolMetadata(position.poolType, position.poolAddress);
    open = await getDecodedPrices(pool, position.openTime);
    close = await getDecodedPrices(pool, position.closeTime);
  } catch (err) {
    console.error("Failed to read local DB, please fetch the data");
    log(err);
    return;
  }

  let currentRange = calculatePriceRange(open.price, position);

  log("Position value (USD):", position.amountUSD);
  log("Entry price:", p(open.price));
  log(
    "Price low, high:",
    ...mm(p(currentRange.price.high), p(currentRange.price.low))
  );
  log(
    "Rebalance low, high:",
    ...mm(p(currentRange.rebalance.low), p(currentRange.rebalance.high))
  );
  log("Token prices at open:", open.price0, open.price1);

  // Calculate initial position
  let pos = getTokensAmountFromDepositAmountUSD(
    open.price,
    currentRange.price.low,
    currentRange.price.high,
    open.price0,
    open.price1,
    position.amountUSD
  );
  printPosition(pool, [pos.amount0, pos.amount1]);

  log("Calculating fees");

  // Fetch all trades within the interval
  const trades = getAllTrades(pool.id, position.openTime, position.closeTime);
  log(`Simulating ${trades.length} trades...`);

  let feesCollected = 0;
  let future = { ...pos };

  // Track whether the price is within the range
  let inPriceRange = true;

  for (const trade of trades) {
    const volumeUSD = new bn(trade.amountUSD);
    if (!trade.amount0 || !trade.amount1) continue;

    // Calculate the pos trade price
    const tradePrice = decodePrice(trade.sqrtPriceX96, pool);

    if (position.rebalance) {
      if (
        tradePrice < currentRange.rebalance.low ||
        tradePrice > currentRange.rebalance.high
      ) {
        log("REBALANCING", currentRange, tradePrice);
        currentRange = calculatePriceRange(tradePrice, position);
        inPriceRange = false; // to trigger deltaL recalculation
      }
    }
    if (
      tradePrice < currentRange.price.low ||
      tradePrice > currentRange.price.high
    ) {
      if (inPriceRange) {
        // If the price leaves the range, freeze the token amounts
        log("OUT OF RANGE:", tradePrice, future.amount0, future.amount1);
        inPriceRange = false;
      }
    } else {
      if (!inPriceRange) {
        log("IN RANGE:", tradePrice, future.amount0, future.amount1);
        inPriceRange = true;
      }

      const deltaL = getLiquidityDelta(
        tradePrice,
        currentRange.price.low,
        currentRange.price.high,
        pos.amount0,
        pos.amount1,
        pool.token0Decimals,
        pool.token1Decimals
      );

      const fee = estimateFee(
        deltaL,
        trade.current_liquidity,
        volumeUSD,
        trade.current_feeTier || pool.feeTier
      );

      if (isNaN(fee)) continue;

      feesCollected += fee;
    }
  }

  if (CONFIG.SHOW_SIMULATION_PROGRESS) log("");
  log("Fees collected by position (USD):", feesCollected);

  log("Exit price:", p(close.price));
  log("Token prices at close:", close.price0, close.price1);

  const { totalValueB: newValueUSD, ILPercentage } = calculateIL(
    [close.price0, close.price1],
    mm(1 / currentRange.price.low, 1 / currentRange.price.high),
    pos.liquidityDelta,
    pos.amount0,
    pos.amount1
  );
  log("IL (%):", ILPercentage);
  log("Position value (USD):", newValueUSD);

  const totalPnL = newValueUSD - position.amountUSD;
  const totalPnLPercent = (newValueUSD / position.amountUSD - 1) * 100;
  log("Total PnL (USD):", totalPnL);
  log("Total PnL (%):", totalPnLPercent);
  log("-------------------");

  return totalPnLPercent;
}

//simulatePosition(CONFIG.position);
