package com.ocularmigraine.mcp.adb;

import android.util.Log;

import java.io.DataInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * A minimal adb client, speaking the pre-TLS protocol to adbd on this same headset.
 *
 * Legacy transport only, on purpose. The Android 11+ wireless-debugging stack would be the nicer
 * route — it survives a reboot — but this build pins `adb_wifi_enabled` to 0 and refuses
 * `persist.adb.tls_server.enable` to the shell user, so no TLS server can ever be started here.
 * That removes the need for a self-signed X.509 generator, TLS 1.3 mutual auth, the A_STLS
 * transition and mDNS, which is most of what a full client would be.
 */
public final class AdbClient implements AutoCloseable {

    private static final String TAG = "TomAdb";

    /** Marks the end of a command's output and carries its status, since legacy `shell:` has no exit code. */
    private static final String RC_SENTINEL = "__TOM_RC=";

    private static final int CONNECT_TIMEOUT_MS = 3000;
    /** Long enough to cover the user walking to the headset and reading the prompt. */
    private static final int AUTH_TIMEOUT_MS = 60_000;
    private static final int IO_TIMEOUT_MS = 30_000;

    public static final class ShellResult {
        public final String output;
        public final int exitCode;

        ShellResult(String output, int exitCode) {
            this.output = output;
            this.exitCode = exitCode;
        }
    }

    private final Socket socket;
    private final DataInputStream in;
    private final OutputStream out;
    private final AtomicInteger nextLocalId = new AtomicInteger(1);

    private AdbClient(Socket socket) throws IOException {
        this.socket = socket;
        this.in = new DataInputStream(socket.getInputStream());
        this.out = socket.getOutputStream();
    }

    /**
     * Opens and authorises a connection.
     *
     * `offerKey` is the difference between the two ways in. Once the headset has stored this app's
     * key, the signature alone succeeds and nobody is asked anything — so startup reconnects
     * silently with offerKey false, and a refused signature is reported rather than turned into an
     * unexpected prompt. The Unlock button passes true, because a prompt is exactly what the user
     * just asked for.
     */
    public static AdbClient connect(String host, int port, AdbKey key, boolean offerKey) throws Exception {
        Socket socket = new Socket();
        socket.connect(new InetSocketAddress(host, port), CONNECT_TIMEOUT_MS);
        socket.setTcpNoDelay(true);
        socket.setSoTimeout(offerKey ? AUTH_TIMEOUT_MS : IO_TIMEOUT_MS);

        AdbClient client = new AdbClient(socket);
        try {
            client.handshake(key, offerKey);
        } catch (Exception e) {
            client.closeQuietly();
            throw e;
        }
        socket.setSoTimeout(IO_TIMEOUT_MS);
        return client;
    }

    /** The headset is showing "Allow debugging?" and nothing more can happen until someone answers. */
    public static final class AwaitingApprovalException extends IOException {
        public AwaitingApprovalException(String message) {
            super(message);
        }
    }

    /** The port is open but this app's key is not trusted yet, and we chose not to ask. */
    public static final class NotAuthorisedException extends IOException {
        public NotAuthorisedException(String message) {
            super(message);
        }
    }

