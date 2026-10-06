use std::{hint::black_box, sync::OnceLock};

struct Chunk {
    offset: usize,
    seed: u32,
    mask: u32,
    bytes: &'static [u8],
}

include!(concat!(env!("OUT_DIR"), "/packed.rs"));

fn unpack(chunks: &[Chunk]) -> String {
    let size = chunks
        .iter()
        .map(|c| c.offset + c.bytes.len())
        .max()
        .unwrap_or(0);
    let mut output = vec![0u8; size];
    for chunk in black_box(chunks) {
        // Prevent release/LTO from replacing the decoder with plaintext constants.
        let mut state = black_box(chunk.seed) ^ black_box(chunk.mask);
        let mut previous = (state >> 24) as u8;
        let bytes = black_box(chunk.bytes);
        for i in 0..bytes.len() {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            let value = black_box(bytes[bytes.len() - 1 - i]);
            output[chunk.offset + i] = (value ^ state as u8 ^ previous).wrapping_sub(i as u8);
            previous = value;
        }
    }
    String::from_utf8(output).expect("Invalid packed data")
}

pub fn config() -> &'static str {
    static VALUE: OnceLock<String> = OnceLock::new();
    VALUE.get_or_init(|| unpack(CONFIG_DATA))
}

pub fn guide() -> &'static str {
    static VALUE: OnceLock<String> = OnceLock::new();
    VALUE.get_or_init(|| unpack(GUIDE_DATA))
}

pub fn text(id: usize) -> &'static str {
    static VALUE: OnceLock<Vec<String>> = OnceLock::new();
    &VALUE.get_or_init(|| serde_json::from_str(&unpack(TEXT_DATA)).unwrap())[id]
}

#[cfg(test)]
mod tests {
    #[test]
    fn packed_data_round_trips() {
        assert_eq!(super::config(), include_str!("../config.json"));
        assert_eq!(super::guide(), include_str!("guide.html"));
    }
}
