// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IUserRegistry {
    function register(
        string calldata label,
        address owner,
        address registry,
        address resolver,
        uint256 roleBitmap,
        uint64 expiry
    ) external returns (uint256 tokenId);
    function renew(uint256 anyId, uint64 newExpiry) external;
    function getOwner(uint256 anyId) external view returns (address);
}
