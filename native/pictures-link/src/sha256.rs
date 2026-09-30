//! SHA-256 (FIPS 180-4), so that the helper holds NDI's library to its pin
//! (`native/pictures-link/ndi-library.json`, compiled in) before it loads it:
//! `npm run app -- --vmix-pictures` checks the same pin, and this is the
//! helper's own check of it (D33). No crate is added for it.

/// The first 32 bits of the fractional parts of the cube roots of the first
/// 64 primes.
const K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/// The first 32 bits of the fractional parts of the square roots of the
/// first 8 primes.
const START: [u32; 8] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

/// One 64-byte block into the state.
fn compress(state: &mut [u32; 8], block: &[u8]) {
    let mut w = [0_u32; 64];
    for (word, bytes) in w.iter_mut().zip(block.chunks_exact(4)) {
        *word = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    }
    for i in 16..64 {
        let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
        let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
        w[i] = w[i - 16]
            .wrapping_add(s0)
            .wrapping_add(w[i - 7])
            .wrapping_add(s1);
    }
    let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = *state;
    for i in 0..64 {
        let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
        let choice = (e & f) ^ (!e & g);
        let t1 = h
            .wrapping_add(s1)
            .wrapping_add(choice)
            .wrapping_add(K[i])
            .wrapping_add(w[i]);
        let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
        let majority = (a & b) ^ (a & c) ^ (b & c);
        let t2 = s0.wrapping_add(majority);
        h = g;
        g = f;
        f = e;
        e = d.wrapping_add(t1);
        d = c;
        c = b;
        b = a;
        a = t1.wrapping_add(t2);
    }
    for (value, add) in state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
        *value = value.wrapping_add(add);
    }
}

/// The SHA-256 of `bytes`, as 64 lowercase hexadecimal characters.
pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut state = START;
    let mut blocks = bytes.chunks_exact(64);
    for block in &mut blocks {
        compress(&mut state, block);
    }
    // The rest, a one bit, zeros, and the length in bits: one block or two.
    let rest = blocks.remainder();
    let mut tail = [0_u8; 128];
    tail[..rest.len()].copy_from_slice(rest);
    tail[rest.len()] = 0x80;
    let length = if rest.len() < 56 { 64 } else { 128 };
    let bits = (bytes.len() as u64).wrapping_mul(8);
    tail[length - 8..length].copy_from_slice(&bits.to_be_bytes());
    for block in tail[..length].chunks_exact(64) {
        compress(&mut state, block);
    }
    state.iter().map(|word| format!("{word:08x}")).collect()
}

/// The pin's SHA-256, read from `ndi-library.json`'s text: the value of its
/// `"sha256"`, when it is 64 lowercase hexadecimal characters.
pub fn pinned_sha256(pin: &str) -> Option<&str> {
    const KEY: &str = "\"sha256\"";
    let after = &pin[pin.find(KEY)? + KEY.len()..];
    let quoted = after
        .trim_start()
        .strip_prefix(':')?
        .trim_start()
        .strip_prefix('"')?;
    let (value, _) = quoted.split_once('"')?;
    let well_formed = value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
    well_formed.then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    // FIPS 180-4's examples, and the edges of the padding.
    #[test]
    fn it_gives_the_standard_s_digests() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            sha256_hex(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
        assert_eq!(
            sha256_hex(&[b'a'; 1_000_000]),
            "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
        );
        // Around the padding's edges: the length fits the last block, or
        // needs another (the digests .NET's own SHA-256 gives).
        for (length, digest) in [
            (
                55,
                "d5e285683cd4efc02d021a5c62014694958901005d6f71e89e0989fac77e4072",
            ),
            (
                56,
                "04c26261370ee7541549d16dee320c723e3fd14671e66a099afe0a377c16888e",
            ),
            (
                63,
                "75220b47218278e656f2013bb8f0c455a25eaf01e86c64924e9d48d89776d6f2",
            ),
            (
                64,
                "7ce100971f64e7001e8fe5a51973ecdfe1ced42befe7ee8d5fd6219506b5393c",
            ),
            (
                65,
                "9537c5fdf120482f7d58d25e9ed583f52c02b4e304ea814db1633ad565aed7e9",
            ),
            (
                119,
                "000b48d4edf0fa7bee3c6236ecd2785baa5db4eeb8bb54341b029e0d9fa5fb0c",
            ),
            (
                120,
                "13f05a0b594787f5ecd315edc96141bd3243203d1b7d4f0836f37308b276ba98",
            ),
        ] {
            assert_eq!(sha256_hex(&vec![b'x'; length]), digest, "{length} bytes");
        }
    }

    #[test]
    fn the_pin_s_digest_is_read_from_its_file() {
        let pin = include_str!("../ndi-library.json");
        let digest = pinned_sha256(pin).expect("the pin holds a digest");
        assert_eq!(digest.len(), 64);
        assert_eq!(
            pinned_sha256(
                r#"{ "sha256" : "2b6602075868ba4401f82f417d72424805d69b11ca86078023d0d489ff45dd84" }"#
            ),
            Some("2b6602075868ba4401f82f417d72424805d69b11ca86078023d0d489ff45dd84")
        );
        for refused in [
            r#"{}"#,
            r#"{"sha256": "2B66"}"#,
            r#"{"sha256": 7}"#,
            r#"{"sha256": "zz6602075868ba4401f82f417d72424805d69b11ca86078023d0d489ff45dd84"}"#,
        ] {
            assert_eq!(pinned_sha256(refused), None, "{refused}");
        }
    }
}
