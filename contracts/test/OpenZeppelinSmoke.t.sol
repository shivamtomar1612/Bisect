// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ReentrancyGuardSmoke is ReentrancyGuard {
    function guarded() external nonReentrant returns (bool) {
        return true;
    }
}

contract OpenZeppelinSmokeTest {
    function testReentrancyGuardImportAndCall() external {
        require(new ReentrancyGuardSmoke().guarded(), "guarded call failed");
    }
}
