// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {NeuroAgent} from "../src/NeuroAgent.sol";

contract NeuroAgentTest is Test {
    NeuroAgent public agent;
    
    address public owner = address(1);
    address public operator = address(2);
    address public treasury = address(3);
    address public attacker = address(4);
    
    uint256 public constant MAX_TX_VALUE = 1 ether;

    function setUp() public {
        vm.startPrank(owner);
        agent = new NeuroAgent(operator, treasury, MAX_TX_VALUE);
        vm.stopPrank();
    }

    // ============================================
    // DEPLOYMENT TESTS
    // ============================================

    function test_Deployment() public view {
        assertEq(agent.owner(), owner);
        assertEq(agent.operator(), operator);
        assertEq(agent.treasury(), treasury);
        assertEq(agent.maxSingleTxValue(), MAX_TX_VALUE);
        assertEq(uint8(agent.executionMode()), uint8(NeuroAgent.ExecutionMode.READ_ONLY));
        assertFalse(agent.killSwitchEnabled());
    }

    function testFail_DeployWithZeroOperator() public {
        new NeuroAgent(address(0), treasury, MAX_TX_VALUE);
    }

    function testFail_DeployWithZeroTreasury() public {
        new NeuroAgent(operator, address(0), MAX_TX_VALUE);
    }

    // ============================================
    // KILL SWITCH TESTS
    // ============================================

    function test_ActivateKillSwitch() public {
        vm.prank(operator);
        agent.activateKillSwitch("Emergency");
        
        assertTrue(agent.killSwitchEnabled());
        assertEq(agent.killSwitchReason(), "Emergency");
        assertTrue(agent.paused());
    }

    function test_DeactivateKillSwitch() public {
        vm.prank(operator);
        agent.activateKillSwitch("Emergency");
        
        vm.prank(owner);
        agent.deactivateKillSwitch();
        
        assertFalse(agent.killSwitchEnabled());
        assertEq(agent.killSwitchReason(), "");
        assertFalse(agent.paused());
    }

    function testFail_AttackerActivateKillSwitch() public {
        vm.prank(attacker);
        agent.activateKillSwitch("Hack");
    }

    function testFail_OperatorDeactivateKillSwitch() public {
        vm.prank(operator);
        agent.activateKillSwitch("Emergency");
        
        vm.prank(operator);
        agent.deactivateKillSwitch(); // Should fail - only owner
    }

    // ============================================
    // EXECUTION MODE TESTS
    // ============================================

    function test_SetExecutionMode() public {
        vm.prank(owner);
        agent.setExecutionMode(NeuroAgent.ExecutionMode.WRITE_ENABLED);
        
        assertEq(uint8(agent.executionMode()), uint8(NeuroAgent.ExecutionMode.WRITE_ENABLED));
        assertTrue(agent.canWrite());
    }

    function testFail_SetExecutionModeWhenKillSwitched() public {
        vm.prank(operator);
        agent.activateKillSwitch("Emergency");
        
        vm.prank(owner);
        agent.setExecutionMode(NeuroAgent.ExecutionMode.WRITE_ENABLED);
    }

    function testFail_OperatorSetExecutionMode() public {
        vm.prank(operator);
        agent.setExecutionMode(NeuroAgent.ExecutionMode.WRITE_ENABLED);
    }

    // ============================================
    // ACTION TESTS
    // ============================================

    function test_ProposeAction() public {
        vm.prank(operator);
        bytes32 actionId = agent.proposeAction(
            address(0x123),
            0.5 ether,
            "",
            block.timestamp + 1 hours
        );
        
        assertTrue(actionId != bytes32(0));
    }

    function testFail_ProposeActionExceedsLimit() public {
        vm.prank(operator);
        agent.proposeAction(
            address(0x123),
            2 ether, // Exceeds MAX_TX_VALUE
            "",
            block.timestamp + 1 hours
        );
    }

    function test_FullActionFlow() public {
        // Enable write mode
        vm.prank(owner);
        agent.setExecutionMode(NeuroAgent.ExecutionMode.WRITE_ENABLED);
        
        // Fund the agent
        vm.deal(address(agent), 10 ether);
        
        // Propose action
        vm.prank(operator);
        bytes32 actionId = agent.proposeAction(
            treasury,
            0.5 ether,
            "",
            block.timestamp + 1 hours
        );
        
        // Approve action
        vm.prank(owner);
        agent.approveAction(actionId);
        
        // Execute action
        uint256 treasuryBalanceBefore = treasury.balance;
        
        vm.prank(operator);
        agent.executeAction(actionId);
        
        assertEq(treasury.balance, treasuryBalanceBefore + 0.5 ether);
    }

    // ============================================
    // VIEW FUNCTION TESTS
    // ============================================

    function test_CanWrite() public {
        assertFalse(agent.canWrite()); // Default is READ_ONLY
        
        vm.prank(owner);
        agent.setExecutionMode(NeuroAgent.ExecutionMode.WRITE_ENABLED);
        
        assertTrue(agent.canWrite());
        
        vm.prank(operator);
        agent.activateKillSwitch("Test");
        
        assertFalse(agent.canWrite());
    }

    function test_GetSecurityState() public view {
        (
            bool killSwitch,
            NeuroAgent.ExecutionMode mode,
            bool paused,
            uint256 maxValue
        ) = agent.getSecurityState();
        
        assertFalse(killSwitch);
        assertEq(uint8(mode), uint8(NeuroAgent.ExecutionMode.READ_ONLY));
        assertFalse(paused);
        assertEq(maxValue, MAX_TX_VALUE);
    }
}
