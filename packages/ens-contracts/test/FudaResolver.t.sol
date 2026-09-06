// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FudaResolver} from "../contracts/FudaResolver.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function etch(address target, bytes calldata newRuntimeBytecode) external;
    function prank(address msgSender) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
    function expectCall(address callee, bytes calldata data, uint64 count) external;
    function expectEmit(bool topic1, bool topic2, bool topic3, bool data, address emitter) external;
}

contract ResolverRegistry {
    error RegistryUnavailable();
    mapping(uint256 => address) public owners;
    bool public fail;

    function setOwner(bytes32 labelHash, address nextOwner) external {
        owners[uint256(labelHash)] = nextOwner;
    }

    function setFailure(bool nextFailure) external {
        fail = nextFailure;
    }

    function getOwner(uint256 labelHash) external view returns (address) {
        if (fail) revert RegistryUnavailable();
        return owners[labelHash];
    }
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
    ResolverRegistry private registry;

    event RegistrarSet(address registrar);

    function setUp() public {
        string[] memory urls = new string[](1);
        urls[0] = "https://api.fuda.sh/ens/gateway";
        registry = new ResolverRegistry();
        resolver = new FudaResolver(address(registry), _namehash("fuda.eth"), VM.addr(SIGNER_KEY), urls);
        resolver.setRegistrar(address(this));
    }

    function testNeverClaimedIssuerAndMemberStayOffchain() public {
        _expectRegistryReads(0);
        _offchainLookup(_name(), _record());
        _offchainLookup(_memberName(), _legacy(_namehash("alice.coffee.fuda.eth")));
    }

    function testActiveClaimedIssuerLegacyAddrComesFromRegistry() public {
        _claim(OUTSIDER);
        _expectRegistryReads(1);
        _assertResult(_name(), _record(), abi.encode(OUTSIDER));
    }

    function testActiveClaimedIssuerCoin60AddrComesFromRegistry() public {
        _claim(OUTSIDER);
        _expectRegistryReads(1);
        _assertResult(
            _name(), _coin(_namehash("coffee.fuda.eth"), 60), abi.encode(abi.encodePacked(OUTSIDER))
        );
    }

    function testActiveClaimedMemberStaysOffchain() public {
        _claim(OUTSIDER);
        _expectRegistryReads(1);
        _offchainLookup(_memberName(), _legacy(_namehash("alice.coffee.fuda.eth")));
    }

    function testInactiveClaimedIssuerReturnsSelectorSpecificEmptyAddresses() public {
        _claim(address(0));
        _expectRegistryReads(2);
        _assertResult(_name(), _record(), abi.encode(address(0)));
        _assertResult(_name(), _coin(_namehash("coffee.fuda.eth"), 60), abi.encode(bytes("")));
    }

    function testInactiveClaimedMemberReturnsSelectorSpecificEmptyAddresses() public {
        _claim(address(0));
        _expectRegistryReads(2);
        _assertResult(_memberName(), _legacy(_namehash("alice.coffee.fuda.eth")), abi.encode(address(0)));
        _assertResult(_memberName(), _coin(_namehash("alice.coffee.fuda.eth"), 60), abi.encode(bytes("")));
    }

    function testInactiveClaimedNamespaceRejectsUnsupportedSelectorWithoutOffchainLookup() public {
        _claim(address(0));
        _expectRegistryReads(2);
        _requireResolveError(_name(), hex"deadbeef", bytes4(keccak256("InactiveIssuer()")));
        _requireResolveError(_memberName(), hex"deadbeef", bytes4(keccak256("InactiveIssuer()")));
    }

    function testReregisteredIssuerAndMemberBecomeLiveAgain() public {
        _claim(OUTSIDER);
        _assertResult(_name(), _record(), abi.encode(OUTSIDER));
        registry.setOwner(keccak256("coffee"), address(0));
        _assertResult(_memberName(), _legacy(_namehash("alice.coffee.fuda.eth")), abi.encode(address(0)));
        registry.setOwner(keccak256("coffee"), OTHER_RESOLVER);
        _assertResult(_name(), _record(), abi.encode(OTHER_RESOLVER));
        _offchainLookup(_memberName(), _legacy(_namehash("alice.coffee.fuda.eth")));
    }

    function testRegistryFailureNeverFallsBackOffchain() public {
        _claim(OUTSIDER);
        registry.setFailure(true);
        _expectRegistryReads(3);
        _requireResolveError(_name(), _record(), ResolverRegistry.RegistryUnavailable.selector);
        _requireResolveError(
            _memberName(), _legacy(_namehash("alice.coffee.fuda.eth")), ResolverRegistry.RegistryUnavailable.selector
        );
        _requireResolveError(_memberName(), hex"deadbeef", ResolverRegistry.RegistryUnavailable.selector);
    }

    function testRejectsCompressionPointerMissingRootExtraBytesEmptyLabelAndOversizeLabel() public {
        _claim(OUTSIDER);
        _expectRegistryReads(0);
        bytes[] memory invalidNames = new bytes[](8);
        invalidNames[0] = hex"c000";
        invalidNames[1] = hex"06636f66666565046675646103657468";
        invalidNames[2] = bytes.concat(_name(), hex"01");
        invalidNames[3] = hex"05616c6963650006636f6666656504667564610365746800";
        invalidNames[4] = bytes.concat(hex"40", new bytes(64), hex"00");
        invalidNames[5] = hex"00";
        invalidNames[6] = hex"";
        invalidNames[7] = hex"036100";
        for (uint256 i = 0; i < invalidNames.length; i++) {
            _requireResolveError(invalidNames[i], _record(), bytes4(keccak256("InvalidDNSName()")));
        }
    }

    function testRejectsDnsNamesOver255BytesBeforeRegistryRead() public {
        _claim(OUTSIDER);
        _expectRegistryReads(0);
        bytes memory longName = bytes.concat(
            hex"3f", new bytes(63), hex"3f", new bytes(63), hex"3f", new bytes(63), hex"3e", new bytes(62), hex"00"
        );
        require(longName.length == 256, "bad boundary fixture");
        _requireResolveError(longName, hex"deadbeef", bytes4(keccak256("InvalidDNSName()")));
    }

    function testAccepts255ByteDnsNameAnd63ByteLabels() public view {
        bytes memory longest = bytes.concat(
            hex"3f", new bytes(63), hex"3f", new bytes(63), hex"3f", new bytes(63), hex"3d", new bytes(61), hex"00"
        );
        require(longest.length == 255, "bad boundary fixture");
        _offchainLookup(longest, hex"deadbeef");
    }

    function testRejectsLegacyAndCoin60NodeMismatchBeforeRegistryRead() public {
        _claim(OUTSIDER);
        _expectRegistryReads(0);
        _requireResolveError(_name(), _legacy(bytes32(uint256(1))), bytes4(keccak256("InvalidRecord()")));
        _requireResolveError(
            _memberName(), _coin(_namehash("coffee.fuda.eth"), 60), bytes4(keccak256("InvalidRecord()"))
        );
    }

    function testRejectsMalformedSupportedRecordLengthsBeforeRegistryRead() public {
        _claim(OUTSIDER);
        _expectRegistryReads(0);
        _requireResolveError(_name(), hex"3b3b57de", bytes4(keccak256("InvalidRecord()")));
        _requireResolveError(_name(), bytes.concat(_record(), hex"00"), bytes4(keccak256("InvalidRecord()")));
        _requireResolveError(_name(), hex"f1cb7e06", bytes4(keccak256("InvalidRecord()")));
        _requireResolveError(
            _name(), bytes.concat(_coin(_namehash("coffee.fuda.eth"), 60), hex"00"), bytes4(keccak256("InvalidRecord()"))
        );
        _requireResolveError(
            _name(), abi.encodeWithSelector(bytes4(0xf1cb7e06), _namehash("coffee.fuda.eth")), bytes4(keccak256("InvalidRecord()"))
        );
    }

    function testNon60CoinTypeRemainsAnOffchainUnsupportedRecordWhenActive() public {
        _claim(OUTSIDER);
        _expectRegistryReads(2);
        bytes memory unsupported = _coin(bytes32(uint256(1)), 0);
        (,, bytes memory request,,) = _offchainLookup(_name(), unsupported);
        require(keccak256(request) == keccak256(_request(_name(), unsupported)), "unsupported record changed");
        registry.setOwner(keccak256("coffee"), address(0));
        _requireResolveError(_name(), unsupported, bytes4(keccak256("InactiveIssuer()")));
    }

    function testOnlyOwnerWiresRegistrarOnceAndZeroIsRejected() public {
        FudaResolver fresh = new FudaResolver(
            address(registry), _namehash("fuda.eth"), VM.addr(SIGNER_KEY), resolver.gatewayUrls()
        );
        (bool ok, bytes memory reason) =
            address(fresh).call(abi.encodeCall(FudaResolver.setRegistrar, (address(0))));
        require(!ok && _selector(reason) == bytes4(keccak256("InvalidRegistrar()")), "zero registrar accepted");
        VM.prank(OUTSIDER);
        (ok, reason) = address(fresh).call(abi.encodeCall(FudaResolver.setRegistrar, (OUTSIDER)));
        require(!ok && _selector(reason) == FudaResolver.Unauthorized.selector, "outsider wired registrar");
        fresh.setRegistrar(address(this));
        (ok, reason) = address(fresh).call(abi.encodeCall(FudaResolver.setRegistrar, (OUTSIDER)));
        require(!ok && _selector(reason) == bytes4(keccak256("RegistrarAlreadySet()")), "registrar changed twice");
        fresh.markIssuer("coffee");
        require(
            fresh.issuerLabelHashes(_namehash("coffee.fuda.eth")) == keccak256("coffee"),
            "authorized registrar cannot mark"
        );
    }

    function testSetRegistrarEmitsRegistrarSet() public {
        FudaResolver fresh = new FudaResolver(
            address(registry), _namehash("fuda.eth"), VM.addr(SIGNER_KEY), resolver.gatewayUrls()
        );
        VM.expectEmit(false, false, false, true, address(fresh));
        emit RegistrarSet(OUTSIDER);
        fresh.setRegistrar(OUTSIDER);
    }

    function testOnlyRegistrarMarksAndMarkerSurvivesInactiveState() public {
        VM.prank(OUTSIDER);
        (bool ok, bytes memory reason) =
            address(resolver).call(abi.encodeCall(FudaResolver.markIssuer, ("coffee")));
        require(!ok && _selector(reason) == FudaResolver.Unauthorized.selector, "outsider marked issuer");
        require(
            resolver.issuerLabelHashes(_namehash("coffee.fuda.eth")) == bytes32(0), "unauthorized marker persisted"
        );
        _claim(OUTSIDER);
        registry.setOwner(keccak256("coffee"), address(0));
        _assertResult(_name(), _record(), abi.encode(address(0)));
        require(
            resolver.issuerLabelHashes(_namehash("coffee.fuda.eth")) == keccak256("coffee"), "inactive marker lost"
        );
    }

    function testSupportsERC165AndENSIP10AfterHybridization() public {
        _claim(OUTSIDER);
        require(resolver.supportsInterface(0x01ffc9a7), "missing ERC165");
        require(resolver.supportsInterface(0x9061b923), "missing ENSIP10");
        require(!resolver.supportsInterface(0xffffffff), "unknown interface supported");
        require(resolver.parentNode() == _namehash("fuda.eth"), "wrong registrar parent");
    }

    function testDeepInactiveDescendantStaysClosedAndSiblingStaysOffchain() public {
        _claim(address(0));
        _expectRegistryReads(1);
        _assertResult(
            bytes.concat(hex"03626f62", _memberName()),
            _legacy(_namehash("bob.alice.coffee.fuda.eth")),
            abi.encode(address(0))
        );
        _offchainLookup(hex"057768616c6504667564610365746800", _legacy(_namehash("whale.fuda.eth")));
    }

    function testUnknownRecordBytesAndOuterCalldataRemainExact() public {
        _claim(OUTSIDER);
        bytes memory request = bytes.concat(_request(_name(), hex"01"), hex"feedface");
        (bool ok, bytes memory reason) = address(resolver).staticcall(request);
        require(!ok, "unknown record resolved locally");
        string[] memory urls = new string[](1);
        urls[0] = "https://api.fuda.sh/ens/gateway";
        bytes memory expected = abi.encodeWithSelector(
            OFFCHAIN_LOOKUP_SELECTOR,
            address(resolver),
            urls,
            request,
            FudaResolver.resolveWithProof.selector,
            abi.encode(address(resolver), request)
        );
        require(keccak256(reason) == keccak256(expected), "offchain envelope changed calldata");
        _offchainLookup(_name(), hex"");
    }

    function testRejectsZeroRecoverySignature() public {
        VM.warp(1_000);
        bytes memory request = _request(_name(), _record());
        bytes memory response =
            abi.encode(_result(), uint64(1_300), abi.encodePacked(bytes32(0), bytes32(0), uint8(27)));
        _requireCallbackFailure(response, abi.encode(address(resolver), request));
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

    // Break: removing callback-time routing revalidation returns a stale member result after issuer inactivation.
    function testCallbackRejectsActiveMemberResultAfterIssuerBecomesInactive() public {
        VM.warp(1_000);
        _claim(OUTSIDER);
        (,, bytes memory request,, bytes memory extraData) =
            _offchainLookup(_memberName(), _legacy(_namehash("alice.coffee.fuda.eth")));
        bytes memory response =
            _signedEnvelope(address(resolver), request, _result(), 1_300, SIGNER_KEY);

        registry.setOwner(keccak256("coffee"), address(0));

        _requireCallbackStateFailure(response, extraData);
    }

    // Break: removing callback-time routing revalidation returns stale D1 issuer data after an onchain claim.
    function testCallbackRejectsNeverClaimedIssuerResultAfterActiveClaim() public {
        VM.warp(1_000);
        (,, bytes memory request,, bytes memory extraData) = _offchainLookup(_name(), _record());
        bytes memory response =
            _signedEnvelope(address(resolver), request, _result(), 1_300, SIGNER_KEY);

        _claim(OUTSIDER);

        _requireCallbackStateFailure(response, extraData);
    }

    // Break: removing callback-time routing revalidation returns a signed result after the registry starts failing.
    function testCallbackRejectsActiveMemberResultAfterRegistryFailure() public {
        VM.warp(1_000);
        _claim(OUTSIDER);
        (,, bytes memory request,, bytes memory extraData) =
            _offchainLookup(_memberName(), _legacy(_namehash("alice.coffee.fuda.eth")));
        bytes memory response =
            _signedEnvelope(address(resolver), request, _result(), 1_300, SIGNER_KEY);

        registry.setFailure(true);

        _requireCallbackStateFailure(response, extraData);
    }

    // Break: accepting any callback self-call revert lets an inactive issuer's unsupported record reach stale data.
    function testCallbackRejectsUnsupportedRecordAfterIssuerBecomesInactive() public {
        VM.warp(1_000);
        _claim(OUTSIDER);
        (,, bytes memory request,, bytes memory extraData) = _offchainLookup(_memberName(), hex"deadbeef");
        bytes memory response =
            _signedEnvelope(address(resolver), request, _result(), 1_300, SIGNER_KEY);

        registry.setOwner(keccak256("coffee"), address(0));

        _requireCallbackStateFailure(response, extraData);
    }

    // Break: skipping exact OffchainLookup envelope validation accepts a signed malformed resolve request.
    function testCallbackRejectsSignedMalformedResolveRequest() public {
        VM.warp(1_000);
        bytes memory request = _request(hex"00", _record());
        bytes memory response =
            _signedEnvelope(address(resolver), request, _result(), 1_300, SIGNER_KEY);

        _requireCallbackStateFailure(response, abi.encode(address(resolver), request));
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
        address vectorRegistry = address(0x2222);
        VM.etch(vectorRegistry, address(registry).code);
        FudaResolver template = new FudaResolver(
            vectorRegistry, _namehash("fuda.eth"), VM.addr(SIGNER_KEY), resolver.gatewayUrls()
        );
        VM.etch(vectorAddress, address(template).code);
        FudaResolver vectorResolver = FudaResolver(vectorAddress);
        vectorResolver.setSigner(0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf);
        vectorResolver.setGatewayUrls(resolver.gatewayUrls());
        VM.warp(1_999_999_999);
        bytes memory response =
            hex"0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000007735940000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000001234567890123456789012345678901234567890000000000000000000000000000000000000000000000000000000000000004177ae7a3fd3d7e6af762a704497b07c28b76cb655ce6d76bd18811bc6b60bf0534a67bfe9b08fe591aee73d6610f1b0ba11cf782bc10cb96b693f5c659af5e6fb1c00000000000000000000000000000000000000000000000000000000000000";
        bytes memory extraData =
            hex"0000000000000000000000001111111111111111111111111111111111111111000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000e49061b92300000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000001106636f666665650466756461036574680000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000243b3b57de0eadf6d0c642109fe0df14e1ffef24a74fb69b639ff49ca376ad093e4eb2b1800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

        (address target, bytes memory request) = abi.decode(extraData, (address, bytes));
        require(target == vectorAddress, "vector target changed");
        require(keccak256(request) == keccak256(_request(_name(), _record())), "vector request changed");
        (bool ok, bytes memory reason) = vectorAddress.staticcall(request);
        require(!ok, "unclaimed vector resolved locally");
        bytes memory expectedLookup = abi.encodeWithSelector(
            OFFCHAIN_LOOKUP_SELECTOR,
            vectorAddress,
            resolver.gatewayUrls(),
            request,
            FudaResolver.resolveWithProof.selector,
            extraData
        );
        require(keccak256(reason) == keccak256(expectedLookup), "vector OffchainLookup changed");
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

    function _requireCallbackStateFailure(bytes memory response, bytes memory extraData) private view {
        (bool ok, bytes memory reason) = address(resolver).staticcall(
            abi.encodeCall(FudaResolver.resolveWithProof, (response, extraData))
        );
        require(!ok, "stale callback result accepted");
        require(
            _selector(reason) == bytes4(keccak256("InvalidCallbackState()")),
            "wrong callback state error"
        );
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
        return _legacy(0x0eadf6d0c642109fe0df14e1ffef24a74fb69b639ff49ca376ad093e4eb2b180);
    }

    function _legacy(bytes32 node) private pure returns (bytes memory) {
        return abi.encodeWithSelector(bytes4(0x3b3b57de), node);
    }

    function _coin(bytes32 node, uint256 coinType) private pure returns (bytes memory) {
        return abi.encodeWithSelector(bytes4(0xf1cb7e06), node, coinType);
    }

    function _memberName() private pure returns (bytes memory) {
        return hex"05616c69636506636f6666656504667564610365746800";
    }

    function _claim(address issuerOwner) private {
        resolver.markIssuer("coffee");
        registry.setOwner(keccak256("coffee"), issuerOwner);
    }

    function _expectRegistryReads(uint64 count) private {
        // VM counts calls outside EVM state, including STATICCALL and reverted resolutions.
        bytes memory expected = count == 0
            ? abi.encodeWithSelector(ResolverRegistry.getOwner.selector)
            : abi.encodeCall(ResolverRegistry.getOwner, (uint256(keccak256("coffee"))));
        VM.expectCall(address(registry), expected, count);
    }

    function _assertResult(bytes memory name, bytes memory record, bytes memory expected) private view {
        require(keccak256(resolver.resolve(name, record)) == keccak256(expected), "wrong local address encoding");
    }

    function _requireResolveError(bytes memory name, bytes memory record, bytes4 expected) private view {
        (bool ok, bytes memory reason) = address(resolver).staticcall(_request(name, record));
        require(!ok, "invalid resolution accepted");
        require(_selector(reason) == expected, "wrong resolution error");
    }

    function _namehash(string memory name) private pure returns (bytes32 node) {
        bytes memory text = bytes(name);
        uint256 end = text.length;
        for (uint256 i = end; i > 0; i--) {
            if (text[i - 1] == ".") {
                bytes memory label = new bytes(end - i);
                for (uint256 j = i; j < end; j++) label[j - i] = text[j];
                node = keccak256(abi.encodePacked(node, keccak256(label)));
                end = i - 1;
            }
        }
        bytes memory first = new bytes(end);
        for (uint256 i = 0; i < end; i++) first[i] = text[i];
        return keccak256(abi.encodePacked(node, keccak256(first)));
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
