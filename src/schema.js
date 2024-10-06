import {
  sqliteTable,
  integer,
  text,
  uniqueIndex,
  foreignKey,
  check,
} from "drizzle-orm/sqlite-core";

export const pools = sqliteTable("pools", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull().default("uniswapv3"), // uniswapv3 | thena
  address: text("address").notNull().unique(),
  token0Symbol: text("token0Symbol").notNull(),
  token1Symbol: text("token1Symbol").notNull(),
  token0Decimals: integer("token0Decimals").notNull(),
  token1Decimals: integer("token1Decimals").notNull(),
  feeTier: text("feeTier"),
});

export const trades = sqliteTable("trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  txid: text("txid").notNull(),
  timestamp: integer("timestamp").notNull(),
  pool_id: integer("pool_id").references(() => pools.id),
  amount0: text("amount0").notNull(),
  amount1: text("amount1").notNull(),
  amountUSD: text("amountUSD").notNull(),
  sqrtPriceX96: integer("sqrtPriceX96").notNull(),
  tick: text("tick").notNull(),
});

export const liquidity = sqliteTable(
  "liquidity",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    pool_id: integer("pool_id")
      .references(() => pools.id)
      .notNull(),
    timestamp: integer("timestamp").notNull(),
    liquidity: integer("liquidity").notNull(),

    // Add composite unique constraint on (pool_id, timestamp)
  },
  (table) => {
    return {
      liquidityUniquePoolIdTimestamp: uniqueIndex(
        "liquidity_unique_pool_id_timestamp"
      ).on(table.pool_id, table.timestamp),
    };
  }
);
export const fee_tiers = sqliteTable(
  "fee_tiers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    pool_id: integer("pool_id")
      .references(() => pools.id)
      .notNull(),
    timestamp: integer("timestamp").notNull(),
    feeTier: integer("feeTier").notNull(),

    // Add composite unique constraint on (pool_id, timestamp)
  },
  (table) => {
    return {
      feeTiersUniquePoolIdTimestamp: uniqueIndex(
        "fee_tiers_unique_pool_id_timestamp"
      ).on(table.pool_id, table.timestamp),
    };
  }
);

export const volatility = sqliteTable(
  "volatility",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    pool_id: integer("pool_id")
      .references(() => pools.id)
      .notNull(),
    timestamp: integer("timestamp").notNull(),
    realizedVolatility: text("realizedVolatility").notNull(),

    // Add composite unique constraint on (pool_id, timestamp)
  },
  (table) => {
    return {
      volatilityUniquePoolIdTimestamp: uniqueIndex(
        "volatility_unique_pool_id_timestamp"
      ).on(table.pool_id, table.timestamp),
    };
  }
);
