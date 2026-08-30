package com.ocularmigraine.mcp.plugins;

import android.os.Build;
import android.os.Environment;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.ocularmigraine.mcp.FileServer;

import java.io.File;

/**
 * Share a folder from the headset over HTTP, and optionally take files back.
 *
 * Every answer is the server's own state, never a remembered intention: status() asks the socket
 * whether it is listening, so a server the system killed cannot keep reading as up in the UI.
 */
@CapacitorPlugin(name = "FileServer")
public class FileServerPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String root = call.getString("root", "");
        boolean uploads = Boolean.TRUE.equals(call.getBoolean("uploads", false));
        if (root == null || root.isEmpty()) root = Environment.getExternalStorageDirectory().getAbsolutePath();

        if (!canReadStorage()) {
            call.reject("All files access has not been granted to this app");
            return;
        }
        try {
            FileServer.get().start(new File(root), uploads);
            call.resolve(status());
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "Could not start the server" : e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        FileServer.get().stop();
        call.resolve(status());
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(status());
    }

    private JSObject status() {
        FileServer server = FileServer.get();
        JSObject out = new JSObject();
        out.put("running", server.isRunning());
        out.put("port", FileServer.PORT);
        out.put("root", server.rootPath());
        out.put("uploads", server.uploadsAllowed());
        out.put("canRead", canReadStorage());
        return out;
    }

    /**
     * MANAGE_EXTERNAL_STORAGE is granted from a Settings screen, not a prompt, so this is a fact
     * the UI has to be able to state before someone wonders why their folder looks empty.
     */
    private boolean canReadStorage() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return true;
        return Environment.isExternalStorageManager();
    }
}
