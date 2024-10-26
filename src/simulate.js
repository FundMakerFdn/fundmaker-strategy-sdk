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


export async function simulateLP(posConfig) {
  if (!posConfig.amountUSD) posConfig.amountUSD = CONFIG.DEFAULT_POS_USD;
  const p = true ? (p) => 1 / p : (p) => p;
  let pool, open, close;

  try {
    pool = await getPoolMetadata(posConfig.poolType, posConfig.poolAddress);
    open = await getDecodedPrices(pool, posConfig.openTime);
    close = await getDecodedPrices(pool, posConfig.closeTime);
  } catch (err) {
    console.error("Failed to read local DB, please fetch the data");
    log(err);
    return null;
  }

  let currentRange = calculatePriceRange(open.price, posConfig);

  log("Position value (USD):", posConfig.amountUSD);
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
    posConfig.amountUSD
  );
  printPosition(pool, [pos.amount0, pos.amount1]);

  log("Calculating fees");

  // Fetch all trades within the interval
  const trades = getAllTrades(pool.id, posConfig.openTime, posConfig.closeTime);
  log(`Simulating ${trades.length} trades...`);

  let positions = [];
  let currentPosition = {
    poolType: posConfig.poolType,
    poolAddress: posConfig.poolAddress,
    openTimestamp: posConfig.openTime.getTime(),
    openPrice: open.price,
    amountUSD: posConfig.amountUSD,
    feesCollected: 0,
  };

  let inPriceRange = true;
  let lastTradeTimestamp = 0;

  for (let trade of trades) {
    if (trade.timestamp >= posConfig.closeTime.getTime()) {
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

    if (posConfig.rebalance) {
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
        currentRange = calculatePriceRange(tradePrice, posConfig);
        pos = getTokensAmountFromDepositAmountUSD(
          tradePrice,
          currentRange.price.low,
          currentRange.price.high,
          trade.price0,
          trade.price1,
          posConfig.amountUSD
        );
        currentPosition = {
          poolType: posConfig.poolType,
          poolAddress: posConfig.poolAddress,
          openTimestamp: trade.timestamp,
          openPrice: tradePrice,
          amountUSD: posConfig.amountUSD,
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
    currentPosition.closeTimestamp = posConfig.closeTime.getTime();
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

  // If trading is enabled in the strategy, simulate trading positions
  if (posConfig.trading?.enabled) {
    const tradingPositions = await simulateTrading(trades, posConfig, currentPosition, pool);
    // Remove this line that concatenates the positions
    // positions = positions.concat(tradingPositions);
    
    if (CONFIG.SHOW_SIMULATION_PROGRESS) log("");
    log("LP Positions:", positions.length);
    log("Trading Positions:", tradingPositions.length);
    
    // Log positions separately
    positions.forEach((pos, index) => {
      log(`LP Position ${index + 1}:`);
      logLPPosition(pos);
    });
    
    tradingPositions.forEach((pos, index) => {
      log(`Trading Position ${index + 1}:`);
      logTradingPosition(pos);
    });

    return {
      lpPositions: positions,
      tradingPositions
    };
  }

  // If trading is not enabled, just return LP positions
  return {
    lpPositions: positions,
    tradingPositions: []
  };
}

// Helper function to reduce code duplication
function logLPPosition(pos) {
  log("  Open timestamp:", new Date(pos.openTimestamp).toISOString());
  log("  Close timestamp:", new Date(pos.closeTimestamp).toISOString());
  log("  Price:", pos.openPrice || pos.price);

    log("  Fees collected (USD):", pos.feesCollected);
    log("  IL (%):", pos.ILPercentage);
    log("  PnL (%):", pos.pnlPercent);

  log("-------------------");
}

//simulateLP(CONFIG.position);

// Pure helper functions
function calcTokenGains(initial, current) {
  return {
    token0Amount: current.token0Amount - initial.token0Amount,
    token1Amount: current.token1Amount - initial.token1Amount
  };
}

function calcPnLPercents(initial, current, prices) {
  const initialUSD = initial.token0Amount * prices.price0 + initial.token1Amount * prices.price1;
  const currentUSD = current.token0Amount * prices.price0 + current.token1Amount * prices.price1;

  return {
    pnlPercentToken0: initial.token0Amount ? ((current.token0Amount / initial.token0Amount) - 1) * 100 : 0,
    pnlPercentToken1: initial.token1Amount ? ((current.token1Amount / initial.token1Amount) - 1) * 100 : 0, 
    pnlPercentUSD: ((currentUSD / initialUSD) - 1) * 100
  };
}

async function simulateTrading(trades, posConfig, initialPosition, pool) {
  const positions = [];
  const tradingConfig = posConfig.trading;
  const entryPrice = decodePrice(trades[0].sqrtPriceX96, pool);
  
  let currentPosition = null;
  const longTakeProfit = entryPrice * (1 + tradingConfig.longTakeProfitPercent/100);
  const shortTakeProfit = entryPrice * (1 + tradingConfig.shortTakeProfitPercent/100);

  for (let trade of trades) {
    if (trade.amountUSD < CONFIG.MIN_TRADE_USD) continue;
    const currentPrice = decodePrice(trade.sqrtPriceX96, pool);
    const prices = calcPrices(trade);

    // Check if we need to close existing position
    if (currentPosition) {
      let shouldClose = false;
      if (currentPosition.type === 'long' && currentPrice >= currentPosition.takeProfit) {
        shouldClose = true;
      } else if (currentPosition.type === 'short' && currentPrice <= currentPosition.takeProfit) {
        shouldClose = true;
      }

      if (shouldClose) {
        const pnlPercent = currentPosition.type === 'long' 
          ? ((currentPrice / currentPosition.entryPrice) - 1) * 100
          : ((currentPosition.entryPrice / currentPrice) - 1) * 100;
        
        const exitAmount = currentPosition.entryAmount * (1 + pnlPercent/100);
        
        positions.push({
          ...currentPosition,
          closeTimestamp: trade.timestamp,
          closePrice: currentPrice,
          pnlPercent,
          pnlUSD: exitAmount - currentPosition.entryAmount
        });
        
        currentPosition = null;
      }
    }

    // Open new position if conditions are met
    if (!currentPosition) {
      if (currentPrice > entryPrice) {
        currentPosition = {
          type: 'long',
          openTimestamp: trade.timestamp,
          openPrice: currentPrice,
          entryPrice: currentPrice,
          entryAmount: initialPosition.amountUSD,
          takeProfit: currentPrice * (1 + tradingConfig.longTakeProfitPercent/100)
        };
      } else if (currentPrice < shortTakeProfit) {
        currentPosition = {
          type: 'short',
          openTimestamp: trade.timestamp,
          openPrice: currentPrice,
          entryPrice: currentPrice,
          entryAmount: initialPosition.amountUSD,
          takeProfit: currentPrice * (1 + tradingConfig.shortTakeProfitPercent/100)
        };
      }
    }
  }

  // Close any remaining position at last trade
  if (currentPosition) {
    const lastTrade = trades[trades.length - 1];
    const lastPrice = decodePrice(lastTrade.sqrtPriceX96, pool);
    
    const pnlPercent = currentPosition.type === 'long'
      ? ((lastPrice / currentPosition.entryPrice) - 1) * 100
      : ((currentPosition.entryPrice / lastPrice) - 1) * 100;
    
    const exitAmount = currentPosition.entryAmount * (1 + pnlPercent/100);

    positions.push({
      ...currentPosition,
      closeTimestamp: lastTrade.timestamp,
      closePrice: lastPrice,
      pnlPercent,
      pnlUSD: exitAmount - currentPosition.entryAmount
    });
  }

  return positions;
}

function logTradingPosition(pos) {
  log("  Type:", pos.type);
  log("  Open timestamp:", new Date(pos.openTimestamp).toISOString());
  log("  Close timestamp:", new Date(pos.closeTimestamp).toISOString());
  log("  Open price:", pos.openPrice);
  log("  Close price:", pos.closePrice);
  log("  Entry amount:", pos.entryAmount);
  log("  PnL (%):", pos.pnlPercent);
  log("  PnL (USD):", pos.pnlUSD);
  log("-------------------");
}
