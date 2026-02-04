// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title INeuroAgent
 * @notice Interface for the NEURO Agent contract
 */
interface INeuroAgent {
    enum ExecutionMode {
        READ_ONLY,
        WRITE_ENABLED
    }

    struct PendingAction {
        bytes32 actionId;
        address target;
        uint256 value;
        bytes data;
        uint256 deadline;
        bool executed;
        bool approved;
    }

    // Events
    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event KillSwitchActivated(address indexed activatedBy, string reason);
    event KillSwitchDeactivated(address indexed deactivatedBy);
    event ExecutionModeChanged(ExecutionMode oldMode, ExecutionMode newMode);
    event ActionExecuted(bytes32 indexed actionId, address indexed executor, bytes data);

    // Kill Switch
    function activateKillSwitch(string calldata reason) external;
    function deactivateKillSwitch() external;
    function killSwitchEnabled() external view returns (bool);

    // Execution Mode
    function setExecutionMode(ExecutionMode _mode) external;
    function executionMode() external view returns (ExecutionMode);

    // Operator & Treasury
    function operator() external view returns (address);
    function treasury() external view returns (address);
    function setOperator(address _operator) external;
    function setTreasury(address _treasury) external;

    // Actions
    function proposeAction(
        address target,
        uint256 value,
        bytes calldata data,
        uint256 deadline
    ) external returns (bytes32 actionId);
    function approveAction(bytes32 actionId) external;
    function executeAction(bytes32 actionId) external;

    // View
    function canWrite() external view returns (bool);
    function getSecurityState() external view returns (
        bool _killSwitchEnabled,
        ExecutionMode _executionMode,
        bool _paused,
        uint256 _maxSingleTxValue
    );
}
