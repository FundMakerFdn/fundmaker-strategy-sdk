import { fetchPool, fetchDailyTrades, fetchLiquidity } from "./fetch-utils.js";
import CONFIG from "./config.js";

async function main() {
  let currentDate = new Date(CONFIG.START_DATE);

  const poolId = await fetchPool(CONFIG.POOL_ADDRESS);

  // Loop through each day until the end date
  while (currentDate < CONFIG.END_DATE) {
    let nextDate = new Date(currentDate);
    nextDate.setDate(nextDate.getDate() + 1);
    nextDate = new Date(Math.min(nextDate, CONFIG.END_DATE));

    console.log(`Processing trades for ${currentDate.toISOString()}`);

    // Fetch and process trades for the current date
    await fetchDailyTrades(poolId, currentDate, nextDate);

    currentDate = nextDate;
  }

  console.log("All dates processed.");
  console.log("Fetching liquidity...");

  fetchLiquidity(poolId, CONFIG.START_DATE, CONFIG.END_DATE);
}

// Start the main function
main().catch((err) => {
  console.error("Error in main function:", err.message);
});
