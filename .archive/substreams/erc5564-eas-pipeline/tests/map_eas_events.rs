use erc5564_eas_pipeline_substreams::{CANONICAL_EAS, extract_eas_events, parse_eas_address};
use ethabi::{ParamType, Token, long_signature};
use prost_types::Timestamp;
use substreams_ethereum::pb::eth::v2::{
    Block, BlockHeader, Log, TransactionReceipt, TransactionTrace,
};

#[test]
fn uses_the_base_sepolia_eas_when_the_parameter_is_empty() {
    assert_eq!(parse_eas_address("").unwrap(), CANONICAL_EAS);
}

#[test]
fn extracts_attested_and_revoked_events_with_raw_identity() {
    let block = block_with_logs(
        vec![
            eas_log(CANONICAL_EAS.to_vec(), "Attested", 3, 0xaa),
            eas_log(CANONICAL_EAS.to_vec(), "Revoked", 4, 0xbb),
        ],
        99,
        1_800_000_001,
    );

    let output = extract_eas_events("", &block).unwrap();

    assert_eq!(output.items.len(), 2);
    assert_eq!(output.items[0].kind, 1);
    assert_eq!(output.items[0].uid, vec![0xaa; 32]);
    assert_eq!(output.items[0].recipient, vec![0x11; 20]);
    assert_eq!(output.items[0].attester, vec![0x22; 20]);
    assert_eq!(output.items[0].schema_uid, vec![0x33; 32]);
    assert_eq!(output.items[0].tx_hash, vec![0x44; 32]);
    assert_eq!(output.items[0].log_index, 3);
    assert_eq!(output.items[0].block_number, 99);
    assert_eq!(output.items[0].timestamp, 1_800_000_001);
    assert_eq!(output.items[1].kind, 2);
    assert_eq!(output.items[1].uid, vec![0xbb; 32]);
}

#[test]
fn ignores_a_lookalike_event_from_another_contract() {
    let block = block_with_logs(
        vec![eas_log(vec![0x99; 20], "Attested", 3, 0xaa)],
        99,
        1_800_000_001,
    );

    assert!(extract_eas_events("", &block).unwrap().items.is_empty());
}

pub fn eas_log(address: Vec<u8>, name: &str, index: u32, uid: u8) -> Log {
    Log {
        address,
        topics: vec![
            long_signature(
                name,
                &[
                    ParamType::Address,
                    ParamType::Address,
                    ParamType::FixedBytes(32),
                    ParamType::FixedBytes(32),
                ],
            )
            .as_bytes()
            .to_vec(),
            address_topic(0x11),
            address_topic(0x22),
            vec![0x33; 32],
        ],
        data: ethabi::encode(&[Token::FixedBytes(vec![uid; 32])]),
        index,
        ..Default::default()
    }
}

fn block_with_logs(logs: Vec<Log>, number: u64, timestamp: i64) -> Block {
    Block {
        number,
        header: Some(BlockHeader {
            timestamp: Some(Timestamp {
                seconds: timestamp,
                nanos: 0,
            }),
            ..Default::default()
        }),
        transaction_traces: vec![TransactionTrace {
            hash: vec![0x44; 32],
            status: 1,
            receipt: Some(TransactionReceipt {
                logs,
                ..Default::default()
            }),
            ..Default::default()
        }],
        ..Default::default()
    }
}

fn address_topic(byte: u8) -> Vec<u8> {
    let mut topic = vec![0_u8; 12];
    topic.extend([byte; 20]);
    topic
}
