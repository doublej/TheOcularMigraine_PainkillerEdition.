package com.ocularmigraine.mcp.plugins;

import android.os.Build;
import android.os.Environment;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.ocularmigraine.mcp.Mp4Stereo;

import java.io.File;
import java.util.Arrays;

/**
 * The recordings on the headset, and the one thing this app does to them: mark a both-eyes capture
 * as 3D so YouTube plays it as stereo.
 *
 * The work happens on its own thread. Capacitor runs plugin methods on a single shared
 * HandlerThread, so copying a multi-gigabyte capture there would freeze every other plugin call in
 * the app for as long as it took.
 */
@CapacitorPlugin(name = "Video")
public class VideoPlugin extends Plugin {

    /** Where the headset puts its own captures. */
    private static final String CAPTURES = "/sdcard/Oculus/VideoShots";
    /** Where the marked copies go, which is where the original app put them too. */
    private static final String MARKED = CAPTURES + "/3D";

    @PluginMethod
    public void listCaptures(PluginCall call) {
        File dir = new File(CAPTURES);
        File[] files = dir.listFiles((d, name) -> name.toLowerCase().endsWith(".mp4"));
        if (files == null) files = new File[0];
        // Newest first: the recording someone wants is almost always the one they just made.
        Arrays.sort(files, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));

        JSArray videos = new JSArray();
        for (File file : files) {
            JSObject entry = new JSObject();
            entry.put("path", file.getAbsolutePath());
            entry.put("name", file.getName());
            entry.put("bytes", file.length());
            entry.put("modified", file.lastModified());
            videos.put(entry);
        }

        JSObject result = new JSObject();
        result.put("videos", videos);
        result.put("folder", CAPTURES);
        result.put("canRead", canManageFiles());
        call.resolve(result);
    }

    /**
     * Writes a marked copy and leaves the original alone, so a file that comes out wrong costs a
     * copy rather than the recording. Re-marking the same capture overwrites the previous copy.
     */
    @PluginMethod
    public void markStereo(PluginCall call) {
        String path = call.getString("path", "");
        if (path == null || path.isEmpty()) {
            call.reject("path is required");
            return;
        }
        boolean topBottom = Boolean.TRUE.equals(call.getBoolean("topBottom", false));

        File source = new File(path);
        if (!source.isFile()) {
            call.reject("No file at " + path);
            return;
        }

        File target = new File(MARKED, markedName(source.getName()));
        new Thread(() -> {
            try {
                Mp4Stereo.inject(
                    source,
                    target,
                    topBottom ? Mp4Stereo.STEREO_TOP_BOTTOM : Mp4Stereo.STEREO_LEFT_RIGHT
                );
                JSObject result = new JSObject();
                result.put("path", target.getAbsolutePath());
                result.put("name", target.getName());
                result.put("bytes", target.length());
                call.resolve(result);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "Could not mark the file" : e.getMessage());
            }
        }, "mark-stereo").start();
    }

    /** Keeps the original name recognisable, and keeps the marked copy from looking like a capture. */
    private String markedName(String name) {
        int dot = name.lastIndexOf('.');
        return dot > 0 ? name.substring(0, dot) + "_3D.mp4" : name + "_3D.mp4";
    }

    /** Granted from a Settings screen rather than a prompt, so the UI has to be able to state it. */
    private boolean canManageFiles() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return true;
        return Environment.isExternalStorageManager();
    }
}
