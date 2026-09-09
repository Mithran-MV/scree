/**
 * One query, asked of every deployment.
 *
 * Nothing here names a protocol. That is the point: Aave, Spark and Compound
 * all answer this because they publish the same schema, so the map fans out
 * across them without a per-protocol adapter, and adding a deployment costs a
 * registry row rather than a code path.
 */
export const WALLET_POSITIONS = /* GraphQL */ `
  query WalletPositions($account: ID!, $first: Int!) {
    account(id: $account) {
      id
      positions(where: { balance_gt: "0" }, first: $first) {
        id
        side
        balance
        market {
          id
          name
          liquidationThreshold
          maximumLTV
          inputTokenPriceUSD
          inputToken {
            id
            symbol
            decimals
          }
          rates(where: { side_in: [LENDER, BORROWER] }) {
            side
            type
            rate
          }
        }
      }
    }
    spot: markets(
      first: 1
      where: { inputToken_: { symbol_in: ["WETH", "WETH.e"] } }
      orderBy: totalValueLockedUSD
      orderDirection: desc
    ) {
      inputTokenPriceUSD
    }
    _meta {
      block {
        number
      }
    }
  }
`;

/**
 * The market rows behind the flood layer: everyone's exposure, not just yours.
 * Ordered by size because the tail cannot move the water table meaningfully and
 * fetching all of it would price the tiles out of reach.
 */
export const MARKET_POSITIONS = /* GraphQL */ `
  query MarketPositions($first: Int!) {
    markets(first: 25, orderBy: totalValueLockedUSD, orderDirection: desc) {
      id
      name
      liquidationThreshold
      inputTokenPriceUSD
      inputToken {
        id
        symbol
        decimals
      }
      positions(
        where: { balance_gt: "0" }
        first: $first
        orderBy: balance
        orderDirection: desc
      ) {
        id
        side
        balance
        account {
          id
        }
      }
    }
    _meta {
      block {
        number
      }
    }
  }
`;
