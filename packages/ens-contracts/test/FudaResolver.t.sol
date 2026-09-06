// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FudaResolver} from "../contracts/FudaResolver.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function etch(address target, bytes calldata newRuntimeBytecode) external;
    function prank(address msgSender) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
}

contract FudaResolverTest {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes4 private constant ERC165_INTERFACE_ID = 0x01ffc9a7;
    bytes4 private constant ENSIP10_INTERFACE_ID = 0x9061b923;
    bytes4 private constant OFFCHAIN_LOOKUP_SELECTOR =
        bytes4(keccak256("OffchainLookup(address,string[],bytes,bytes4,bytes)"));
    uint256 private constant SIGNER_KEY = 0xa11ce;
    uint256 private constant OTHER_SIGNER_KEY = 0xb0b;
    uint256 private constant SECP256K1_ORDER =
        0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141;
    address private constant OUTSIDER = address(0xbeef);
    address private constant OTHER_RESOLVER = address(0xcafe);

    FudaResolver private resolver;

    function setUp() public {
        string[] memory urls = new string[](1);
        urls[0] = "https://api.fuda.sh/ens/gateway";
        resolver = new FudaResolver(VM.addr(SIGNER_KEY), urls);
    }

    function testSupportsRequiredInterfaces() public view {
        require(resolver.supportsInterface(ERC165_INTERFACE_ID), "missing ERC-165 interface");
        require(resolver.supportsInterface(ENSIP10_INTERFACE_ID), "missing ENSIP-10 interface");
        require(!resolver.supportsInterface(0xffffffff), "supports unknown interface");
    }

    function testResolveRevertsWithExactOffchainLookup() public view {
        bytes memory name = _name();
        bytes memory record = _record();
        (
            address sender,
            string[] memory urls,
            bytes memory request,
            bytes4 callback,
            bytes memory extraData
        ) = _offchainLookup(name, record);

        require(sender == address(resolver), "wrong OffchainLookup sender");
        require(urls.length == 1, "wrong URL count");
        require(_sameString(urls[0], "https://api.fuda.sh/ens/gateway"), "wrong gateway URL");
        require(keccak256(request) == keccak256(_request(name, record)), "wrong gateway request");
        require(callback == FudaResolver.resolveWithProof.selector, "wrong callback selector");
        (address target, bytes memory boundRequest) = abi.decode(extraData, (address, bytes));
        require(target == address(resolver), "wrong bound resolver");
        require(keccak256(boundRequest) == keccak256(request), "wrong bound request");
    }

    function testAcceptsUnexpiredAuthorizedResponse() public {
        VM.warp(1_000);
        bytes memory request = _request(_name(), _record());
        bytes memory result = _result();
        bytes memory response = _signedEnvelope(address(resolver), request, result, 1_300, SIGNER_KEY);

        bytes memory resolved = resolver.resolveWithProof(response, abi.encode(address(resolver), request));

        require(keccak256(resolved) == keccak256(result), "wrong signed result");
    }

    function testAcceptsResponseAtExactExpiry() public {
        VM.warp(1_300);
        bytes memory request = _request(_name(), _record());
        bytes memory result = _result();
        bytes memory response = _signedEnvelope(address(resolver), request, result, 1_300, SIGNER_KEY);

        bytes memory resolved = resolver.resolveWithProof(response, abi.encode(address(resolver), request));

        require(keccak256(resolved) == keccak256(result), "exact-expiry response rejected");
    }

    function testAcceptsTypeScriptConformanceVector() public {
        address vectorAddress = address(0x1111111111111111111111111111111111111111);
        VM.etch(vectorAddress, address(resolver).code);
        FudaResolver vectorResolver = FudaResolver(vectorAddress);
        vectorResolver.setSigner(0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf);
        VM.warp(1_999_999_999);
        bytes memory response =
            hex"0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000007735940000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000001234567890123456789012345678901234567890000000000000000000000000000000000000000000000000000000000000004177ae7a3fd3d7e6af762a704497b07c28b76cb655ce6d76bd18811bc6b60bf0534a67bfe9b08fe591aee73d6610f1b0ba11cf782bc10cb96b693f5c659af5e6fb1c00000000000000000000000000000000000000000000000000000000000000";
        bytes memory extraData =
            hex"0000000000000000000000001111111111111111111111111111111111111111000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000e49061b92300000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000001106636f666665650466756461036574680000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000243b3b57de0eadf6d0c642109fe0df14e1ffef24a74fb69b639ff49ca376ad093e4eb2b1800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

        bytes memory resolved = vectorResolver.resolveWithProof(response, extraData);

        require(
            keccak256(resolved)
                == keccak256(hex"0000000000000000000000001234567890123456789012345678901234567890"),
            "TypeScript vector result rejected"
        );
    }

    function testRejectsExpiredResponse() public {
        VM.warp(1_001);
        bytes memory request = _request(_name(), _record());
        bytes memory response = _signedEnvelope(address(resolver), request, _result(), 1_000, SIGNER_KEY);

        _requireCallbackFailure(response, abi.encode(address(resolver), request));
    }

    function testRejectsSignatureForDifferentRequest() public {
        VM.warp(1_000);
        bytes memory request = _request(_name(), _record());
        bytes memory response = _signedEnvelope(address(resolver), request, _result(), 1_300, SIGNER_KEY);
        bytes memory otherRequest = _request(hex"056f7468657204667564610365746800", _record());

        _requireCallbackFailure(response, abi.encode(address(resolver), otherRequest));
    }

    function testRejectsSignatureForDifferentResult() public {
        VM.warp(1_000);
        bytes memory request = _request(_name(), _record());
        uint64 expires = 1_300;
        bytes memory signature = _signature(address(resolver), request, _result(), expires, SIGNER_KEY);
        bytes memory alteredResult = abi.encode(address(0x9876));
        bytes memory response = abi.encode(alteredResult, expires, signature);

        _requireCallbackFailure(response, abi.encode(address(resolver), request));
    }

    function testRejectsResponseForDifferentResolver() public {
        VM.warp(1_000);
        bytes memory request = _request(_name(), _record());
        bytes memory response = _signedEnvelope(OTHER_RESOLVER, request, _result(), 1_300, SIGNER_KEY);

        _requireCallbackFailure(response, abi.encode(OTHER_RESOLVER, request));
    }

    function testRejectsSignatureForDifferentResolverWithCorrectExtraData() public {
        VM.warp(1_000);
        bytes memory request = _request(_name(), _record());
        bytes memory response = _signedEnvelope(OTHER_RESOLVER, request, _result(), 1_300, SIGNER_KEY);

        _requireCallbackFailure(response, abi.encode(address(resolver), request));
    }

    function testRejectsUnauthorizedSigner() public {
        VM.warp(1_000);
        bytes memory request = _request(_name(), _record());
        bytes memory response =
            _signedEnvelope(address(resolver), request, _result(), 1_300, OTHER_SIGNER_KEY);

        _requireCallbackFailure(response, abi.encode(address(resolver), request));
    }

    function testRejectsHighSSignature() public {
        VM.warp(1_000);
        bytes memory request = _request(_name(), _record());
        bytes memory result = _result();
        uint64 expires = 1_300;
        bytes32 digest = _digest(address(resolver), request, result, expires);
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(SIGNER_KEY, digest);
        bytes32 highS = bytes32(SECP256K1_ORDER - uint256(s));
        uint8 flippedV = v == 27 ? 28 : 27;
        bytes memory response = abi.encode(result, expires, abi.encodePacked(r, highS, flippedV));

        _requireCallbackFailure(response, abi.encode(address(resolver), request));
    }

    function testRejectsMalformedSignature() public {
        VM.warp(1_000);
        bytes memory request = _request(_name(), _record());
        bytes memory result = _result();
        uint64 expires = 1_300;
        (, bytes32 r, bytes32 s) = VM.sign(SIGNER_KEY, _digest(address(resolver), request, result, expires));
        bytes memory response = abi.encode(result, expires, abi.encodePacked(r, s));

        _requireCallbackFailure(response, abi.encode(address(resolver), request));
    }

    function testRejectsInvalidRecoveryId() public {
        VM.warp(1_000);
        bytes memory request = _request(_name(), _record());
        bytes memory result = _result();
        uint64 expires = 1_300;
        (, bytes32 r, bytes32 s) = VM.sign(SIGNER_KEY, _digest(address(resolver), request, result, expires));
        bytes memory response = abi.encode(result, expires, abi.encodePacked(r, s, uint8(29)));

        _requireCallbackFailure(response, abi.encode(address(resolver), request));
    }

    function testOnlyOwnerCanRotateSigner() public {
        address nextSigner = VM.addr(OTHER_SIGNER_KEY);
        resolver.setSigner(nextSigner);
        require(resolver.signer() == nextSigner, "owner signer rotation failed");

        VM.prank(OUTSIDER);
        (bool ok,) = address(resolver).call(abi.encodeCall(FudaResolver.setSigner, (OUTSIDER)));
        require(!ok, "non-owner rotated signer");
        require(resolver.signer() == nextSigner, "signer changed after rejected rotation");
    }

    function testSignerCannotBeCleared() public {
        (bool ok,) = address(resolver).call(abi.encodeCall(FudaResolver.setSigner, (address(0))));
        require(!ok, "zero signer accepted");
    }

    function testOnlyOwnerCanRotateGatewayUrls() public {
        string[] memory nextUrls = new string[](2);
        nextUrls[0] = "https://one.example/ens";
        nextUrls[1] = "https://two.example/ens";
        resolver.setGatewayUrls(nextUrls);
        string[] memory configuredUrls = resolver.gatewayUrls();
        require(configuredUrls.length == 2, "owner URL rotation failed");
        require(_sameString(configuredUrls[1], nextUrls[1]), "wrong rotated URL");

        string[] memory attackerUrls = new string[](1);
        attackerUrls[0] = "https://attacker.example";
        VM.prank(OUTSIDER);
        (bool ok,) = address(resolver).call(abi.encodeCall(FudaResolver.setGatewayUrls, (attackerUrls)));
        require(!ok, "non-owner rotated URLs");

        (, string[] memory emittedUrls,,,) = _offchainLookup(_name(), _record());
        require(emittedUrls.length == 2, "URLs changed after rejected rotation");
        require(_sameString(emittedUrls[0], nextUrls[0]), "OffchainLookup used stale URLs");
    }

    function testGatewayUrlsCannotBeEmpty() public {
        string[] memory emptyUrls = new string[](0);
        (bool ok,) = address(resolver).call(abi.encodeCall(FudaResolver.setGatewayUrls, (emptyUrls)));
        require(!ok, "empty URL list accepted");
    }

    function testGatewayUrlCannotBeEmptyString() public {
        string[] memory emptyUrl = new string[](1);
        emptyUrl[0] = "";
        (bool ok,) = address(resolver).call(abi.encodeCall(FudaResolver.setGatewayUrls, (emptyUrl)));
        require(!ok, "empty gateway URL accepted");
    }

    function _offchainLookup(bytes memory name, bytes memory record)
        private
        view
        returns (address, string[] memory, bytes memory, bytes4, bytes memory)
    {
        (bool ok, bytes memory revertData) =
            address(resolver).staticcall(abi.encodeCall(FudaResolver.resolve, (name, record)));
        require(!ok, "resolve did not revert");
        require(_selector(revertData) == OFFCHAIN_LOOKUP_SELECTOR, "wrong revert selector");
        return abi.decode(_withoutSelector(revertData), (address, string[], bytes, bytes4, bytes));
    }

    function _requireCallbackFailure(bytes memory response, bytes memory extraData) private view {
        (bool ok,) = address(resolver).staticcall(
            abi.encodeCall(FudaResolver.resolveWithProof, (response, extraData))
        );
        require(!ok, "invalid response accepted");
    }

    function _signedEnvelope(
        address target,
        bytes memory request,
        bytes memory result,
        uint64 expires,
        uint256 signerKey
    ) private returns (bytes memory) {
        return abi.encode(result, expires, _signature(target, request, result, expires, signerKey));
    }

    function _signature(
        address target,
        bytes memory request,
        bytes memory result,
        uint64 expires,
        uint256 signerKey
    ) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(signerKey, _digest(target, request, result, expires));
        return abi.encodePacked(r, s, v);
    }

    function _digest(address target, bytes memory request, bytes memory result, uint64 expires)
        private
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(hex"1900", target, expires, keccak256(request), keccak256(result)));
    }

    function _request(bytes memory name, bytes memory record) private pure returns (bytes memory) {
        return abi.encodeWithSelector(ENSIP10_INTERFACE_ID, name, record);
    }

    function _name() private pure returns (bytes memory) {
        return hex"06636f6666656504667564610365746800";
    }

    function _record() private pure returns (bytes memory) {
        return abi.encodeWithSelector(bytes4(0x3b3b57de), bytes32(uint256(0x1234)));
    }

    function _result() private pure returns (bytes memory) {
        return abi.encode(address(0x1234567890123456789012345678901234567890));
    }

    function _selector(bytes memory data) private pure returns (bytes4 selector) {
        require(data.length >= 4, "revert data too short");
        assembly ("memory-safe") {
            selector := mload(add(data, 0x20))
        }
    }

    function _withoutSelector(bytes memory data) private pure returns (bytes memory output) {
        output = new bytes(data.length - 4);
        for (uint256 i = 4; i < data.length; i++) {
            output[i - 4] = data[i];
        }
    }

    function _sameString(string memory left, string memory right) private pure returns (bool) {
        return keccak256(bytes(left)) == keccak256(bytes(right));
    }
}
