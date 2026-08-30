package com.ocularmigraine.mcp.plugins;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;

/**
 * Device facts that a sideloaded app can read for itself.
 *
 * Every one of these used to be a shell-out — `dumpsys battery`, `dumpsys wifi`, `df`, `ip addr`,
 * `getprop ro.product.model`. Measured on a Quest 3, the dumpsys calls are refused outright to an
 * app uid ("Can't find service"), so on a headset install the whole Device Info card read blank.
 * These framework calls need no privilege at all and no setup.
 */
@CapacitorPlugin(name = "DeviceInfo")
public class DeviceInfoPlugin extends Plugin {

    /** Android's own placeholder when the caller may not see the network name. */
    private static final String UNKNOWN_SSID = "<unknown ssid>";

    @PluginMethod
    public void info(PluginCall call) {
        JSObject result = new JSObject();
        result.put("model", Build.MODEL);
        result.put("manufacturer", Build.MANUFACTURER);
        result.put("firmware", Build.DISPLAY);
        result.put("securityPatch", Build.VERSION.SECURITY_PATCH);
        result.put("sdkInt", Build.VERSION.SDK_INT);

        putBattery(result);
        putStorage(result);
        result.put("ip", firstIpv4());

        call.resolve(result);
    }

    /**
     * Wi-Fi is split out because the SSID alone needs a runtime location permission — Android hands
     * back "<unknown ssid>" without it. Signal and link speed come back either way, so a refused
     * permission still leaves something honest to show rather than an empty card.
     */
    @PluginMethod
    public void wifi(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ssid", "");
        result.put("signal", 0);
        result.put("ssidHidden", false);

        WifiManager wifi = (WifiManager) getContext()
            .getApplicationContext()
            .getSystemService(Context.WIFI_SERVICE);
        if (wifi == null) {
            call.resolve(result);
            return;
        }

        WifiInfo connection = wifi.getConnectionInfo();
        if (connection == null) {
            call.resolve(result);
            return;
        }

        // getSSID() wraps the name in quotes when it is printable UTF-8.
        String ssid = connection.getSSID();
        if (ssid != null) {
            ssid = ssid.replaceAll("^\"|\"$", "");
        }
        boolean hidden = ssid == null || ssid.isEmpty() || UNKNOWN_SSID.equals(ssid);

        result.put("ssid", hidden ? "" : ssid);
        result.put("ssidHidden", hidden);
        result.put("signal", connection.getRssi());
        call.resolve(result);
    }

    private void putBattery(JSObject result) {
        // The sticky broadcast: registering a null receiver returns the last value without ever
        // subscribing, so there is nothing to unregister and nothing to leak.
        Intent status = getContext().registerReceiver(
            null,
            new IntentFilter(Intent.ACTION_BATTERY_CHANGED)
        );
        if (status == null) {
            result.put("batteryLevel", 0);
            result.put("charging", false);
            return;
        }

        int level = status.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = status.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
        int state = status.getIntExtra(BatteryManager.EXTRA_STATUS, -1);

        // Scale is not always 100, so the percentage has to be computed rather than assumed.
        result.put("batteryLevel", level >= 0 && scale > 0 ? Math.round(level * 100f / scale) : 0);
        result.put(
            "charging",
            state == BatteryManager.BATTERY_STATUS_CHARGING || state == BatteryManager.BATTERY_STATUS_FULL
        );
    }

    private void putStorage(JSObject result) {
        // The user-visible volume, matching what `df /storage/emulated/0` used to report — not
        // getDataDirectory(), which would quietly start answering a different question.
        StatFs stat = new StatFs(Environment.getExternalStorageDirectory().getAbsolutePath());
        long free = stat.getAvailableBlocksLong() * stat.getBlockSizeLong();
        long total = stat.getBlockCountLong() * stat.getBlockSizeLong();
        result.put("freeBytes", free);
        result.put("totalBytes", total);
    }

    /** First non-loopback IPv4 address, which on a headset is the Wi-Fi one. Empty when offline. */
    private String firstIpv4() {
        try {
            for (NetworkInterface iface : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (iface.isLoopback() || !iface.isUp()) continue;
                for (InetAddress address : Collections.list(iface.getInetAddresses())) {
                    if (address instanceof Inet4Address) return address.getHostAddress();
                }
            }
        } catch (Exception ignored) {
            // No interfaces readable is the same answer as no address: unknown, not zero.
        }
        return "";
    }
}
