package com.ocularmigraine.mcp.plugins;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.provider.Settings;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.util.List;

/**
 * App listing, launching and installing without a shell.
 *
 * `pm list packages -3` works from an app uid, but it returns bare package ids and nothing else —
 * which is why the picker had to guess a name from the last id segment. PackageManager gives the
 * real label and icon. `monkey`, `am start` and `pm install` are all refused to an app uid on a
 * Quest 3; the Intent equivalents are not.
 */
@CapacitorPlugin(name = "Apps")
public class AppsPlugin extends Plugin {

    /** Icons are shipped inline with the list, so they are downscaled to a list-row size first. */
    private static final int ICON_PX = 48;

    @PluginMethod
    public void list(PluginCall call) {
        boolean withIcons = Boolean.TRUE.equals(call.getBoolean("icons", true));
        PackageManager pm = getContext().getPackageManager();
        JSArray apps = new JSArray();

        for (PackageInfo info : pm.getInstalledPackages(0)) {
            ApplicationInfo app = info.applicationInfo;
            if (app == null) continue;
            // Same set `pm list packages -3` returned: sideloaded and store-installed, no system apps.
            // An updated system app keeps FLAG_SYSTEM, so both flags have to be checked.
            boolean system = (app.flags & ApplicationInfo.FLAG_SYSTEM) != 0
                || (app.flags & ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0;
            if (system) continue;

            JSObject entry = new JSObject();
            entry.put("packageName", info.packageName);
            entry.put("label", String.valueOf(pm.getApplicationLabel(app)));
            entry.put("versionName", info.versionName == null ? "" : info.versionName);
            entry.put("enabled", app.enabled);
            if (withIcons) entry.put("icon", iconDataUri(pm, app));
            apps.put(entry);
        }

        JSObject result = new JSObject();
        result.put("apps", apps);
        call.resolve(result);
    }

    @PluginMethod
    public void launch(PluginCall call) {
        String pkg = call.getString("packageName", "");
        if (pkg == null || pkg.isEmpty()) {
            call.reject("packageName is required");
            return;
        }

        Intent intent = resolveLaunchIntent(pkg);
        if (intent == null) {
            call.reject("No launchable activity in " + pkg);
            return;
        }

        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(new JSObject().put("launched", pkg));
        } catch (Exception e) {
            call.reject("Could not launch " + pkg + ": " + e.getMessage());
        }
    }

    /**
     * Hands the APK to the system installer, which asks the user to confirm. An app can never
     * install silently — `pm install` needs the shell uid — so the confirmation is the feature,
     * not a limitation to work around.
     */
    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path", "");
        if (path == null || path.isEmpty()) {
            call.reject("path is required");
            return;
        }

        File apk = new File(path);
        if (!apk.exists()) {
            call.reject("No file at " + path);
            return;
        }

        try {
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                apk
            );
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getContext().startActivity(intent);
            call.resolve(new JSObject().put("handedOff", true));
        } catch (Exception e) {
            call.reject("Could not open the installer: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open Settings: " + e.getMessage());
        }
    }

    /**
     * The nearest honest equivalent of `am kill-all`: killBackgroundProcesses only ever touches one
     * package at a time and silently ignores anything in the foreground, so this sweeps the
     * third-party list and reports how many it asked about rather than claiming a kill.
     */
    @PluginMethod
    public void killBackground(PluginCall call) {
        ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        if (am == null) {
            call.reject("No activity manager");
            return;
        }

        PackageManager pm = getContext().getPackageManager();
        String self = getContext().getPackageName();
        int asked = 0;
        for (PackageInfo info : pm.getInstalledPackages(0)) {
            ApplicationInfo app = info.applicationInfo;
            if (app == null || (app.flags & ApplicationInfo.FLAG_SYSTEM) != 0) continue;
            if (self.equals(info.packageName)) continue;
            am.killBackgroundProcesses(info.packageName);
            asked++;
        }
        call.resolve(new JSObject().put("asked", asked));
    }

    /**
     * Quest apps are not always reachable through CATEGORY_LAUNCHER — the 2D panel convention uses
     * CATEGORY_INFO, which is why this app's own manifest declares both.
     */
    private Intent resolveLaunchIntent(String pkg) {
        PackageManager pm = getContext().getPackageManager();
        Intent launcher = pm.getLaunchIntentForPackage(pkg);
        if (launcher != null) return launcher;

        Intent info = new Intent(Intent.ACTION_MAIN);
        info.addCategory(Intent.CATEGORY_INFO);
        info.setPackage(pkg);
        List<ResolveInfo> matches = pm.queryIntentActivities(info, 0);
        if (matches.isEmpty()) return null;

        ResolveInfo match = matches.get(0);
        Intent intent = new Intent(Intent.ACTION_MAIN);
        intent.addCategory(Intent.CATEGORY_INFO);
        intent.setClassName(match.activityInfo.packageName, match.activityInfo.name);
        return intent;
    }

    /** '' rather than a broken image when an icon cannot be rendered — the row still has its label. */
    private String iconDataUri(PackageManager pm, ApplicationInfo app) {
        try {
            Drawable icon = pm.getApplicationIcon(app);
            Bitmap bitmap = toBitmap(icon);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
            return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) {
            return "";
        }
    }

    private Bitmap toBitmap(Drawable icon) {
        if (icon instanceof BitmapDrawable && ((BitmapDrawable) icon).getBitmap() != null) {
            return Bitmap.createScaledBitmap(((BitmapDrawable) icon).getBitmap(), ICON_PX, ICON_PX, true);
        }
        // Adaptive icons have no backing bitmap and must be drawn.
        Bitmap bitmap = Bitmap.createBitmap(ICON_PX, ICON_PX, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        icon.setBounds(0, 0, ICON_PX, ICON_PX);
        icon.draw(canvas);
        return bitmap;
    }
}
