package com.ocularmigraine.mcp;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

/**
 * Brings the launch watcher back after a reboot, without anyone opening the app.
 *
 * This is the half that makes auto-apply worth having: the first game of the day is usually the
 * first thing after a boot, and a watcher that only starts when you remember to open this app
 * would miss exactly that launch.
 *
 * It starts only if the watcher was running when the headset went down — the flag on disk is the
 * user's last answer, so a boot never turns on something that was deliberately switched off.
 * BOOT_COMPLETED is exempt from the background foreground-service restriction, so the start is
 * allowed here even though an ordinary background start would not be.
 */
public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "TomBoot";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;

        SharedPreferences prefs = context.getSharedPreferences(
            LaunchWatcherService.PREFS, Context.MODE_PRIVATE);
        if (!prefs.getBoolean(LaunchWatcherService.KEY_RUNNING, false)) return;

        Log.i(TAG, "boot completed, restarting the launch watcher");
        context.startForegroundService(new Intent(context, LaunchWatcherService.class));
    }
}
