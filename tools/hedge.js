import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { program } from "commander";

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
  return Math.ceil(timeDiff / (1000 * 3600)) / 24;
}

function findMaxTheta(pnlPercent, dte) {
  // For a straddle strategy, we assume the maximum profit is achieved when the underlying
  // asset price doesn't move (pnlPercent = 0)
  const maxProfit = Math.abs(pnlPercent);

  // The maximum theta per day that still allows for profit
  const maxThetaPerDay = maxProfit / dte;

  return maxThetaPerDay;
}

function processData(data) {
  const results = [];

  for (const { file, records } of data) {
    const fileResults = [];

    for (const record of records) {
      const pnlPercent = parseFloat(record.pnlPercent);
      const dte = calculateDTE(record.openTimestamp, record.closeTimestamp);

      const maxTheta = findMaxTheta(pnlPercent, dte);

      fileResults.push({
        ...record,
        dte,
        maxTheta,
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

function main(directoryPath, strategyPath) {
  const data = readCSVFiles(directoryPath);
  const strategy = JSON.parse(fs.readFileSync(strategyPath, "utf-8"))[0];

  const results = processData(data, strategy);

  writeResults(results);
}

program
  .description("CLI tool for options-based LP position hedging simulation")
  .requiredOption("-d, --directory <path>", "Input directory path")
  .requiredOption("-s, --strategy <path>", "Path to the strategy JSON file")
  .action((options) => {
    try {
      main(options.directory, options.strategy);
    } catch (error) {
      console.error("An error occurred:", error);
    }
  });

program.parse(process.argv);
