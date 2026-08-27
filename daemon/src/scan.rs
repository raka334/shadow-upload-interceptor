pub const PRIVATE_KEY_NEEDLE: &[u8] = b"BEGIN RSA PRIVATE KEY";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Allow,
    Block,
}

/// Scans borrowed bytes directly: the complete file is never converted to a String.
pub fn scan(bytes: &[u8]) -> Decision {
    if bytes
        .windows(PRIVATE_KEY_NEEDLE.len())
        .any(|window| window == PRIVATE_KEY_NEEDLE)
    {
        Decision::Block
    } else {
        Decision::Allow
    }
}

#[cfg(test)]
mod tests {
    use super::{Decision, scan};

    #[test]
    fn blocks_the_fake_pem_fixture() {
        let fixture = include_bytes!("../../testdata/block.pem");
        assert_eq!(scan(fixture), Decision::Block);
    }

    #[test]
    fn allows_the_harmless_fixture() {
        let fixture = include_bytes!("../../testdata/allow.txt");
        assert_eq!(scan(fixture), Decision::Allow);
    }

    #[test]
    fn allows_empty_input() {
        assert_eq!(scan(&[]), Decision::Allow);
    }

    #[test]
    fn allows_binary_noise_without_the_marker() {
        let fixture = [0, 159, 146, 150, 255, 12, 0, 44, 8];
        assert_eq!(scan(&fixture), Decision::Allow);
    }
}
