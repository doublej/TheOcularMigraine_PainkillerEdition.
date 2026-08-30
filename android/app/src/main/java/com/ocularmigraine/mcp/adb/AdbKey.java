package com.ocularmigraine.mcp.adb;

import android.util.Base64;

import java.io.File;
import java.io.FileOutputStream;
import java.math.BigInteger;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;

import javax.crypto.Cipher;

/**
 * The RSA identity adbd authorises, in adb's own wire format.
 *
 * Deliberately not in the Android Keystore: the legacy AUTH step needs a raw PKCS#1 v1.5 operation
 * over an already-hashed 20-byte token, which Keystore may refuse outright, and the security gain
 * is close to zero for a key whose only power is a shell on this one headset that the user
 * explicitly approved.
 *
 * The public-key encoding below is the one place a silent bug hides: get it wrong and the headset
 * simply never shows its prompt, which looks identical to "the headset is not listening". The only
 * check that settles it is adbd accepting the key — a structural self-test would only re-assert
 * this file's own conventions, which is exactly what would be wrong. So: authorise once on a real
 * headset, and `adb shell cat /data/misc/adb/adb_keys` should end with a line named
 * ocular-migraine@headset.
 */
public final class AdbKey {

    private static final int KEY_BITS = 2048;
    private static final int WORDS = KEY_BITS / 32;
    /** modulus_size_words + n0inv + modulus + rr + exponent */
    private static final int PUBKEY_BYTES = 4 + 4 + (WORDS * 4) + (WORDS * 4) + 4;
    private static final BigInteger WORD_MASK = BigInteger.valueOf(0xFFFFFFFFL);
    private static final BigInteger TWO_32 = BigInteger.ONE.shiftLeft(32);

    private final KeyPair pair;

    private AdbKey(KeyPair pair) {
        this.pair = pair;
    }

    /** Loads the stored identity, generating one on first use. Losing it costs one re-authorisation. */
    public static AdbKey loadOrCreate(File dir) throws Exception {
        File priv = new File(dir, "adbkey.pk8");
        File pub = new File(dir, "adbkey.x509");
        if (priv.exists() && pub.exists()) {
            KeyFactory factory = KeyFactory.getInstance("RSA");
            return new AdbKey(new KeyPair(
                factory.generatePublic(new X509EncodedKeySpec(Files.readAllBytes(pub.toPath()))),
                factory.generatePrivate(new PKCS8EncodedKeySpec(Files.readAllBytes(priv.toPath())))
            ));
        }

        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(KEY_BITS);
        KeyPair generated = generator.generateKeyPair();
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Cannot create " + dir);
        write(priv, generated.getPrivate().getEncoded());
        write(pub, generated.getPublic().getEncoded());
        return new AdbKey(generated);
    }

    /**
     * The ASN.1 DigestInfo header for SHA-1, which adb's signature is expected to carry.
     *
     * adb signs with OpenSSL's RSA_sign(NID_sha1, ...). That does not hash the token — it is already
     * a 20-byte digest — but it does wrap it in this DigestInfo structure before padding. Signing
     * the bare token instead produces a well-formed signature that adbd silently rejects, which
     * looks from the outside exactly like an unauthorised key.
     */
    private static final byte[] SHA1_DIGEST_INFO = {
        0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e,
        0x03, 0x02, 0x1a, 0x05, 0x00, 0x04, 0x14,
    };

    /**
     * Signs adbd's challenge the way adb does: DigestInfo-wrapped, PKCS#1 v1.5 padded, no second
     * hash. Not Signature.getInstance("SHA1withRSA") — that would hash the already-hashed token.
     */
    public byte[] sign(byte[] token) throws Exception {
        byte[] wrapped = new byte[SHA1_DIGEST_INFO.length + token.length];
        System.arraycopy(SHA1_DIGEST_INFO, 0, wrapped, 0, SHA1_DIGEST_INFO.length);
        System.arraycopy(token, 0, wrapped, SHA1_DIGEST_INFO.length, token.length);

        Cipher cipher = Cipher.getInstance("RSA/ECB/PKCS1Padding");
        cipher.init(Cipher.ENCRYPT_MODE, (PrivateKey) pair.getPrivate());
        return cipher.doFinal(wrapped);
    }

    /**
     * The `<base64> <name>` line adbd stores in /data/misc/adb/adb_keys once the user approves.
     *
     * The trailing NUL is not optional. adbd reads this payload as a C string, so without it the
     * decoder runs past the buffer and reports the key as invalid base64 — which from the outside
     * looks exactly like a headset that will not answer. It is appended as an explicit byte rather
     * than an escape in the literal, so it stays visible to whoever reads this next.
     */
    public byte[] publicKeyPayload() {
        String encoded = Base64.encodeToString(encodePublicKey(), Base64.NO_WRAP);
        byte[] text = (encoded + " ocular-migraine@headset").getBytes(StandardCharsets.UTF_8);
        byte[] payload = new byte[text.length + 1];
        System.arraycopy(text, 0, payload, 0, text.length);
        return payload;
    }

    /**
     * adb's RSAPublicKey struct: little-endian throughout, modulus and rr as 64 32-bit words with
     * the least significant word first.
     */
    byte[] encodePublicKey() {
        RSAPublicKey key = (RSAPublicKey) pair.getPublic();
        BigInteger n = key.getModulus();

        ByteBuffer buffer = ByteBuffer.allocate(PUBKEY_BYTES).order(ByteOrder.LITTLE_ENDIAN);
        buffer.putInt(WORDS);
        // n0inv = -(n^-1) mod 2^32, over the low word only.
        buffer.putInt(TWO_32.subtract(n.modInverse(TWO_32)).intValue());
        putWords(buffer, n);
        // rr = (2^2048)^2 mod n, the Montgomery R^2 the verifier needs.
        putWords(buffer, BigInteger.ONE.shiftLeft(KEY_BITS * 2).mod(n));
        buffer.putInt(key.getPublicExponent().intValue());
        return buffer.array();
    }

    private static void putWords(ByteBuffer buffer, BigInteger value) {
        for (int i = 0; i < WORDS; i++) {
            buffer.putInt(value.shiftRight(i * 32).and(WORD_MASK).intValue());
        }
    }

    private static void write(File file, byte[] bytes) throws Exception {
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
    }
}
