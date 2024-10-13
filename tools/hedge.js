import fs from "fs";
import path from "path";
import { parse } from "fast-csv";
import { program } from "commander";
import { getFirstSpotPrice } from "../src/db-utils.js";

async function calculateProfitability(row, theta, maxOptionPrice) {
  const symbol = row.poolType === "Thena_BSC" ? "BNBUSDT" : "ETHUSDT";
  const spotPrice = await getFirstSpotPrice(
    symbol,
    new Date(row.openTimestamp).getTime()
  );
  if (!spotPrice) {
    throw new Error(
      `No spot price found for ${symbol} at ${row.openTimestamp}`
    );
  }

  const openDate = new Date(row.openTimestamp);
  const closeDate = new Date(row.closeTimestamp);
  const daysOpen = (closeDate - openDate) / (1000 * 60 * 60 * 24);

  // Calculate LP PnL (already in percentage)
  const lpPnl = parseFloat(row.pnlPercent);

  // Calculate option PnL based on theta (put option)
  const optionPnl = Math.min(
    ((theta * spotPrice * daysOpen) / spotPrice) * 100,
    maxOptionPrice
  );

  // Calculate combined PnL (in percentage)
  const combinedPnl = lpPnl + optionPnl;

  return {
    combinedPnl,
    spotPrice,
    daysOpen,
    lpPnl,
    optionPnl,
    theta,
  };
}

async function processCSV(inputFile, maxOptionPrice) {
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

  const thetaValues = Array.from({ length: 1001 }, (_, i) => i / 10000); // 0 to 0.1 with 0.0001 step
  let bestTheta = 0;
  let bestTotalPnl = -Infinity;

  console.log(`Processing ${inputFile}`);

  for (const theta of thetaValues) {
    const results = await Promise.all(
      rows.map((row) => calculateProfitability(row, theta, maxOptionPrice))
    );
    const totalPnl = results.reduce(
      (sum, result) => sum + result.combinedPnl,
      0
    );

    if (totalPnl > bestTotalPnl) {
      bestTotalPnl = totalPnl;
      bestTheta = theta;
    }

    // Log progress every 100 iterations
    if (theta * 10000 % 100 === 0) {
      console.log(`Theta: ${theta.toFixed(4)}, Total PnL: ${totalPnl.toFixed(6)}`);
    }
  }

  console.log(`Best theta found: ${bestTheta.toFixed(4)}, Total PnL: ${bestTotalPnl.toFixed(6)}`);

  // Calculate additional statistics for the best theta
  const bestResults = await Promise.all(
    rows.map((row) => calculateProfitability(row, bestTheta, maxOptionPrice))
  );
  const averageLpPnl = bestResults.reduce((sum, result) => sum + result.lpPnl, 0) / rows.length;
  const averageOptionPnl = bestResults.reduce((sum, result) => sum + result.optionPnl, 0) / rows.length;
  const averageDaysOpen = bestResults.reduce((sum, result) => sum + result.daysOpen, 0) / rows.length;

  console.log(`Average LP PnL: ${averageLpPnl.toFixed(6)}%`);
  console.log(`Average Option PnL: ${averageOptionPnl.toFixed(6)}%`);
  console.log(`Average Days Open: ${averageDaysOpen.toFixed(2)}`);

  return {
    inputFile,
    bestTheta,
    totalPnl: bestTotalPnl,
    averagePnl: bestTotalPnl / rows.length,
    totalPositions: rows.length,
    averageLpPnl,
    averageOptionPnl,
    averageDaysOpen,
  };
}

async function processDirectory(inputDir, outputFile, maxOptionPrice) {
  const files = fs
    .readdirSync(inputDir)
    .filter((file) => file.endsWith(".csv"));
  const results = await Promise.all(
    files.map((file) => processCSV(path.join(inputDir, file), maxOptionPrice))
  );

  const csvContent = [
    "inputFile,bestTheta,totalPnl,averagePnl,totalPositions,averageLpPnl,averageOptionPnl,averageDaysOpen",
    ...results.map(
      (r) =>
        `${r.inputFile},${r.bestTheta},${r.totalPnl.toFixed(6)},${r.averagePnl.toFixed(6)},${r.totalPositions},${r.averageLpPnl.toFixed(6)},${r.averageOptionPnl.toFixed(6)},${r.averageDaysOpen.toFixed(2)}`
    ),
  ].join("\n");

  fs.writeFileSync(outputFile, csvContent);

  console.log("Processing complete. Results summary:");
  console.log(`Total files processed: ${results.length}`);
  console.log(`Output written to ${outputFile}`);
}

async function main(opts) {
  await processDirectory(opts.input, opts.output, opts.maxOptionPrice);
}

program
  .description(
    "Calculate best theta and profitability of hedging strategy for multiple CSV files"
  )
  .requiredOption(
    "-i, --input <inputDir>",
    "input directory containing CSV files"
  )
  .requiredOption("-o, --output <outputCSV>", "output CSV filename")
  .requiredOption(
    "-m, --max-option-price <price>",
    "maximum option price as a percentage",
    parseFloat
  )
  .action(main);

program.parse(process.argv);
