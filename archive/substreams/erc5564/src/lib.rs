pub const CANONICAL_ANNOUNCER: [u8; 20] = [
    0x55, 0x64, 0x9e, 0x01, 0xb5, 0xdf, 0x19, 0x8d, 0x18, 0xd9, 0x5b, 0x5c, 0xc5, 0x05, 0x16, 0x30,
    0xcf, 0xd4, 0x55, 0x64,
];

pub fn parse_announcer_address(value: &str) -> Result<[u8; 20], substreams::errors::Error> {
    if value.is_empty() {
        return Ok(CANONICAL_ANNOUNCER);
    }

    let Some(hex) = value.strip_prefix("0x") else {
        return Err(anyhow_message());
    };
    if hex.len() != 40 {
        return Err(anyhow_message());
    }

    let mut address = [0_u8; 20];
    for (index, pair) in hex.as_bytes().chunks_exact(2).enumerate() {
        let Some(high) = decode_nibble(pair[0]) else {
            return Err(anyhow_message());
        };
        let Some(low) = decode_nibble(pair[1]) else {
            return Err(anyhow_message());
        };
        address[index] = (high << 4) | low;
    }
    Ok(address)
}

fn anyhow_message() -> substreams::errors::Error {
    std::io::Error::new(
        std::io::ErrorKind::InvalidInput,
        "announcer_address must be a 20-byte hex address",
    )
    .into()
}

fn decode_nibble(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

#[substreams::handlers::map]
fn map_announcements(
    announcer_address: String,
    block: Block,
) -> Result<Announcements, substreams::errors::Error> {
    extract_announcements(&announcer_address, &block)
}

pub fn extract_announcements(
    announcer_address: &str,
    block: &Block,
) -> Result<Announcements, substreams::errors::Error> {
    let address = parse_announcer_address(announcer_address)?;
    let addresses: [&[u8]; 1] = [&address];
    let timestamp = block.timestamp_seconds();
    let block_number = block.number;

    let items = block
        .events::<AnnouncementEvent>(&addresses)
        .map(|(event, log)| Announcement {
            scheme_id: uint256_bytes(&event.scheme_id),
            stealth_address: event.stealth_address,
            caller: event.caller,
            ephemeral_pub_key: event.ephemeral_pub_key,
            metadata: event.metadata,
            tx_hash: log.receipt.transaction.hash.clone(),
            log_index: log.index(),
            block_number,
            timestamp,
        })
        .collect();

    Ok(Announcements { items })
}

fn uint256_bytes(value: &substreams::scalar::BigInt) -> Vec<u8> {
    let (_, bytes) = value.to_bytes_be();
    let mut output = vec![0_u8; 32];
    let offset = output.len() - bytes.len();
    output[offset..].copy_from_slice(&bytes);
    output
}
mod abi {
    pub mod announcer;
}

pub mod pb {
    pub mod fuda {
        pub mod erc5564 {
            pub mod v1 {
                include!(concat!(env!("OUT_DIR"), "/fuda.erc5564.v1.rs"));
            }
        }
    }
}

use abi::announcer::events::Announcement as AnnouncementEvent;
use pb::fuda::erc5564::v1::{Announcement, Announcements};
use substreams_ethereum::pb::eth::v2::Block;
