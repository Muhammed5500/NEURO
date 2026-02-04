// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title NeuroAgent
 * @notice Core agent contract for NEURO on Monad Mainnet
 * @dev Implements kill switch, operator management, and treasury separation
 */
contract NeuroAgent is Ownable, Pausable, ReentrancyGuard {
    // ============================================
    // EVENTS
    // ============================================
    
    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event KillSwitchActivated(address indexed activatedBy, string reason);
    event KillSwitchDeactivated(address indexed deactivatedBy);
    event ExecutionModeChanged(ExecutionMode oldMode, ExecutionMode newMode);
    event ActionExecuted(bytes32 indexed actionId, address indexed executor, bytes data);
    event MaxValueUpdated(uint256 oldValue, uint256 newValue);

    // ============================================
    // ERRORS
    // ============================================

    error KillSwitchActive();
    error ReadOnlyMode();
    error Unauthorized();
    error ValueExceedsLimit(uint256 value, uint256 limit);
    error InvalidAddress();
    error ActionExpired();
    error ActionAlreadyExecuted();

    // ============================================
    // TYPES
    // ============================================

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

    // ============================================
    // STATE
    // ============================================

    /// @notice Operator address for daily operations
    address public operator;
    
    /// @notice Treasury address for large holdings
    address public treasury;
    
    /// @notice Current execution mode
    ExecutionMode public executionMode;
    
    /// @notice Kill switch state
    bool public killSwitchEnabled;
    
    /// @notice Kill switch reason
    string public killSwitchReason;
    
    /// @notice Maximum single transaction value in wei
    uint256 public maxSingleTxValue;
    
    /// @notice Pending actions mapping
    mapping(bytes32 => PendingAction) public pendingActions;
    
    /// @notice Action nonce for unique IDs
    uint256 public actionNonce;

    // ============================================
    // MODIFIERS
    // ============================================

    modifier onlyOperator() {
        if (msg.sender != operator && msg.sender != owner()) {
            revert Unauthorized();
        }
        _;
    }

    modifier notKillSwitched() {
        if (killSwitchEnabled) {
            revert KillSwitchActive();
        }
        _;
    }

    modifier writeEnabled() {
        if (executionMode == ExecutionMode.READ_ONLY) {
            revert ReadOnlyMode();
        }
        _;
    }

    // ============================================
    // CONSTRUCTOR
    // ============================================

    constructor(
        address _operator,
        address _treasury,
        uint256 _maxSingleTxValue
    ) Ownable(msg.sender) {
        if (_operator == address(0) || _treasury == address(0)) {
            revert InvalidAddress();
        }
        
        operator = _operator;
        treasury = _treasury;
        maxSingleTxValue = _maxSingleTxValue;
        executionMode = ExecutionMode.READ_ONLY; // Default to read-only
        
        emit OperatorUpdated(address(0), _operator);
        emit TreasuryUpdated(address(0), _treasury);
    }

    // ============================================
    // KILL SWITCH
    // ============================================

    /**
     * @notice Activates the kill switch
     * @param reason Reason for activation
     */
    function activateKillSwitch(string calldata reason) external onlyOperator {
        killSwitchEnabled = true;
        killSwitchReason = reason;
        _pause();
        emit KillSwitchActivated(msg.sender, reason);
    }

    /**
     * @notice Deactivates the kill switch (owner only)
     */
    function deactivateKillSwitch() external onlyOwner {
        killSwitchEnabled = false;
        killSwitchReason = "";
        _unpause();
        emit KillSwitchDeactivated(msg.sender);
    }

    // ============================================
    // EXECUTION MODE
    // ============================================

    /**
     * @notice Sets the execution mode
     * @param _mode New execution mode
     */
    function setExecutionMode(ExecutionMode _mode) external onlyOwner notKillSwitched {
        ExecutionMode oldMode = executionMode;
        executionMode = _mode;
        emit ExecutionModeChanged(oldMode, _mode);
    }

    // ============================================
    // OPERATOR & TREASURY MANAGEMENT
    // ============================================

    /**
     * @notice Updates the operator address
     * @param _operator New operator address
     */
    function setOperator(address _operator) external onlyOwner {
        if (_operator == address(0)) revert InvalidAddress();
        address oldOperator = operator;
        operator = _operator;
        emit OperatorUpdated(oldOperator, _operator);
    }

    /**
     * @notice Updates the treasury address
     * @param _treasury New treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert InvalidAddress();
        address oldTreasury = treasury;
        treasury = _treasury;
        emit TreasuryUpdated(oldTreasury, _treasury);
    }

    /**
     * @notice Updates the maximum single transaction value
     * @param _maxValue New maximum value in wei
     */
    function setMaxSingleTxValue(uint256 _maxValue) external onlyOwner {
        uint256 oldValue = maxSingleTxValue;
        maxSingleTxValue = _maxValue;
        emit MaxValueUpdated(oldValue, _maxValue);
    }

    // ============================================
    // ACTION EXECUTION
    // ============================================

    /**
     * @notice Proposes an action for execution
     * @param target Target contract address
     * @param value ETH value to send
     * @param data Calldata for the action
     * @param deadline Expiration timestamp
     * @return actionId Unique action identifier
     */
    function proposeAction(
        address target,
        uint256 value,
        bytes calldata data,
        uint256 deadline
    ) external onlyOperator notKillSwitched returns (bytes32 actionId) {
        if (value > maxSingleTxValue) {
            revert ValueExceedsLimit(value, maxSingleTxValue);
        }

        actionId = keccak256(abi.encodePacked(target, value, data, deadline, actionNonce++));
        
        pendingActions[actionId] = PendingAction({
            actionId: actionId,
            target: target,
            value: value,
            data: data,
            deadline: deadline,
            executed: false,
            approved: false
        });

        return actionId;
    }

    /**
     * @notice Approves a pending action (owner only)
     * @param actionId Action to approve
     */
    function approveAction(bytes32 actionId) external onlyOwner notKillSwitched {
        PendingAction storage action = pendingActions[actionId];
        if (action.executed) revert ActionAlreadyExecuted();
        if (block.timestamp > action.deadline) revert ActionExpired();
        
        action.approved = true;
    }

    /**
     * @notice Executes an approved action
     * @param actionId Action to execute
     */
    function executeAction(bytes32 actionId) 
        external 
        onlyOperator 
        notKillSwitched 
        writeEnabled 
        nonReentrant 
        whenNotPaused 
    {
        PendingAction storage action = pendingActions[actionId];
        
        if (action.executed) revert ActionAlreadyExecuted();
        if (!action.approved) revert Unauthorized();
        if (block.timestamp > action.deadline) revert ActionExpired();

        action.executed = true;

        (bool success, ) = action.target.call{value: action.value}(action.data);
        require(success, "Action execution failed");

        emit ActionExecuted(actionId, msg.sender, action.data);
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================

    /**
     * @notice Returns whether write operations are allowed
     */
    function canWrite() external view returns (bool) {
        return !killSwitchEnabled && 
               executionMode == ExecutionMode.WRITE_ENABLED && 
               !paused();
    }

    /**
     * @notice Returns the current security state
     */
    function getSecurityState() external view returns (
        bool _killSwitchEnabled,
        ExecutionMode _executionMode,
        bool _paused,
        uint256 _maxSingleTxValue
    ) {
        return (killSwitchEnabled, executionMode, paused(), maxSingleTxValue);
    }

    // ============================================
    // RECEIVE
    // ============================================

    receive() external payable {}
}
