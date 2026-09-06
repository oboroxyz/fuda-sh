// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice ENSIP-10 wildcard resolver backed by the fuda EIP-3668 gateway.
contract FudaResolver {
    error InvalidGatewayUrls();
    error InvalidResponseTarget();
    error InvalidSignature();
    error InvalidSigner();
    error ResponseExpired();
    error Unauthorized();
    error OffchainLookup(
        address sender,
        string[] urls,
        bytes callData,
        bytes4 callbackFunction,
        bytes extraData
    );

    bytes4 private constant ERC165_INTERFACE_ID = 0x01ffc9a7;
    bytes4 private constant ENSIP10_INTERFACE_ID = 0x9061b923;
    uint256 private constant SECP256K1_HALF_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    address public immutable owner;
    address public signer;
    string[] private _gatewayUrls;

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(address initialSigner, string[] memory initialGatewayUrls) {
        owner = msg.sender;
        _setSigner(initialSigner);
        _setGatewayUrls(initialGatewayUrls);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == ERC165_INTERFACE_ID || interfaceId == ENSIP10_INTERFACE_ID;
    }

    function gatewayUrls() external view returns (string[] memory) {
        return _gatewayUrls;
    }

    function setSigner(address nextSigner) external onlyOwner {
        _setSigner(nextSigner);
    }

    function setGatewayUrls(string[] calldata nextGatewayUrls) external onlyOwner {
        _setGatewayUrls(nextGatewayUrls);
    }

    function resolve(bytes calldata, bytes calldata) external view returns (bytes memory) {
        bytes memory request = msg.data;
        revert OffchainLookup(
            address(this),
            _gatewayUrls,
            request,
            this.resolveWithProof.selector,
            abi.encode(address(this), request)
        );
    }

    function resolveWithProof(bytes calldata response, bytes calldata extraData)
        external
        view
        returns (bytes memory result)
    {
        (address target, bytes memory request) = abi.decode(extraData, (address, bytes));
        if (target != address(this)) revert InvalidResponseTarget();

        uint64 expires;
        bytes memory signature;
        (result, expires, signature) = abi.decode(response, (bytes, uint64, bytes));
        if (block.timestamp > expires) revert ResponseExpired();

        bytes32 digest = keccak256(
            abi.encodePacked(hex"1900", target, expires, keccak256(request), keccak256(result))
        );
        if (_recover(digest, signature) != signer) revert InvalidSignature();
    }

    function _recover(bytes32 digest, bytes memory signature) private pure returns (address recovered) {
        if (signature.length != 65) revert InvalidSignature();

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        if (uint256(s) > SECP256K1_HALF_ORDER || (v != 27 && v != 28)) {
            revert InvalidSignature();
        }
        recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0)) revert InvalidSignature();
    }

    function _setSigner(address nextSigner) private {
        if (nextSigner == address(0)) revert InvalidSigner();
        signer = nextSigner;
    }

    function _setGatewayUrls(string[] memory nextGatewayUrls) private {
        if (nextGatewayUrls.length == 0) revert InvalidGatewayUrls();
        delete _gatewayUrls;
        for (uint256 i = 0; i < nextGatewayUrls.length; i++) {
            if (bytes(nextGatewayUrls[i]).length == 0) revert InvalidGatewayUrls();
            _gatewayUrls.push(nextGatewayUrls[i]);
        }
    }
}
