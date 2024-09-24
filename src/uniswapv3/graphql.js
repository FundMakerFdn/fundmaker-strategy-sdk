import CONFIG from "#src/config.js";

export const poolMetadataGraphQL = (poolAddress) => `
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
        feeTier
      }
    }
  `;
export const poolTradesGraphQL = (
  poolAddress,
  startTimestamp,
  endTimestamp,
  skip
) => `
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
        sqrtPriceX96
        tick
      }
    }
  `;
export const poolLiquidityGraphQL = (
  poolAddress,
  startTimestamp,
  endTimestamp,
  skip
) => `
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
