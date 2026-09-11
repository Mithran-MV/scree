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
 * The second question, asked of the same seven deployments in the same shape.
 *
 * Where WalletPositions asks what one address holds, this asks what each
 * market is: how much is in it, how much is borrowed, at what threshold it
 * liquidates, how far a fresh borrower may lever, and what it pays. Nothing
 * here names a protocol either, which is what lets one holdfast's plaque and
 * another's be filled from the same fields.
 */
export const MARKETS = /* GraphQL */ `
  query Markets($first: Int!) {
    markets(first: $first, orderBy: totalValueLockedUSD, orderDirection: desc) {
      id
      name
      canBorrowFrom
      canUseAsCollateral
      liquidationThreshold
      maximumLTV
      liquidationPenalty
      inputTokenPriceUSD
      totalValueLockedUSD
      totalDepositBalanceUSD
      totalBorrowBalanceUSD
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
    _meta {
      block {
        number
        timestamp
      }
    }
  }
`;
