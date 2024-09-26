import CONFIG from "#src/config.js";
import db from "#src/database.js";
import { pools, trades, liquidity, fee_tiers } from "#src/schema.js";
import {
  queryPoolMetadata,
  queryPoolTrades,
  queryPoolLiquidity,
  queryPoolFeeTiers,
} from "#src/graphql.js";
import { getPoolMetadata, batchInsert } from "#src/db-utils.js";

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
        feeTier: CONFIG.DYNAMIC_FEE_POOLS.includes(poolType)
          ? null
          : pool.feeTier,
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
    await batchInsert(db, liquidity, liquidityData);
  } catch (err) {
    console.error("Error saving liquidity data:", err.message);
    throw err;
  }
}

export async function fetchPool(poolType, poolAddress) {
  let poolId = (await getPoolMetadata(poolType, poolAddress))?.id;

  if (!poolId) {
    console.log(`Fetching metadata for ${poolType} pool ${poolAddress}`);
    const poolMetadata = await queryPoolMetadata(poolType, poolAddress);
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

export async function fetchDailyTrades(poolType, poolId, startDate, endDate) {
  let totalCount = 0;

  const startTimestamp = Math.floor(startDate.getTime() / 1000);
  const endTimestamp = Math.floor(endDate.getTime() / 1000);

  const trades = await queryPoolTrades(
    poolType,
    CONFIG.POOL_ADDRESS,
    startTimestamp,
    endTimestamp,
    0
  );

  const formattedTrades = trades.map((trade) => {
    return {
      pool_id: poolId,
      txid: trade.id,
      timestamp: Number(trade.timestamp) * 1000,
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

export async function fetchLiquidity(poolType, poolId, startDate, endDate) {
  const startTimestamp = Math.floor(startDate.getTime() / 1000);
  const endTimestamp = Math.floor(endDate.getTime() / 1000);

  let liquidityData = await queryPoolLiquidity(
    poolType,
    CONFIG.POOL_ADDRESS,
    startTimestamp,
    endTimestamp,
    0
  );
  liquidityData = liquidityData.map((liquidityPoint) => ({
    pool_id: poolId,
    timestamp: parseInt(liquidityPoint.periodStartUnix * 1000),
    liquidity: liquidityPoint.liquidity,
  }));

  saveLiquidityToDatabase(liquidityData, poolId);

  console.log(
    `Finished fetching liquidity for ${startDate.toISOString()} to ${endDate.toISOString()}`
  );
}

export async function saveFeeTiersToDatabase(feeTiersData, poolId) {
  try {
    await batchInsert(db, fee_tiers, feeTiersData);
  } catch (err) {
    console.error("Error saving feeTiers data:", err.message);
    throw err;
  }
}

export async function fetchFeeTiers(poolType, poolId, startDate, endDate) {
  const startTimestamp = Math.floor(startDate.getTime() / 1000);
  const endTimestamp = Math.floor(endDate.getTime() / 1000);
  let feeTiersData = await queryPoolFeeTiers(
    poolType,
    CONFIG.POOL_ADDRESS,
    startTimestamp,
    endTimestamp,
    0
  );
  feeTiersData = feeTiersData.map((hourFee) => ({
    ...hourFee,
    timestamp: Number(hourFee.timestamp) * 1000,
    pool_id: poolId,
  }));
  saveFeeTiersToDatabase(feeTiersData, poolId);
  console.log(
    `Finished fetching feeTiers for ${startDate.toISOString()} to ${endDate.toISOString()}`
  );
}
