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

// Black-Scholes formula implementation
function blackScholes(S, K, T, r, sigma, type) {
  // Convert sigma from percentage to decimal
  const sigmaDecimal = sigma / 100;

  const d1 =
    (Math.log(S / K) + (r + sigmaDecimal ** 2 / 2) * T) /
    (sigmaDecimal * Math.sqrt(T));
  const d2 = d1 - sigmaDecimal * Math.sqrt(T);

  const Nd1 = cumulativeNormalDistribution(d1);
  const Nd2 = cumulativeNormalDistribution(d2);

  if (type === "call") {
    return S * Nd1 - K * Math.exp(-r * T) * Nd2;
  } else {
    return K * Math.exp(-r * T) * (1 - Nd2) - S * (1 - Nd1);
  }
}

// Standard normal cumulative distribution function
function cumulativeNormalDistribution(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  let prob =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (x > 0) prob = 1 - prob;
  return prob;
}

// Calculate option greeks
function calculateGreeks(S, K, T, r, sigma, type) {
  // Convert sigma from percentage to decimal
  const sigmaDecimal = sigma / 100;

  const d1 =
    (Math.log(S / K) + (r + sigmaDecimal ** 2 / 2) * T) /
    (sigmaDecimal * Math.sqrt(T));
  const d2 = d1 - sigmaDecimal * Math.sqrt(T);

  const Nd1 = cumulativeNormalDistribution(d1);
  const Nd2 = cumulativeNormalDistribution(d2);
  const nPrimeD1 = Math.exp((-d1 * d1) / 2) / Math.sqrt(2 * Math.PI);

  const delta = type === "call" ? Nd1 : Nd1 - 1;
  const gamma = nPrimeD1 / (S * sigmaDecimal * Math.sqrt(T));
  const vega = (S * nPrimeD1 * Math.sqrt(T)) / 100; // Expressed in terms of 1% change in volatility
  const theta =
    -(S * sigmaDecimal * nPrimeD1) / (2 * Math.sqrt(T)) / 365 -
    (r * K * Math.exp(-r * T) * (type === "call" ? Nd2 : -Nd2)) / 365;
  const rho = (K * T * Math.exp(-r * T) * (type === "call" ? Nd2 : -Nd2)) / 100; // Expressed in terms of 1% change in interest rate

  return { delta, gamma, vega, theta, rho };
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

      const pool = await getPoolById(record.poolId);
      const spotSymbol = pool.type === "Thena_BSC" ? "BNBUSDT" : "ETHUSDT";
      const spotPrice = await getFirstSpotPrice(
        spotSymbol,
        record.openTimestamp
      );
      const iv = await getHistIV("EVIV", record.openTimestamp);

      if (!spotPrice || !iv) {
        log(`Missing data for record: ${JSON.stringify(record)}`);
        continue;
      }

      const optionResults = await Promise.all(
        strategy.options.map(async (option, index) => {
          log(`Processing option ${index + 1}`);

          const strikePrice =
            option.strikePrice === 1
              ? spotPrice
              : option.strikePrice * spotPrice;
          const T = dte / 365; // Time to expiration in years
          const r = 0.03;

          const price = blackScholes(
            spotPrice,
            strikePrice,
            T,
            r,
            iv,
            option.optionType
          );
          const greeks = calculateGreeks(
            spotPrice,
            strikePrice,
            T,
            r,
            iv,
            option.optionType
          );

          return {
            optionType: option.optionType,
            strikePrice,
            price,
            ...greeks,
          };
        })
      );

      fileResults.push({
        ...record,
        dte,
        spotPrice,
        iv,
        options: optionResults,
      });
    }

    results.push({ file, results: fileResults });
  }

  return results;
}

async function main(directoryPath, strategyPath) {
  const data = readCSVFiles(directoryPath);
  const strategy = JSON.parse(fs.readFileSync(strategyPath, "utf-8"))[0];

  const results = await processData(data, strategy);

  writeResults(results);
}

program
  .description("CLI tool for options-based LP position hedging simulation")
  .requiredOption("-i, --input <path>", "Input directory path")
  .requiredOption("-s, --strategy <path>", "Path to the strategy JSON file")
  .action(async (options) => {
    try {
      await main(options.input, options.strategy);
    } catch (error) {
      console.error("An error occurred:", error);
    }
  });

program.parse(process.argv);

function writeResults(results) {
  for (const { file, results: fileResults } of results) {
    console.log(`Results for ${file}:`);
    for (const result of fileResults) {
      console.log(`LP position PnL %: ${result.pnlPercent}`);
      console.log(`DTE: ${result.dte}`);
      console.log(`Spot Price: ${result.spotPrice.toFixed(2)}`);
      console.log(`IV: ${result.iv.toFixed(4)}`);
      console.log("Options:");
      for (const option of result.options) {
        console.log(`  Type: ${option.optionType}`);
        console.log(`  Strike: ${option.strikePrice.toFixed(2)}`);
        console.log(`  Price: ${option.price.toFixed(4)}`);
        console.log(`  Delta: ${option.delta.toFixed(4)}`);
        console.log(`  Gamma: ${option.gamma.toFixed(4)}`);
        console.log(`  Vega: ${option.vega.toFixed(4)}`);
        console.log(`  Theta: ${option.theta.toFixed(4)}`);
        console.log(`  Rho: ${option.rho.toFixed(4)}`);
        console.log("---");
      }
      console.log("================");
    }
  }
}
