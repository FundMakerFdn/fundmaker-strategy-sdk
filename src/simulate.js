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

function calcPrices(trade) {
  return {
    ...trade,
    price0: Math.abs(+trade.amountUSD / +trade.amount0),
    price1: Math.abs(+trade.amountUSD / +trade.amount1),
  };
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
    return null;
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

  let positions = [];
  let currentPosition = {
    poolType: position.poolType,
    poolAddress: position.poolAddress,
    openTimestamp: position.openTime.getTime(),
    openPrice: open.price,
    amountUSD: position.amountUSD,
    feesCollected: 0,
  };

  let inPriceRange = true;
  let lastTradeTimestamp = 0;

  for (let trade of trades) {
    if (trade.timestamp >= position.closeTime.getTime()) {
      break; // Stop if we've reached or passed the strategy end timestamp
    }

    trade = calcPrices(trade);
    const volumeUSD = new bn(trade.amountUSD);
    if (!trade.amount0 || !trade.amount1) continue;

    const tradePrice = decodePrice(trade.sqrtPriceX96, pool);

    // Prevent creating positions with the same timestamp
    if (trade.timestamp <= lastTradeTimestamp) {
      continue;
    }
    lastTradeTimestamp = trade.timestamp;

    if (position.rebalance) {
      if (
        tradePrice < currentRange.rebalance.low ||
        tradePrice > currentRange.rebalance.high
      ) {
        log("REBALANCING", currentRange, tradePrice);

        // Close current position
        currentPosition.closeTimestamp = trade.timestamp;
        currentPosition.closePrice = tradePrice;
        const { totalValueB: newValueUSD, ILPercentage } = calculateIL(
          [trade.price0, trade.price1],
          mm(1 / currentRange.price.low, 1 / currentRange.price.high),
          pos.liquidityDelta,
          pos.amount0,
          pos.amount1
        );
        currentPosition.ILPercentage = ILPercentage;
        currentPosition.pnlPercent =
          (newValueUSD / currentPosition.amountUSD - 1) * 100;
        positions.push(currentPosition);

        // Open new position
        currentRange = calculatePriceRange(tradePrice, position);
        pos = getTokensAmountFromDepositAmountUSD(
          tradePrice,
          currentRange.price.low,
          currentRange.price.high,
          trade.price0,
          trade.price1,
          position.amountUSD
        );
        currentPosition = {
          poolType: position.poolType,
          poolAddress: position.poolAddress,
          openTimestamp: trade.timestamp,
          openPrice: tradePrice,
          amountUSD: position.amountUSD,
          feesCollected: 0,
        };
        inPriceRange = true;
      }
    }

    if (
      tradePrice < currentRange.price.low ||
      tradePrice > currentRange.price.high
    ) {
      if (inPriceRange) {
        log("OUT OF RANGE:", tradePrice, pos.amount0, pos.amount1);
        inPriceRange = false;
      }
    } else {
      if (!inPriceRange) {
        log("IN RANGE:", tradePrice, pos.amount0, pos.amount1);
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

      if (!isNaN(fee)) {
        currentPosition.feesCollected += fee;
      }
    }
  }

  // Close the last position if it's still open
  if (currentPosition.closeTimestamp === undefined) {
    currentPosition.closeTimestamp = position.closeTime.getTime();
    currentPosition.closePrice = close.price;
    const { totalValueB: newValueUSD, ILPercentage } = calculateIL(
      [close.price0, close.price1],
      mm(1 / currentRange.price.low, 1 / currentRange.price.high),
      pos.liquidityDelta,
      pos.amount0,
      pos.amount1
    );
    currentPosition.ILPercentage = ILPercentage;
    currentPosition.pnlPercent =
      (newValueUSD / currentPosition.amountUSD - 1) * 100;
    positions.push(currentPosition);
  }

  if (CONFIG.SHOW_SIMULATION_PROGRESS) log("");
  log("Positions:", positions.length);
  positions.forEach((pos, index) => {
    log(`Position ${index + 1}:`);
    log("  Open timestamp:", new Date(pos.openTimestamp).toISOString());
    log("  Close timestamp:", new Date(pos.closeTimestamp).toISOString());
    log("  Open price:", pos.openPrice);
    log("  Close price:", pos.closePrice);
    log("  Fees collected (USD):", pos.feesCollected);
    log("  IL (%):", pos.ILPercentage);
    log("  PnL (%):", pos.pnlPercent);
    log("-------------------");
  });

  return positions;
}

//simulatePosition(CONFIG.position);
