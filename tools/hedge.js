import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { program } from "commander";
import { getFirstSpotPrice, getHistIV, getPoolById } from "#src/db-utils.js";
import CONFIG from "#src/config.js";

function log(message) {
  if (CONFIG.VERBOSE) {
    console.log(message);
  }
}

function determineGreeksDirection(optionType, moneyness, spotPriceDiff) {
  let deltaDirection = 1;
  let vegaDirection = 1;

  if (optionType === "call") {
    deltaDirection = 1;
  } else if (optionType === "put") {
    deltaDirection = -1;
  }

  if (moneyness === "ITM") {
    if (
      (optionType === "call" && spotPriceDiff > 0) ||
      (optionType === "put" && spotPriceDiff < 0)
    ) {
      vegaDirection = -1;
    }
  } else if (moneyness === "OTM") {
    if (
      (optionType === "call" && spotPriceDiff < 0) ||
      (optionType === "put" && spotPriceDiff > 0)
    ) {
      vegaDirection = -1;
    }
  }

  return { deltaDirection, vegaDirection };
}

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
  closeTimestamp,
  optionType,
  moneyness
) {
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

  log(`${spotSymbol} spot price difference: ${spotPriceDiff}`);
  log(`IV difference: ${ivDiff}`);

  const { deltaDirection, vegaDirection } = determineGreeksDirection(
    optionType,
    moneyness,
    spotPriceDiff
  );

  log(`Delta direction: ${deltaDirection}`);
  log(`Vega direction: ${vegaDirection}`);

  const deltaPriceImpact = nDelta * spotPriceDiff * deltaDirection;
  const vegaPriceImpact = nVega * ivDiff * vegaDirection;

  log(`Delta price impact: ${deltaPriceImpact}`);
  log(`Vega price impact: ${vegaPriceImpact}`);

  const totalPriceImpact = deltaPriceImpact + vegaPriceImpact;

  log(`Total price impact: ${totalPriceImpact}`);

  const maxTheta = (pnlPercent - totalPriceImpact) / dte;

  log(`Calculated max theta: ${maxTheta}`);

  return maxTheta;
}

async function processData(data, strategy) {
  const results = [];

  for (const { file, records } of data) {
    log(`Processing file: ${file}`);
    const fileResults = [];

    for (const record of records) {
      log(`Processing record: ${JSON.stringify(record)}`);
      const pnlPercent = parseFloat(record.pnlPercent);
      const dte = calculateDTE(record.openTimestamp, record.closeTimestamp);

      log(`PNL Percent: ${pnlPercent}`);
      log(`DTE: ${dte}`);

      const optionResults = await Promise.all(
        strategy.options.map(async (option, index) => {
          log(`Processing option ${index + 1}`);
          const { nVega, nDelta, optionType, moneyness } = option;
          log(
            `Option details: nVega=${nVega}, nDelta=${nDelta}, type=${optionType}, moneyness=${moneyness}`
          );

          const maxTheta = await findMaxTheta(
            pnlPercent,
            dte,
            nVega,
            nDelta,
            record.poolId,
            record.openTimestamp,
            record.closeTimestamp,
            optionType,
            moneyness
          );

          log(`Calculated max theta for option ${index + 1}: ${maxTheta}`);

          return {
            maxTheta,
            nVega,
            nDelta,
            optionType,
            moneyness,
          };
        })
      );

      fileResults.push({
        ...record,
        dte,
        options: optionResults,
      });
    }

    results.push({ file, results: fileResults });
  }

  return results;
}

function writeResults(results) {
  for (const { file, results: fileResults } of results) {
    console.log(`Results for file: ${file}`);
    for (const result of fileResults) {
      console.log(`Position Details:`);
      console.log(`  Pool Type: ${result.poolType}`);
      console.log(`  PNL: ${result.pnlPercent}%`);
      console.log(`  DTE: ${result.dte}`);
      console.log("Options:");
      result.options.forEach((option, index) => {
        console.log(`  Option ${index + 1}:`);
        console.log(`    Max Theta: ${option.maxTheta}`);
        console.log(`    nVega: ${option.nVega}`);
        console.log(`    nDelta: ${option.nDelta}`);
        console.log(`    Option Type: ${option.optionType}`);
        console.log(`    Moneyness: ${option.moneyness}`);
      });
      console.log("-----------------------------------");
    }
    console.log("\n");
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
