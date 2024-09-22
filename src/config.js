import { config } from "dotenv";
config();

const CONFIG = {
  UNISWAP_V3_SUBGRAPH_URL: process.env.UNISWAP_V3_SUBGRAPH_URL,
  POOL_ADDRESS: "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640",
  //START_DATE: new Date("2024-01-01T01:00:00.000Z"),
  START_DATE: new Date("2024-09-14T17:10:00.000Z"),
  END_DATE: new Date("2024-09-15T11:15:00.000Z"),
  BATCH_SIZE: 1000,
  DELAY_BETWEEN_REQUESTS: 1000, // in milliseconds

  SHOW_SIMULATION_PROGRESS: true, // print a dot for each hour simulated
};

CONFIG.position = {
  invPrices: true, // true for USDC/WETH, false for WETH/USDC
  openPrice: 2414.3175, // if null, detects from openTime
  closePrice: null, // if null, detects from closeTime
  amountUSD: 51.78,
  priceHigh: 2418.7668,
  priceLow: 2411.5217,
  openTime: CONFIG.START_DATE,
  closeTime: CONFIG.END_DATE,
  poolAddress: CONFIG.POOL_ADDRESS,
};

export default CONFIG;
