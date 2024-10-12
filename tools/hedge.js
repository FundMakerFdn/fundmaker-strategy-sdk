import fs from "fs";
import { program } from "commander";
import { parse, format } from "fast-csv";
import {
  getFirstSpotPrice,
  getRealizedVolatility,
  getPoolMetadata,
} from "#src/db-utils.js";

// Black-Scholes Option Pricing Model
function blackScholes(S, K, T, r, sigma, type) {
  const d1 =
    (Math.log(S / K) + (r + sigma ** 2 / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  if (type === "call") {
    return S * cdf(d1) - K * Math.exp(-r * T) * cdf(d2);
  } else {
    return K * Math.exp(-r * T) * cdf(-d2) - S * cdf(-d1);
  }
}

// Cumulative distribution function for standard normal
function cdf(x) {
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

async function calculateStraddle(row, strategy) {
  debugger;
  const pool = await getPoolMetadata(row.poolType, row.poolAddress);
  if (!pool) {
    return null;
  }

  const symbol = pool.type.includes("ETH") ? "ETHUSDT" : "BNBUSDT";
  const openTimestamp = new Date(row.openTimestamp).getTime();
  const spotPrice = await getFirstSpotPrice(symbol, openTimestamp);
  const realizedVolatility = await getRealizedVolatility(
    pool.id,
    openTimestamp
  );

  if (!spotPrice || !realizedVolatility) {
    return null;
  }

  const T = parseFloat(strategy.straddleDaysToExpiry) / 365; // Time to expiry in years
  const r = parseFloat(strategy.riskFreeRate); // Risk-free rate
  const sigma = realizedVolatility / 100; // Convert percentage to decimal

  if (spotPrice <= 0 || T <= 0 || r < 0 || sigma <= 0) {
    return null;
  }

  const callPrice = blackScholes(spotPrice, spotPrice, T, r, sigma, "call");
  const putPrice = blackScholes(spotPrice, spotPrice, T, r, sigma, "put");
  const straddlePrice = callPrice + putPrice;

  if (isNaN(callPrice) || isNaN(putPrice) || isNaN(straddlePrice)) {
    return null;
  }

  return {
    symbol,
    spotPrice,
    callPrice,
    putPrice,
    straddlePrice,
  };
}

async function processCSV(inputFile, outputFile, strategy) {
  const rows = await new Promise((resolve, reject) => {
    const rowsCSV = [];
    fs.createReadStream(inputFile)
      .pipe(parse({ headers: true }))
      .on("data", (row) => {
        rowsCSV.push(row);
      })
      .on("error", reject)
      .on("end", () => resolve(rowsCSV));
  });

  const results = [];
  for (const row of rows) {
    const straddleResult = await calculateStraddle(row, strategy);
    if (straddleResult) {
      results.push({ ...row, ...straddleResult });
    }
  }

  await new Promise((resolve, reject) => {
    const csvStream = format({ headers: true });
    const writableStream = fs.createWriteStream(outputFile);

    csvStream.pipe(writableStream);
    results.forEach((record) => csvStream.write(record));
    csvStream.end();

    writableStream.on("finish", resolve);
    writableStream.on("error", reject);
  });
}

async function main(opts) {
  const strategyJSON = JSON.parse(fs.readFileSync(opts.strategy, "utf8"));
  const strategy = strategyJSON[0]; // Assuming we're using the first strategy

  await processCSV(opts.input, opts.output, strategy);
  console.log("Output written to", opts.output);
}

program
  .description(
    "Calculate straddle option prices for positions from strategy.js output"
  )
  .requiredOption(
    "-i, --input <inputCSV>",
    "input CSV filename (output from strategy.js)"
  )
  .requiredOption("-s, --strategy <strategyJSON>", "strategy JSON filename")
  .requiredOption("-o, --output <outputCSV>", "output CSV filename")
  .action(main);

program.parse(process.argv);