    private void handshake(AdbKey key, boolean offerKey) throws Exception {
        Log.i(TAG, "handshake start, offerKey=" + offerKey);
        // A featureless banner: everything below uses legacy `shell:`, so there is nothing to negotiate.
        new AdbMessage(AdbMessage.A_CNXN, AdbMessage.VERSION, AdbMessage.MAX_PAYLOAD,
            AdbMessage.cstring("host::")).writeTo(out);

        boolean offeredKey = false;
        while (true) {
            AdbMessage message;
            try {
                message = AdbMessage.readFrom(in);
            } catch (IOException e) {
                // A read that times out after the key was offered means nobody answered the prompt.
                if (offeredKey) throw new AwaitingApprovalException("Waiting for the headset prompt");
                throw e;
            }

            Log.i(TAG, "recv cmd=" + Integer.toHexString(message.command)
                + " arg0=" + message.arg0 + " len=" + message.payload.length);
            if (message.command == AdbMessage.A_CNXN) return;

            if (message.command != AdbMessage.A_AUTH || message.arg0 != AdbMessage.AUTH_TOKEN) {
                throw new IOException("Unexpected adb packet during handshake");
            }

            if (!offeredKey) {
                // First try the signature: if this key is already in adb_keys the user sees nothing.
                new AdbMessage(AdbMessage.A_AUTH, AdbMessage.AUTH_SIGNATURE, 0, key.sign(message.payload))
                    .writeTo(out);
                // A second token means the signature was refused, so fall through to offering the key.
                AdbMessage next = AdbMessage.readFrom(in);
                Log.i(TAG, "after signature: cmd=" + Integer.toHexString(next.command) + " arg0=" + next.arg0);
                if (next.command == AdbMessage.A_CNXN) return;
                if (next.command != AdbMessage.A_AUTH) throw new IOException("Unexpected adb packet after signing");
                if (!offerKey) throw new NotAuthorisedException("This app's key is not authorised yet");
                offeredKey = true;
                new AdbMessage(AdbMessage.A_AUTH, AdbMessage.AUTH_RSAPUBLICKEY, 0, key.publicKeyPayload())
                    .writeTo(out);
                continue;
            }

            throw new AwaitingApprovalException("Waiting for the headset prompt");
        }
    }

    /**
     * Runs one command and waits for its stream to close.
     *
     * Legacy `shell:` merges stderr into stdout and reports no status, so the status is appended by
     * the command itself and stripped back off here. That is deliberately simpler than negotiating
     * shell,v2 — the banner above advertises nothing, so adbd would be within its rights to refuse it.
     */
    public synchronized ShellResult shell(String command) throws IOException {
        int localId = nextLocalId.getAndIncrement();
        new AdbMessage(AdbMessage.A_OPEN, localId, 0,
            AdbMessage.cstring("shell:" + command + "; echo " + RC_SENTINEL + "$?")).writeTo(out);

        StringBuilder collected = new StringBuilder();
        int remoteId = 0;

        while (true) {
            AdbMessage message = AdbMessage.readFrom(in);
            // Strictly this stream's traffic, CLSE included. The connection is reused for every
            // command, so a CLSE still in flight from the previous one would otherwise end this
            // one the moment it opened — which returned an empty string and no exit status.
            if (message.arg1 != localId) continue;

            if (message.command == AdbMessage.A_OKAY) {
                remoteId = message.arg0;
                continue;
            }
            if (message.command == AdbMessage.A_WRTE) {
                remoteId = message.arg0;
                collected.append(new String(message.payload, StandardCharsets.UTF_8));
                // Every WRTE must be acknowledged or adbd stops sending.
                new AdbMessage(AdbMessage.A_OKAY, localId, remoteId, null).writeTo(out);
                continue;
            }
            if (message.command == AdbMessage.A_CLSE) {
                new AdbMessage(AdbMessage.A_CLSE, localId, remoteId, null).writeTo(out);
                break;
            }
        }

        return split(collected.toString());
    }

    /** Peels the sentinel off the tail. A missing sentinel means the shell died before echoing it. */
    private static ShellResult split(String raw) {
        int marker = raw.lastIndexOf(RC_SENTINEL);
        if (marker < 0) return new ShellResult(raw.trim(), -1);

        String tail = raw.substring(marker + RC_SENTINEL.length()).trim();
        int exitCode;
        try {
            exitCode = Integer.parseInt(tail);
        } catch (NumberFormatException e) {
            exitCode = -1;
        }
        return new ShellResult(raw.substring(0, marker).trim(), exitCode);
    }

    public boolean isAlive() {
        return socket.isConnected() && !socket.isClosed();
    }

    @Override
    public void close() {
        closeQuietly();
    }

    private void closeQuietly() {
        try {
            socket.close();
        } catch (IOException ignored) {
            // Already gone is the outcome we wanted.
        }
    }
}
