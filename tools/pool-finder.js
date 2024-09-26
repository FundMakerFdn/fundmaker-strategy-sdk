import db from "#src/database.js";
import { pools } from "#src/schema.js";
import { queryPoolAddress } from "#src/graphql.js";
import fs from "fs";
import { program } from "commander";
import { Parser } from "@json2csv/plainjs";
import { formatUSD } from "#src/misc-utils.js";
import { getFeeTierPercentage } from "#src/pool-math.js";

async function findPool(token0, token1, feeTier) {
  const symbol0 = token0.toUpperCase();
  const symbol1 = token1.toUpperCase();

  const poolType = this.opts().type;

  console.log("Searching...");
  const pools = await queryPoolAddress(poolType, symbol0, symbol1, feeTier);
  console.log("Search results:");
  for (const pool of pools) {
    console.log("\nCA:", pool.id);
    console.log(
      "Total Value Locked (USD):",
      formatUSD(pool.totalValueLockedUSD)
    );
    console.log(
      `Fee tier: ${pool.feeTier} (${getFeeTierPercentage(pool.feeTier) * 100}%)`
    );
  }
  console.log();
}

program
  .description("Find the pool address by token symbols")
  .option("-t, --type <poolType>", "pool type - uniswapv3 | thena", "uniswapv3")
  .argument("<token0>", "token 0 symbol")
  .argument("<token1>", "token 1 symbol")
  .argument("[feeTier]", "pool fee tier")
  .action(findPool);

program.parse(process.argv);
