package com.ocularmigraine.mcp;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Opens the chosen app once the headset has finished starting.
 *
 * The wait is the whole trick: BOOT_COMPLETED arrives before the VR shell has taken over, and an
 * activity started before then is placed behind it and never seen. goAsync() is what buys the time
 * — a receiver that simply slept would be killed on return from onReceive().
 */
public class BootLaunchReceiver extends BroadcastReceiver {

    private static final String TAG = "TomStartup";
    private static final String QUICKBOOT = "android.intent.action.QUICKBOOT_POWERON";
    /** Long enough for the shell to be up, short enough to stay inside the broadcast's budget. */
    private static final long SETTLE_MS = 8000;

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !QUICKBOOT.equals(action)) return;

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
