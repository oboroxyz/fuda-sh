// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IFudaIssuerMarker {
    function parentNode() external view returns (bytes32);
    function markIssuer(string calldata label) external;
}
