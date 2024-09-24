import CONFIG from "#src/config.js";
import db from "#src/database.js";
import { pools, trades, liquidity } from "#src/schema.js";
import { eq } from "drizzle-orm";
import {
  queryPoolMetadata,
  queryPoolTrades,
  queryPoolLiquidity,
} from "./uniswapv3/graphql.js";
import { getPoolMetadata, batchInsert } from "#src/db-utils.js";
import { handle } from "#src/misc-utils.js";

// Function to save pool metadata
export async function savePoolMetadata(poolType, pool) {
  try {
    const rows = await db
      .insert(pools)
      .values({
        token0Symbol: pool.token0.symbol,
        token1Symbol: pool.token1.symbol,
        token0Decimals: pool.token0.decimals,
        token1Decimals: pool.token1.decimals,
        type: poolType,
        address: pool.id,
        feeTier: pool.feeTier, // Saving the feeTier in the pool table
      })
      .onConflictDoNothing()
      .returning();

    const row = rows[0];

    console.log(`Saved metadata for ${row.token0Symbol}/${row.token1Symbol}:`);

    return row.id;
  } catch (err) {
    console.error("Error saving pool metadata:", err.message);
    throw err;
  }
}

// Function to save trades to the database
export async function saveTradesToDatabase(tradesData, poolId) {
  try {
    await batchInsert(db, trades, tradesData);
  } catch (err) {
    console.error("Error saving trades:", err.message);
    throw err;
  }
}

export async function saveLiquidityToDatabase(liquidityData, poolId) {
  try {
    await batchInsert(
      db,
      liquidity,
      liquidityData.map((liquidityPoint) => ({
        pool_id: poolId,
        timestamp: parseInt(liquidityPoint.periodStartUnix * 1000),
        liquidity: liquidityPoint.liquidity,
      }))
    );
  } catch (err) {
    console.error("Error saving liquidity data:", err.message);
    throw err;
  }
}

export async function fetchPool(poolType, poolAddress) {
  let poolId = (await getPoolMetadata(poolType, poolAddress))?.id;

  if (!poolId) {
    console.log(`Fetching metadata for ${poolType} pool ${poolAddress}`);
    const poolMetadata = await queryPoolMetadata(poolAddress);
    if (poolMetadata) {
      poolId = await savePoolMetadata(poolType, poolMetadata);
      if (!poolId) {
        console.error(
          `Failed to save pool metadata for ${poolType} pool ${poolAddress}`
        );
        return;
      }
    }
  }
  return poolId;
}

// Main function to fetch and store daily trades and liquidity
export async function fetchDailyTrades(poolId, startDate, endDate) {
  let totalCount = 0;

  const startTimestamp = Math.floor(startDate.getTime() / 1000);
  const endTimestamp = Math.floor(endDate.getTime() / 1000);

  const trades = await queryPoolTrades(
    CONFIG.POOL_ADDRESS,
    startTimestamp,
    endTimestamp,
    0
  );

  const formattedTrades = trades.map((trade) => {
    return {
      pool_id: poolId,
      txid: trade.id,
      timestamp: parseInt(trade.timestamp) * 1000,
      amount0: trade.amount0,
      amount1: trade.amount1,
      amountUSD: trade.amountUSD,
      sqrtPriceX96: trade.sqrtPriceX96,
      tick: trade.tick,
    };
  });

  await saveTradesToDatabase(formattedTrades, poolId);
  totalCount += trades.length;

  console.log(
    `Fetched ${trades.length} trades. Total since launch: ${totalCount}`
  );

  console.log(
    `Finished fetching trades for ${startDate.toISOString()} to ${endDate.toISOString()}`
  );
}

// Helper function to fetch and store liquidity for a given pool
export async function fetchLiquidity(poolId, startDate, endDate) {
  const startTimestamp = Math.floor(startDate.getTime() / 1000);
  const endTimestamp = Math.floor(endDate.getTime() / 1000);

  const liquidityData = await queryPoolLiquidity(
    CONFIG.POOL_ADDRESS,
    startTimestamp,
    endTimestamp,
    0
  );

  saveLiquidityToDatabase(liquidityData, poolId);

  console.log(
    `Finished fetching liquidity for ${startDate.toISOString()} to ${endDate.toISOString()}`
  );
}
