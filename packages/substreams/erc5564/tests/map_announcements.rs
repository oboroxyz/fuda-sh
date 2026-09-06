use ethabi::Token;
use ethabi::ethereum_types::U256;
use fuda_erc5564_substreams::{
    CANONICAL_ANNOUNCER, extract_announcements, parse_announcer_address,
};
use prost_types::Timestamp;
use substreams_ethereum::pb::eth::v2::{
    Block, BlockHeader, Log, TransactionReceipt, TransactionTrace,
};

#[test]
fn uses_the_canonical_announcer_when_the_parameter_is_empty() {
    assert_eq!(parse_announcer_address("").unwrap(), CANONICAL_ANNOUNCER);
}

#[test]
fn accepts_a_case_insensitive_override() {
    assert_eq!(
        parse_announcer_address("0x11111111111111111111111111111111111111AA").unwrap(),
        hex("11111111111111111111111111111111111111aa")
    );
}

#[test]
fn rejects_an_invalid_override() {
    let error = parse_announcer_address("0x1234").unwrap_err();
    assert_eq!(
        error.to_string(),
        "announcer_address must be a 20-byte hex address"
    );
}

#[test]
fn extracts_only_canonical_announcements_and_preserves_raw_fields() {
    let matching = announcement_log(CANONICAL_ANNOUNCER.to_vec(), 7);
    let other = announcement_log(vec![0x99; 20], 8);
    let block = block_with_logs(vec![matching, other], 42, 1_800_000_000);

    let output = extract_announcements("", &block).unwrap();

    assert_eq!(output.items.len(), 1);
    let item = &output.items[0];
    assert_eq!(item.scheme_id, uint_topic(1));
    assert_eq!(item.stealth_address, vec![0x22; 20]);
    assert_eq!(item.caller, vec![0x33; 20]);
    assert_eq!(item.ephemeral_pub_key, vec![0x02, 0xaa]);
    assert_eq!(item.metadata, vec![0xbb, 0xcc]);
    assert_eq!(item.tx_hash, vec![0x44; 32]);
    assert_eq!(item.log_index, 7);
    assert_eq!(item.block_number, 42);
    assert_eq!(item.timestamp, 1_800_000_000);
}

#[test]
fn preserves_a_scheme_id_larger_than_u64_as_32_big_endian_bytes() {
    let mut scheme_id = vec![0_u8; 32];
    scheme_id[0] = 0x80;
    scheme_id[31] = 0x01;
    let block = block_with_logs(
        vec![announcement_log_with_scheme(
            CANONICAL_ANNOUNCER.to_vec(),
            1,
            scheme_id.clone(),
        )],
        42,
        1_800_000_000,
    );

    let output = extract_announcements("", &block).unwrap();

    assert_eq!(output.items[0].scheme_id, scheme_id);
}

#[test]
fn excludes_logs_from_failed_transactions() {
    let mut transaction =
        transaction_with_logs(vec![announcement_log(CANONICAL_ANNOUNCER.to_vec(), 1)]);
    transaction.status = 2;
    let mut block = block_with_logs(Vec::new(), 42, 1_800_000_000);
    block.transaction_traces = vec![transaction];

    assert!(extract_announcements("", &block).unwrap().items.is_empty());
}

fn announcement_log(address: Vec<u8>, index: u32) -> Log {
    announcement_log_with_scheme(address, index, uint_topic(1))
}

fn announcement_log_with_scheme(address: Vec<u8>, index: u32, scheme_id: Vec<u8>) -> Log {
    Log {
        address,
        topics: vec![
            vec![
                0x5f, 0x0e, 0xab, 0x80, 0x57, 0x63, 0x0b, 0xa7, 0x67, 0x6c, 0x49, 0xb4, 0xf2, 0x1a,
                0x02, 0x31, 0x41, 0x4e, 0x79, 0x47, 0x45, 0x95, 0xbe, 0x8e, 0x4c, 0x43, 0x2f, 0xbf,
                0x6b, 0xf0, 0xf4, 0xe7,
            ],
            scheme_id,
            address_topic(0x22),
            address_topic(0x33),
        ],
        data: ethabi::encode(&[
            Token::Bytes(vec![0x02, 0xaa]),
            Token::Bytes(vec![0xbb, 0xcc]),
        ]),
        index,
        ..Default::default()
    }
}

fn transaction_with_logs(logs: Vec<Log>) -> TransactionTrace {
    TransactionTrace {
        hash: vec![0x44; 32],
        status: 1,
        receipt: Some(TransactionReceipt {
            logs,
            ..Default::default()
        }),
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
        transaction_traces: vec![transaction_with_logs(logs)],
        ..Default::default()
    }
}

fn uint_topic(value: u64) -> Vec<u8> {
    let mut topic = [0_u8; 32];
    U256::from(value).to_big_endian(&mut topic);
    topic.to_vec()
}

fn address_topic(byte: u8) -> Vec<u8> {
    let mut topic = vec![0_u8; 12];
    topic.extend([byte; 20]);
    topic
}

fn hex(value: &str) -> [u8; 20] {
    let mut output = [0_u8; 20];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        output[index] = (nibble(pair[0]) << 4) | nibble(pair[1]);
    }
    output
}

fn nibble(value: u8) -> u8 {
    match value {
        b'0'..=b'9' => value - b'0',
        b'a'..=b'f' => value - b'a' + 10,
        _ => panic!("test fixture must be lowercase hex"),
    }
}
