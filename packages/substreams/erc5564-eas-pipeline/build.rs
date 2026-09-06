fn main() {
    prost_build::Config::new()
        .compile_protos(
            &["proto/fuda.proto", "../erc5564/proto/erc5564.proto"],
            &["proto", "../erc5564/proto"],
        )
        .expect("ERC-5564 + EAS pipeline protobuf generation must succeed");

    substreams_ethereum::Abigen::new("eas", "src/abi/eas.json")
        .expect("EAS ABI must be valid")
        .generate()
        .expect("EAS bindings must generate")
        .write_to_file("src/abi/eas.rs")
        .expect("EAS bindings must be writable");
}
