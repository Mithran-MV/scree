// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

/// @notice What a CRE forwarder delivers: the workflow's signed report, with its metadata.
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/**
 * @title Guardian
 * @notice The verdict ledger for Scree's private terrace.
 *
 * A confidential workflow reads a wallet's survey inside an enclave, compares
 * it with a risk policy that never leaves the enclave, and crosses back to the
 * DON with a verdict and nothing else. The DON signs that verdict and the
 * forwarder delivers it here. This contract records what was decided, when,
 * and for whom; the thresholds that produced it are not on-chain and never
 * were.
 *
 * Verdicts: 0 HOLD (the ground is safe by the policy), 1 RAISE (lift the
 * terrace by `liftBps` of health), 2 DROWNED (the book is under water at
 * today's price by the schema's own thresholds).
 */
contract Guardian is IReceiver {
    struct Reading {
        uint8 verdict;
        uint32 healthBps;
        uint32 liftBps;
        uint64 observedAt;
        uint64 recordedAt;
    }

    address public owner;
    /// @notice Forwarders whose reports are accepted. On a testnet ledger this
    /// holds the network's KeystoneForwarder and the simulator's mock forwarder,
    /// so simulated runs can land; a production ledger lists the real one alone.
    mapping(address => bool) public forwarders;
    uint256 public count;
    mapping(address => Reading) public latest;

    event VerdictRecorded(address indexed wallet, uint8 verdict, uint32 healthBps, uint32 liftBps, uint64 observedAt);
    event ForwarderUpdated(address indexed forwarder, bool allowed);

    error NotOwner();
    error NotForwarder(address sender);
    error UnknownVerdict(uint8 verdict);

    constructor(address[] memory forwarders_) {
        require(forwarders_.length > 0, "forwarder required");
        owner = msg.sender;
        for (uint256 i = 0; i < forwarders_.length; i++) {
            require(forwarders_[i] != address(0), "zero forwarder");
            forwarders[forwarders_[i]] = true;
            emit ForwarderUpdated(forwarders_[i], true);
        }
    }

    /// @inheritdoc IReceiver
    /// @param report ABI-encoded (address wallet, uint8 verdict, uint32 healthBps, uint32 liftBps, uint64 observedAt)
    function onReport(bytes calldata, bytes calldata report) external override {
        if (!forwarders[msg.sender]) revert NotForwarder(msg.sender);
        (address wallet, uint8 verdict, uint32 healthBps, uint32 liftBps, uint64 observedAt) =
            abi.decode(report, (address, uint8, uint32, uint32, uint64));
        if (verdict > 2) revert UnknownVerdict(verdict);
        latest[wallet] = Reading(verdict, healthBps, liftBps, observedAt, uint64(block.timestamp));
        count += 1;
        emit VerdictRecorded(wallet, verdict, healthBps, liftBps, observedAt);
    }

    function setForwarder(address forwarder, bool allowed) external {
        if (msg.sender != owner) revert NotOwner();
        forwarders[forwarder] = allowed;
        emit ForwarderUpdated(forwarder, allowed);
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
