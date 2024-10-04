import { config } from "dotenv";
config();

const CONFIG = {
  POOL_ADDRESS: "0x1123e75b71019962cd4d21b0f3018a6412edb63c",
  POOL_TYPE: "thena", // uniswapv3, thena
  START_DATE: new Date("2024-09-14T17:12:00.000Z"), // data fetch start date
  END_DATE: new Date("2024-09-30T11:12:00.000Z"), // data fetch end date
  BATCH_SIZE: 1000,
  DELAY_BETWEEN_REQUESTS: 1000, // in milliseconds
  SHOW_SIMULATION_PROGRESS: true, // print a dot for each hour simulated

  SUBGRAPH_URLS: {
    uniswapv3: `https://gateway-arbitrum.network.thegraph.com/api/${process.env.SUBGRAPH_API_KEY}/subgraphs/id/5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV`,
    thena: `https://gateway-arbitrum.network.thegraph.com/api/${process.env.SUBGRAPH_API_KEY}/subgraphs/id/Hnjf3ipVMCkQze3jmHp8tpSMgPmtPnXBR38iM4ix1cLt`,
  },

  // Pools with dynamic fee tiers
  DYNAMIC_FEE_POOLS: ["thena"],

  // Make sure that the swap reflects the current price
  SWAP_USD_THRESHOLD: 1,

  VERBOSE: false,
};

CONFIG.position = {
  invPrices: true, // only visually
  amountUSD: 52,
  uptickPercent: 20, // +% of openPrice for price range
  downtickPercent: 20, // -% of openPrice for price range
  openPrice: null, // if null, detects from openTime
  closePrice: null, // if null, detects from closeTime
  openTime: CONFIG.START_DATE,
  closeTime: CONFIG.END_DATE,
  poolAddress: CONFIG.POOL_ADDRESS,
  poolType: CONFIG.POOL_TYPE,
};

export default CONFIG;
