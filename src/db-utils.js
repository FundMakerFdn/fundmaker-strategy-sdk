import db from "./database.js";
import { pools, trades, liquidity, fee_tiers } from "./schema.js";
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

export const getTableBetween = async (
  table,
  poolId,
  startTimestamp,
  endTimestamp
) => {
  const rows = await db
    .select()
    .from(table)
    .where(
      and(
        eq(table.pool_id, poolId),
        between(
          table.timestamp,
          startTimestamp.getTime(),
          endTimestamp.getTime()
        )
      )
    )
    .orderBy(table.timestamp);

  return rows;
};

export const getLiquidityBetween = handle(
  async (...args) => getTableBetween(liquidity, ...args),
  "fetching liquidity points between timestamps"
);
export const getFeeTiersBetween = handle(
  async (...args) => getTableBetween(fee_tiers, ...args),
  "fetching fee tiers between timestamps"
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

    return result[0]?.totalAmountUSD || 0;
  },
  "summing volume"
);

export const processIntervals = handle(
  async (calc, pool, pos, sqPriceX96Low, sqPriceX96High) => {
    // Fetch liquidity timestamps between the start and end
    const liquiditySteps = await getLiquidityBetween(
      pool.id,
      pos.openTime,
      pos.closeTime
    );
    const feeTierSteps = await getFeeTiersBetween(
      pool.id,
      pos.openTime,
      pos.closeTime
    );

    if (liquiditySteps.length === 0) {
      throw new Error(
        "No liquidity steps found between the provided timestamps."
      );
    }

    // Initialize intervals, starting with the [pos.openTime, first liquidity] interval
    let intervals = [];

    // Add the first interval [pos.openTime, liquiditySteps[0].timestamp] only if it's valid
    if (liquiditySteps[0].timestamp > pos.openTime) {
      intervals.push({
        start: pos.openTime.getTime(),
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

    // Add the last interval [last liquidity timestamp, pos.closeTime] if it's valid
    if (liquiditySteps[liquiditySteps.length - 1].timestamp < pos.closeTime) {
      intervals.push({
        start: liquiditySteps[liquiditySteps.length - 1].timestamp,
        end: pos.closeTime.getTime(),
      });
    }

    const hourlyReturns = [];

    // Process each interval
    for (const interval of intervals) {
      // Sum the trade volume in this interval
      const volume = await sumTradeVolume(
        pool.id,
        interval.start,
        interval.end,
        sqPriceX96Low,
        sqPriceX96High
      );

      if (!volume) continue;

      const intervalLiq = liquiditySteps.find(
        (liq) => liq.timestamp === interval.start
      )?.liquidity;

      let intervalFeeTier;
      if (CONFIG.DYNAMIC_FEE_POOLS.includes(pool.type)) {
        intervalFeeTier = feeTierSteps.find(
          (row) => row.timestamp === interval.start
        )?.feeTier;
      } else {
        intervalFeeTier = pool.feeTier;
      }

      if (intervalLiq != null && volume != null) {
        hourlyReturns.push(calc(intervalLiq, volume, intervalFeeTier));
      }
    }

    return hourlyReturns;
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
