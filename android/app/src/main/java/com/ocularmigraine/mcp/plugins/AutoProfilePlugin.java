package com.ocularmigraine.mcp.plugins;

import android.app.AppOpsManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Process;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.ocularmigraine.mcp.LaunchWatcherService;
import com.ocularmigraine.mcp.adb.AdbChannel;
import com.ocularmigraine.mcp.adb.AdbClient;

import org.json.JSONObject;

import java.util.concurrent.TimeUnit;

/**
 * The bridge between the profiles in the WebView and the service that applies them on launch.
 *
 * The profiles live in localStorage, which no service can read, so the view mirrors them here as
 * an already-resolved package -> props map. Resolving in TypeScript keeps DISPLAY_PROPS the single
 * place that knows which prop carries which setting, and leaves the Java side dumb on purpose.
 */
@CapacitorPlugin(name = "AutoProfile")
public class AutoProfilePlugin extends Plugin {

    private static final String USAGE_OP = "android:get_usage_stats";
    private static final long SHELL_TIMEOUT_S = 15;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(LaunchWatcherService.PREFS, Context.MODE_PRIVATE);
    }

    /** Replaces the whole map, so a deleted or renamed profile cannot linger in the service's copy. */
    @PluginMethod
    public void sync(PluginCall call) {
        JSObject profiles = call.getObject("profiles", new JSObject());
        prefs().edit()
            .putString(LaunchWatcherService.KEY_PROFILES, profiles == null ? "{}" : profiles.toString())
            .apply();
        call.resolve();
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!hasUsageAccess()) {
            call.reject("Usage access has not been granted");
            return;
        }
        Intent intent = new Intent(getContext(), LaunchWatcherService.class);
        getContext().startForegroundService(intent);
        call.resolve(status());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), LaunchWatcherService.class));
        prefs().edit().putBoolean(LaunchWatcherService.KEY_RUNNING, false).apply();
        call.resolve(status());
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(status());
    }

    /**
     * Grants the app its own usage access through the privileged channel.
     *
     * Quest has no Settings screen for usage access, so the ordinary
     * ACTION_USAGE_ACCESS_SETTINGS intent resolves to nothing there. The channel is already how
     * this app writes render props, and one `appops` line is the same privilege in the same place.
     */
    @PluginMethod
    public void grantUsageAccess(PluginCall call) {
        AdbChannel channel = AdbChannel.get(getContext());
        if (!channel.isConnected()) {
            call.reject("The headset is not unlocked, so usage access cannot be granted");
            return;
        }
        try {
            String command = "appops set " + getContext().getPackageName() + " " + USAGE_OP + " allow";
            AdbClient.ShellResult result = channel.shell(command).get(SHELL_TIMEOUT_S, TimeUnit.SECONDS);
            if (result.exitCode != 0) {
                call.reject("appops refused: " + result.output.trim());
                return;
            }
            call.resolve(status());
        } catch (Exception e) {
            call.reject("Could not grant usage access: " + e.getMessage());
        }
    }

    private JSObject status() {
        JSObject result = new JSObject();
        result.put("usageAccess", hasUsageAccess());
        result.put("running", prefs().getBoolean(LaunchWatcherService.KEY_RUNNING, false));
        result.put("elevated", AdbChannel.get(getContext()).isConnected());
        String raw = prefs().getString(LaunchWatcherService.KEY_LAST_EVENT, "");
        if (!raw.isEmpty()) {
            try {
                JSONObject event = new JSONObject(raw);
                result.put("lastMessage", event.optString("message", ""));
                result.put("lastAt", event.optLong("at", 0));
            } catch (Exception ignored) {
                // An unreadable status line is not worth failing the whole call over.
            }
        }
        return result;
    }

    /** Asked of AppOpsManager rather than remembered, because it can be revoked from outside the app. */
    private boolean hasUsageAccess() {
        AppOpsManager ops = (AppOpsManager) getContext().getSystemService(Context.APP_OPS_SERVICE);
        if (ops == null) return false;
        int mode = ops.unsafeCheckOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS,
            Process.myUid(),
            getContext().getPackageName()
        );
        return mode == AppOpsManager.MODE_ALLOWED;
    }
}
