# Scree

**A survey map of how you get liquidated.**

Every lending app reduces your risk to a single number: *"liquidated at $3,434."*
That number is a scalar standing in for a field, and it is most wrong exactly when
it matters. Scree renders the field.

## The map

| Axis | Meaning |
|---|---|
| left to right | price of your primary collateral, -60% to +60% of spot, log scale |
| bottom to top | **dwell** — how long price has continuously stayed at or below that level, 0 to 30 days |
| elevation | health factor minus one, minimised across every lending deployment you borrow from |
| sea level | liquidation |

High ground is safe. The coastline is where you die.

## Status

Early. Built from scratch for ETHOnline 2026. See the commit history.

## Licence

MIT. See [LICENSE](LICENSE).
