import fs from "fs";
import path from "path";
import { program } from "commander";
import { parse, format } from "fast-csv";
import { simulatePosition } from "#src/simulate.js";
import db from "#src/database.js";
import { trades } from "#src/schema.js";
import { eq, and, gte } from "drizzle-orm";
import { getHistIV } from "#src/db-utils.js";
import {
  checkLiquidityIntegrity,
  getPoolById,
  getPoolMetadata,
} from "#src/db-utils.js";
import { fetchData } from "#src/fetcher.js";
import CONFIG from "#src/config.js";
import {
  decodePrice,
  calculateStandardDeviation,
  PRICE_MIN,
  PRICE_MAX,
} from "#src/pool-math.js";
import { fetchPool } from "#src/fetch-utils.js";

// Function to read CSV file using fast-csv
function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const rowsCSV = [];
    fs.createReadStream(filePath)
      .pipe(parse({ headers: true }))
      .on("data", (row) => rowsCSV.push(row))
      .on("error", (err) => {
        reject(`Error reading file ${filePath}: ${err}`);
      })
      .on("end", () => {
        resolve(rowsCSV);
      });
  });
}

async function getLatestDatapoint(db, table, poolId, timestamp) {
  const result = await db
    .select()
    .from(table)
    .where(and(eq(table.pool_id, poolId), gte(table.timestamp, timestamp)))
    .orderBy(table.timestamp, "asc")
    .limit(1)
    .execute();

  return result.length > 0 ? result[0] : null;
}

async function getLatestIV(timestamp) {
  return await getHistIV("EVIV", timestamp);
}

async function executeStrategy(db, pool, startDate, endDate, strategy) {
  let positions = [];
  let currentDate = new Date(startDate);
  const endDateTime = new Date(endDate).getTime();
  let openPositions = [];

  while (currentDate.getTime() <= endDateTime) {
    // Check for position closure first
    for (const hour of strategy.hoursCheckClose) {
      const closeCheckTime = new Date(currentDate);
      closeCheckTime.setUTCHours(hour, 0, 0, 0);

      if (closeCheckTime.getTime() > endDateTime) break;

      openPositions = openPositions.filter((position) => {
        const positionAge = closeCheckTime.getTime() - position.openTimestamp;
        const maxPositionAge = strategy.positionOpenDays * 24 * 60 * 60 * 1000;

        if (positionAge >= maxPositionAge) {
          position.closeTimestamp = closeCheckTime.getTime();
          positions.push(position);
          return false;
        }
        return true;
      });
    }

    // Check for opening new positions
    for (const hour of strategy.hoursCheckOpen) {
      const checkTime = new Date(currentDate);
      checkTime.setUTCHours(hour, 0, 0, 0);

      if (checkTime.getTime() > endDateTime) break;

      // Check if we should open a new position based on onePosPerPool
      if (strategy.onePosPerPool && openPositions.length > 0) {
        const lastOpenPosition = openPositions[openPositions.length - 1];
        const timeSinceLastOpen =
          checkTime.getTime() - lastOpenPosition.openTimestamp;
        const maxPositionAge = strategy.positionOpenDays * 24 * 60 * 60 * 1000;

        if (timeSinceLastOpen < maxPositionAge) {
          //console.log("Skipping new position due to onePosPerPool strategy");
          continue;
        }
      }

      const ivData = await getLatestIV(checkTime.getTime());

      if (ivData && parseFloat(ivData) > strategy.volatilityThreshold) {
        console.log("Entering position, IV:", ivData);
        const tradeData = await getLatestDatapoint(
          db,
          trades,
          pool.id,
          checkTime.getTime()
        );

        if (tradeData) {
          const openPrice = parseFloat(
            decodePrice(tradeData.sqrtPriceX96, pool)
          );
          const newPosition = {
            openTimestamp: checkTime.getTime(),
            openPrice: openPrice,
            targetUptickPrice:
              openPrice * (1 + strategy.priceRange.uptickPercent / 100),
            targetDowntickPrice:
              openPrice * (1 - strategy.priceRange.downtickPercent / 100),
            closeTimestamp: null,
          };
          openPositions.push(newPosition);
        }
      }
    }

    currentDate.setUTCDate(currentDate.getDate() + 1);
  }

  // Close any remaining open positions
  for (let position of openPositions) {
    position.closeTimestamp = endDateTime;
    positions.push(position);
  }

  let positionsSim = [];
  for (let position of positions) {
    // Simulate position using simulatePosition
    const simulationResults = await simulatePosition({
      poolType: pool.type,
      poolAddress: pool.address,
      openTime: new Date(position.openTimestamp),
      closeTime: new Date(position.closeTimestamp),
      priceRange: strategy?.priceRange,
      rebalance: strategy?.rebalance,
      fullRange: strategy?.priceRange?.fullRange,
      amountUSD: strategy.amountUSD || CONFIG.DEFAULT_POS_USD,
      positionOpenDays: strategy.positionOpenDays,
    });

    if (simulationResults) {
      console.log(`Simulated ${simulationResults.length} positions`);
      positionsSim.push(...simulationResults);
    }
  }

  return positionsSim;
}

