import { config } from "dotenv";
config();

const CONFIG = {
  POOL_ADDRESS: "0xcbcdf9626bc03e24f779434178a73a0b4bad62ed",
  POOL_TYPE: "uniswapv3", // uniswapv3, thena
  START_DATE: new Date("2024-09-14T17:15:00.000Z"), // data fetch start date
  END_DATE: new Date("2024-09-15T11:12:00.000Z"), // data fetch end date
  BATCH_SIZE: 1000,
  DELAY_BETWEEN_REQUESTS: 1000, // in milliseconds
  SHOW_SIMULATION_PROGRESS: true, // print a dot for each hour simulated

  SUBGRAPH_URLS: {
    uniswapv3: `https://gateway-arbitrum.network.thegraph.com/api/${process.env.SUBGRAPH_API_KEY}/subgraphs/id/5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV`,
    thena: `https://gateway-arbitrum.network.thegraph.com/api/${process.env.SUBGRAPH_API_KEY}/subgraphs/id/Hnjf3ipVMCkQze3jmHp8tpSMgPmtPnXBR38iM4ix1cLt`,
  },

  // Pools with dynamic fee tiers
  DYNAMIC_FEE_POOLS: ["thena"],

  VERBOSE: false,
};

CONFIG.position = {
  invPrices: false, // only visually
  amountUSD: 51,
  uptickPercent: 2, // +% of openPrice for price range
  downtickPercent: 3, // -% of openPrice for price range
  openPrice: null, // if null, detects from openTime
  closePrice: null, // if null, detects from closeTime
  openTime: CONFIG.START_DATE,
  closeTime: CONFIG.END_DATE,
  poolAddress: CONFIG.POOL_ADDRESS,
  poolType: CONFIG.POOL_TYPE,
};

export default CONFIG;
