import { config } from "dotenv";
config();

const CONFIG = {
  POOL_ADDRESS: "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640",
  POOL_TYPE: "uniswapv3", // uniswapv3, thena
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

  VERBOSE: false,
};

CONFIG.position = {
  invPrices: true, // only visually
  amountUSD: 52,
  uptickPercent: 1, // +% of openPrice for price range
  downtickPercent: 1, // -% of openPrice for price range
  openPrice: null, // if null, detects from openTime
  closePrice: null, // if null, detects from closeTime
  openTime: CONFIG.START_DATE,
  closeTime: CONFIG.END_DATE,
  poolAddress: CONFIG.POOL_ADDRESS,
  poolType: CONFIG.POOL_TYPE,
};

export default CONFIG;
