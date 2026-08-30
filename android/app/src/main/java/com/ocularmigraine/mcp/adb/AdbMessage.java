package com.ocularmigraine.mcp.adb;

import java.io.DataInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/** One packet on adb's wire protocol: a 24-byte little-endian header plus an optional payload. */
final class AdbMessage {

    static final int A_CNXN = 0x4e584e43;
    static final int A_AUTH = 0x48545541;
    static final int A_OPEN = 0x4e45504f;
    static final int A_OKAY = 0x59414b4f;
    static final int A_CLSE = 0x45534c43;
    static final int A_WRTE = 0x45545257;

    static final int AUTH_TOKEN = 1;
    static final int AUTH_SIGNATURE = 2;
    static final int AUTH_RSAPUBLICKEY = 3;

    private static final int HEADER_BYTES = 24;
    /** The version adbd expects from a client that speaks the pre-TLS protocol. */
    static final int VERSION = 0x01000000;
    static final int MAX_PAYLOAD = 256 * 1024;

    final int command;
    final int arg0;
    final int arg1;
    final byte[] payload;

    AdbMessage(int command, int arg0, int arg1, byte[] payload) {
        this.command = command;
        this.arg0 = arg0;
        this.arg1 = arg1;
        this.payload = payload == null ? new byte[0] : payload;
    }

    void writeTo(OutputStream out) throws IOException {
        ByteBuffer header = ByteBuffer.allocate(HEADER_BYTES).order(ByteOrder.LITTLE_ENDIAN);
        header.putInt(command);
        header.putInt(arg0);
        header.putInt(arg1);
        header.putInt(payload.length);
        header.putInt(checksum(payload));
        // The magic is the command's own complement; adbd rejects the packet otherwise.
        header.putInt(command ^ 0xFFFFFFFF);
        out.write(header.array());
        if (payload.length > 0) out.write(payload);
        out.flush();
    }

    static AdbMessage readFrom(DataInputStream in) throws IOException {
        byte[] raw = new byte[HEADER_BYTES];
        in.readFully(raw);
        ByteBuffer header = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN);
        int command = header.getInt();
        int arg0 = header.getInt();
        int arg1 = header.getInt();
        int length = header.getInt();
        header.getInt(); // checksum — adbd stopped populating it, so it is read and ignored
        int magic = header.getInt();

        if ((command ^ 0xFFFFFFFF) != magic) throw new IOException("Bad adb packet header");
        if (length < 0 || length > MAX_PAYLOAD) throw new IOException("Bad adb payload length: " + length);

        byte[] payload = new byte[length];
        if (length > 0) in.readFully(payload);
        return new AdbMessage(command, arg0, arg1, payload);
    }

    /** A NUL-terminated string, which is how adb frames every service name and banner. */
    static byte[] cstring(String value) {
        byte[] bytes = value.getBytes();
        byte[] out = new byte[bytes.length + 1];
        System.arraycopy(bytes, 0, out, 0, bytes.length);
        return out;
    }

    private static int checksum(byte[] payload) {
        int sum = 0;
        for (byte b : payload) sum += (b & 0xFF);
        return sum;
    }
}
