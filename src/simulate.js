import CONFIG from "./config.js";
import {
  decodePrice,
  getTokensAmountFromDepositAmountUSD,
  getLiquidityDelta,
  estimateFee,
  calculateIL,
} from "./pool-math.js";
import { getPrices, getPoolMetadata, getAllTrades } from "./db-utils.js";
import bn from "bignumber.js";
import { mm } from "./misc-utils.js";

async function getDecodedPrices(pool, timestamp) {
  const prices = await getPrices(pool.id, timestamp);
  const price = decodePrice(prices.sqrtPriceX96, pool);
  return {
    ...prices,
    price,
  };
}

function printPosition(pool, [amount0, amount1]) {
  console.log(`Position ${pool.token0Symbol}: ${amount0}`);
  console.log(`Position ${pool.token1Symbol}: ${amount1}`);
}

export async function simulatePosition(position) {
  if (!position.amountUSD) position.amountUSD = CONFIG.DEFAULT_POS_USD;
  const p = position.invPrices ? (p) => 1 / p : (p) => p;
  let pool, open, close;

  try {
    pool = await getPoolMetadata(position.poolType, position.poolAddress);
    open = await getDecodedPrices(pool, position.openTime);
    close = await getDecodedPrices(pool, position.closeTime);
  } catch (err) {
    console.error("Failed to read local DB, please fetch the data");
    console.log(err);
    return;
  }

  const priceHigh = open.price + (open.price * position.uptickPercent) / 100;
  const priceLow = open.price - (open.price * position.downtickPercent) / 100;

  console.log("Position value (USD):", position.amountUSD);
  console.log("Entry price:", p(open.price));
  console.log("Price low, high:", ...mm(p(priceHigh), p(priceLow)));
  console.log("Token prices at open:", open.price0, open.price1);

  // Calculate initial position
  let pos = getTokensAmountFromDepositAmountUSD(
    open.price,
    priceLow,
    priceHigh,
    open.price0,
    open.price1,
    position.amountUSD
  );
  printPosition(pool, [pos.amount0, pos.amount1]);

  console.log("Calculating fees");

  // Fetch all trades within the interval
  const trades = getAllTrades(pool.id, position.openTime, position.closeTime);
  console.log(`Simulating ${trades.length} trades...`);

  let feesCollected = 0;
  let future = { ...pos };

  // Track whether the price is within the range
  let inRange = true;

  for (const trade of trades) {
    const volumeUSD = new bn(trade.amountUSD);
    if (!trade.amount0 || !trade.amount1) continue;

    // Calculate the pos trade price
    const tradePrice = decodePrice(trade.sqrtPriceX96, pool);
    // Check if the price is within the defined range
    if (tradePrice < priceLow || tradePrice > priceHigh) {
      if (inRange) {
        // If the price leaves the range, freeze the token amounts
        if (CONFIG.VERBOSE)
          console.log(
            "OUT OF RANGE:",
            tradePrice,
            future.amount0,
            future.amount1
          );
        inRange = false;
      }
    } else {
      if (!inRange) {
        if (CONFIG.VERBOSE)
          console.log("IN RANGE:", tradePrice, future.amount0, future.amount1);
        inRange = true;
      }

      const deltaL = getLiquidityDelta(
        tradePrice,
        priceLow,
        priceHigh,
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

  if (CONFIG.SHOW_SIMULATION_PROGRESS) console.log("");
  console.log("Fees collected by position (USD):", feesCollected);

  console.log("Exit price:", p(close.price));
  console.log("Token prices at close:", close.price0, close.price1);

  const { totalValueB: newValueUSD, ILPercentage } = calculateIL(
    [close.price0, close.price1],
    mm(1 / priceLow, 1 / priceHigh),
    pos.liquidityDelta,
    pos.amount0,
    pos.amount1
  );
  console.log("IL (%):", ILPercentage);
  console.log("Position value (USD):", newValueUSD);

  const totalPnL = newValueUSD - position.amountUSD;
  const totalPnLPercent = (newValueUSD / position.amountUSD - 1) * 100;
  console.log("Total PnL (USD):", totalPnL);
  console.log("Total PnL (%):", totalPnLPercent);
  console.log("-------------------");

  return totalPnLPercent;
}

//simulatePosition(CONFIG.position);
