import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { program } from "commander";
import { getFirstSpotPrice, getHistIV, getPoolById } from "../src/db-utils.js";

function readCSVFiles(directoryPath) {
  const files = fs
    .readdirSync(directoryPath)
    .filter((file) => file.endsWith(".csv"));
  const allData = [];

  for (const file of files) {
    const filePath = path.join(directoryPath, file);
    const fileContent = fs.readFileSync(filePath, "utf-8");
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
    });
    allData.push({ file, records });
  }

  return allData;
}

function calculateDTE(openTimestamp, closeTimestamp) {
  const openDate = new Date(openTimestamp);
  const closeDate = new Date(closeTimestamp);
  const timeDiff = closeDate.getTime() - openDate.getTime();
  return Math.ceil((timeDiff / (1000 * 3600 * 24)) * 10) / 10;
}

async function findMaxTheta(
  pnlPercent,
  dte,
  nVega,
  nDelta,
  poolId,
  openTimestamp,
  closeTimestamp
) {
  debugger;
  const pool = await getPoolById(poolId);
  const spotSymbol = pool.type === "Thena_BSC" ? "BNBUSDT" : "ETHUSDT";

  const openSpotPrice = await getFirstSpotPrice(spotSymbol, openTimestamp);
  const closeSpotPrice = await getFirstSpotPrice(spotSymbol, closeTimestamp);
  const openIV = await getHistIV("EVIV", openTimestamp);
  const closeIV = await getHistIV("EVIV", closeTimestamp);

  if (!openSpotPrice || !closeSpotPrice || !openIV || !closeIV) {
    console.error("Missing data for findMaxTheta calculation");
    return null;
  }

  const spotPriceDiff = closeSpotPrice - openSpotPrice;
  const ivDiff = closeIV - openIV;

  const deltaPriceImpact = nDelta * spotPriceDiff;
  const vegaPriceImpact = nVega * ivDiff;

  const totalPriceImpact = deltaPriceImpact + vegaPriceImpact;

  const maxTheta = (pnlPercent - totalPriceImpact) / dte;

  return maxTheta;
}

async function processData(data, strategy) {
  const results = [];
  const { nVega, nDelta } = strategy.options;

  for (const { file, records } of data) {
    const fileResults = [];

    for (const record of records) {
      const pnlPercent = parseFloat(record.pnlPercent);
      const dte = calculateDTE(record.openTimestamp, record.closeTimestamp);

      const maxTheta = await findMaxTheta(
        pnlPercent,
        dte,
        nVega,
        nDelta,
        record.poolId,
        record.openTimestamp,
        record.closeTimestamp
      );

      fileResults.push({
        ...record,
        dte,
        maxTheta,
        nVega,
        nDelta,
      });
    }

    results.push({ file, results: fileResults });
  }

  return results;
}

function writeResults(results) {
  for (const { file, results: fileResults } of results) {
    console.log(`Results for file: ${file}`);
    console.log(JSON.stringify(fileResults, null, 2));
    console.log("-----------------------------------");
  }
}

async function main(directoryPath, strategyPath) {
  const data = readCSVFiles(directoryPath);
  const strategy = JSON.parse(fs.readFileSync(strategyPath, "utf-8"))[0];

  const results = await processData(data, strategy);

  writeResults(results);
}

program
  .description("CLI tool for options-based LP position hedging simulation")
  .requiredOption("-d, --directory <path>", "Input directory path")
  .requiredOption("-s, --strategy <path>", "Path to the strategy JSON file")
  .action(async (options) => {
    try {
      await main(options.directory, options.strategy);
    } catch (error) {
      console.error("An error occurred:", error);
    }
  });

program.parse(process.argv);
