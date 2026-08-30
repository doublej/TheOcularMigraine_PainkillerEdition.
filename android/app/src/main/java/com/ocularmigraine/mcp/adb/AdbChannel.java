package com.ocularmigraine.mcp.adb;

import android.content.Context;
import android.provider.Settings;
import android.util.Log;

import java.io.File;
import java.io.IOException;
import java.net.ConnectException;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * Owns the one privileged connection, on its own thread.
 *
 * Its own executor and not Capacitor's: Capacitor runs plugin methods off the UI thread, but on a
 * single shared HandlerThread, so a 60-second wait for the headset's authorisation dialog would
 * freeze every other plugin call in the app for that whole minute.
 */
public final class AdbChannel {

    /**
     * Every state is detected, never guessed. In particular adbd sends no signal when a user
     * declines the prompt, so REJECTED_OR_IGNORED can only ever mean "declined, or never appeared".
     */
    public enum State {
        DEV_MODE_OFF,
        NO_PORT,
        PORT_OPEN_UNAUTHORIZED,
        AWAITING_USER,
        REJECTED_OR_IGNORED,
        CONNECTED,
        DROPPED,
        UNSUPPORTED,
    }

    private static final String TAG = "TomAdb";

    /** adbd binds this on `adb tcpip 5555`. It does not survive a reboot. */
    public static final int PORT = 5555;
    private static final String HOST = "127.0.0.1";
    /** Past this, a prompt that has not been answered was never going to be. */
    private static final long AWAIT_LIMIT_MS = 60_000;

    public interface StateListener {
        void onState(State state, String detail);
    }

    private static AdbChannel instance;

    private final Context context;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "adb-channel");
        thread.setDaemon(true);
        return thread;
    });

    private AdbClient client;
    private State state = State.NO_PORT;
    private String detail = "";
    private long awaitingSince = 0;
    private StateListener listener;

    private AdbChannel(Context context) {
        this.context = context.getApplicationContext();
    }

    public static synchronized AdbChannel get(Context context) {
        if (instance == null) instance = new AdbChannel(context);
        return instance;
    }

    public void setListener(StateListener listener) {
        this.listener = listener;
    }

    public synchronized State state() {
        // A connection that has died since we last looked is the dangerous state, so it is checked
        // on every read rather than only when a command happens to fail.
        if (state == State.CONNECTED && (client == null || !client.isAlive())) {
            client = null;
            publish(State.DROPPED, "The connection to the headset closed");
        }
        if (state == State.AWAITING_USER && System.currentTimeMillis() - awaitingSince > AWAIT_LIMIT_MS) {
            publish(State.REJECTED_OR_IGNORED, "No answer to the headset prompt");
        }
        return state;
    }

    public synchronized String detail() {
        return detail;
    }

    public synchronized boolean isConnected() {
        return state() == State.CONNECTED && client != null;
    }

    /** Runs on the channel thread so a slow or hung command cannot block the rest of the app. */
    public Future<AdbClient.ShellResult> shell(String command) {
        return submit(() -> {
            AdbClient live = requireClient();
            try {
                return live.shell(command);
            } catch (IOException e) {
                synchronized (this) {
                    closeClient();
                    publish(State.DROPPED, e.getMessage() == null ? "The connection dropped" : e.getMessage());
                }
                throw e;
            }
        });
    }

    /**
     * Reconnects without asking anyone anything. Once the headset has stored this app's key the
     * signature alone is enough, so after the first unlock every later launch just works until the
     * headset restarts and closes the port. A key that is not trusted yet stops here rather than
     * springing an unexpected "Allow debugging?" prompt on someone who only opened the app.
     */
    public Future<State> reconnectSilently() {
        return connect(false);
    }

    /** The Unlock button: may offer the public key, which is what makes the headset prompt appear. */
    public Future<State> elevate() {
        return connect(true);
    }

    /**
     * Reports where it got to rather than a bare boolean, because "no port", "prompt showing" and
     * "declined, or never appeared" each need their own sentence from the UI.
     */
    private Future<State> connect(boolean offerKey) {
        return submit(() -> {
            synchronized (this) {
                if (isConnected()) return state;
            }

            if (!developerModeOn()) {
                return publishSync(State.DEV_MODE_OFF, "USB debugging is switched off on the headset");
            }

            try {
                AdbKey key = AdbKey.loadOrCreate(new File(context.getFilesDir(), "adb"));
                AdbClient connected = AdbClient.connect(HOST, PORT, key, offerKey);
                synchronized (this) {
                    closeClient();
                    client = connected;
                    return publishSync(State.CONNECTED, "");
                }
            } catch (AdbClient.AwaitingApprovalException e) {
                synchronized (this) {
                    if (state != State.AWAITING_USER) awaitingSince = System.currentTimeMillis();
                    return publishSync(State.AWAITING_USER, "Approve the prompt in the headset");
                }
            } catch (AdbClient.NotAuthorisedException e) {
                return publishSync(State.PORT_OPEN_UNAUTHORIZED, "This app is not authorised on the headset yet");
            } catch (ConnectException e) {
                return publishSync(State.NO_PORT, "Nothing is listening on port " + PORT);
            } catch (IOException e) {
                return publishSync(State.PORT_OPEN_UNAUTHORIZED,
                    e.getMessage() == null ? "The headset refused the connection" : e.getMessage());
            } catch (Exception e) {
                return publishSync(State.UNSUPPORTED,
                    e.getMessage() == null ? "This headset cannot be unlocked this way" : e.getMessage());
            }
        });
    }

    public Future<State> disconnect() {
        return submit(() -> {
            synchronized (this) {
                closeClient();
                return publishSync(State.NO_PORT, "");
            }
        });
    }

    /**
     * `adb_enabled` is readable by any app, so "developer mode is off" is a fact we can state
     * rather than infer from a refused connection.
     */
    private boolean developerModeOn() {
        try {
            return Settings.Global.getInt(context.getContentResolver(), Settings.Global.ADB_ENABLED, 0) == 1;
        } catch (Exception e) {
            // Unreadable is not the same as off, so do not claim it is.
            return true;
        }
    }

    private synchronized AdbClient requireClient() throws IOException {
        if (client == null || !client.isAlive()) throw new IOException("Not connected to the headset");
        return client;
    }

    private synchronized void closeClient() {
        if (client != null) {
            client.close();
            client = null;
        }
    }

    private synchronized State publishSync(State next, String message) {
        publish(next, message);
        return next;
    }

    private synchronized void publish(State next, String message) {
        boolean changed = state != next || !detail.equals(message);
        state = next;
        detail = message == null ? "" : message;
        if (changed) Log.i(TAG, "state=" + state + " detail=" + detail);
        if (changed && listener != null) listener.onState(state, detail);
    }

    private <T> Future<T> submit(Callable<T> work) {
        return worker.submit(work);
    }
}
