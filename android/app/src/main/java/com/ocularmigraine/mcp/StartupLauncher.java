package com.ocularmigraine.mcp;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;

import java.util.List;

/**
 * The app the headset opens after a restart, and the one way to launch anything by package id.
 *
 * Deliberately not the system's home activity. Replacing Quest Home needs the shell uid, and a
 * choice that does not come back leaves someone with no way to reach anything — so this is a
 * BOOT_COMPLETED receiver starting a normal launch Intent, which the user can always undo from
 * inside the app. Whether the VR shell lets a launch land that early is the headset's call.
 */
public final class StartupLauncher {

    public static final String PREFS = "tom_startup";
    public static final String KEY_PACKAGE = "package";

    private StartupLauncher() {
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** '' when nothing is chosen. Never null, so no caller has to guard twice. */
    public static String get(Context context) {
        return prefs(context).getString(KEY_PACKAGE, "");
    }

    public static void set(Context context, String packageName) {
        prefs(context).edit().putString(KEY_PACKAGE, packageName == null ? "" : packageName).apply();
    }

    public static boolean launch(Context context, String packageName) {
        Intent intent = intentFor(context, packageName);
        if (intent == null) return false;
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
        return true;
    }

    /**
     * Quest apps are not always reachable through CATEGORY_LAUNCHER — the 2D panel convention uses
     * CATEGORY_INFO, which is why this app's own manifest declares both.
     */
    public static Intent intentFor(Context context, String packageName) {
        if (packageName == null || packageName.isEmpty()) return null;
        PackageManager pm = context.getPackageManager();
        Intent launcher = pm.getLaunchIntentForPackage(packageName);
        if (launcher != null) return launcher;

        Intent info = new Intent(Intent.ACTION_MAIN);
        info.addCategory(Intent.CATEGORY_INFO);
        info.setPackage(packageName);
        List<ResolveInfo> matches = pm.queryIntentActivities(info, 0);
        if (matches.isEmpty()) return null;

        ResolveInfo match = matches.get(0);
        Intent intent = new Intent(Intent.ACTION_MAIN);
        intent.addCategory(Intent.CATEGORY_INFO);
        intent.setClassName(match.activityInfo.packageName, match.activityInfo.name);
        return intent;
    }
}
