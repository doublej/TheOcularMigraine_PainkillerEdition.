package com.ocularmigraine.mcp;

import java.io.File;
import java.io.IOException;
import java.net.URLDecoder;

/**
 * The one guard standing between a shared folder and the rest of the headset.
 *
 * Its own file, with nothing from Android in it, so it can be compiled and run on a desktop JVM —
 * see main(). A path check that cannot be exercised is a path check nobody has ever seen work.
 */
public final class SafePath {

    private SafePath() {
    }

    /**
     * The file a request is asking for, or null when that is not inside the shared root.
     *
     * Canonical on both sides, so ../ segments, percent-encoded ones and symlinks all resolve to
     * where they really point before the comparison. The separator in the prefix test is what
     * stops /sdcard/Downloads-secret passing as a child of /sdcard/Downloads.
     */
    public static File inside(File root, String target) throws IOException {
        String path = target == null ? "" : target;
        int query = path.indexOf('?');
        if (query >= 0) path = path.substring(0, query);
        path = URLDecoder.decode(path, "UTF-8");
        // A NUL byte truncates the name in some filesystem calls, so a path holding one is refused
        // rather than normalised into something shorter than what was checked.
        if (path.indexOf('\0') >= 0) return null;

        File candidate = new File(root, path).getCanonicalFile();
        String rootPath = root.getCanonicalPath();
        String candidatePath = candidate.getCanonicalPath();
        if (candidatePath.equals(rootPath)) return candidate;
        return candidatePath.startsWith(rootPath + File.separator) ? candidate : null;
    }

    /** Runs the guard against the shapes that would matter if it were wrong. */
    public static void main(String[] args) throws IOException {
        File root = new File(System.getProperty("java.io.tmpdir"), "tom-safepath-check");
        File nested = new File(root, "sub");
        if (!nested.mkdirs() && !nested.isDirectory()) throw new IllegalStateException("no temp root");

        allow(root, "/");
        allow(root, "/sub");
        allow(root, "/sub/file.mp4");
        allow(root, "/a%20file.txt");
        refuse(root, "/../etc/passwd");
        refuse(root, "/sub/../../outside");
        refuse(root, "/%2e%2e/%2e%2e/data");
        refuse(root, "/..%2fetc");
        refuse(root, "/sub/\0/etc");
        // Not a child of the root, only a name that starts the same way.
        refuse(new File(root, "sub"), "/../subsidiary");

        System.out.println("SafePath: every case behaved");
    }

    private static void allow(File root, String target) throws IOException {
        if (inside(root, target) == null) throw new IllegalStateException("should have allowed " + target);
    }

    private static void refuse(File root, String target) throws IOException {
        if (inside(root, target) != null) throw new IllegalStateException("should have refused " + target);
    }
}
