pub const CANONICAL_EAS: [u8; 20] = [
    0x42, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x21,
];

pub fn parse_eas_address(value: &str) -> Result<[u8; 20], substreams::errors::Error> {
    if value.is_empty() {
        return Ok(CANONICAL_EAS);
    }

    let Some(hex) = value.strip_prefix("0x") else {
        return Err(invalid_address());
    };
    if hex.len() != 40 {
        return Err(invalid_address());
    }

    let mut address = [0_u8; 20];
    for (index, pair) in hex.as_bytes().chunks_exact(2).enumerate() {
        let (Some(high), Some(low)) = (decode_nibble(pair[0]), decode_nibble(pair[1])) else {
            return Err(invalid_address());
        };
        address[index] = (high << 4) | low;
    }
    Ok(address)
}

#[substreams::handlers::map]
fn map_eas_events(
    eas_address: String,
    block: Block,
) -> Result<EasEvents, substreams::errors::Error> {
    extract_eas_events(&eas_address, &block)
}

pub fn extract_eas_events(
    eas_address: &str,
    block: &Block,
) -> Result<EasEvents, substreams::errors::Error> {
    let address = parse_eas_address(eas_address)?;
    let addresses: [&[u8]; 1] = [&address];
    let timestamp = block.timestamp_seconds();
    let block_number = block.number;

    let mut items: Vec<EasEvent> = block
        .events::<AttestedEvent>(&addresses)
        .map(|(event, log)| EasEvent {
            kind: EasEventKind::Attested.into(),
            uid: event.uid.to_vec(),
            attester: event.attester,
            recipient: event.recipient,
            schema_uid: event.schema_uid.to_vec(),
            tx_hash: log.receipt.transaction.hash.clone(),
            log_index: log.index(),
            block_number,
            timestamp,
        })
        .chain(
            block
                .events::<RevokedEvent>(&addresses)
                .map(|(event, log)| EasEvent {
                    kind: EasEventKind::Revoked.into(),
                    uid: event.uid.to_vec(),
                    attester: event.attester,
                    recipient: event.recipient,
                    schema_uid: event.schema_uid.to_vec(),
                    tx_hash: log.receipt.transaction.hash.clone(),
                    log_index: log.index(),
                    block_number,
                    timestamp,
                }),
        )
        .collect();
    items.sort_by_key(|event| event.log_index);

    Ok(EasEvents { items })
}

#[substreams::handlers::map]
fn fuda_events(announcements: Announcements, eas_events: EasEvents) -> FudaEvents {
    merge_events(announcements, eas_events)
}

pub fn merge_events(announcements: Announcements, eas_events: EasEvents) -> FudaEvents {
    FudaEvents {
        announcements: announcements.items,
        eas_events: eas_events.items,
    }
}

fn invalid_address() -> substreams::errors::Error {
    std::io::Error::new(
        std::io::ErrorKind::InvalidInput,
        "eas_address must be a 20-byte hex address",
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

mod abi {
    pub mod eas;
}

pub mod pb {
    pub mod fuda {
        pub mod erc5564 {
            pub mod v1 {
                include!(concat!(env!("OUT_DIR"), "/fuda.erc5564.v1.rs"));
            }
        }
        pub mod pipeline {
            pub mod v1 {
                include!(concat!(env!("OUT_DIR"), "/fuda.pipeline.v1.rs"));
            }
        }
    }
}

use abi::eas::events::{Attested as AttestedEvent, Revoked as RevokedEvent};
use pb::fuda::erc5564::v1::Announcements;
use pb::fuda::pipeline::v1::{EasEvent, EasEventKind, EasEvents, FudaEvents};
use substreams_ethereum::pb::eth::v2::Block;
