import { describe, expect, it } from "vitest";
import protocolVectors from "../../docs/protocol-vectors.json";
import vectors from "../../packages/merkle/fixtures/merkle-v1-vectors.json";
import {
  createStateProof,
  createTraceCommitment,
  parseStateProof,
  parseTraceCommitment,
  serializeStateProof,
  serializeTraceCommitment,
  verifyStateProof,
} from "../../packages/merkle/src/index.js";
import { computeNodeHash, encodePublicInputAbi } from "../../packages/vm/src/index.js";

const standard = vectors.standardBudget;
const expectedStandard = {
  program: standard.programHex,
  publicInput: standard.publicInput,
  transitionCount: standard.transitionCount,
  expectedRoot: standard.traceRoot,
};

describe("protocol v1 ordered trace commitments", () => {
  it("reproduces exact ABI inputs, context, leaves, bottom-up proofs, and root vectors", () => {
    expect(standard.publicInputAbiEncoded).toBe(encodePublicInputAbi(standard.publicInput));
    expect(standard.programHex).toBe(protocolVectors.exampleExecution.programHex);
    expect(standard.traceRoot).toBe(protocolVectors.exampleExecution.traceRoot);

    for (const sample of standard.sampledProofs) {
      const proof = createStateProof(
        createTraceCommitment(standard.programHex, standard.publicInput, standard.transitionCount),
        sample.index,
      );
      expect(proof.state).toEqual(sample.state);
      expect(proof.stateAbiEncoded).toBe(sample.stateAbiEncoded);
      expect(proof.stateHash).toBe(sample.stateHash);
      expect(proof.leafHash).toBe(sample.leafHash);
      expect(proof.siblingsBottomUp).toEqual(sample.siblingsBottomUp);
      expect(proof.traceRoot).toBe(standard.traceRoot);
      expect(
        verifyStateProof(proof, {
          ...expectedStandard,
        }),
      ).toBe(sample.verifies);
    }
  });

  it("proves first, middle, and last states with the exact six-level path", () => {
    const trace = createTraceCommitment(standard.programHex, standard.publicInput, 63);
    for (const index of [0, 32, 63]) {
      const proof = createStateProof(trace, index);
      expect(proof.stateIndex).toBe(index);
      expect(proof.siblingsBottomUp).toHaveLength(6);
      expect(verifyStateProof(proof, expectedStandard)).toBe(true);
    }
  });

  it("verifies the maximum-budget 4096-leaf vector at depth twelve", () => {
    const maximum = vectors.maximumBudget;
    expect(maximum.leafCount).toBe(4096);
    expect(maximum.finalSiblingsBottomUp).toHaveLength(12);
    const proof = {
      schema: "bisect.state-proof.v1",
      protocolVersion: 1,
      vmVersion: 1,
      encodingVersion: 1,
      programHex: maximum.programHex,
      publicInput: maximum.publicInput,
      publicInputAbiEncoded: maximum.publicInputAbiEncoded,
      transitionCount: maximum.transitionCount,
      leafCount: maximum.leafCount,
      programHash: maximum.programHash,
      inputHash: maximum.inputHash,
      executionContextHash: maximum.executionContextHash,
      traceRoot: maximum.traceRoot,
      stateIndex: 4095,
      state: maximum.finalState,
      stateAbiEncoded: maximum.finalStateAbiEncoded,
      stateHash: maximum.finalStateHash,
      leafHash: maximum.finalLeafHash,
      siblingsBottomUp: maximum.finalSiblingsBottomUp,
    };
    expect(
      verifyStateProof(proof, {
        program: maximum.programHex,
        publicInput: maximum.publicInput,
        transitionCount: maximum.transitionCount,
        expectedRoot: maximum.traceRoot,
      }),
    ).toBe(maximum.verifies);
  });

  it("rejects malformed and single-leaf inputs outside the fixed v1 budgets", () => {
    expect(() => createTraceCommitment("0x09000000", Array(8).fill("0"), 0)).toThrow();
    expect(() => createTraceCommitment("0x09000000", ["0"], 63)).toThrow();
    expect(() => createTraceCommitment("0x0108000009000000", Array(8).fill("0"), 63)).toThrow();
  });

  it("commits deterministic bounded traces that do not halt for challenger analysis", () => {
    const trace = createTraceCommitment(
      "0x0800000009000000",
      ["1", "0", "0", "0", "0", "0", "0", "0"],
      63,
    );
    expect(trace.haltIndex).toBeNull();
    expect(trace.haltedWithinBudget).toBe(false);
    expect(trace.states).toHaveLength(64);
    expect(trace.states[0]).toEqual(trace.states[63]);
  });

  it("rejects altered states, sibling hashes/order, indices, roots, identities, and trace lengths", () => {
    const trace = createTraceCommitment(standard.programHex, standard.publicInput, 63);
    const proof = createStateProof(trace, 32);
    const changedRegisters = proof.state.registers.map((register, index) =>
      index === 0 ? "99" : register,
    );
    const changedState = { ...proof.state, registers: changedRegisters };
    const changedSiblings = [...proof.siblingsBottomUp];
    changedSiblings[0] = proof.siblingsBottomUp[1] ?? proof.programHash;

    expect(verifyStateProof({ ...proof, state: changedState }, expectedStandard)).toBe(false);
    expect(
      verifyStateProof({ ...proof, siblingsBottomUp: changedSiblings }, expectedStandard),
    ).toBe(false);
    expect(
      verifyStateProof(
        { ...proof, siblingsBottomUp: [...proof.siblingsBottomUp].reverse() },
        expectedStandard,
      ),
    ).toBe(false);
    expect(verifyStateProof({ ...proof, stateIndex: 31 }, expectedStandard)).toBe(false);
    expect(
      verifyStateProof(proof, {
        ...expectedStandard,
        expectedRoot: computeNodeHash(proof.traceRoot, proof.programHash),
      }),
    ).toBe(false);
    expect(verifyStateProof({ ...proof, traceRoot: proof.programHash }, expectedStandard)).toBe(
      false,
    );
    expect(
      verifyStateProof(proof, {
        ...expectedStandard,
        program: "0x010100060300000009000000",
      }),
    ).toBe(false);
    expect(
      verifyStateProof(proof, {
        ...expectedStandard,
        publicInput: ["8", "0", "0", "0", "0", "0", "0", "0"],
      }),
    ).toBe(false);
    expect(
      verifyStateProof(proof, {
        ...expectedStandard,
        transitionCount: 255,
      }),
    ).toBe(false);
    expect(verifyStateProof({ ...proof, leafCount: 65 }, expectedStandard)).toBe(false);
    expect(
      verifyStateProof(
        { ...proof, siblingsBottomUp: proof.siblingsBottomUp.slice(1) },
        expectedStandard,
      ),
    ).toBe(false);
  });

  it("uses position-sensitive ordered nodes rather than OpenZeppelin sorted-pair hashing", () => {
    const trace = createTraceCommitment(standard.programHex, standard.publicInput, 63);
    expect(computeNodeHash(trace.programHash, trace.inputHash)).not.toBe(
      computeNodeHash(trace.inputHash, trace.programHash),
    );
  });

  it("round-trips canonical trace and proof JSON without losing uint64 precision", () => {
    const input = ["18446744073709551615", "0", "0", "0", "0", "0", "0", "0"];
    const trace = createTraceCommitment("0x09000000", input, 63);
    const traceJson = serializeTraceCommitment(trace);
    const parsedTrace = parseTraceCommitment(traceJson);
    expect(serializeTraceCommitment(parsedTrace)).toBe(traceJson);
    expect(parsedTrace.states[0]?.registers[0]).toBe("18446744073709551615");

    const proof = createStateProof(parsedTrace, 63);
    const proofJson = serializeStateProof(proof);
    const parsedProof = parseStateProof(proofJson);
    expect(serializeStateProof(parsedProof)).toBe(proofJson);
    expect(parsedProof.state.registers[0]).toBe("18446744073709551615");
    expect(
      verifyStateProof(parsedProof, {
        program: "0x09000000",
        publicInput: input,
        transitionCount: 63,
        expectedRoot: trace.traceRoot,
      }),
    ).toBe(true);
  });

  it("reproduces the same root across independent VM replays", () => {
    const first = createTraceCommitment(standard.programHex, standard.publicInput, 63);
    const second = createTraceCommitment(standard.programHex, standard.publicInput, 63);
    expect(first.traceRoot).toBe(second.traceRoot);
    expect(serializeTraceCommitment(first)).toBe(serializeTraceCommitment(second));
  });

  it("property-checks state, index, context, and proof tampering across seeded traces", () => {
    const mask = (1n << 64n) - 1n;
    let seed = 0x8b5ad4cef1239071n;
    const nextUint64 = () => {
      seed ^= seed << 13n;
      seed ^= seed >> 7n;
      seed ^= seed << 17n;
      seed &= mask;
      return seed;
    };

    for (let sample = 0; sample < 48; sample += 1) {
      const publicInput = Array.from({ length: 8 }, () => nextUint64().toString());
      const trace = createTraceCommitment("0x09000000", publicInput, 63);
      const index = Number(nextUint64() % 64n);
      const proof = createStateProof(trace, index);
      const context = {
        program: "0x09000000",
        publicInput,
        transitionCount: 63,
        expectedRoot: trace.traceRoot,
      };

      expect(verifyStateProof(proof, context)).toBe(true);
      expect(
        verifyStateProof(
          {
            ...proof,
            state: {
              ...proof.state,
              registers: proof.state.registers.map((value, register) =>
                register === 7 ? (BigInt(value) ^ 1n).toString() : value,
              ),
            },
          },
          context,
        ),
      ).toBe(false);
      expect(verifyStateProof({ ...proof, stateIndex: (index + 1) % 64 }, context)).toBe(false);
      expect(
        verifyStateProof(
          { ...proof, siblingsBottomUp: [...proof.siblingsBottomUp].reverse() },
          context,
        ),
      ).toBe(false);
      expect(
        verifyStateProof(proof, {
          ...context,
          publicInput: ["1", ...publicInput.slice(1)],
        }),
      ).toBe(false);
    }
  }, 15_000);
});
