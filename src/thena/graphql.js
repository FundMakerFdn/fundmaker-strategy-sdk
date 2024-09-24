import axios from "axios";
import CONFIG from "#src/config.js";
import { delay } from "#src/misc-utils.js";

const SUBGRAPH_URL = CONFIG.SUBGRAPH_URLS.thena;

export async function queryPoolMetadata(poolAddress) {
  const query = `
    query {
      pool(id: "${poolAddress}") {
        id
        token0 {
          symbol
          decimals
        }
        token1 {
          symbol
          decimals
        }
        fee
      }
    }
  `;

  try {
    const response = await axios.post(SUBGRAPH_URL, {
      query,
    });
    if (response.data && response.data.data && response.data.data.pool) {
      // Thena schema adjustments
      const pool = response.data.data.pool;
      pool.feeTier = pool.fee;
      return pool;
    } else {
      console.error(
        "Unexpected response structure for pool metadata:",
        response.data
      );
      return null;
    }
  } catch (error) {
    console.error("Error fetching pool metadata:", error.message);
    return null;
  }
}

// Function to get historical pool trades
export async function queryPoolTrades(
  poolAddress,
  startTimestamp,
  endTimestamp,
  skip = 0,
  allTrades = []
) {
  const query = `
    query {
      swaps(
        where: {
          pool: "${poolAddress}",
          timestamp_gte: ${startTimestamp},
          timestamp_lte: ${endTimestamp}
        }
        orderBy: timestamp
        orderDirection: asc
        first: ${CONFIG.BATCH_SIZE}
        skip: ${skip}
      ) {
        id
        timestamp
        amount0
        amount1
        amountUSD
        sqrtPriceX96:price
        tick
      }
    }
  `;

  try {
    const response = await axios.post(SUBGRAPH_URL, {
      query,
    });

    if (response?.data?.data?.swaps) {
      const trades = response.data.data.swaps;

      // Concatenate the new trades with the already fetched ones
      allTrades = allTrades.concat(trades);

      // If the number of fetched trades equals the batch size, there may be more trades to fetch.
      if (trades.length === CONFIG.BATCH_SIZE) {
        await delay(CONFIG.DELAY_BETWEEN_REQUESTS);
        // Fetch the next batch of trades
        return queryPoolTrades(
          poolAddress,
          startTimestamp,
          endTimestamp,
          skip + CONFIG.BATCH_SIZE,
          allTrades
        );
      }

      return allTrades; // Return all fetched trades once there are no more to fetch
    } else {
      console.error("Unexpected response structure:", response.data);
      return allTrades; // Return whatever has been fetched so far
    }
  } catch (error) {
    console.error("Error fetching trades:", error.message);
    if (error.response) {
      console.error("Error response:", error.response.data);
    }
    return allTrades; // Return partial data on error
  }
}

export async function queryPoolLiquidity(
  poolAddress,
  startTimestamp,
  endTimestamp,
  skip
) {
  const query = `
    query {
      poolHourDatas(
        where: {
          pool: "${poolAddress}",
          periodStartUnix_gte: ${startTimestamp},
          periodStartUnix_lte: ${endTimestamp}
        }
        orderBy: periodStartUnix
        orderDirection: asc
        first: ${CONFIG.BATCH_SIZE}
        skip: ${skip}
      ) {
        periodStartUnix
        liquidity
        volumeUSD
        feesUSD
      }
    }
  `;

  try {
    const response = await axios.post(SUBGRAPH_URL, {
      query,
    });

    if (response?.data?.data?.poolHourDatas) {
      const liquidityData = response.data.data.poolHourDatas;
      if (liquidityData.length === CONFIG.BATCH_SIZE) {
        console.log(`Fetched ${CONFIG.BATCH_SIZE} datapoints.`);
        await delay(CONFIG.DELAY_BETWEEN_REQUESTS);
        return queryPoolLiquidity(
          poolAddress,
          startTimestamp,
          endTimestamp,
          skip + CONFIG.BATCH_SIZE
        );
      }
      return response.data.data.poolHourDatas;
    } else {
      console.error(
        "Unexpected response structure for hourly liquidity data:",
        response.data
      );
      return [];
    }
  } catch (error) {
    console.error("Error fetching hourly liquidity data:", error.message);
    if (error.response) {
      console.error("Error response:", error.response.data);
    }
    return [];
  }
}
