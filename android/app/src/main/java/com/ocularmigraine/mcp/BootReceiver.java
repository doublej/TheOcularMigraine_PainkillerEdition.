package com.ocularmigraine.mcp;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

/**
 * The app's one answer to a finished boot: restart the launch watcher, then open the startup app.
 *
 * Both used to be their own receiver on the same broadcast, which is two orderings, two logs and
 * two places to look when a reboot behaves oddly. They are one thing — what this app does when the
 * headset comes back — so they are one receiver. Their stores stay separate: the watcher's flag
 * lives in tom_auto_profile and the startup package in tom_startup, and neither knows the other.
 *
 * The watcher half is what makes auto-apply worth having: the first game of the day is usually the
 * first thing after a boot, and a watcher that only starts when you remember to open this app would
 * miss exactly that launch. It starts only if the watcher was running when the headset went down —
 * the flag on disk is the user's last answer, so a boot never turns on something deliberately
 * switched off. BOOT_COMPLETED is exempt from the background foreground-service restriction, so the
 * start is allowed here even though an ordinary background start would not be.
 *
 * The launch half waits, and the wait is the whole trick: BOOT_COMPLETED arrives before the VR
 * shell has taken over, and an activity started before then is placed behind it and never seen.
 * goAsync() is what buys the time — a receiver that simply slept would be killed on return.
 */
public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "TomBoot";
    private static final String QUICKBOOT = "android.intent.action.QUICKBOOT_POWERON";
    /** Long enough for the shell to be up, short enough to stay inside the broadcast's budget. */
    private static final long SETTLE_MS = 8000;

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !QUICKBOOT.equals(action)) return;

        restartWatcher(context);
        launchStartupApp(context);
    }

    private void restartWatcher(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(
            LaunchWatcherService.PREFS, Context.MODE_PRIVATE);
        if (!prefs.getBoolean(LaunchWatcherService.KEY_RUNNING, false)) return;

        Log.i(TAG, "boot completed, restarting the launch watcher");
        context.startForegroundService(new Intent(context, LaunchWatcherService.class));
    }

    private void launchStartupApp(Context context) {
        String pkg = StartupLauncher.get(context);
        if (pkg.isEmpty()) return;

        PendingResult result = goAsync();
        Context app = context.getApplicationContext();
        new Thread(() -> {
            try {
                Thread.sleep(SETTLE_MS);
                if (!StartupLauncher.launch(app, pkg)) Log.w(TAG, "no launchable activity in " + pkg);
            } catch (Exception e) {
                // Nothing to report to: the app is not running. The user's own launch still works.
                Log.w(TAG, "startup launch failed", e);
            } finally {
                result.finish();
            }
        }, "startup-launch").start();
    }
}
