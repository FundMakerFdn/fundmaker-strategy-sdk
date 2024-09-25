import { config } from "dotenv";
config();

const CONFIG = {
  POOL_ADDRESS: "0xd405b976ac01023c9064024880999fc450a8668b",
  POOL_TYPE: "thena", // uniswapv3, thena
  START_DATE: new Date("2024-09-14T17:10:00.000Z"), // data fetch start date
  END_DATE: new Date("2024-09-15T11:15:00.000Z"), // data fetch end date
  BATCH_SIZE: 1000,
  DELAY_BETWEEN_REQUESTS: 1000, // in milliseconds
  SHOW_SIMULATION_PROGRESS: true, // print a dot for each hour simulated

  SUBGRAPH_URLS: {
    uniswapv3: process.env.UNISWAP_V3_SUBGRAPH_URL,
    thena: process.env.THENA_SUBGRAPH_URL,
  },

  // Pools with dynamic fee tiers
  DYNAMIC_FEE_POOLS: ["thena"],
};

CONFIG.position = {
  invPrices: true, // true for USDC/WETH, false for WETH/USDC
  openPrice: null, // if null, detects from openTime
  closePrice: null, // if null, detects from closeTime
  amountUSD: 100,
  priceHigh: 545,
  priceLow: 555,
  openTime: CONFIG.START_DATE,
  closeTime: CONFIG.END_DATE,
  poolAddress: CONFIG.POOL_ADDRESS,
  poolType: CONFIG.POOL_TYPE,
};

export default CONFIG;
