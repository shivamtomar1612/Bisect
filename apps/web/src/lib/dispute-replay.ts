import { computeNodeHash } from "@bisect/vm";
import type { Hex } from "viem";

export type ReplayRound = {
  round: number;
  low: number;
  high: number;
  midpoint: number;
  retained: "left" | "right";
  remaining: number;
  proverParent: Hex;
  challengerParent: Hex;
  proverChildren: readonly [Hex, Hex];
  challengerChildren: readonly [Hex, Hex];
  transactionHashes: readonly [Hex, Hex] | null;
  blockNumber: string | null;
};

export type Replay = {
  chainId: number | null;
  contractAddress: string | null;
  claimId: string | null;
  gameNumber: string | null;
  rounds: ReplayRound[];
  complete: boolean;
  issue: string | null;
  finalIndex: number | null;
  winner: string | null;
  creditedWei: string | null;
  bondWei: string | null;
  proverBondStatus: string | null;
  challengerBondStatus: string | null;
  transitionCount: number;
  proverRoot: Hex;
  challengerRoot: Hex;
  lagBlocks: string | null;
};

type Item = {
  eventName: string;
  payload: Record<string, unknown>;
  blockNumber: bigint;
  transactionHash: Hex;
  transactionIndex: number;
  logIndex: number;
};

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Malformed indexed event or timeline.");
  return value as Record<string, unknown>;
}
function decimal(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value))
    throw new Error("Malformed indexed decimal value.");
  return BigInt(value);
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Malformed indexed integer value.");
  return value;
}
function hash(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new Error("Malformed indexed hash.");
  return value as Hex;
}
function address(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value))
    throw new Error("Malformed indexed address.");
  return value.toLowerCase();
}
function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function replayDisputeTimeline(
  value: unknown,
  expected?: { claimId: string; gameNumber: string },
): Replay {
  const timeline = record(value);
  const chainId = integer(timeline["chainId"]);
  const contractAddress = address(timeline["contractAddress"]);
  const claimId = decimal(timeline["claimId"]).toString();
  const gameNumber = decimal(timeline["gameNumber"]).toString();
  if (expected && (claimId !== expected.claimId || gameNumber !== expected.gameNumber))
    throw new Error("Timeline identifiers do not match the requested dispute.");
  const count = integer(timeline["transitionCount"]);
  if (![63, 255, 1023, 4095].includes(count))
    throw new Error("Unsupported execution budget in indexed dispute.");
  const expectedRounds = integer(timeline["expectedRounds"]);
  const proverRoot = hash(timeline["proverRoot"]);
  const challengerRoot = hash(timeline["challengerRoot"]);
  const prover = address(timeline["prover"]);
  const challenger = address(timeline["challenger"]);
  const lagBlocks = decimal(record(timeline["lag"])["lagBlocks"]).toString();
  const proverBond = timeline["proverBond"] === null ? null : record(timeline["proverBond"]);
  const challengerBond =
    timeline["challengerBond"] === null ? null : record(timeline["challengerBond"]);
  const proverBondStatus = proverBond === null ? null : String(proverBond["status"]);
  const challengerBondStatus = challengerBond === null ? null : String(challengerBond["status"]);
  if (
    [proverBondStatus, challengerBondStatus].some(
      (status) => status !== null && !["LOCKED", "RELEASED", "SLASHED"].includes(status),
    )
  )
    throw new Error("Indexed bond status is malformed.");
  const base = {
    chainId,
    contractAddress,
    claimId,
    gameNumber,
    transitionCount: count,
    proverRoot,
    challengerRoot,
    lagBlocks,
    proverBondStatus,
    challengerBondStatus,
  };
  if (timeline["truncated"] !== false) throw new Error("Indexed event history is truncated.");
  if (!Array.isArray(timeline["events"])) throw new Error("Indexed dispute events are malformed.");
  const events: Item[] = timeline["events"].map((raw: unknown) => {
    const item = record(raw);
    if (typeof item["eventName"] !== "string") throw new Error("Indexed event name is malformed.");
    return {
      eventName: item["eventName"],
      payload: record(item["payload"]),
      blockNumber: decimal(item["blockNumber"]),
      transactionHash: hash(item["transactionHash"]),
      transactionIndex: integer(item["transactionIndex"]),
      logIndex: integer(item["logIndex"]),
    };
  });
  for (let i = 1; i < events.length; i++) {
    const previous = events[i - 1] as Item;
    const current = events[i] as Item;
    if (
      current.blockNumber < previous.blockNumber ||
      (current.blockNumber === previous.blockNumber &&
        (current.transactionIndex < previous.transactionIndex ||
          (current.transactionIndex === previous.transactionIndex &&
            current.logIndex <= previous.logIndex)))
    )
      throw new Error("Indexed dispute events are out of order.");
  }
  const opening = events[0];
  if (!opening || opening.eventName !== "ChallengeStarted")
    return {
      ...base,
      rounds: [],
      complete: false,
      issue: "Confirmed challenge opening is missing from the indexer.",
      finalIndex: null,
      winner: null,
      creditedWei: null,
      bondWei: null,
    };
  const bondWei = decimal(opening.payload["bondWei"]).toString();
  if (
    (proverBond && decimal(proverBond["amountWei"]).toString() !== bondWei) ||
    (challengerBond && decimal(challengerBond["amountWei"]).toString() !== bondWei)
  )
    throw new Error("Indexed bond amount disagrees with the challenge event.");
  if (
    !same(hash(opening.payload["challengerRoot"]), challengerRoot) ||
    integer(opening.payload["initialHeight"]) !== Math.log2(count + 1)
  )
    throw new Error("Challenge opening contradicts indexed commitments.");
  let baseIndex = 0;
  let height = Math.log2(count + 1);
  let proverNode = proverRoot;
  let challengerNode = challengerRoot;
  const rounds: ReplayRound[] = [];
  let cursor = 1;
  let interruptedTurn = false;
  while (cursor < events.length && events[cursor]?.eventName === "DisputeChildrenRevealed") {
    const first = events[cursor];
    const second = events[cursor + 1];
    const resolved = events[cursor + 2];
    if (
      !first ||
      !second ||
      !resolved ||
      second.eventName !== "DisputeChildrenRevealed" ||
      resolved.eventName !== "BisectionLevelResolved"
    ) {
      interruptedTurn = true;
      break;
    }
    if (
      height < 1 ||
      address(first.payload["responder"]) !== prover ||
      address(second.payload["responder"]) !== challenger
    )
      throw new Error("Bisection responder order is invalid.");
    const proverChildren: [Hex, Hex] = [
      hash(first.payload["leftChild"]),
      hash(first.payload["rightChild"]),
    ];
    const challengerChildren: [Hex, Hex] = [
      hash(second.payload["leftChild"]),
      hash(second.payload["rightChild"]),
    ];
    if (
      !same(computeNodeHash(...proverChildren), proverNode) ||
      !same(computeNodeHash(...challengerChildren), challengerNode)
    )
      throw new Error("Child hashes do not authenticate against the committed parent nodes.");
    const leftDiffers = !same(proverChildren[0], challengerChildren[0]);
    const rightDiffers = !same(proverChildren[1], challengerChildren[1]);
    if (!leftDiffers && !rightDiffers) throw new Error("A resolved round has no differing child.");
    const low = baseIndex;
    const high = baseIndex + 2 ** height - 1;
    const midpoint = baseIndex + 2 ** (height - 1);
    const retained = leftDiffers ? "left" : "right";
    if (retained === "right") baseIndex = midpoint;
    height -= 1;
    proverNode = proverChildren[retained === "left" ? 0 : 1];
    challengerNode = challengerChildren[retained === "left" ? 0 : 1];
    if (
      integer(resolved.payload["subtreeBaseIndex"]) !== baseIndex ||
      integer(resolved.payload["subtreeHeight"]) !== height ||
      !same(hash(resolved.payload["proverNode"]), proverNode) ||
      !same(hash(resolved.payload["challengerNode"]), challengerNode)
    )
      throw new Error("Resolved interval contradicts authenticated child commitments.");
    rounds.push({
      round: rounds.length + 1,
      low,
      high,
      midpoint,
      retained,
      remaining: 2 ** height,
      proverParent: computeNodeHash(...proverChildren),
      challengerParent: computeNodeHash(...challengerChildren),
      proverChildren,
      challengerChildren,
      transactionHashes: [first.transactionHash, second.transactionHash],
      blockNumber: resolved.blockNumber.toString(),
    });
    cursor += 3;
  }
  if (rounds.length !== expectedRounds)
    return {
      ...base,
      rounds,
      complete: false,
      issue: `Indexer has ${rounds.length} authenticated rounds; read model expects ${expectedRounds}.`,
      finalIndex: null,
      winner: null,
      creditedWei: null,
      bondWei,
    };
  const finalIndex = height === 0 ? baseIndex : null;
  const resolution = events.find((event) => event.eventName === "GameResolved");
  const credit = events.find((event) => event.eventName === "GameBondCredited");
  if (!resolution || !credit)
    return {
      ...base,
      rounds,
      complete: false,
      issue: interruptedTurn
        ? "A round has one confirmed child reveal; waiting for the response or timeout."
        : finalIndex === null
          ? "Dispute remains active; later rounds are not yet confirmed."
          : "Terminal verification or settlement is not yet confirmed.",
      finalIndex,
      winner: null,
      creditedWei: null,
      bondWei,
    };
  const outcome = integer(resolution.payload["outcome"]);
  if (outcome < 1 || outcome > 5) throw new Error("Unknown dispute outcome.");
  if (finalIndex === null && outcome !== 2 && outcome !== 4)
    return {
      ...base,
      rounds,
      complete: false,
      issue: "Resolution exists but authenticated bisection rounds are missing.",
      finalIndex: null,
      winner: null,
      creditedWei: null,
      bondWei,
    };
  if (outcome !== 2 && outcome !== 4) {
    const terminalEvents = events.filter((event) => event.eventName === "TerminalEvidenceRevealed");
    if (terminalEvents.length !== 2)
      return {
        ...base,
        rounds,
        complete: false,
        issue: "Terminal proof events are missing from the confirmed timeline.",
        finalIndex,
        winner: null,
        creditedWei: null,
        bondWei,
      };
    if (
      address(terminalEvents[0]?.payload["responder"]) !== challenger ||
      address(terminalEvents[1]?.payload["responder"]) !== prover ||
      terminalEvents.some((event) => integer(event.payload["differentIndex"]) !== finalIndex)
    )
      throw new Error("Terminal proof event order or disputed index is inconsistent.");
  }
  if (interruptedTurn && outcome !== 2 && outcome !== 4)
    throw new Error("An unresolved child turn cannot precede a proof-based resolution.");
  const winner = address(resolution.payload["winner"]);
  if (
    timeline["status"] !== (outcome <= 2 ? "PROVER_WON" : "CHALLENGER_WON") ||
    timeline["outcome"] !== outcome
  )
    throw new Error("Indexed dispute outcome does not reconcile with the resolution event.");
  if (
    winner !== (outcome <= 2 ? prover : challenger) ||
    address(credit.payload["beneficiary"]) !== winner ||
    integer(credit.payload["outcome"]) !== outcome
  )
    throw new Error("Settlement beneficiary or outcome contradicts the protocol.");
  if (finalIndex !== null && integer(resolution.payload["differentIndex"]) !== finalIndex)
    throw new Error("Resolution differs from the authenticated leaf index.");
  const creditedWei = decimal(credit.payload["amountWei"]).toString();
  const expectedCredit = outcome <= 2 ? BigInt(bondWei) : BigInt(bondWei) * 2n;
  if (BigInt(creditedWei) !== expectedCredit)
    throw new Error("Credited amount contradicts the zero-fee v1 bond policy.");
  if (
    !Array.isArray(timeline["settlements"]) ||
    !timeline["settlements"].some((raw: unknown) => {
      const settlement = record(raw);
      return (
        decimal(settlement["amountWei"]).toString() === creditedWei &&
        address(record(settlement["beneficiary"])["address"]) === winner
      );
    })
  )
    throw new Error("Indexed settlement does not reconcile with the confirmed credit event.");
  return {
    ...base,
    rounds,
    complete: true,
    issue: interruptedTurn
      ? "A turn timed out after one child reveal; no missing round was invented."
      : null,
    finalIndex,
    winner,
    creditedWei,
    bondWei,
  };
}
