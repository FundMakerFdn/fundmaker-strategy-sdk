import fs from "fs";
import { program } from "commander";
import csvParser from "csv-parser";
import { createObjectCsvWriter } from "csv-writer";
import { simulatePosition } from "#src/simulate.js";
import db from "#src/database.js";
import { trades, volatility } from "#src/schema.js";
import { eq, and, gte } from "drizzle-orm";
import { findFirstMissingHourlyInterval, getPoolById } from "#src/db-utils.js";
import { fetchData } from "#src/fetcher.js";
import CONFIG from "#src/config.js";
import { decodePrice, calculateStandardDeviation } from "#src/pool-math.js";
import { fetchPool } from "../src/fetch-utils.js";

function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const rowsCSV = [];

    fs.createReadStream(filePath)
      .pipe(csvParser())
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

async function executeStrategy(db, pool, startDate, endDate, strategy) {
  let positions = [];
  let currentDate = new Date(startDate);
  const endDateTime = new Date(endDate).getTime();
  let openPosition = null;

  while (currentDate.getTime() <= endDateTime) {
    // Check for position closure first
    for (const hour of strategy.hoursCheckClose) {
      const closeCheckTime = new Date(currentDate);
      closeCheckTime.setUTCHours(hour, 0, 0, 0);

      if (closeCheckTime.getTime() > endDateTime) break;

      if (openPosition) {
        const positionAge =
          closeCheckTime.getTime() - openPosition.openTimestamp;
        const maxPositionAge = strategy.positionOpenDays * 24 * 60 * 60 * 1000;

        if (positionAge >= maxPositionAge) {
          openPosition.closeTimestamp = closeCheckTime.getTime();

          positions.push(openPosition);
          openPosition = null;
        }
      }
    }

    // Check for opening new position
    if (!openPosition) {
      for (const hour of strategy.hoursCheckOpen) {
        const checkTime = new Date(currentDate);
        checkTime.setUTCHours(hour, 0, 0, 0);

        if (checkTime.getTime() > endDateTime) break;

        const volatilityData = await getLatestDatapoint(
          db,
          volatility,
          pool.id,
          checkTime.getTime()
        );

        if (
          volatilityData &&
          parseFloat(volatilityData.realizedVolatility) >
            strategy.volatilityThreshold
        ) {
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
            openPosition = {
              openTimestamp: checkTime.getTime(),
              openPrice: openPrice,
              targetUptickPrice:
                openPrice * (1 + strategy.priceRange.uptickPercent / 100),
              targetDowntickPrice:
                openPrice * (1 - strategy.priceRange.downtickPercent / 100),
              closeTimestamp: null,
            };
            break; // Exit the loop after opening a position
          }
        }
      }
    }

    currentDate.setUTCDate(currentDate.getDate() + 1);
  }

  // Close any remaining open position
  if (openPosition) {
    openPosition.closeTimestamp = endDateTime;
    positions.push(openPosition);
  }

  let positionsSim = [];
  for (let position of positions) {
    // Simulate PnL percentage using simulatePosition
    const pnlPercent = await simulatePosition({
      poolType: pool.type,
      poolAddress: pool.address,
      openTime: new Date(position.openTimestamp),
      closeTime: new Date(position.closeTimestamp),
      uptickPercent: strategy.priceRange.uptickPercent,
      downtickPercent: strategy.priceRange.downtickPercent,
      amountUSD: strategy.amountUSD || CONFIG.DEFAULT_POS_USD,
    });
    console.log(`Closed position with PnL: ${pnlPercent}%`);
    position.pnlPercent = pnlPercent;
    positionsSim.push(position);
  }

  return positionsSim;
}

async function writeOutputCSV(results, outputFile) {
  const csvWriter = createObjectCsvWriter({
    path: outputFile,
    header: [
      "strategyName",
      "poolType",
      "poolAddress",
      "openTimestamp",
      "closeTimestamp",
      "openPrice",
      "targetUptickPrice",
      "targetDowntickPrice",
      "pnlPercent",
    ],
  });

  const records = results.flatMap((result) =>
    result.positions.map((position) => ({
      strategyName: result.strategyName,
      poolType: result.poolType,
      poolAddress: result.poolAddress,
      openTimestamp: new Date(position.openTimestamp).toISOString(),
      closeTimestamp: new Date(position.closeTimestamp).toISOString(),
      openPrice: position.openPrice,
      targetUptickPrice: position.targetUptickPrice,
      targetDowntickPrice: position.targetDowntickPrice,
      pnlPercent: position.pnlPercent,
    }))
  );

  await csvWriter.writeRecords(records);
  console.log(`Results written to ${outputFile}`);
}

async function main(opts) {
  const strategyJSON = JSON.parse(fs.readFileSync(opts.strategy, "utf8"));
  const poolsCSV = await parseCSV(opts.input);

  const results = [];

  for (const strategy of strategyJSON) {
    console.log(`Executing strategy "${strategy.strategyName}"`);
    for (const poolRow of poolsCSV) {
      if (CONFIG.VERBOSE) console.log("Pool", poolRow.poolAddress);
      const poolId = await fetchPool(poolRow.poolType, poolRow.poolAddress);
      const startDate = new Date(poolRow.startDate);
      const endDate = new Date(poolRow.endDate);

      if (opts.noChecks) {
        if (CONFIG.VERBOSE) console.log("Checking data integrity...");
        const missingData = await findFirstMissingHourlyInterval(
          poolId,
          startDate,
          endDate
        );
        if (missingData) {
          console.log("Fetching the data...");
          await fetchData({ ...poolRow, startDate, endDate });
        }
      }

      const pool = await getPoolById(poolId);

      const positions = await executeStrategy(
        db,
        pool,
        startDate,
        endDate,
        strategy
      );
      const pnlArr = positions.map((p) => p.pnlPercent);
      const avgPnL = pnlArr.reduce((a, r) => a + r, 0) / pnlArr.length;
      const sharpe = avgPnL / calculateStandardDeviation(pnlArr);
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
  // Write results to output CSV using the new function
  await writeOutputCSV(results, opts.output);

  // Log summary statistics
  results.forEach((result) => {
    console.log(
      `Strategy: ${result.strategyName}, Pool: ${result.poolAddress}`
    );
    console.log("Average PnL %:", result.avgPnL);
    console.log("Sharpe ratio:", result.sharpe);
    console.log("---");
  });
}

program
  .description(
    "Execute a strategy based on pools from the CSV file in the format of (poolType,poolAddress,startDate,endDate), and write output CSV with position history."
  )
  .requiredOption("-i, --input <inputCSV>", "input CSV filename")
  .requiredOption("-s, --strategy <strategyJSON>", "strategy JSON filename")
  .requiredOption("-o, --output <outputCSV>", "output CSV filename")
  .option("-n, --no-checks", "disable data integrity check & autofetching")
  .action(main);

program.parse(process.argv);
