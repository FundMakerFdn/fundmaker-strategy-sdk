import { program } from "commander";
import db from "#src/database.js";
import { spot } from "#src/schema.js";
import { batchInsert } from "#src/db-utils.js";

const API_URL = "https://api.binance.com/api/v3/klines";
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT"];
const LIMIT = 1000;

function formatDate(timestamp) {
  return new Date(timestamp).toISOString();
}

program
  .option("-i, --interval <interval>", "Interval (e.g., 15m, 1h, 1d)", "1h")
  .option("-s, --start-date <date>", "Start date (YYYY-MM-DD)")
  .option("-e, --end-date <date>", "End date (YYYY-MM-DD)")
  .parse(process.argv);

const options = program.opts();

if (!options.startDate || !options.endDate) {
  console.error("Please provide both start and end dates");
  process.exit(1);
}

async function fetchData(symbol, interval, startTime, endTime) {
  const url = `${API_URL}?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${LIMIT}`;
  const response = await fetch(url);
  const data = await response.json();
  return data;
}

async function scrapeData(symbol, interval, startDate, endDate) {
  let allData = [];
  let currentStartTime = new Date(startDate).getTime();
  const endTime = new Date(endDate).getTime();

  while (currentStartTime < endTime) {
    try {
      const data = await fetchData(symbol, interval, currentStartTime, endTime);

      if (data.length === 0) {
        break;
      } else {
        allData = allData.concat(data);
        currentStartTime = data[data.length - 1][0] + 1;
        console.log(
          `Fetched ${data.length} records for ${symbol}, new startTime: ${formatDate(currentStartTime)}, total: ${allData.length}`
        );
      }
    } catch (error) {
      console.error(`Error fetching data for ${symbol}:`, error);
      break;
    }
  }

  return allData;
}

async function saveToDatabase(data, symbol, interval) {
  const rows = data.map((item) => ({
    symbol,
    interval,
    timestamp: item[0],
    open: parseFloat(item[1]),
    high: parseFloat(item[2]),
    low: parseFloat(item[3]),
    close: parseFloat(item[4]),
    volume: parseFloat(item[5]),
  }));

  await batchInsert(db, spot, rows);
  console.log(`Saved ${rows.length} records for ${symbol} (${interval}) to the database`);
}

async function main() {
  for (const symbol of SYMBOLS) {
    const data = await scrapeData(
      symbol,
      options.interval,
      options.startDate,
      options.endDate
    );
    await saveToDatabase(data, symbol, options.interval);
  }
  console.log("Data fetching and saving completed");
}

main().catch((error) => {
  console.error("An error occurred:", error);
  process.exit(1);
});
