import fs from "fs";
import { program } from "commander";
import csvParser from "csv-parser";
import { fetchPool } from "#src/fetch-utils.js";
import db from "#src/database.js";
import { pools, trades } from "#src/schema.js";
import { sql, eq, and, between, count } from "drizzle-orm";
import { findFirstMissingHourlyInterval } from "#src/db-utils.js";
import { fetchData } from "#src/fetcher.js";
import CONFIG from "#src/config.js";

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

async function main(opts) {
  const strategyJSON = JSON.parse(fs.readFileSync(opts.strategy, "utf8"));
  const poolsCSV = await parseCSV(opts.input);

  for (const strategy of strategyJSON) {
    console.log(`Executing strategy "${strategy.strategyName}"`);
    for (const poolRow of poolsCSV) {
      if (CONFIG.VERBOSE) console.log("Pool", poolRow.poolAddress);
      const poolId = await fetchPool(poolRow.poolType, poolRow.poolAddress);
      const startDate = new Date(poolRow.startDate);
      const endDate = new Date(poolRow.endDate);

      if (CONFIG.VERBOSE) console.log("Checking for data integrity...");
      const missingData = await findFirstMissingHourlyInterval(
        poolId,
        startDate,
        endDate
      );
      if (missingData) {
        console.log("Fetching the data...");
        await fetchData({ ...poolRow, poolId, startDate, endDate });
      }
    }
    // strategy
  }
}

program
  .description(
    "Execute a strategy based on pools from the CSV file in the format of (poolType,poolAddress,startDate,endDate), and write output CSV with position history."
  )
  .requiredOption("-i, --input <inputCSV>", "input CSV filename")
  .requiredOption("-s, --strategy <strategyJSON>", "strategy JSON filename")
  .requiredOption("-o, --output <outputCSV>", "output CSV filename")
  .action(main);

program.parse(process.argv);
