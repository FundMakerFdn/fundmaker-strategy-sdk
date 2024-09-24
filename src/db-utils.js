import db from "./database.js";
import { pools, trades, liquidity } from "./schema.js";
import { sql, and, eq, between } from "drizzle-orm";
import { handle } from "./misc-utils.js";
import CONFIG from "./config.js";

export const getPoolMetadata = handle(async (poolType, poolAddress) => {
  const rows = await db
    .select()
    .from(pools)
    .where(and(eq(pools.type, poolType), eq(pools.address, poolAddress)))
    .limit(1);
  return rows[0];
}, "reading pool metadata");

export const getPrice = handle(async (poolId, timestamp) => {
  const rows = await db
    .select({
      sqrtPriceX96: trades.sqrtPriceX96,
      timestamp: trades.timestamp,
    })
    .from(trades)
    .where(eq(trades.pool_id, poolId))
    .orderBy(sql`ABS(${trades.timestamp} - ${timestamp.getTime()})`) // Assuming timestamp is a Date object
    .limit(1);
  return rows[0].sqrtPriceX96;
}, "reading price from DB");

export const getLiquidityBetween = handle(
  async (poolId, startTimestamp, endTimestamp) => {
    const rows = await db
      .select({
        liquidity: liquidity.liquidity,
        timestamp: liquidity.timestamp,
      })
      .from(liquidity)
      .where(
        and(
          eq(liquidity.pool_id, poolId),
          between(
            liquidity.timestamp,
            startTimestamp.getTime(),
            endTimestamp.getTime()
          )
        )
      )
      .orderBy(liquidity.timestamp); // Order the results by timestamp

    return rows;
  },
  "fetching liquidity points between timestamps"
);

export const sumTradeVolume = handle(
  async (
    poolId,
    startTimestamp,
    endTimestamp,
    sqPriceX96Low = 0,
    sqPriceX96High = Infinity
  ) => {
    if (CONFIG.SHOW_SIMULATION_PROGRESS) process.stdout.write(".");
    const result = await db
      .select({ totalAmountUSD: sql`SUM(${trades.amountUSD})` })
      .from(trades)
      .where(
        and(
          eq(trades.pool_id, poolId),
          between(trades.timestamp, startTimestamp, endTimestamp),
          between(trades.sqrtPriceX96, sqPriceX96Low, sqPriceX96High)
        )
      );

    return result[0]?.totalAmountUSD || 0; // Return the sum or 0 if no records
  },
  "summing volume"
);

export const processIntervals = handle(
  async (calc, poolId, start, end, sqPriceX96Low, sqPriceX96High) => {
    // Fetch liquidity timestamps between the start and end
    const liquiditySteps = await getLiquidityBetween(poolId, start, end);

    if (liquiditySteps.length === 0) {
      throw new Error(
        "No liquidity steps found between the provided timestamps."
      );
    }

    // Initialize intervals, starting with the [start, first liquidity] interval
    let intervals = [];

    // Add the first interval [start, liquiditySteps[0].timestamp] only if it's valid
    if (liquiditySteps[0].timestamp > start) {
      intervals.push({
        start: start.getTime(),
        end: liquiditySteps[0].timestamp,
      });
    }

    // Add the rest of the intervals
    for (let i = 0; i < liquiditySteps.length - 1; i++) {
      intervals.push({
        start: liquiditySteps[i].timestamp,
        end: liquiditySteps[i + 1].timestamp,
      });
    }

    // Add the last interval [last liquidity timestamp, end] if it's valid
    if (liquiditySteps[liquiditySteps.length - 1].timestamp < end) {
      intervals.push({
        start: liquiditySteps[liquiditySteps.length - 1].timestamp,
        end: end.getTime(),
      });
    }

    const feeBlocks = [];

    // Process each interval
    for (const interval of intervals) {
      // Sum the trade volume in this interval
      const volume = await sumTradeVolume(
        poolId,
        interval.start,
        interval.end,
        sqPriceX96Low,
        sqPriceX96High
      );

      // If no volume was found, skip the interval
      if (!volume) continue;

      // Get the liquidity at the start of this interval
      const intervalLiq = liquiditySteps.find(
        (liq) => liq.timestamp === interval.start
      )?.liquidity;

      // Only call calc if we have both valid liquidity and volume
      if (intervalLiq != null && volume != null) {
        feeBlocks.push(calc(intervalLiq, volume));
      }
    }

    return feeBlocks;
  },
  "processing intervals"
);

export async function batchInsert(db, table, items, chunkSize = 999) {
  for (let i = 0; i < items.length; i += chunkSize) {
    await db
      .insert(table)
      .values(items.slice(i, i + chunkSize))
      .onConflictDoNothing();
  }
}
