# @bisect/vm

Independent TypeScript implementation of the locked BISECT VM v1 semantics. It makes no provider, wallet, contract, filesystem, network, or host-callback calls during VM execution.

## Build and import

From the repository root:

    pnpm --filter @bisect/vm build
    pnpm --filter @bisect/vm typecheck

The package build emits JavaScript and declarations to the ignored dist directory. Consumers import its public API from @bisect/vm.

## Public API

- parseProgram(bytesOrHex) validates and decodes canonical four-byte instructions.
- validateProgramBytes(bytes) performs v1 static validation.
- assemble(source) and disassemble(program) convert between readable assembly and canonical bytes.
- initialState(input), step(program, state), verifyTransition(program, before, after).
- generateTrace(program, input, N) returns exactly N+1 deterministic states. It also returns bounded non-halting traces for challenger analysis.
- execute(program, input, N) requires HALT within N transitions and returns the successful execution summary, canonical trace root, and states.
- calculateOutput(program, input, N) returns final R0 as BigInt after a successful run.
- Encoding functions implement the v1 ABI/Keccak formats and Merkle proofs in docs/encoding-spec.md.
- serializeState and serializeCanonicalJson encode each uint64 as an exact base-10 string.
- createExample(name) builds validated examples and provides recommended inputs/budgets.

Registers and public input values are BigInt internally. Public input accepts only nonnegative uint64 BigInts, canonical decimal strings, or safe nonnegative integer Numbers. Unsafe Numbers, fractions, values outside uint64, and arrays other than exactly eight values are rejected.

execute fails with BUDGET_EXHAUSTED if no HALT occurs in the selected budget. generateTrace remains available for the deterministic N-transition trace in that case. A generated trace is not evidence that every transition is valid or that an off-chain party can meet an on-chain deadline.

## CLI

The root bisect command supports:

    pnpm bisect vm --help
    pnpm bisect vm validate example:addition
    pnpm bisect vm run example:addition --input input.json --budget 63
    pnpm bisect vm trace example:nonterminating --input input.json --budget 63 --output trace.json
    pnpm bisect vm inspect example:sum
    pnpm bisect vm disassemble example:fibonacci

Program arguments can be 0x bytecode, a .hex text file, a .bin raw-byte file, an .asm source file, or example:<name>. Input files contain a JSON array of eight values. Use JSON strings for values that may exceed JavaScript's safe integer range. Run exits unsuccessfully for invalid input, malformed programs, or missing HALT; trace exits successfully for any valid bounded trace and states whether it halted.

Available examples: increment, addition, multiplication, sum, fibonacci, factorial, nonterminating, invalid-opcode, malformed-operands. Factorial arithmetic follows uint64 wrapping. Sum and factorial accept at most 14 and 19 respectively under budget 63; Fibonacci accepts at most 11.

## Verification and limits

tests/unit/vm.test.ts covers each opcode, wrapping, malformed programs and inputs, current-PC-relative branches, stuttering, all approved trace sizes, seeded randomized valid programs, exact serialization, known-answer protocol vectors, Merkle membership, and readable-assembly round trips. These tests establish implementation behavior only; VM v1 has not yet been compared to a Solidity verifier implementation and is unaudited.
