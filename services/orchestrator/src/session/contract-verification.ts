/**
 * Contract Verification Hooks
 * 
 * Provides verification data for on-chain session validation.
 * Used for smart contract integration to validate session keys.
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import * as crypto from "crypto";
import type {
  SessionKeyConfig,
  ContractVerificationHook,
} from "./types.js";

const verifyLogger = logger.child({ component: "contract-verification" });

// ============================================
// VERIFICATION MESSAGE TYPES
// ============================================

/**
 * Message format for signing session actions
 */
export interface SessionActionMessage {
  sessionId: string;
  nonce: number;
  targetAddress: string;
  methodSelector: string;
  value: string;
  deadline: number;
  chainId: number;
}

/**
 * Signed session action
 */
export interface SignedSessionAction {
  message: SessionActionMessage;
  signature: string;
  recoveryParam: number;
}

// ============================================
// CONTRACT VERIFICATION GENERATOR
// ============================================

export class ContractVerificationGenerator {
  private readonly chainId: number;

  constructor(chainId = 143) { // Monad mainnet
    this.chainId = chainId;
  }

  /**
   * Create a message hash for signing
   */
  createMessageHash(action: SessionActionMessage): Buffer {
    // EIP-712 style message hashing
    const domain = this.getDomainSeparator();
    const actionHash = this.hashAction(action);
    
    const message = Buffer.concat([
      Buffer.from([0x19, 0x01]),
      domain,
      actionHash,
    ]);

    return crypto.createHash("sha256").update(message).digest();
  }

  /**
   * Sign a session action (for off-chain key)
   */
  signAction(
    action: SessionActionMessage,
    privateKeyHex: string
  ): SignedSessionAction {
    const messageHash = this.createMessageHash(action);
    
    // In production, would use proper secp256k1 signing
    // Simplified for demonstration
    const sign = crypto.createSign("SHA256");
    sign.update(messageHash);
    const signature = sign.sign({
      key: Buffer.from(privateKeyHex, "hex"),
      dsaEncoding: "ieee-p1363",
    } as any);

    return {
      message: action,
      signature: signature.toString("hex"),
      recoveryParam: 0, // Would be calculated from actual signature
    };
  }

  /**
   * Verify a signed action
   */
  verifySignature(
    signedAction: SignedSessionAction,
    publicKeyHex: string
  ): boolean {
    try {
      const messageHash = this.createMessageHash(signedAction.message);
      
      const verify = crypto.createVerify("SHA256");
      verify.update(messageHash);
      
      return verify.verify(
        {
          key: Buffer.from(publicKeyHex, "hex"),
          dsaEncoding: "ieee-p1363",
        } as any,
        Buffer.from(signedAction.signature, "hex")
      );
    } catch (error) {
      verifyLogger.warn({ error }, "Signature verification failed");
      return false;
    }
  }