// Writing CSV output using fast-csv
async function writeOutputCSV(results, outputDir) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (const result of results) {
    const { strategyName, poolType, poolAddress, positions } = result;
    const pool = await getPoolMetadata(poolType, poolAddress);
    const token0 = pool.token0Symbol;
    const token1 = pool.token1Symbol;

    let increment = 1;
    let fileName;
    let filePath;

    do {
      fileName = `${strategyName}_${token0}${token1}_${pool.id}_${poolType}_${increment}.csv`;
      filePath = path.join(outputDir, fileName);
      increment++;
    } while (fs.existsSync(filePath));

    const csvStream = format({ headers: true });
    const writableStream = fs.createWriteStream(filePath);

    csvStream.pipe(writableStream);

    positions.forEach((position) => {
      csvStream.write({
        poolType: position.poolType,
        poolAddress: position.poolAddress,
        openTimestamp: new Date(position.openTimestamp).toISOString(),
        closeTimestamp: new Date(position.closeTimestamp).toISOString(),
        openPrice: position.openPrice,
        closePrice: position.closePrice,
        amountUSD: position.amountUSD,
        feesCollected: position.feesCollected,
        ILPercentage: position.ILPercentage,
        pnlPercent: position.pnlPercent,
      });
    });

    csvStream.end();

    console.log(`Results written to ${filePath}`);
  }
}

async function main(opts) {
  const strategyJSON = JSON.parse(fs.readFileSync(opts.strategy, "utf8"));
  const poolsCSV = await parseCSV(opts.input);

  const results = [];

  for (const strategy of strategyJSON) {
    console.log(`Executing strategy "${strategy.strategyName}"`);
    for (const poolRow of poolsCSV) {
      console.log("Pool", poolRow.poolType, poolRow.poolAddress);
      const poolId = await fetchPool(poolRow.poolType, poolRow.poolAddress);
      const pool = await getPoolById(poolId);

      const startDate = poolRow.startDate
        ? new Date(poolRow.startDate)
        : new Date(pool.created);
      const endDate = poolRow.endDate ? new Date(poolRow.endDate) : new Date();

      if (opts.checks) {
        console.log("Checking data integrity...");
        let didFetch;
        if (endDate !== null) {
          didFetch = await checkLiquidityIntegrity(poolId, startDate, endDate);
        } else didFetch = false;
        if (!didFetch) {
          console.log("Fetching the data...");
          await fetchData({ ...poolRow, poolId, startDate, endDate });
        }
      }

      const positions = await executeStrategy(
        db,
        pool,
        startDate,
        endDate,
        strategy
      );
      const pnlArr = positions.map((p) => p.pnlPercent);
      const avgPnL = pnlArr.reduce((a, r) => a + r, 0) / pnlArr.length;
      const std = calculateStandardDeviation(pnlArr);
      const sharpe = std !== 0 ? avgPnL / std : 0;
      results.push({
        strategyName: strategy.strategyName,
        poolType: poolRow.poolType,
        poolAddress: poolRow.poolAddress,
        positions: positions,
        avgPnL,
        sharpe,
      });
    }
  }

  // Write results to output CSVs using fast-csv
  await writeOutputCSV(results, opts.output);

  // Log summary statistics
  results.forEach((result) => {
    console.log(
      `Strategy: ${result.strategyName}, Pool: ${result.poolAddress}`
    );
    console.log("Total positions:", result.positions.length);
    console.log("Average PnL %:", result.avgPnL);
    console.log("Sharpe ratio:", result.sharpe);
    console.log("---");
  });
}

program
  .description(
    "Execute a strategy based on pools from the CSV file in the format of (poolType,poolAddress,startDate,endDate), and write output CSVs with position history."
  )
  .requiredOption("-i, --input <inputCSV>", "input CSV filename")
  .requiredOption("-s, --strategy <strategyJSON>", "strategy JSON filename")
  .option("-o, --output <outputDir>", "output directory", "output/")
  .option("-n, --no-checks", "disable data integrity check & autofetching")
  .action(main);

program.parse(process.argv);
