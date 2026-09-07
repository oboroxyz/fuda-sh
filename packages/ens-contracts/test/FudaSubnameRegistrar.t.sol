// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FudaSubnameRegistrar} from "../contracts/FudaSubnameRegistrar.sol";
import {IUserRegistry} from "../contracts/interfaces/IUserRegistry.sol";
import {IFudaIssuerMarker} from "../contracts/interfaces/IFudaIssuerMarker.sol";
import {FudaECDSA} from "../contracts/libraries/FudaECDSA.sol";

interface RegistrarVm {
    function addr(uint256 privateKey) external returns (address);
    function chainId(uint256 chainId_) external;
    function prank(address sender) external;
    function sign(uint256 key, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
    function expectEmit(bool topic1, bool topic2, bool topic3, bool data, address emitter) external;
}

contract FakeUserRegistry is IUserRegistry {
    struct Entry {
        address owner;
        address registry;
        address resolver;
        uint256 roles;
        uint64 expiry;
    }
    mapping(uint256 => Entry) public entries;
    uint256 public nextTokenId = 1;
    bool public failWrites;
    uint256 public nonceAtRegister;
    uint256 public nonceAtRenew;

    function setFailWrites(bool fail) external {
        failWrites = fail;
    }

    function replaceOwner(uint256 id, address nextOwner) external {
        entries[id].owner = nextOwner;
    }

    function register(
        string calldata label,
        address owner,
        address registry,
        address resolver,
        uint256 roleBitmap,
        uint64 expiry
    ) external returns (uint256 tokenId) {
        require(!failWrites, "registry unavailable");
        nonceAtRegister = FudaSubnameRegistrar(msg.sender).nonces(owner);
        uint256 id = uint256(keccak256(bytes(label)));
        require(getOwner(id) == address(0), "active");
        entries[id] = Entry(owner, registry, resolver, roleBitmap, expiry);
        return nextTokenId++;
    }

    function getOwner(uint256 anyId) public view returns (address) {
        Entry memory entry = entries[anyId];
        return block.timestamp < entry.expiry ? entry.owner : address(0);
    }

    function renew(uint256 anyId, uint64 newExpiry) external {
        require(!failWrites, "registry unavailable");
        nonceAtRenew = FudaSubnameRegistrar(msg.sender).nonces(entries[anyId].owner);
        require(newExpiry >= entries[anyId].expiry, "reduced");
        entries[anyId].expiry = newExpiry;
    }
}

contract FakeIssuerMarker is IFudaIssuerMarker {
    bytes32 public immutable parentNode;
    string public markedLabel;
    uint256 public markCount;
    bool public failWrites;

    function setFailWrites(bool fail) external {
        failWrites = fail;
    }

    constructor(bytes32 node) {
        parentNode = node;
    }

    function markIssuer(string calldata label) external {
        require(!failWrites, "marker unavailable");
        markedLabel = label;
        markCount++;
    }
}

contract ECDSAHarness {
    function recover(bytes32 digest, bytes memory signature) external pure returns (address) {
        return FudaECDSA.recover(digest, signature);
    }
}

contract FudaSubnameRegistrarTest {
    RegistrarVm private constant VM =
        RegistrarVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant SIGNER_KEY = 0xa11ce;
    uint256 private constant NEXT_SIGNER_KEY = 0xb0b;
    uint256 private constant SECP256K1_ORDER =
        0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141;
    bytes32 private constant PARENT_NODE = keccak256("parent fixture");
    bytes32 private constant CLAIM_TYPE = keccak256(
        "ClaimVoucher(bytes32 labelHash,address issuer,uint64 expiry,uint256 nonce,uint64 deadline)"
    );
    bytes32 private constant RENEW_TYPE = keccak256(
        "RenewVoucher(bytes32 labelHash,address issuer,uint64 expiry,uint256 nonce,uint64 deadline)"
    );

    event IssuerClaimed(bytes32 indexed labelHash, address indexed issuer, uint256 indexed tokenId, uint64 expiry, uint256 nonce);
    event IssuerRenewed(bytes32 indexed labelHash, address indexed issuer, uint64 expiry, uint256 nonce);
    event VoucherSignerUpdated(address indexed previousSigner, address indexed nextSigner);

    FakeUserRegistry private registry;
    FakeIssuerMarker private marker;
    FudaSubnameRegistrar private registrar;
    address private issuer;

    function setUp() public {
        VM.chainId(11_155_111);
        VM.warp(1_000);
        issuer = VM.addr(0x155);
        registry = new FakeUserRegistry();
        marker = new FakeIssuerMarker(PARENT_NODE);
        registrar = new FudaSubnameRegistrar(registry, marker, VM.addr(SIGNER_KEY), PARENT_NODE);
    }

    // Break: registration forwards a wrong owner, resolver, subregistry, role, or expiry.
    function testClaimRegistersExactImmutableSettingsAndMarksIssuer() public {
        uint256 tokenId = _claim("coffee-42", 3_000, 0);
        require(tokenId == 1, "wrong registry token ID");
        _assertEntry("coffee-42", issuer, 3_000);
        require(keccak256(bytes(marker.markedLabel())) == keccak256("coffee-42"), "label changed");
        require(marker.markCount() == 1, "issuer not marked once");
    }

    // Break: missing nonce consumption or misindexed event makes claims replayable or unindexable.
    function testClaimConsumesNonceAndEmitsIssuerClaimed() public {
        bytes memory signature = _signature(CLAIM_TYPE, "coffee", 3_000, 0, 2_000, SIGNER_KEY);
        VM.expectEmit(true, true, true, true, address(registrar));
        emit IssuerClaimed(keccak256("coffee"), issuer, 1, 3_000, 0);
        VM.prank(issuer);
        registrar.claim("coffee", issuer, 3_000, 0, 2_000, signature);
        require(registrar.nonces(issuer) == 1, "nonce not consumed");
    }

    // Break: renewal uses token ID instead of label hash or renews a neighboring label.
    function testRenewExtendsTheActiveIssuersExactLabel() public {
        _claim("coffee", 3_000, 0);
        _claim("tea", 3_100, 1);
        bytes memory signature = _signature(RENEW_TYPE, "coffee", 4_000, 2, 2_000, SIGNER_KEY);
        VM.expectEmit(true, true, false, true, address(registrar));
        emit IssuerRenewed(keccak256("coffee"), issuer, 4_000, 2);
        VM.prank(issuer);
        registrar.renew("coffee", issuer, 4_000, 2, 2_000, signature);
        _assertEntry("coffee", issuer, 4_000);
        _assertEntry("tea", issuer, 3_100);
        require(registrar.nonces(issuer) == 3, "renew nonce not consumed");
        require(marker.markCount() == 2, "renew unexpectedly marked issuer");
    }

    // Break: expired names cannot be freshly registered at the exclusive expiry boundary.
    function testExpiredIssuerUsesClaimForFreshRegistration() public {
        _claim("coffee", 1_100, 0);
        VM.warp(1_100);
        require(registry.getOwner(uint256(keccak256("coffee"))) == address(0), "expiry not exclusive");
        require(_claim("coffee", 3_000, 1) == 2, "not freshly registered");
        _assertEntry("coffee", issuer, 3_000);
    }

    // Break: rotating the signer leaves old vouchers valid.
    function testOwnerRotatesVoucherSignerAndOldSignerStopsAuthorizing() public {
        bytes memory oldSignature = _signature(CLAIM_TYPE, "coffee", 3_000, 0, 2_000, SIGNER_KEY);
        address nextSigner = VM.addr(NEXT_SIGNER_KEY);
        VM.expectEmit(true, true, false, true, address(registrar));
        emit VoucherSignerUpdated(VM.addr(SIGNER_KEY), nextSigner);
        registrar.setVoucherSigner(nextSigner);
        VM.prank(issuer);
        (bool ok,) = address(registrar).call(abi.encodeCall(FudaSubnameRegistrar.claim, ("coffee", issuer, 3_000, 0, 2_000, oldSignature)));
        require(!ok, "old signer authorized claim");
        bytes memory signature = _signature(CLAIM_TYPE, "coffee", 3_000, 0, 2_000, NEXT_SIGNER_KEY);
        VM.prank(issuer);
        registrar.claim("coffee", issuer, 3_000, 0, 2_000, signature);
        _assertEntry("coffee", issuer, 3_000);
    }

    // Break: cross-language voucher domain or field encoding diverges.
    function testMatchesTypeScriptClaimAndRenewDigestVectors() public pure {
        bytes32 labelHash = 0x3333333333333333333333333333333333333333333333333333333333333333;
        address vectorIssuer = 0x2222222222222222222222222222222222222222;
        address vectorRegistrar = 0x1111111111111111111111111111111111111111;
        bytes32 claimHash = keccak256(abi.encode(CLAIM_TYPE, labelHash, vectorIssuer, uint64(3_000), uint256(7), uint64(2_000)));
        bytes32 renewHash = keccak256(abi.encode(RENEW_TYPE, labelHash, vectorIssuer, uint64(3_000), uint256(7), uint64(2_000)));
        require(_digest(vectorRegistrar, 11_155_111, claimHash) == 0x923f42654b9c0bb0dc3c49be040b9f72aeee1becad195ab14c3e0d389bc5724a, "claim vector differs");
        require(_digest(vectorRegistrar, 11_155_111, renewHash) == 0xe36967dad4b6815e19ce53998015a1073a004dce72bf2ee3437c075bb98882f3, "renew vector differs");
    }

    // Break: a deployment on another chain accepts Sepolia-bound vouchers.
    function testRejectsWrongChainAtConstruction() public {
        VM.chainId(1);
        _rejectConstruction(registry, marker, VM.addr(SIGNER_KEY), PARENT_NODE);
    }

    // Break: unusable dependencies or a mismatched namehash are locked in forever.
    function testRejectsZeroConstructorAddressesAndMismatchedParent() public {
        address signer = VM.addr(SIGNER_KEY);
        _rejectConstruction(IUserRegistry(address(0)), marker, signer, PARENT_NODE);
        _rejectConstruction(registry, IFudaIssuerMarker(address(0)), signer, PARENT_NODE);
        _rejectConstruction(registry, marker, address(0), PARENT_NODE);
        _rejectConstruction(registry, marker, signer, bytes32(uint256(1)));
    }

    // Break: a relayer can spend an issuer's voucher without their transaction.
    // Break: requiring the issuer to be the sender would force a venue owner to hold
    // this chain's gas. The voucher signature is the whole authorization, so a relayed
    // submission must land the name on the signed issuer and nowhere else.
    function testRelayedClaimAndRenewLandOnTheSignedIssuer() public {
        address relayer = VM.addr(0xfeed);
        bytes memory signature = _signature(CLAIM_TYPE, "coffee", 3_000, 0, 2_000, SIGNER_KEY);
        VM.prank(relayer);
        registrar.claim("coffee", issuer, 3_000, 0, 2_000, signature);
        _assertEntry("coffee", issuer, 3_000);
        require(registrar.nonces(issuer) == 1, "relayed claim did not consume the issuer nonce");
        require(registrar.nonces(relayer) == 0, "relayed claim consumed the relayer nonce");

        signature = _signature(RENEW_TYPE, "coffee", 4_000, 1, 2_000, SIGNER_KEY);
        VM.prank(relayer);
        registrar.renew("coffee", issuer, 4_000, 1, 2_000, signature);
        _assertEntry("coffee", issuer, 4_000);
    }

    // Break: dropping the sender check must not weaken the renewal ownership rule —
    // a relayer must not be able to renew a label the signed issuer no longer owns.
    function testRelayedRenewStillRequiresTheSignedIssuerToOwnTheLabel() public {
        _claim("coffee", 3_000, 0);
        registry.replaceOwner(uint256(keccak256("coffee")), VM.addr(0xdead));
        bytes memory signature = _signature(RENEW_TYPE, "coffee", 4_000, 1, 2_000, SIGNER_KEY);
        VM.prank(VM.addr(0xfeed));
        (bool ok,) = address(registrar).call(abi.encodeCall(FudaSubnameRegistrar.renew, ("coffee", issuer, 4_000, 1, 2_000, signature)));
        require(!ok, "relayer renewed a label the issuer no longer owns");
        require(registrar.nonces(issuer) == 1, "rejected renewal spent the nonce");
    }

    // Break: accepting noncanonical labels creates ambiguous or unresolvable names.
    function testRejectsEmptyUppercaseLeadingHyphenTrailingHyphenAndOverlongLabels() public {
        string[9] memory labels = ["", "Coffee", "-coffee", "coffee-", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "co_ffee", "co.ffee", "co ffee", unicode"café"];
        for (uint256 i; i < labels.length; i++) {
            _rejectClaim(labels[i], 3_000, 0, 2_000, _signature(CLAIM_TYPE, labels[i], 3_000, 0, 2_000, SIGNER_KEY));
        }
        _claim("coffee", 3_000, 0);
        _rejectRenew("Coffee", 4_000, 1, 2_000, _signature(RENEW_TYPE, "Coffee", 4_000, 1, 2_000, SIGNER_KEY));
    }

    // Break: vouchers can be substituted across labels, actions, domains, signers, or nonce values.
    function testRejectsWrongLabelHashActionChainContractSignerAndNonce() public {
        _rejectClaim("coffee", 3_000, 0, 2_000, _signature(CLAIM_TYPE, "tea", 3_000, 0, 2_000, SIGNER_KEY));
        _rejectClaim("coffee", 3_000, 0, 2_000, _signature(RENEW_TYPE, "coffee", 3_000, 0, 2_000, SIGNER_KEY));
        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPE, keccak256("coffee"), issuer, uint64(3_000), uint256(0), uint64(2_000)));
        _rejectClaim("coffee", 3_000, 0, 2_000, _signDigest(_digest(address(registrar), 1, structHash)));
        _rejectClaim("coffee", 3_000, 0, 2_000, _signDigest(_digest(address(0xbeef), 11_155_111, structHash)));
        _rejectClaim("coffee", 3_000, 0, 2_000, _signature(CLAIM_TYPE, "coffee", 3_000, 0, 2_000, NEXT_SIGNER_KEY));
        _rejectClaim("coffee", 3_000, 1, 2_000, _signature(CLAIM_TYPE, "coffee", 3_000, 1, 2_000, SIGNER_KEY));
        _rejectClaim("coffee", 3_001, 0, 2_000, _signature(CLAIM_TYPE, "coffee", 3_000, 0, 2_000, SIGNER_KEY));
        _rejectClaim("coffee", 3_000, 0, 2_001, _signature(CLAIM_TYPE, "coffee", 3_000, 0, 2_000, SIGNER_KEY));
    }

    // Break: stale vouchers or already-expired entries are accepted.
    function testRejectsExpiredDeadlineAndNonFutureExpiry() public {
        _rejectClaim("coffee", 3_000, 0, 999, _signature(CLAIM_TYPE, "coffee", 3_000, 0, 999, SIGNER_KEY));
        _rejectClaim("coffee", 1_000, 0, 2_000, _signature(CLAIM_TYPE, "coffee", 1_000, 0, 2_000, SIGNER_KEY));
        _rejectClaim("coffee", 999, 0, 2_000, _signature(CLAIM_TYPE, "coffee", 999, 0, 2_000, SIGNER_KEY));
        _claim("coffee", 3_000, 0);
        _rejectRenew("coffee", 4_000, 1, 999, _signature(RENEW_TYPE, "coffee", 4_000, 1, 999, SIGNER_KEY));
        _rejectRenew("coffee", 1_000, 1, 2_000, _signature(RENEW_TYPE, "coffee", 1_000, 1, 2_000, SIGNER_KEY));
    }

    // Break: noncanonical encodings and malleable ECDSA signatures bypass strict recovery.
    function testRejectsMalformedInvalidVAndHighSSignatures() public {
        bytes memory signature = _signature(CLAIM_TYPE, "coffee", 3_000, 0, 2_000, SIGNER_KEY);
        _rejectClaim("coffee", 3_000, 0, 2_000, bytes.concat(signature, hex"00"));
        _rejectClaim("coffee", 3_000, 0, 2_000, hex"");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        _rejectClaim("coffee", 3_000, 0, 2_000, abi.encodePacked(r, s));
        _rejectClaim("coffee", 3_000, 0, 2_000, abi.encodePacked(r, s, uint8(29)));
        _rejectClaim("coffee", 3_000, 0, 2_000, abi.encodePacked(r, s, uint8(v - 27)));
        _rejectClaim("coffee", 3_000, 0, 2_000, abi.encodePacked(r, bytes32(SECP256K1_ORDER - uint256(s)), uint8(v == 27 ? 28 : 27)));
        _rejectClaim("coffee", 3_000, 0, 2_000, abi.encodePacked(bytes32(0), bytes32(0), uint8(27)));
    }

    // Break: consumed claim vouchers are accepted because replay rejection is hidden behind expiry validation.
    function testRejectsReplay() public {
        bytes memory claimSignature = _signature(CLAIM_TYPE, "coffee", 1_100, 0, 2_000, SIGNER_KEY);
        _claim("coffee", 1_100, 0);
        VM.prank(issuer);
        (bool ok, bytes memory revertData) = address(registrar).call(
            abi.encodeCall(
                FudaSubnameRegistrar.claim,
                ("coffee", issuer, 1_100, 0, 2_000, claimSignature)
            )
        );
        require(!ok, "claim replay accepted");
        require(
            _revertSelector(revertData) == FudaSubnameRegistrar.InvalidNonce.selector,
            "claim replay did not reject its nonce"
        );
        VM.warp(1_100);
        _claim("coffee", 3_000, 1);
        bytes memory signature = _signature(RENEW_TYPE, "coffee", 4_000, 2, 2_000, SIGNER_KEY);
        VM.prank(issuer);
        registrar.renew("coffee", issuer, 4_000, 2, 2_000, signature);
        _rejectRenew("coffee", 4_000, 2, 2_000, signature);
    }

    // Break: past owners retain renewal authority, or an expiry can be shortened.
    function testRejectsRenewalByFormerOrExpiredOwnerAndReducedExpiry() public {
        _claim("coffee", 3_000, 0);
        registry.replaceOwner(uint256(keccak256("coffee")), address(0xbeef));
        _rejectRenew("coffee", 4_000, 1, 2_000, _signature(RENEW_TYPE, "coffee", 4_000, 1, 2_000, SIGNER_KEY));
        registry.replaceOwner(uint256(keccak256("coffee")), issuer);
        _rejectRenew("coffee", 2_999, 1, 2_000, _signature(RENEW_TYPE, "coffee", 2_999, 1, 2_000, SIGNER_KEY));
        VM.warp(3_000);
        _rejectRenew("coffee", 4_000, 1, 4_000, _signature(RENEW_TYPE, "coffee", 4_000, 1, 4_000, SIGNER_KEY));
    }

    // Break: a registry revert is swallowed and spends a nonce or marks an unregistered name.
    function testRegistryFailureRollsBackNonceAndMarker() public {
        registry.setFailWrites(true);
        _rejectClaim("coffee", 3_000, 0, 2_000, _signature(CLAIM_TYPE, "coffee", 3_000, 0, 2_000, SIGNER_KEY));
        _assertAbsent("coffee");
        require(marker.markCount() == 0, "failed registration marked issuer");
        registry.setFailWrites(false);
        _claim("coffee", 3_000, 0);
        registry.setFailWrites(true);
        _rejectRenew("coffee", 4_000, 1, 2_000, _signature(RENEW_TYPE, "coffee", 4_000, 1, 2_000, SIGNER_KEY));
        _assertEntry("coffee", issuer, 3_000);
        require(marker.markCount() == 1, "failed renewal changed marker");
    }

    // Break: a marker revert leaves a paid registration or consumed nonce behind.
    function testMarkerFailureRollsBackRegistrationAndNonce() public {
        marker.setFailWrites(true);
        _rejectClaim("coffee", 3_000, 0, 2_000, _signature(CLAIM_TYPE, "coffee", 3_000, 0, 2_000, SIGNER_KEY));
        _assertAbsent("coffee");
        require(registry.nextTokenId() == 1, "failed mark consumed token ID");
        require(marker.markCount() == 0, "failed mark persisted");
        marker.setFailWrites(false);
        require(_claim("coffee", 3_000, 0) == 1, "voucher not reusable after rollback");
    }

    // Break: anyone can seize voucher authority or disable signature verification with zero.
    function testOnlyOwnerCanRotateVoucherSignerAndZeroIsRejected() public {
        address signer = VM.addr(SIGNER_KEY);
        VM.prank(issuer);
        (bool ok,) = address(registrar).call(abi.encodeCall(FudaSubnameRegistrar.setVoucherSigner, (issuer)));
        require(!ok, "non-owner rotated signer");
        require(registrar.voucherSigner() == signer, "rejected rotation changed signer");
        (ok,) = address(registrar).call(abi.encodeCall(FudaSubnameRegistrar.setVoucherSigner, (address(0))));
        require(!ok, "zero signer accepted");
        require(registrar.voucherSigner() == signer, "zero rotation changed signer");
    }

    // Break: registrar gives an issuer transfer or other registry permissions.
    function testRegisteredIssuerHasNoTransferRole() public {
        _claim("coffee", 3_000, 0);
        (,,, uint256 roles,) = registry.entries(uint256(keccak256("coffee")));
        require(roles == 0, "issuer received registry permissions");
    }

    // Break: the shared seam returns zero for unrecoverable signatures to another consumer.
    function testSharedRecoveryRejectsZeroRecovery() public {
        ECDSAHarness harness = new ECDSAHarness();
        (bool ok,) = address(harness).call(abi.encodeCall(ECDSAHarness.recover, (bytes32(0), abi.encodePacked(bytes32(0), bytes32(0), uint8(27)))));
        require(!ok, "shared recovery returned zero");
    }

    // Break: validation rejects valid 1/63-byte labels, interior hyphens, or an inclusive deadline.
    function testAcceptsLabelLengthAndDeadlineBoundaries() public {
        _claim("0", 3_000, 0);
        _claim("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 3_000, 1);
        bytes memory signature = _signature(CLAIM_TYPE, "a--9", 1_001, 2, 1_000, SIGNER_KEY);
        VM.prank(issuer);
        registrar.claim("a--9", issuer, 1_001, 2, 1_000, signature);
        _assertEntry("a--9", issuer, 1_001);
        signature = _signature(RENEW_TYPE, "a--9", 1_001, 3, 1_000, SIGNER_KEY);
        VM.prank(issuer);
        registrar.renew("a--9", issuer, 1_001, 3, 1_000, signature);
        require(registrar.nonces(issuer) == 4, "equal-expiry renewal failed");
    }

    // Break: moving nonce consumption after the registry call exposes the voucher during callbacks.
    function testConsumesNonceBeforeRegistryCanCallBack() public {
        _claim("coffee", 3_000, 0);
        require(registry.nonceAtRegister() == 1, "registry saw unspent claim nonce");
        bytes memory signature = _signature(RENEW_TYPE, "coffee", 4_000, 1, 2_000, SIGNER_KEY);
        VM.prank(issuer);
        registrar.renew("coffee", issuer, 4_000, 1, 2_000, signature);
        require(registry.nonceAtRenew() == 2, "registry saw unspent renewal nonce");
    }

    // Break: failed duplicate registration spends an otherwise valid voucher or overwrites an active entry.
    function testActiveLabelCannotBeClaimedAgain() public {
        _claim("coffee", 3_000, 0);
        _rejectClaim("coffee", 4_000, 1, 2_000, _signature(CLAIM_TYPE, "coffee", 4_000, 1, 2_000, SIGNER_KEY));
        _assertEntry("coffee", issuer, 3_000);
        require(marker.markCount() == 1, "duplicate claim changed issuer marker");
    }

    function _rejectConstruction(IUserRegistry registry_, IFudaIssuerMarker marker_, address signer_, bytes32 node_) private {
        try new FudaSubnameRegistrar(registry_, marker_, signer_, node_) returns (FudaSubnameRegistrar) {
            revert("invalid deployment accepted");
        } catch {}
    }

    function _rejectClaim(string memory label, uint64 expiry, uint256 nonce, uint64 deadline, bytes memory signature) private {
        uint256 beforeNonce = registrar.nonces(issuer);
        VM.prank(issuer);
        (bool ok,) = address(registrar).call(abi.encodeCall(FudaSubnameRegistrar.claim, (label, issuer, expiry, nonce, deadline, signature)));
        require(!ok, "invalid claim accepted");
        require(registrar.nonces(issuer) == beforeNonce, "rejected claim spent nonce");
    }

    function _rejectRenew(string memory label, uint64 expiry, uint256 nonce, uint64 deadline, bytes memory signature) private {
        uint256 beforeNonce = registrar.nonces(issuer);
        VM.prank(issuer);
        (bool ok,) = address(registrar).call(abi.encodeCall(FudaSubnameRegistrar.renew, (label, issuer, expiry, nonce, deadline, signature)));
        require(!ok, "invalid renewal accepted");
        require(registrar.nonces(issuer) == beforeNonce, "rejected renewal spent nonce");
    }

    function _assertAbsent(string memory label) private view {
        (address entryOwner, address subregistry, address entryResolver, uint256 roles, uint64 expiry) = registry.entries(uint256(keccak256(bytes(label))));
        require(entryOwner == address(0) && subregistry == address(0) && entryResolver == address(0) && roles == 0 && expiry == 0, "failed call persisted entry");
    }

    function _signDigest(bytes32 digest) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(SIGNER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function _revertSelector(bytes memory data) private pure returns (bytes4 selector) {
        if (data.length < 4) return bytes4(0);
        assembly ("memory-safe") {
            selector := mload(add(data, 0x20))
        }
    }

    function _claim(string memory label, uint64 expiry, uint256 nonce) private returns (uint256) {
        bytes memory signature = _signature(CLAIM_TYPE, label, expiry, nonce, 2_000, SIGNER_KEY);
        VM.prank(issuer);
        return registrar.claim(label, issuer, expiry, nonce, 2_000, signature);
    }

    function _signature(bytes32 action, string memory label, uint64 expiry, uint256 nonce, uint64 deadline, uint256 key) private returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(action, keccak256(bytes(label)), issuer, expiry, nonce, deadline));
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(key, _digest(address(registrar), 11_155_111, structHash));
        return abi.encodePacked(r, s, v);
    }

    function _digest(address target, uint256 chain, bytes32 structHash) private pure returns (bytes32) {
        bytes32 domain = keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"), keccak256("FudaSubnameRegistrar"), keccak256("1"), chain, target));
        return keccak256(abi.encodePacked(hex"1901", domain, structHash));
    }

    function _assertEntry(string memory label, address expectedOwner, uint64 expectedExpiry) private view {
        (address entryOwner, address subregistry, address entryResolver, uint256 roles, uint64 expiry) = registry.entries(uint256(keccak256(bytes(label))));
        require(entryOwner == expectedOwner, "wrong owner");
        require(subregistry == address(0), "subregistry enabled");
        require(entryResolver == address(marker), "wrong resolver");
        require(roles == 0, "issuer roles enabled");
        require(expiry == expectedExpiry, "wrong expiry");
    }
}
