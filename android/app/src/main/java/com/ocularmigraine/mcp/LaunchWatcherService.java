package com.ocularmigraine.mcp;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import com.ocularmigraine.mcp.adb.AdbChannel;
import com.ocularmigraine.mcp.adb.AdbClient;

import org.json.JSONObject;

import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Applies a game's saved profile at the moment that game comes to the foreground.
 *
 * Why a service at all: the render props bind when an app starts, so the write has to land in the
 * seconds around the launch — and the moment a game takes over, this app's own Activity is paused.
 * A foreground service is the only thing that keeps running to see it happen.
 *
 * Why UsageStats and not a broadcast: Android has no "app launched" broadcast for other packages.
 * UsageStatsManager is the supported route, and on a Quest 3 it does report ACTIVITY_RESUMED for
 * real VR titles, not only for 2D panel apps.
 *
 * Why the writes go back through AdbChannel: setprop on debug.oculus.* is refused to an app uid,
 * so applying a profile needs the same privileged channel the UI uses. It is a process-wide
 * singleton, so this service shares the connection the app already opened rather than making one.
 */
public class LaunchWatcherService extends Service {

    private static final String TAG = "TomWatcher";
    private static final String CHANNEL_ID = "tom_launch_watcher";
    private static final int NOTIFICATION_ID = 4711;

    /** Fast enough that the write lands with the launch, slow enough to cost nothing measurable. */
    private static final long POLL_MS = 1000;
    /** How far back the first poll looks, so a launch during startup is not missed. */
    private static final long LOOKBACK_MS = 10_000;
    private static final long SHELL_TIMEOUT_S = 15;

    /** Leaving a game lands here, and that is what re-arms a profile for the next launch. */
    private static final String HOME_PACKAGE = "com.oculus.vrshell";

    public static final String PREFS = "tom_auto_profile";
    /** packageName -> { name, props: { prop: value } }, mirrored from the WebView's localStorage. */
    public static final String KEY_PROFILES = "profiles";
    public static final String KEY_RUNNING = "running";
    public static final String KEY_LAST_EVENT = "lastEvent";

    private volatile boolean running = false;
    private Thread poller;
    /** The profile currently on the headset, so a game is set up once per launch, not once a second. */
    private String appliedTo = null;
    private long cursor = 0;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        startForeground(NOTIFICATION_ID, buildNotification());
        running = true;
        prefs().edit().putBoolean(KEY_RUNNING, true).apply();
        cursor = System.currentTimeMillis() - LOOKBACK_MS;
        poller = new Thread(this::loop, "launch-watcher");
        poller.setDaemon(true);
        poller.start();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Restarted by the system after a kill: the profiles are on disk, so it picks up where it was.
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (poller != null) poller.interrupt();
        prefs().edit().putBoolean(KEY_RUNNING, false).apply();
        super.onDestroy();
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private void loop() {
        UsageStatsManager usage = (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
        if (usage == null) {
            note("no usage stats service on this device");
            return;
        }
        while (running) {
            try {
                pollOnce(usage);
                Thread.sleep(POLL_MS);
            } catch (InterruptedException e) {
                return;
            } catch (Exception e) {
                // A poll that threw must not take the watcher down; the next one usually works.
                Log.w(TAG, "poll failed", e);
            }
        }
    }

    private void pollOnce(UsageStatsManager usage) throws Exception {
        long now = System.currentTimeMillis();
        UsageEvents events = usage.queryEvents(cursor, now);
        // +1 so the same event is never replayed as the next window's first hit.
        cursor = now + 1;
        if (events == null) return;

        UsageEvents.Event event = new UsageEvents.Event();
        while (events.hasNextEvent()) {
            events.getNextEvent(event);
            if (event.getEventType() != UsageEvents.Event.ACTIVITY_RESUMED) continue;
            String pkg = event.getPackageName();
            if (pkg == null) continue;

            if (HOME_PACKAGE.equals(pkg)) {
                // Back at Home, so the next launch of that game gets its profile written again.
                appliedTo = null;
                continue;
            }
            if (pkg.equals(appliedTo)) continue;

            JSONObject profile = profileFor(pkg);
            // Every shell panel and system overlay resumes constantly while a game runs. Anything
            // without a profile is not a launch worth reacting to, and must not clear the state.
            if (profile == null) continue;
            apply(pkg, profile);
        }
    }

    private JSONObject profileFor(String pkg) {
        try {
            String raw = prefs().getString(KEY_PROFILES, "{}");
            JSONObject all = new JSONObject(raw);
            return all.optJSONObject(pkg);
        } catch (Exception e) {
            Log.w(TAG, "unreadable profile store", e);
            return null;
        }
    }

    private void apply(String pkg, JSONObject profile) {
        String name = profile.optString("name", pkg);
        JSONObject props = profile.optJSONObject("props");
        if (props == null || props.length() == 0) {
            note("“" + name + "” holds no settings, so nothing was written");
            return;
        }

        AdbChannel channel = AdbChannel.get(this);
        if (!channel.isConnected()) {
            // Said plainly rather than retried: without the privileged channel setprop is refused,
            // and a silent failure here is exactly the kind of lie this app is built to avoid.
            note("“" + name + "” could not be applied — the headset is not unlocked");
            return;
        }

        StringBuilder command = new StringBuilder();
        Iterator<String> keys = props.keys();
        while (keys.hasNext()) {
            String prop = keys.next();
            String value = props.optString(prop, "");
            if (command.length() > 0) command.append("; ");
            command.append("setprop ").append(prop).append(" '").append(value).append("'");
        }

        try {
            AdbClient.ShellResult result = channel.shell(command.toString())
                .get(SHELL_TIMEOUT_S, TimeUnit.SECONDS);
            if (result.exitCode == 0) {
                appliedTo = pkg;
                note("Applied “" + name + "” to " + pkg);
            } else {
                note("“" + name + "” failed: " + result.output.trim());
            }
        } catch (Exception e) {
            note("“" + name + "” failed: " + e.getMessage());
        }
    }

    /** The one line the UI shows for "what did this actually do", timestamped so it cannot go stale unnoticed. */
    private void note(String message) {
        Log.i(TAG, message);
        try {
            JSONObject event = new JSONObject();
            event.put("at", System.currentTimeMillis());
            event.put("message", message);
            prefs().edit().putString(KEY_LAST_EVENT, event.toString()).apply();
        } catch (Exception ignored) {
            // A status line is not worth taking the watcher down for.
        }
    }

    private Notification buildNotification() {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager != null) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                getString(R.string.watcher_channel),
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }

        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(
            this, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new Notification.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.watcher_title))
            .setContentText(getString(R.string.watcher_text))
            .setSmallIcon(android.R.drawable.ic_menu_preferences)
            .setContentIntent(pending)
            .setOngoing(true)
            .build();
    }
}
