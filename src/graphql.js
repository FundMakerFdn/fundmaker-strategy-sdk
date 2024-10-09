import axios from "axios";
import axiosRetry from "axios-retry";
import CONFIG from "#src/config.js";
import { delay } from "#src/misc-utils.js";

import * as uniswapv3 from "./uniswapv3/graphql.js";
import * as thena from "./thena/graphql.js";

const getSubgraphURL = (type) => CONFIG.SUBGRAPH_URLS[type];
const q = { uniswapv3, thena };

axiosRetry(axios, {
  retries: CONFIG.RETRY_COUNT,
  retryDelay: CONFIG.DELAY_BETWEEN_REQUESTS,
});

// Helper function to send GraphQL queries
async function sendGraphQLQuery(poolType, query) {
  try {
    const response = await axios.post(getSubgraphURL(poolType), { query });
    return response?.data?.data || null;
  } catch (error) {
    console.error(`Error fetching data for ${poolType}:`, error.message);
    if (error.response) {
      console.error("Error response:", error.response.data);
    }
    return null;
  }
}

// Helper function for handling paginated data fetching
async function fetchPaginatedData(
  fetchFn,
  poolType,
  poolAddress,
  startTimestamp,
  endTimestamp,
  skip = 0,
  accumulatedData = []
) {
  const newData = await fetchFn(
    poolType,
    poolAddress,
    startTimestamp,
    endTimestamp,
    skip
  );
  if (!newData) return accumulatedData;

  const allData = accumulatedData.concat(newData);

  if (newData.length === CONFIG.BATCH_SIZE) {
    await delay(CONFIG.DELAY_BETWEEN_REQUESTS);
    return fetchPaginatedData(
      fetchFn,
      poolType,
      poolAddress,
      startTimestamp,
      endTimestamp,
      skip + CONFIG.BATCH_SIZE,
      allData
    );
  }
  return allData;
}

// Function to get pool metadata
export async function queryPoolMetadata(poolType, poolAddress) {
  const query = q[poolType].poolMetadataGraphQL(poolAddress);
  const data = await sendGraphQLQuery(poolType, query);
  if (data?.pool) return data.pool;
  else {
    console.error("Unexpected response structure for pool metadata:", data);
    return null;
  }
}

export async function queryPoolAddress(
  poolType,
  symbol0,
  symbol1,
  feeTier = null
) {
  const query = q[poolType].poolAddressGraphQL(symbol0, symbol1, feeTier);
  const data = await sendGraphQLQuery(poolType, query);
  if (data?.pools) return data.pools;
  else {
    console.error(
      "Unexpected response structure for pool address query:",
      data
    );
    return null;
  }
}

// Function to fetch pool trades (with pagination)
export async function queryPoolTrades(
  poolType,
  poolAddress,
  startTimestamp,
  endTimestamp
) {
  const fetchTrades = async (
    poolType,
    poolAddress,
    startTimestamp,
    endTimestamp,
    skip
  ) => {
    const query = q[poolType].poolTradesGraphQL(
      poolAddress,
      startTimestamp,
      endTimestamp,
      skip
    );
    const data = await sendGraphQLQuery(poolType, query);
    return data?.swaps || [];
  };

  return fetchPaginatedData(
    fetchTrades,
    poolType,
    poolAddress,
    startTimestamp,
    endTimestamp
  );
}

// Function to fetch pool liquidity (with pagination)
export async function queryPoolLiquidity(
  poolType,
  poolAddress,
  startTimestamp,
  endTimestamp
) {
  const fetchLiquidity = async (
    poolType,
    poolAddress,
    startTimestamp,
    endTimestamp,
    skip
  ) => {
    const query = q[poolType].poolLiquidityGraphQL(
      poolAddress,
      startTimestamp,
      endTimestamp,
      skip
    );
    const data = await sendGraphQLQuery(poolType, query);
    return data?.poolHourDatas || [];
  };

  return fetchPaginatedData(
    fetchLiquidity,
    poolType,
    poolAddress,
    startTimestamp,
    endTimestamp
  );
}

// Function to fetch pool fee tiers (with pagination)
export async function queryPoolFeeTiers(
  poolType,
  poolAddress,
  startTimestamp,
  endTimestamp
) {
  const fetchFeeTiers = async (
    poolType,
    poolAddress,
    startTimestamp,
    endTimestamp,
    skip
  ) => {
    const query = q[poolType].poolFeeTiersGraphQL(
      poolAddress,
      startTimestamp,
      endTimestamp,
      skip
    );
    const data = await sendGraphQLQuery(poolType, query);
    return (data?.feeHourDatas || []).map((datapoint) => ({
      ...datapoint,
      feeTier: (Number(datapoint.minFee) + Number(datapoint.maxFee)) / 2,
    }));
  };

  return fetchPaginatedData(
    fetchFeeTiers,
    poolType,
    poolAddress,
    startTimestamp,
    endTimestamp
  );
}
