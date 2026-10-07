mod string_codegen;
mod build_config;
use std::{
    env, fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

fn next(state: &mut u32) -> u32 {
    *state ^= *state << 13;
    *state ^= *state >> 17;
    *state ^= *state << 5;
    *state
}

fn pack(name: &str, bytes: &[u8], state: &mut u32) -> String {
    let mut chunks = Vec::new();
    let mut offset = 0;
    while offset < bytes.len() {
        let len = (64 + next(state) as usize % 129).min(bytes.len() - offset);
        let seed = next(state) | 1;
        let mask = next(state);
        let mut stream = seed;
        let mut previous = (seed >> 24) as u8;
        let mut encoded = vec![0u8; len];
        for i in 0..len {
            let key = next(&mut stream) as u8;
            let value = bytes[offset + i].wrapping_add(i as u8) ^ key ^ previous;
            encoded[len - 1 - i] = value;
            previous = value;
        }
        chunks.push((offset, seed ^ mask, mask, encoded));
        offset += len;
    }
    for i in (1..chunks.len()).rev() {
        let j = next(state) as usize % (i + 1);
        chunks.swap(i, j);
    }
    let mut out = format!("static {name}: &[Chunk] = &[\n");
    for (offset, seed, mask, data) in chunks {
        out.push_str(&format!(
            "Chunk {{ offset: {offset}, seed: {seed}, mask: {mask}, bytes: &{data:?} }},\n"
        ));
    }
    out.push_str("];\n");
    out
}

fn main() {
    println!("cargo:rerun-if-changed=config.json");
    println!("cargo:rerun-if-changed=build_config.rs");
    println!("cargo:rerun-if-changed=string_codegen.rs");
    println!("cargo:rerun-if-changed=src/guide.html");
    println!("cargo:rerun-if-env-changed=AHA_BUILD_NONCE");
    let nonce = env::var("AHA_BUILD_NONCE").unwrap_or_else(|_| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
            .to_string()
    });
    let mut state = 2166136261u32;
    for byte in nonce.bytes() {
        state = (state ^ byte as u32).wrapping_mul(16777619);
    }
    state |= 1;
    let config = build_config::prepare(
        serde_json::from_slice(&fs::read("config.json").unwrap()).expect("Invalid config.json"),
        &PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("../pages"),
    );
    let config = serde_json::to_vec(&config).unwrap();
    let guide = fs::read("src/guide.html").unwrap();
    let output = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let mut strings = string_codegen::Strings::default();
    for name in ["engine", "runtime"] {
        let input = format!("src/{name}.rs");
        println!("cargo:rerun-if-changed={input}");
        let generated = string_codegen::generate(&fs::read_to_string(input).unwrap(), &mut strings);
        fs::write(output.join(format!("{name}.rs")), generated).unwrap();
    }
    let source = pack("CONFIG_DATA", &config, &mut state)
        + &pack("GUIDE_DATA", &guide, &mut state)
        + &pack(
            "TEXT_DATA",
            &serde_json::to_vec(&strings.values).unwrap(),
            &mut state,
        );
    fs::write(
        PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("packed.rs"),
        source,
    )
    .unwrap();
}
