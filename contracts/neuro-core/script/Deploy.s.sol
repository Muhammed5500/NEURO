// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {NeuroAgent} from "../src/NeuroAgent.sol";

contract DeployScript is Script {
    function setUp() public {}

    function run() public {
        // Load configuration from environment
        address operator = vm.envAddress("OPERATOR_WALLET_ADDRESS");
        address treasury = vm.envAddress("TREASURY_WALLET_ADDRESS");
        uint256 maxTxValue = vm.envOr("MAX_SINGLE_TX_VALUE_WEI", uint256(1 ether));
        
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        console.log("Deploying NeuroAgent...");
        console.log("Operator:", operator);
        console.log("Treasury:", treasury);
        console.log("Max TX Value:", maxTxValue);

        vm.startBroadcast(deployerPrivateKey);

        NeuroAgent agent = new NeuroAgent(operator, treasury, maxTxValue);

        vm.stopBroadcast();

        console.log("NeuroAgent deployed at:", address(agent));
    }
}
