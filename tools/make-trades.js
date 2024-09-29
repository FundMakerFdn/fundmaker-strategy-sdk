import fs from "fs";
import { program } from "commander";
import csvParser from "csv-parser";
import { fetchPool } from "#src/fetch-utils.js";
import db from "#src/database.js";
import { pools, trades } from "#src/schema.js";
import { sql, eq, and, between, count } from "drizzle-orm";
import { findFirstMissingHourlyInterval } from "#src/db-utils.js";

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
  const poolsCSV = await parseCSV(opts.input);
  for (const row of poolsCSV) {
    const poolId = await fetchPool(row.poolType, row.poolAddress);
    const startDate = new Date(row.startDate);
    const endDate = new Date(row.endDate);
    const missingData = await findFirstMissingHourlyInterval(
      poolId,
      startDate,
      endDate
    );
    if (missingData) {
      console.log(
        `Data fetching needed! Please run "yarn fetch ${opts.input}"`
      );
      return;
    }
  }
}

program
  .description(
    "Execute a strategy based on pools from the CSV file in the format of (poolType,poolAddress,startDate,endDate), and write output CSV."
  )
  .requiredOption("-i, --input <inputCSV>", "input CSV filename")
  .requiredOption("-s, --strategy <strategyJSON>", "strategy JSON filename")
  .requiredOption("-o, --output <outputCSV>", "output CSV filename")
  .action(main);

program.parse(process.argv);
