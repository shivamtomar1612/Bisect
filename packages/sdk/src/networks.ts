export const BASE_SEPOLIA = {
  id: 84532,
  name: "Base Sepolia",
  rpcUrl: "https://sepolia.base.org",
  explorerUrl: "https://sepolia.basescan.org",
  currency: { name: "Ether", symbol: "ETH", decimals: 18 },
} as const;

export const LOCAL_ANVIL = {
  id: 31337,
  name: "Local Anvil",
  rpcUrl: "http://127.0.0.1:8545",
  currency: { name: "Ether", symbol: "ETH", decimals: 18 },
} as const;
