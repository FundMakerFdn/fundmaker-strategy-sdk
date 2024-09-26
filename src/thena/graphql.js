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
        feeTier:fee
      }
    }
  `;
export const poolAddressGraphQL = (symbol0, symbol1, _) => `
    query {
      pools(
        where: {
          ${symbol0 != "_" ? `token0_: {symbol: "${symbol0}"}` : ""}
          ${symbol1 != "_" ? `token1_: {symbol: "${symbol1}"}` : ""}
        }
        orderBy: totalValueLockedUSD
        orderDirection: desc
      ) {
        id
        totalValueLockedUSD
        volumeUSD
        feeTier:fee
        token0 {symbol}
        token1 {symbol}
      }
    }
  `;
export const poolTradesGraphQL = (
  poolAddress,
  startTimestamp,
  endTimestamp,
  skip = 0
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
        sqrtPriceX96:price
        tick
      }
    }
  `;
export const poolLiquidityGraphQL = (
  poolAddress,
  startTimestamp,
  endTimestamp,
  skip = 0
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
export const poolFeeTiersGraphQL = (
  poolAddress,
  startTimestamp,
  endTimestamp,
  skip = 0
) => `
    query {
      feeHourDatas(
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
        timestamp
        minFee
        maxFee
      }
    }
  `;
