import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { program } from "commander";
import { getFirstSpotPrice, getHistIV, getPoolById } from "#src/db-utils.js";
import {
  calculateDTE,
  blackScholes,
  calculateGreeks,
  adjustStrikePrice,
} from "#src/options-math.js";
import CONFIG from "#src/config.js";

function log(message) {
  if (CONFIG.VERBOSE) {
    console.log(message);
  }
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

async function processData(data, strategy) {
  const results = [];

  for (const { file, records } of data) {
    log(`Processing file: ${file}`);
    const fileResults = [];

    for (const record of records) {
      log(`Processing record: ${JSON.stringify(record)}`);
      const pnlPercent = parseFloat(record.pnlPercent);
      const dte = calculateDTE(record.openTimestamp, record.closeTimestamp);
      const pool = await getPoolById(record.poolId);

      log(`PNL Percent: ${pnlPercent}`);
      log(`DTE: ${dte}`);

      const optionResults = await Promise.all(
        strategy.options.map(async (option, index) => {
          log(`Processing option ${index + 1}`);

          let spotSymbol;
          if (option.spotSymbol) {
            spotSymbol = option.spotSymbol;
          } else {
            spotSymbol = pool.type === "Thena_BSC" ? "BNBUSDT" : "ETHUSDT";
          }
          const spotPrice = await getFirstSpotPrice(
            spotSymbol,
            record.openTimestamp
          );
          const indexIV = await getHistIV("EVIV", record.openTimestamp);

          if (!spotPrice || !indexIV) {
            log(
              `Missing data for option ${index + 1}: ${JSON.stringify(option)}`
            );
            return null;
          }

          const stepSize = CONFIG.STRIKE_PRICE_STEPS[spotSymbol] || 1;
          const adjustedStrikeMultiplier = adjustStrikePrice(
            spotPrice,
            option.strikePrice,
            stepSize
          );
          const strikePrice = adjustedStrikeMultiplier * spotPrice;

          const T = dte / 365;
          const r = strategy?.riskFreeRate || 0;

          // Apply askIndexIVRatio to get the option's ask IV
          const askIV = indexIV * option.askIndexIVRatio;

          const price = blackScholes(
            spotPrice,
            strikePrice,
            T,
            r,
            askIV,
            option.optionType
          );
          const greeks = calculateGreeks(
            spotPrice,
            strikePrice,
            T,
            r,
            askIV,
            option.optionType
          );

          // Apply askBidRatio to calculate the bid price
          const bidPrice = price / option.askBidRatio;

          return {
            optionType: option.optionType,
            strikePrice,
            spotPrice,
            spotSymbol,
            askPremium: price,
            bidPremium: bidPrice,
            askIV,
            indexIV,
            ...greeks,
          };
        })
      );

      const validOptionResults = optionResults.filter(
        (result) => result !== null
      );

      if (validOptionResults.length === 0) {
        log(`No valid options for record: ${JSON.stringify(record)}`);
        continue;
      }

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

async function main(inputPath, strategyPath, outputPath) {
  const data = readCSVFiles(inputPath);
  const strategies = JSON.parse(fs.readFileSync(strategyPath, "utf-8"));

  for (const strategy of strategies) {
    log(`Processing strategy: ${strategy.name}`);
    const results = await processData(data, strategy);
    writeResults(results, strategy, outputPath);
  }
}

program
  .description("CLI tool for options-based LP position hedging simulation")
  .requiredOption("-i, --input <path>", "Input directory path")
  .requiredOption("-s, --strategy <path>", "Path to the strategy JSON file")
  .requiredOption("-o, --output <path>", "Output directory path")
  .action(async (options) => {
    try {
      await main(options.input, options.strategy, options.output);
    } catch (error) {
      console.error("An error occurred:", error);
    }
  });

program.parse(process.argv);

function writeResults(results, strategy, outputPath) {
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }

  for (const { file, results: fileResults } of results) {
    let increment = 1;
    let outputFileName;
    let outputFilePath;

    do {
      outputFileName = `${strategy.strategyName}_${path.basename(
        file,
        ".csv"
      )}_${increment}.json`;
      outputFilePath = path.join(outputPath, outputFileName);
      increment++;
    } while (fs.existsSync(outputFilePath));

    const output = {
      strategy: strategy.name,
      originalFile: file,
      results: fileResults,
    };

    fs.writeFileSync(outputFilePath, JSON.stringify(output, null, 2));
    console.log(`Results written to ${outputFilePath}`);
  }
}
