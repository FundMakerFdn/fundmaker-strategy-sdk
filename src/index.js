import { fetchPool, fetchDailyTrades, fetchLiquidity } from "./fetch-utils.js";
import CONFIG from "./config.js";

async function main() {
  let currentDate = new Date(CONFIG.START_DATE);

  const poolId = await fetchPool(CONFIG.POOL_TYPE, CONFIG.POOL_ADDRESS);

  while (currentDate < CONFIG.END_DATE) {
    let nextDate = new Date(currentDate);
    nextDate.setDate(nextDate.getDate() + 1);
    nextDate = new Date(Math.min(nextDate, CONFIG.END_DATE));

    console.log(`Processing trades for ${currentDate.toISOString()}`);

    await fetchDailyTrades(CONFIG.POOL_TYPE, poolId, currentDate, nextDate);

    currentDate = nextDate;
  }

  console.log("Fetched trades.");
  console.log("Fetching liquidity...");

  fetchLiquidity(CONFIG.POOL_TYPE, poolId, CONFIG.START_DATE, CONFIG.END_DATE);
}

// Start the main function
main().catch((err) => {
  console.error("Error in main function:", err.message);
});
