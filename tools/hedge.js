import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { program } from "commander";
import { getFirstSpotPrice, getHistIV, getPoolById } from "#src/db-utils.js";
import {
  blackScholes,
  calculateGreeks,
  adjustStrikePrice,
  calculateExpirationDate,
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
      // DTE calculation is now handled per option
      const pool = await getPoolById(record.poolId);

      log(`PNL Percent: ${pnlPercent}`);

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

          const expirationDate = calculateExpirationDate(
            new Date(record.openTimestamp),
            option.dte
          );
          const T =
            (expirationDate.getTime() -
              new Date(record.openTimestamp).getTime()) /
            (1000 * 60 * 60 * 24 * 365);
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
            expirationDate: expirationDate.toISOString(),
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

      // Calculate pnlOptions and pnlCombined
      let pnlOptions = 0;
      const updatedOptions = await Promise.all(
        validOptionResults.map(async (option) => {
          const endSpotPrice = await getFirstSpotPrice(
            option.spotSymbol,
            record.closeTimestamp
          );
          const endIndexIV = await getHistIV("EVIV", record.closeTimestamp);
          const endAskIV =
            endIndexIV *
            strategy.options.find((o) => o.optionType === option.optionType)
              .askIndexIVRatio;

          const endPrice = blackScholes(
            endSpotPrice,
            option.strikePrice,
            0.00001, // Very small time to expiry
            strategy.riskFreeRate,
            endAskIV,
            option.optionType
          );

          const endBidPrice =
            endPrice /
            strategy.options.find((o) => o.optionType === option.optionType)
              .askBidRatio;
          const optionPnl = endBidPrice - option.askPremium;
          pnlOptions += optionPnl;

          return {
            ...option,
            endBidPrice,
            optionPnl,
          };
        })
      );

      const pnlCombined = parseFloat(record.pnlPercent) + pnlOptions;

      fileResults.push({
        ...record,
        options: updatedOptions,
        pnlOptions,
        pnlCombined,
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
