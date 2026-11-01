// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { BisectDisputeRegistryV1 } from "../src/BisectDisputeRegistryV1.sol";

interface DeployScriptVm {
    function envUint(string calldata name) external view returns (uint256 value);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Explicit, single-contract Base Sepolia deployment entry point.
/// @dev This script never reads signing material from environment variables. Forge's selected
///      account/keystore supplies the signer; `--broadcast` is required to submit the deployment.
contract BaseSepoliaDeploy {
    uint256 private constant BASE_SEPOLIA_CHAIN_ID = 84532;
    DeployScriptVm private constant vm =
        DeployScriptVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    error WrongChain(uint256 expected, uint256 actual);
    error InvalidBondConfiguration();
    error InvalidWindowConfiguration();
    error DeploymentVerificationFailed();

    function run() external returns (address registryAddress) {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) {
            revert WrongChain(BASE_SEPOLIA_CHAIN_ID, block.chainid);
        }

        uint256 rawBondWei = vm.envUint("BASE_SEPOLIA_BOND_WEI");
        uint256 rawChallengeWindow = vm.envUint("BASE_SEPOLIA_CHALLENGE_WINDOW_BLOCKS");
        uint256 rawTurnWindow = vm.envUint("BASE_SEPOLIA_TURN_WINDOW_BLOCKS");

        if (rawBondWei == 0 || rawBondWei > type(uint96).max) {
            revert InvalidBondConfiguration();
        }
        if (
            rawChallengeWindow == 0 || rawChallengeWindow > 1_000_000 || rawTurnWindow == 0
                || rawTurnWindow > 100_000
        ) {
            revert InvalidWindowConfiguration();
        }

        vm.startBroadcast();
        BisectDisputeRegistryV1 registry = new BisectDisputeRegistryV1(
            uint96(rawBondWei), uint32(rawChallengeWindow), uint32(rawTurnWindow)
        );
        vm.stopBroadcast();

        registryAddress = address(registry);
        if (
            registryAddress.code.length == 0 || registry.BASE_SEPOLIA_CHAIN_ID() != BASE_SEPOLIA_CHAIN_ID
                || registry.PROTOCOL_VERSION() != 1 || registry.VM_VERSION() != 1
                || registry.ENCODING_VERSION() != 1 || registry.bondWei() != rawBondWei
                || registry.challengeWindowBlocks() != rawChallengeWindow
                || registry.turnWindowBlocks() != rawTurnWindow
        ) {
            revert DeploymentVerificationFailed();
        }
    }
}
