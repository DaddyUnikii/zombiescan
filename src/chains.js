// Chain registry. Every RPC here is a free public endpoint; pass --rpc to use your own.
//   rpc        endpoints that answer topic-only eth_getLogs (needed to find approvals without an API key)
//   archive    endpoints that answer state at old blocks (used to prove a dead spender once had code)
//   blockscout keyless etherscan-compatible API, when the chain has one that answers scripts
export const CHAINS = {
  eth: { id: 1, name: 'Ethereum', native: 'ETH', blockTime: 12,
    rpc: ['https://ethereum-rpc.publicnode.com', 'https://mainnet.gateway.tenderly.co', 'https://eth.llamarpc.com'],
    archive: ['https://mainnet.gateway.tenderly.co'],
    blockscout: 'https://eth.blockscout.com/api', explorer: 'https://etherscan.io' },
  bsc: { id: 56, name: 'BNB Chain', native: 'BNB', blockTime: 0.45,
    rpc: ['https://rpc-bsc.48.club', 'https://bsc-rpc.publicnode.com', 'https://bsc.drpc.org', 'https://bsc.rpc.blxrbdn.com'],
    archive: [], explorer: 'https://bscscan.com' },
  base: { id: 8453, name: 'Base', native: 'ETH', blockTime: 2,
    rpc: ['https://base.gateway.tenderly.co', 'https://base-rpc.publicnode.com', 'https://mainnet.base.org'],
    archive: ['https://base.gateway.tenderly.co'],
    blockscout: 'https://base.blockscout.com/api', explorer: 'https://basescan.org' },
  arb: { id: 42161, name: 'Arbitrum', native: 'ETH', blockTime: 0.25,
    rpc: ['https://arbitrum.gateway.tenderly.co', 'https://arbitrum-one-rpc.publicnode.com', 'https://arb1.arbitrum.io/rpc'],
    archive: [],
    blockscout: 'https://arbitrum.blockscout.com/api', explorer: 'https://arbiscan.io' },
  op: { id: 10, name: 'Optimism', native: 'ETH', blockTime: 2,
    rpc: ['https://optimism.gateway.tenderly.co', 'https://optimism-rpc.publicnode.com', 'https://mainnet.optimism.io'],
    archive: ['https://optimism.gateway.tenderly.co'],
    blockscout: 'https://explorer.optimism.io/api', explorer: 'https://optimistic.etherscan.io' },
  polygon: { id: 137, name: 'Polygon', native: 'POL', blockTime: 2,
    rpc: ['https://polygon.gateway.tenderly.co', 'https://polygon-bor-rpc.publicnode.com', 'https://polygon-rpc.com'],
    archive: ['https://polygon.gateway.tenderly.co'],
    blockscout: 'https://polygon.blockscout.com/api', explorer: 'https://polygonscan.com' },
};

export const ALIASES = { ethereum: 'eth', mainnet: 'eth', bnb: 'bsc', binance: 'bsc', arbitrum: 'arb', optimism: 'op', matic: 'polygon' };

export function resolveChain(key) {
  const k = String(key).toLowerCase();
  const name = CHAINS[k] ? k : ALIASES[k];
  if (!name) throw new Error(`unknown chain "${key}" (try: ${Object.keys(CHAINS).join(', ')}, all)`);
  return { key: name, ...CHAINS[name] };
}
