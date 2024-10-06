import {
  fetchPool,
  fetchDailyTrades,
  fetchLiquidity,
  fetchFeeTiers,
} from "./fetch-utils.js";
import CONFIG from "./config.js";
import { padDateMS } from "./misc-utils.js";
import { rollingRealizedVolatility } from "./volatility.js";

export async function fetchData(config) {
  // padding the start and end date to ensure the data on the "edges" is retrieved
  const startDate = padDateMS(-CONFIG.FETCH_PAD_MS, config.startDate);
  const endDate = padDateMS(CONFIG.FETCH_PAD_MS, config.endDate);
  //const poolId = await fetchPool(config.poolType, config.poolAddress);

  console.log("Fetching liquidity...");

  fetchLiquidity(config.poolType, config.poolId, startDate, endDate);

  if (CONFIG.DYNAMIC_FEE_POOLS.includes(config.poolType)) {
    console.log("Fetching fee tiers...");
    fetchFeeTiers(config.poolType, config.poolId, startDate, endDate);
  }

  // Fetch trades last, since trades are used to
  // check if the interval is fetched or not
  let currentDate = new Date(startDate); // copy by value, not reference
  while (currentDate < endDate) {
    let nextDate = new Date(currentDate);
    nextDate.setDate(nextDate.getDate() + 1);
    nextDate = new Date(Math.min(nextDate, endDate));

    await fetchDailyTrades({ ...config }, currentDate, nextDate);

    currentDate = nextDate;
  }
  console.log("Fetched trades.");

  console.log("Calculating realized volatility...");
  rollingRealizedVolatility(config.poolId, startDate, endDate);
}

// Start the main function
/*main().catch((err) => {
  console.error("Error in main function:", err.message);
});*/
