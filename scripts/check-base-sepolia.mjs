const endpoint = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const expectedChainId = 84532n;

const response = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
  signal: AbortSignal.timeout(15_000),
});
if (!response.ok) throw new Error(`Base Sepolia RPC returned HTTP ${response.status}`);
const payload = await response.json();
if (payload.error) throw new Error(`Base Sepolia RPC error: ${payload.error.message}`);
const actual = BigInt(payload.result);
if (actual !== expectedChainId) throw new Error(`Expected chain ID 84532; received ${actual}`);
console.log(`Base Sepolia RPC verified chain ID ${actual}.`);
