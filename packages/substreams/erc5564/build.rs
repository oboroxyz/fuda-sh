fn main() {
    prost_build::Config::new()
        .compile_protos(&["proto/erc5564.proto"], &["proto"])
        .expect("erc5564 protobuf generation must succeed");

    substreams_ethereum::Abigen::new("announcer", "src/abi/announcer.json")
        .expect("Announcer ABI must be valid")
        .generate()
        .expect("Announcer bindings must generate")
        .write_to_file("src/abi/announcer.rs")
        .expect("Announcer bindings must be writable");
}
