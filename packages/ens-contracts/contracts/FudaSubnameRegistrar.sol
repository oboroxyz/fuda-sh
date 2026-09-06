// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IUserRegistry} from "./interfaces/IUserRegistry.sol";
import {IFudaIssuerMarker} from "./interfaces/IFudaIssuerMarker.sol";
import {FudaECDSA} from "./libraries/FudaECDSA.sol";

/// @notice Voucher-gated registration and renewal of issuer subnames.
contract FudaSubnameRegistrar {
    error InvalidSignature();
    error WrongChain();
    error InvalidAddress();
    error InvalidParentNode();
    error Unauthorized();
    error InvalidLabel();
    error InvalidNonce();
    error VoucherExpired();
    error InvalidExpiry();

    bytes32 public constant CLAIM_TYPEHASH = keccak256(
        "ClaimVoucher(bytes32 labelHash,address issuer,uint64 expiry,uint256 nonce,uint64 deadline)"
    );
    bytes32 public constant RENEW_TYPEHASH = keccak256(
        "RenewVoucher(bytes32 labelHash,address issuer,uint64 expiry,uint256 nonce,uint64 deadline)"
    );
    IUserRegistry public immutable userRegistry;
    IFudaIssuerMarker public immutable resolver;
    bytes32 public immutable parentNode;
    address public immutable owner;
    bytes32 private immutable DOMAIN_SEPARATOR;
    address public voucherSigner;
    mapping(address issuer => uint256 nonce) public nonces;

    event IssuerClaimed(
        bytes32 indexed labelHash,
        address indexed issuer,
        uint256 indexed tokenId,
        uint64 expiry,
        uint256 nonce
    );
    event IssuerRenewed(
        bytes32 indexed labelHash, address indexed issuer, uint64 expiry, uint256 nonce
    );
    event VoucherSignerUpdated(address indexed previousSigner, address indexed nextSigner);

    constructor(
        IUserRegistry userRegistry_,
        IFudaIssuerMarker resolver_,
        address voucherSigner_,
        bytes32 parentNode_
    ) {
        if (block.chainid != 11_155_111) revert WrongChain();
        if (
            address(userRegistry_) == address(0) || address(resolver_) == address(0)
                || voucherSigner_ == address(0)
        ) revert InvalidAddress();
        if (resolver_.parentNode() != parentNode_) revert InvalidParentNode();
        userRegistry = userRegistry_;
        resolver = resolver_;
        voucherSigner = voucherSigner_;
        parentNode = parentNode_;
        owner = msg.sender;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("FudaSubnameRegistrar"),
                keccak256("1"),
                uint256(11_155_111),
                address(this)
            )
        );
    }

    function claim(
        string calldata label,
        address issuer,
        uint64 expiry,
        uint256 nonce,
        uint64 deadline,
        bytes calldata signature
    ) external returns (uint256 tokenId) {
        _validateLabel(label);
        bytes32 labelHash = keccak256(bytes(label));
        _authorize(CLAIM_TYPEHASH, labelHash, issuer, expiry, nonce, deadline, signature);
        nonces[issuer]++;
        tokenId = userRegistry.register(label, issuer, address(0), address(resolver), 0, expiry);
        resolver.markIssuer(label);
        emit IssuerClaimed(labelHash, issuer, tokenId, expiry, nonce);
    }

    function renew(
        string calldata label,
        address issuer,
        uint64 expiry,
        uint256 nonce,
        uint64 deadline,
        bytes calldata signature
    ) external {
        _validateLabel(label);
        bytes32 labelHash = keccak256(bytes(label));
        _authorize(RENEW_TYPEHASH, labelHash, issuer, expiry, nonce, deadline, signature);
        if (userRegistry.getOwner(uint256(labelHash)) != issuer) revert Unauthorized();
        nonces[issuer]++;
        userRegistry.renew(uint256(labelHash), expiry);
        emit IssuerRenewed(labelHash, issuer, expiry, nonce);
    }

    function setVoucherSigner(address nextSigner) external {
        if (msg.sender != owner) revert Unauthorized();
        if (nextSigner == address(0)) revert InvalidAddress();
        emit VoucherSignerUpdated(voucherSigner, nextSigner);
        voucherSigner = nextSigner;
    }

    function _authorize(
        bytes32 action,
        bytes32 labelHash,
        address issuer,
        uint64 expiry,
        uint256 nonce,
        uint64 deadline,
        bytes calldata signature
    ) private view {
        if (msg.sender != issuer) revert Unauthorized();
        if (nonce != nonces[issuer]) revert InvalidNonce();
        if (block.timestamp > deadline) revert VoucherExpired();
        if (block.timestamp >= expiry) revert InvalidExpiry();
        bytes32 structHash = keccak256(abi.encode(action, labelHash, issuer, expiry, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", DOMAIN_SEPARATOR, structHash));
        if (FudaECDSA.recover(digest, signature) != voucherSigner) revert InvalidSignature();
    }

    function _validateLabel(string calldata label) private pure {
        bytes calldata value = bytes(label);
        if (value.length == 0 || value.length > 63) revert InvalidLabel();
        if (value[0] == 0x2d || value[value.length - 1] == 0x2d) revert InvalidLabel();
        for (uint256 i; i < value.length; i++) {
            bytes1 character = value[i];
            if (
                !(
                    (character >= 0x61 && character <= 0x7a)
                        || (character >= 0x30 && character <= 0x39) || character == 0x2d
                )
            ) revert InvalidLabel();
        }
    }
}
