// Spenders worth recognising by name. Addresses are lowercase; chains "*" = same address everywhere.
export const KNOWN = {
  '0x000000000022d473030f116ddee9f6b43ac78ba3': { name: 'Uniswap Permit2', chains: '*' },
  '0x0000000000000068f116a894984e2db1123eb395': { name: 'OpenSea Seaport 1.6', chains: '*' },
  '0x00000000000000adc04c56bf30ac9d3c0aaf14dc': { name: 'OpenSea Seaport 1.5', chains: '*' },
  '0x1e0049783f008a0085193e00003d00cd54003c71': { name: 'OpenSea Conduit', chains: '*' },
  '0x111111125421ca6dc452d289314280a0f8842a65': { name: '1inch Router v6', chains: '*' },
  '0x1111111254eeb25477b68fb85ed929f73a960582': { name: '1inch Router v5', chains: '*' },
  '0x66a9893cc07d91d95644aedd05d03f95e1dba8af': { name: 'Uniswap Universal Router v4', chains: [1] },
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad': { name: 'Uniswap Universal Router', chains: [1, 10, 137, 42161, 8453] },
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d': { name: 'Uniswap V2 Router', chains: [1] },
  '0xe592427a0aece92de3edee1f18e0157c05861564': { name: 'Uniswap V3 Router', chains: [1, 10, 137, 42161] },
  '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': { name: 'Uniswap SwapRouter02', chains: [1, 10, 137, 42161] },
  '0x10ed43c718714eb63d5aa57b78b54704e256024e': { name: 'PancakeSwap V2 Router', chains: [56] },
  '0x13f4ea83d0bd40e75c8222255bc855a974568dd4': { name: 'PancakeSwap Smart Router', chains: [56, 1, 8453, 42161] },
  '0x1b81d678ffb9c0263b24a97847620c99d213eb14': { name: 'PancakeSwap V3 Router', chains: [56, 1, 8453, 42161] },
  '0x31c2f6fcff4f8759b3bd5bf0e1084a055615c768': { name: 'PancakeSwap Permit2', chains: [56, 1, 8453, 42161] },
};

// Spenders with a public, documented exploit that drains standing approvals. Keep this list short and sourced.
export const FLAGGED = {
  // Multichain (AnySwap) Router V4: anySwapOutUnderlyingWithPermit drains WETH approvals (Jan 2022, again Feb 2023).
  // https://etherscan.io/address/0x6b7a87899490ece95443e979ca9485cbe7e71522 (tagged "High Risk")
  // https://medium.com/multichainorg/multichain-contract-vulnerability-post-mortem-d37bfab237c8
  '0x6b7a87899490ece95443e979ca9485cbe7e71522': { name: 'Multichain Router V4', chains: [1], why: 'exploited router: anyone can pull tokens approved to it (Multichain, Jan 2022)' },
};

const match = (table, address, chainId) => {
  const k = table[address.toLowerCase()];
  return k && (k.chains === '*' || k.chains.includes(chainId)) ? k : null;
};
export const knownSpender = (address, chainId) => match(KNOWN, address, chainId)?.name ?? null;
export const flaggedSpender = (address, chainId) => match(FLAGGED, address, chainId);
