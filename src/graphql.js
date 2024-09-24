import axios from "axios";
import CONFIG from "#src/config.js";
import { delay } from "#src/misc-utils.js";

import * as uniswapv3 from "./uniswapv3/graphql.js";
import * as thena from "./thena/graphql.js";

const getSubgraphURL = (type) => CONFIG.SUBGRAPH_URLS[type];

const q = { uniswapv3, thena };

export async function queryPoolMetadata(poolType, poolAddress) {
  try {
    const query = q[poolType].poolMetadataGraphQL(poolAddress);
    const response = await axios.post(getSubgraphURL(poolType), {
      query,
    });
    if (response.data && response.data.data && response.data.data.pool) {
      return response.data.data.pool;
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
  poolType,
  poolAddress,
  startTimestamp,
  endTimestamp,
  skip = 0,
  allTrades = []
) {
  try {
    const query = q[poolType].poolTradesGraphQL(
      poolAddress,
      startTimestamp,
      endTimestamp,
      skip
    );
    const response = await axios.post(getSubgraphURL(poolType), {
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
          poolType,
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
  poolType,
  poolAddress,
  startTimestamp,
  endTimestamp,
  skip
) {
  try {
    const query = q[poolType].poolLiquidityGraphQL(
      poolAddress,
      startTimestamp,
      endTimestamp,
      skip
    );
    const response = await axios.post(getSubgraphURL(poolType), {
      query,
    });

    if (response?.data?.data?.poolHourDatas) {
      const liquidityData = response.data.data.poolHourDatas;
      if (liquidityData.length === CONFIG.BATCH_SIZE) {
        console.log(`Fetched ${CONFIG.BATCH_SIZE} datapoints.`);
        await delay(CONFIG.DELAY_BETWEEN_REQUESTS);
        return queryPoolLiquidity(
          poolType,
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

export default q;
