//! Catalog signing and verification (Phase 9, ADR-004 + ADR-018).
//!
//! A signed catalog carries an Ed25519 signature over its canonical JSON
//! bytes. The public key is embedded in the binary; a catalog whose signature
//! does not verify is rejected before any install is attempted, so a tampered
//! or provider-substituted catalog can never serve unchecked artifacts.
//!
//! Signing happens out-of-band (release tooling holds the private key); this
//! module only verifies. `sign` exists for tests and the signing tool.

use crate::Error;

/// Verify an Ed25519 signature over `payload` using the embedded public key.
/// The signature is hex-encoded (128 chars); a malformed signature, an
/// unknown key, or a payload mismatch all fail closed.
pub fn verify_catalog_signature(
    payload: &[u8],
    public_key_hex: &str,
    signature_hex: &str,
) -> Result<(), Error> {
    let key_bytes = decode_hex(public_key_hex)
        .map_err(|_| Error::Signature("malformed public key".to_owned()))?;
    let key_bytes: [u8; 32] = key_bytes
        .try_into()
        .map_err(|_| Error::Signature("public key must be 32 bytes".to_owned()))?;
    let public_key = ed25519_dalek::VerifyingKey::from_bytes(&key_bytes)
        .map_err(|_| Error::Signature("invalid public key".to_owned()))?;
    let signature_bytes = decode_hex(signature_hex)
        .map_err(|_| Error::Signature("malformed signature".to_owned()))?;
    let signature = ed25519_dalek::Signature::from_slice(&signature_bytes)
        .map_err(|_| Error::Signature("invalid signature length".to_owned()))?;
    public_key
        .verify_strict(payload, &signature)
        .map_err(|_| Error::Signature("catalog signature verification failed".to_owned()))
}

/// Sign `payload` with a private key (hex). Used by tests and the signing
/// tool; production builds only embed a public key.
pub fn sign_payload(payload: &[u8], private_key_hex: &str) -> Result<String, Error> {
    use ed25519_dalek::Signer;
    let key_bytes = decode_hex(private_key_hex)
        .map_err(|_| Error::Signature("malformed private key".to_owned()))?;
    let key_bytes: [u8; 32] = key_bytes
        .try_into()
        .map_err(|_| Error::Signature("private key must be 32 bytes".to_owned()))?;
    let private_key = ed25519_dalek::SigningKey::from_bytes(&key_bytes);
    let signature = private_key.sign(payload);
    Ok(encode_hex(signature.to_bytes()))
}

/// Derive the hex public key from a hex private key (test/tooling helper).
pub fn public_key_for(private_key_hex: &str) -> Result<String, Error> {
    let key_bytes = decode_hex(private_key_hex)
        .map_err(|_| Error::Signature("malformed private key".to_owned()))?;
    let key_bytes: [u8; 32] = key_bytes
        .try_into()
        .map_err(|_| Error::Signature("private key must be 32 bytes".to_owned()))?;
    let private_key = ed25519_dalek::SigningKey::from_bytes(&key_bytes);
    Ok(encode_hex(private_key.verifying_key().to_bytes()))
}

fn decode_hex(hex: &str) -> Result<Vec<u8>, ()> {
    let mut bytes = Vec::with_capacity(hex.len() / 2);
    let trimmed = hex.trim();
    for chunk in trimmed.as_bytes().chunks(2) {
        if chunk.len() != 2 {
            return Err(());
        }
        let hi = hex_val(chunk[0]).ok_or(())?;
        let lo = hex_val(chunk[1]).ok_or(())?;
        bytes.push((hi << 4) | lo);
    }
    Ok(bytes)
}

fn hex_val(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn encode_hex(bytes: impl AsRef<[u8]>) -> String {
    use std::fmt::Write;
    let mut out = String::with_capacity(bytes.as_ref().len() * 2);
    for byte in bytes.as_ref() {
        write!(out, "{byte:02x}").expect("hex write to string cannot fail");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRIVATE_KEY: &str = concat!(
        "5d", "3a", "9f", "d7", "b2", "8c", "e4", "11", "6f", "00", "93", "5b", "d8", "2e", "7a",
        "41", "c0", "33", "8d", "f5", "6a", "1b", "94", "7e", "d9", "25", "4f", "0e", "66", "8a",
        "77", "21"
    );

    #[test]
    fn signs_and_verifies_roundtrip() {
        let payload = br#"{"schema_version":1,"models":[]}"#;
        let signature = sign_payload(payload, PRIVATE_KEY).unwrap();
        let public_key = public_key_for(PRIVATE_KEY).unwrap();
        verify_catalog_signature(payload, &public_key, &signature).unwrap();
    }

    #[test]
    fn rejects_tampered_payload() {
        let payload = br#"{"schema_version":1,"models":[]}"#;
        let signature = sign_payload(payload, PRIVATE_KEY).unwrap();
        let public_key = public_key_for(PRIVATE_KEY).unwrap();
        let tampered = b"{\"schema_version\":2,\"models\":[]}";
        let error = verify_catalog_signature(tampered, &public_key, &signature).unwrap_err();
        assert!(matches!(error, Error::Signature(_)));
    }

    #[test]
    fn rejects_wrong_key() {
        let payload = b"payload";
        let signature = sign_payload(payload, PRIVATE_KEY).unwrap();
        // A different key (all-zero private key) must not verify.
        let other = "00".repeat(32);
        let wrong_public = public_key_for(&other).unwrap();
        let error = verify_catalog_signature(payload, &wrong_public, &signature).unwrap_err();
        assert!(matches!(error, Error::Signature(_)));
    }

    #[test]
    fn rejects_malformed_hex() {
        let public_key = public_key_for(PRIVATE_KEY).unwrap();
        assert!(matches!(
            verify_catalog_signature(b"x", &public_key, "zzz"),
            Err(Error::Signature(_))
        ));
        assert!(matches!(
            verify_catalog_signature(b"x", "not-hex", &"00".repeat(64)),
            Err(Error::Signature(_))
        ));
    }

    #[test]
    fn public_key_is_64_hex_chars() {
        let public_key = public_key_for(PRIVATE_KEY).unwrap();
        assert_eq!(public_key.len(), 64);
    }
}
