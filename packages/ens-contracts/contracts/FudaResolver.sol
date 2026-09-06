// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IUserRegistry} from "./interfaces/IUserRegistry.sol";
import {FudaECDSA} from "./libraries/FudaECDSA.sol";

/// @notice Resolves claimed issuer ETH addresses from ENSv2 and other live records through CCIP-Read.
contract FudaResolver {
    error InvalidGatewayUrls();
    error InvalidResponseTarget();
    error InvalidSignature();
    error InvalidSigner();
    error ResponseExpired();
    error Unauthorized();
    error InvalidRegistrar();
    error RegistrarAlreadySet();
    error InactiveIssuer();
    error InvalidDNSName();
    error InvalidRecord();
    error OffchainLookup(
        address sender,
        string[] urls,
        bytes callData,
        bytes4 callbackFunction,
        bytes extraData
    );

    event RegistrarSet(address registrar);

    bytes4 private constant ERC165_INTERFACE_ID = 0x01ffc9a7;
    bytes4 private constant ENSIP10_INTERFACE_ID = 0x9061b923;
    bytes4 private constant LEGACY_ADDR = 0x3b3b57de;
    bytes4 private constant MULTICOIN_ADDR = 0xf1cb7e06;

    address public immutable owner;
    IUserRegistry public immutable userRegistry;
    bytes32 public immutable parentNode;
    address public registrar;
    mapping(bytes32 issuerNode => bytes32 labelHash) public issuerLabelHashes;
    address public signer;
    string[] private _gatewayUrls;

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(
        address registry,
        bytes32 parent,
        address initialSigner,
        string[] memory initialGatewayUrls
    ) {
        owner = msg.sender;
        userRegistry = IUserRegistry(registry);
        parentNode = parent;
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

    function setRegistrar(address nextRegistrar) external onlyOwner {
        if (nextRegistrar == address(0)) revert InvalidRegistrar();
        if (registrar != address(0)) revert RegistrarAlreadySet();
        registrar = nextRegistrar;
        emit RegistrarSet(nextRegistrar);
    }

    function markIssuer(string calldata label) external {
        if (msg.sender != registrar) revert Unauthorized();
        bytes32 labelHash = keccak256(bytes(label));
        issuerLabelHashes[keccak256(abi.encodePacked(parentNode, labelHash))] = labelHash;
    }

    function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory) {
        bytes32[] memory nodes = _suffixNodes(name);
        bytes4 selector = _addressSelector(data, nodes[0]);
        bool legacy = selector == LEGACY_ADDR;
        bool coin60 = selector == MULTICOIN_ADDR;
        for (uint256 i = 0; i < nodes.length; i++) {
            bytes32 labelHash = issuerLabelHashes[nodes[i]];
            if (labelHash == bytes32(0)) continue;
            address issuerOwner = userRegistry.getOwner(uint256(labelHash));
            if (issuerOwner == address(0)) {
                if (legacy) return abi.encode(address(0));
                if (coin60) return abi.encode(bytes(""));
                revert InactiveIssuer();
            }
            if (i == 0) {
                if (legacy) return abi.encode(issuerOwner);
                if (coin60) return abi.encode(abi.encodePacked(issuerOwner));
            }
            break;
        }
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
        if (FudaECDSA.recover(digest, signature) != signer) revert InvalidSignature();
    }

    function _suffixNodes(bytes calldata name) private pure returns (bytes32[] memory nodes) {
        if (name.length == 0 || name.length > 255) revert InvalidDNSName();
        uint256 count;
        for (uint256 cursor = 0; cursor < name.length;) {
            uint256 length = uint8(name[cursor]);
            if (length == 0) {
                if (cursor != name.length - 1 || count == 0) revert InvalidDNSName();
                break;
            }
            if (length > 63 || cursor + length + 1 >= name.length) revert InvalidDNSName();
            count++;
            cursor += length + 1;
        }
        nodes = new bytes32[](count);
        uint256 offset;
        for (uint256 i = 0; i < count; i++) {
            uint256 length = uint8(name[offset]);
            nodes[i] = keccak256(name[offset + 1:offset + 1 + length]);
            offset += length + 1;
        }
        bytes32 node;
        for (uint256 i = count; i > 0; i--) {
            node = keccak256(abi.encodePacked(node, nodes[i - 1]));
            nodes[i - 1] = node;
        }
    }

    function _addressSelector(bytes calldata data, bytes32 node) private pure returns (bytes4 selector) {
        selector = bytes4(data);
        if (selector == LEGACY_ADDR) {
            if (data.length != 36) revert InvalidRecord();
        } else if (selector == MULTICOIN_ADDR) {
            if (data.length != 68) revert InvalidRecord();
            if (uint256(bytes32(data[36:68])) != 60) return bytes4(0);
        } else {
            return bytes4(0);
        }
        if (bytes32(data[4:36]) != node) revert InvalidRecord();
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
