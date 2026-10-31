export function formatWei(value: bigint | string): string {
  const amount = typeof value === "bigint" ? value : BigInt(value);
  if (amount < 0n) throw new Error("ETH amount cannot be negative.");
  const whole = amount / 10n ** 18n;
  const fraction = (amount % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction.length ? whole.toString() + "." + fraction : whole.toString();
}
