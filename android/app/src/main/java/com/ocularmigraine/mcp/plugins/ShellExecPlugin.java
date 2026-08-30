package com.ocularmigraine.mcp.plugins;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.ocularmigraine.mcp.adb.AdbChannel;
import com.ocularmigraine.mcp.adb.AdbClient;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "ShellExec")
public class ShellExecPlugin extends Plugin {

    /** A shell command that has not answered in this long is hung, not slow. */
    private static final long TIMEOUT_SECONDS = 30;

    private AdbChannel channel;

    @Override
    public void load() {
        channel = AdbChannel.get(getContext());
        channel.setListener((state, detail) -> {
            JSObject event = new JSObject();
            event.put("state", state.name());
            event.put("detail", detail);
            notifyListeners("elevationChange", event);
        });
        // If the port is still open from an earlier session, the stored key gets us back in with
        // no prompt and no tap. An unauthorised key stops short rather than springing a dialog on
        // someone who only opened the app.
        channel.reconnectSilently();
    }

    /**
     * Runs a command with whatever privilege is available, and says which it used.
     *
     * The three-field contract is unchanged; `via` is additive so a caller never has to infer
     * whether a command ran as the app or through the privileged channel.
     */
    @PluginMethod
    public void exec(PluginCall call) {
        String command = call.getString("command", "");
        if (command == null || command.isEmpty()) {
            call.reject("Command is required");
            return;
        }

        if (channel != null && channel.isConnected()) {
            execOverAdb(call, command);
            return;
        }
        localShell(call, command);
    }

    private void execOverAdb(PluginCall call, String command) {
        try {
            AdbClient.ShellResult result = channel.shell(command).get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
            JSObject payload = new JSObject();
            // Legacy `shell:` merges stderr into stdout, so everything lands in output and the
            // status comes from the sentinel rather than being invented here.
            payload.put("output", result.output);
            payload.put("error", "");
            payload.put("exitCode", result.exitCode);
            payload.put("via", "adb");
            call.resolve(payload);
        } catch (Exception e) {
            // Falling back silently would hide a dropped connection behind commands that quietly
            // stop working, so this reports instead.
            call.reject("Privileged shell failed: " + rootMessage(e));
        }
    }

    private void localShell(PluginCall call, String command) {
        Process process = null;
        try {
            process = Runtime.getRuntime().exec(
                new String[]{"/system/bin/sh", "-c", command}
            );

            // Both pipes are drained at once. Reading stdout to EOF first deadlocks the moment a
            // command fills the ~64KB stderr buffer while still producing stdout, which anything
            // dumpsys-shaped will do.
            StringBuilder error = new StringBuilder();
            Thread stderrPump = pump(process.getErrorStream(), error);
            StringBuilder output = new StringBuilder();
            drain(process.getInputStream(), output);
            stderrPump.join(TimeUnit.SECONDS.toMillis(TIMEOUT_SECONDS));

            if (!process.waitFor(TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                call.reject("Command did not finish within " + TIMEOUT_SECONDS + "s: " + command);
                return;
            }

            JSObject result = new JSObject();
            result.put("output", output.toString().trim());
            result.put("error", error.toString().trim());
            result.put("exitCode", process.exitValue());
            result.put("via", "app");
            call.resolve(result);
        } catch (Exception e) {
            if (process != null) process.destroyForcibly();
            call.reject("Shell exec failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void elevationState(PluginCall call) {
        JSObject result = new JSObject();
        result.put("state", channel.state().name());
        result.put("detail", channel.detail());
        result.put("port", AdbChannel.PORT);
        call.resolve(result);
    }

    @PluginMethod
    public void elevate(PluginCall call) {
        try {
            AdbChannel.State state = channel.elevate().get(90, TimeUnit.SECONDS);
            JSObject result = new JSObject();
            result.put("state", state.name());
            result.put("detail", channel.detail());
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Could not unlock: " + rootMessage(e));
        }
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        try {
            channel.disconnect().get(10, TimeUnit.SECONDS);
            JSObject result = new JSObject();
            result.put("state", channel.state().name());
            result.put("detail", channel.detail());
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Could not disconnect: " + rootMessage(e));
        }
    }

    /** Future.get wraps everything once; the wrapper's message is never the useful one. */
    private String rootMessage(Exception e) {
        Throwable cause = e.getCause() == null ? e : e.getCause();
        return cause.getMessage() == null ? cause.getClass().getSimpleName() : cause.getMessage();
    }

    private Thread pump(InputStream stream, StringBuilder sink) {
        Thread thread = new Thread(() -> drain(stream, sink));
        thread.setDaemon(true);
        thread.start();
        return thread;
    }

    private void drain(InputStream stream, StringBuilder sink) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream))) {
            String line;
            while ((line = reader.readLine()) != null) {
                synchronized (sink) {
                    sink.append(line).append("\n");
                }
            }
        } catch (Exception ignored) {
            // A closed pipe means the process is gone; the exit code is the honest signal.
        }
    }
}
