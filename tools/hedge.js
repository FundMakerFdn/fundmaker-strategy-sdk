import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { program } from "commander";
import db from "../src/database.js";
import { getFirstSpotPrice, getHistIV } from "../src/db-utils.js";

const AMOUNT = 100;

async function getVolatilityAndSpotPrice(poolType, poolId, timestamp) {
  const symbol = poolType === "Thena_BSC" ? "BNBUSDT" : "ETHUSDT";
  const volatilitySymbol = "EVIV";

  const spotPrice = await getFirstSpotPrice(symbol, timestamp);
  const volatility = await getHistIV(volatilitySymbol, timestamp);

  if (!spotPrice || !volatility) {
    throw new Error(
      "Unable to fetch spot price or historical implied volatility from the database"
    );
  }

  return { spotPrice, volatility: volatility / 100 };
}

function calculateOptionPnL(
  options,
  volatilityChange,
  timeElapsed,
  underlyingChange
) {
  let totalPnL = 0;

  for (const option of options) {
    let optionPnL = 0;

    // NVega PnL
    optionPnL += option.nVega * volatilityChange * option.fixedNVega;

    // NTheta PnL
    optionPnL += option.nTheta * timeElapsed * option.fixedNTheta;

    // NDelta PnL (we'll calculate this in determineMaxNDelta)
    // optionPnL += option.nDelta * underlyingChange;

    totalPnL += optionPnL;
  }

  return totalPnL;
}

function determineMaxNDelta(options, targetPnL) {
  let low = 0;
  let high = 10; // Increased the upper bound to account for potential higher deltas
  const epsilon = 0.0001;

  while (high - low > epsilon) {
    const mid = (low + high) / 2;
    let pnl = calculateOptionPnL(options, 0, 0, 0);

    // Add NDelta PnL
    for (const option of options) {
      pnl += mid * 0.01; // Assuming 1% underlying change for simplicity
    }

    if (pnl < targetPnL) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return (low + high) / 2;
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
    allData.push(...records);
  }

  return allData;
}

async function simulateHedging(lpPositions, strategy) {
  const results = [];

  for (const position of lpPositions) {
    const openTimestamp = new Date(position.openTimestamp).getTime();
    const closeTimestamp = new Date(position.closeTimestamp).getTime();
    const timeElapsed =
      (closeTimestamp - openTimestamp) / (1000 * 60 * 60 * 24); // in days

    const { spotPrice: openSpotPrice, volatility: openVolatility } =
      await getVolatilityAndSpotPrice(
        position.poolType,
        position.poolId,
        openTimestamp
      );
    const { spotPrice: closeSpotPrice, volatility: closeVolatility } =
      await getVolatilityAndSpotPrice(
        position.poolType,
        position.poolId,
        closeTimestamp
      );

    const volatilityChange = closeVolatility - openVolatility;
    const underlyingChange = (closeSpotPrice - openSpotPrice) / openSpotPrice;

    const maxNDelta = determineMaxNDelta(strategy.options, 0.0025); // 0.25% target PnL

    const optionPnL = calculateOptionPnL(
      strategy.options,
      volatilityChange,
      timeElapsed,
      underlyingChange * maxNDelta
    );
    const lpPnL = (parseFloat(position.pnlPercent) / 100) * AMOUNT;
    const totalPnL = lpPnL + optionPnL;

    results.push({
      position,
      lpPnL,
      optionPnL,
      totalPnL,
      maxNDelta,
    });
  }

  return results;
}

async function main(directoryPath, strategyFilePath) {
  const lpPositions = readCSVFiles(directoryPath);
  const strategyContent = fs.readFileSync(strategyFilePath, 'utf-8');
  const strategies = JSON.parse(strategyContent);
  
  for (const strategy of strategies) {
    console.log(`Simulating strategy: ${strategy.strategyName}`);
    const results = await simulateHedging(lpPositions, strategy);

    for (const result of results) {
      console.log(
        `Position: ${result.position.openTimestamp} - ${result.position.closeTimestamp}`
      );
      console.log(`LP PnL: ${result.lpPnL.toFixed(4)}`);
      console.log(`Option PnL: ${result.optionPnL.toFixed(4)}`);
      console.log(`Total PnL: ${result.totalPnL.toFixed(4)}`);
      console.log(`Max NDelta: ${result.maxNDelta.toFixed(4)}`);
      console.log("---");
    }
  }
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