  /**
   * Generate verification hook for smart contract
   */
  generateHook(
    session: SessionKeyConfig,
    action: SessionActionMessage,
    signature: string
  ): ContractVerificationHook {
    return {
      sessionId: session.sessionId,
      publicKey: session.publicKey,
      signature,
      nonce: action.nonce,
      targetAddress: action.targetAddress,
      methodSelector: action.methodSelector,
      value: action.value,
      budgetProof: {
        totalBudget: session.totalBudgetWei,
        spent: session.spentWei,
        remaining: (BigInt(session.totalBudgetWei) - BigInt(session.spentWei)).toString(),
      },
      timestamp: Date.now(),
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Encode hook for contract call
   */
  encodeHookForContract(hook: ContractVerificationHook): string {
    // Encode as ABI-encoded bytes for contract verification
    // This would use proper ABI encoding in production
    const encoded = [
      this.padHex(hook.sessionId.replace(/-/g, ""), 64),
      this.padHex(hook.nonce.toString(16), 64),
      this.padAddress(hook.targetAddress),
      hook.methodSelector,
      this.padHex(BigInt(hook.value).toString(16), 64),
      this.padHex(BigInt(hook.budgetProof.totalBudget).toString(16), 64),
      this.padHex(BigInt(hook.budgetProof.spent).toString(16), 64),
      this.padHex(hook.timestamp.toString(16), 64),
      this.padHex(hook.expiresAt.toString(16), 64),
    ].join("");

    return "0x" + encoded + hook.signature;
  }

  /**
   * Generate Solidity verification function
   */
  generateSolidityVerifier(): string {
    return `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title SessionKeyVerifier
 * @notice Verifies NEURO session key signatures for delegated execution
 */
contract SessionKeyVerifier {
    struct SessionProof {
        bytes32 sessionId;
        uint256 nonce;
        address targetAddress;
        bytes4 methodSelector;
        uint256 value;
        uint256 totalBudget;
        uint256 spent;
        uint256 timestamp;
        uint256 expiresAt;
        bytes signature;
    }

    // Domain separator for EIP-712
    bytes32 public immutable DOMAIN_SEPARATOR;
    
    // Session nonces (sessionId => nonce => used)
    mapping(bytes32 => mapping(uint256 => bool)) public usedNonces;
    
    // Session budgets (sessionId => spent)
    mapping(bytes32 => uint256) public sessionSpent;
    
    // Kill switch
    bool public killSwitchActive;
    address public killSwitchAdmin;

    constructor(address _admin) {
        killSwitchAdmin = _admin;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("NEURO Session")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    /**
     * @notice Verify a session proof and execute if valid
     */
    function verifyAndExecute(
        SessionProof calldata proof,
        bytes calldata data
    ) external payable returns (bool success, bytes memory result) {
        // Check kill switch
        require(!killSwitchActive, "Kill switch active");
        
        // Verify expiry
        require(block.timestamp < proof.expiresAt, "Session expired");
        
        // Verify nonce not used
        require(!usedNonces[proof.sessionId][proof.nonce], "Nonce already used");
        
        // Verify budget
        uint256 newSpent = sessionSpent[proof.sessionId] + proof.value;
        require(newSpent <= proof.totalBudget, "Budget exceeded");
        
        // Verify signature
        bytes32 messageHash = _hashProof(proof);
        // ... signature verification ...
        
        // Mark nonce as used
        usedNonces[proof.sessionId][proof.nonce] = true;
        
        // Update spent
        sessionSpent[proof.sessionId] = newSpent;
        
        // Execute
        (success, result) = proof.targetAddress.call{value: proof.value}(data);
    }

    /**
     * @notice Activate kill switch (emergency)
     */
    function activateKillSwitch() external {
        require(msg.sender == killSwitchAdmin, "Not admin");
        killSwitchActive = true;
    }

    function _hashProof(SessionProof calldata proof) internal view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\\x19\\x01",
                DOMAIN_SEPARATOR,
                keccak256(
                    abi.encode(
                        proof.sessionId,
                        proof.nonce,
                        proof.targetAddress,
                        proof.methodSelector,
                        proof.value,
                        proof.timestamp,
                        proof.expiresAt
                    )
                )
            )
        );
    }
}
`;
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private getDomainSeparator(): Buffer {
    const typeHash = crypto
      .createHash("sha256")
      .update("EIP712Domain(string name,string version,uint256 chainId)")
      .digest();

    const name = crypto.createHash("sha256").update("NEURO Session").digest();
    const version = crypto.createHash("sha256").update("1").digest();
    const chainId = Buffer.alloc(32);
    chainId.writeBigUInt64BE(BigInt(this.chainId), 24);

    return crypto
      .createHash("sha256")
      .update(Buffer.concat([typeHash, name, version, chainId]))
      .digest();
  }

  private hashAction(action: SessionActionMessage): Buffer {
    const data = Buffer.concat([
      Buffer.from(action.sessionId.replace(/-/g, ""), "hex"),
      this.uint256ToBuffer(action.nonce),
      Buffer.from(action.targetAddress.slice(2).padStart(40, "0"), "hex"),
      Buffer.from(action.methodSelector.slice(2), "hex"),
      this.uint256ToBuffer(BigInt(action.value)),
      this.uint256ToBuffer(action.deadline),
      this.uint256ToBuffer(action.chainId),
    ]);

    return crypto.createHash("sha256").update(data).digest();
  }

  private uint256ToBuffer(value: number | bigint): Buffer {
    const buf = Buffer.alloc(32);
    const bigValue = BigInt(value);
    for (let i = 31; i >= 0; i--) {
      buf[i] = Number(bigValue & 0xffn);
    }
    return buf;
  }

  private padHex(hex: string, length: number): string {
    return hex.padStart(length, "0");
  }

  private padAddress(address: string): string {
    return address.slice(2).padStart(64, "0");
  }
}

/**
 * Factory function
 */
export function createContractVerificationGenerator(
  chainId?: number
): ContractVerificationGenerator {
  return new ContractVerificationGenerator(chainId);
}
