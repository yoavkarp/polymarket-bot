// Authenticated client for live trading.
// Requires POLYMARKET_PRIVATE_KEY in environment.
// TODO: implement once test mode results are validated.
export function getSecureClient(): never {
  throw new Error('Live trading not yet implemented. Validate with --test mode first.');
}
