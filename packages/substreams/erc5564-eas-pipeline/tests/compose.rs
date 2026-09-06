use erc5564_eas_pipeline_substreams::merge_events;
use erc5564_eas_pipeline_substreams::pb::fuda::{
    erc5564::v1::{Announcement, Announcements},
    pipeline::v1::{EasEvent, EasEvents},
};

#[test]
fn combines_announcements_and_eas_events_without_changing_them() {
    let announcement = Announcement {
        metadata: vec![0xde, 0xad],
        ..Default::default()
    };
    let eas_event = EasEvent {
        uid: vec![0xab; 32],
        ..Default::default()
    };

    let output = merge_events(
        Announcements {
            items: vec![announcement.clone()],
        },
        EasEvents {
            items: vec![eas_event.clone()],
        },
    );

    assert_eq!(output.announcements, vec![announcement]);
    assert_eq!(output.eas_events, vec![eas_event]);
}
