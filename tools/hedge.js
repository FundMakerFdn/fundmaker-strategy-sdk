import fs from "fs";
import { parse } from "fast-csv";
import { program } from "commander";
import { getFirstSpotPrice } from "../src/db-utils.js";

async function calculateMaxTheta(row) {
  const symbol = row.poolType === "Thena_BSC" ? "BNBUSDT" : "ETHUSDT";

  // Fetch spot price at the time of opening the position
  const spotPrice = await getFirstSpotPrice(
    symbol,
    new Date(row.openTimestamp).getTime()
  );

  if (!spotPrice) {
    throw new Error(
      `No spot price found for ${symbol} at ${row.openTimestamp}`
    );
  }

  // Calculate the loss in USD based on PnL percent
  const loss = row.pnlPercent;

  // Assume delta is 0.5 for a typical at-the-money put option
  const delta = 0.5;

  // Calculate the premium (amount required to hedge the loss)
  const premium = loss / delta;

  // Calculate the number of days the position was open
  const openDate = new Date(row.openTimestamp);
  const closeDate = new Date(row.closeTimestamp);
  const daysOpen = (closeDate - openDate) / (1000 * 60 * 60 * 24);

  // Calculate the minimum theta required
  const maxThetaForBreakeven = premium / daysOpen;

  return {
    maxThetaForBreakeven,
    spotPrice,
  };
}

async function processCSV(inputFile, outputFile) {
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

  const results = await Promise.all(
    rows.map(async (row) => ({
      ...row,
      ...(await calculateMaxTheta(row)),
    }))
  );

  console.log("Processing complete. Results summary:");
  console.log(`Total positions: ${results.length}`);
  console.log(
    `Average max theta for breakeven: ${(
      results.reduce((sum, r) => sum + r.maxThetaForBreakeven, 0) /
      results.length
    ).toFixed(6)}`
  );
  console.log(
    `Average spot price: ${(
      results.reduce((sum, r) => sum + r.spotPrice, 0) / results.length
    ).toFixed(6)}`
  );

  // Write results to output file
  const csvContent = [
    Object.keys(results[0]).join(","),
    ...results.map((r) => Object.values(r).join(",")),
  ].join("\n");

  fs.writeFileSync(outputFile, csvContent);
}

async function main(opts) {
  await processCSV(opts.input, opts.output);
  console.log("Output written to", opts.output);
}

program
  .description("Calculate maximum theta for zero PnL from strategy.js output")
  .requiredOption(
    "-i, --input <inputCSV>",
    "input CSV filename (output from strategy.js)"
  )
  .requiredOption("-o, --output <outputCSV>", "output CSV filename")
  .action(main);

program.parse(process.argv);
