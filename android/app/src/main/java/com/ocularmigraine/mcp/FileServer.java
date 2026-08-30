package com.ocularmigraine.mcp;

import android.util.Log;

import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.DecimalFormat;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * A folder from the headset, over HTTP, for anything else on the network.
 *
 * Hand-written rather than a library: what is needed is GET a listing, GET a file and PUT a file,
 * and every HTTP server worth adding as a dependency brings a servlet stack with it.
 *
 * Uploads are PUT with the raw body, not multipart. The only client is the page this server itself
 * serves, so it can use fetch() with the File as the body — which removes a multipart parser, and
 * with it every boundary edge case, from a path that writes files to someone's headset.
 *
 * There is no authentication, exactly as on the original. That makes the copy in the app the
 * safety mechanism, so it says plainly who can reach this. What is defended here is the one thing
 * copy cannot: every requested path is resolved and checked to be inside the shared root, so no
 * amount of ../ reaches the rest of the headset.
 */
public final class FileServer {

    private static final String TAG = "TomFiles";
    public static final int PORT = 8080;
    private static final int BUFFER = 64 * 1024;
    /** A headset serving a LAN, not a website: enough for a few parallel downloads, no more. */
    private static final int WORKERS = 4;

    private static FileServer instance;

    private final AtomicBoolean running = new AtomicBoolean(false);
    private ServerSocket socket;
    private ExecutorService workers;
    private Thread acceptor;
    private File root = new File("/sdcard");
    private boolean uploads = false;

    private FileServer() {
    }

    public static synchronized FileServer get() {
        if (instance == null) instance = new FileServer();
        return instance;
    }

    public synchronized boolean isRunning() {
        return running.get();
    }

    public synchronized String rootPath() {
        return root.getAbsolutePath();
    }

    public synchronized boolean uploadsAllowed() {
        return uploads;
    }

    /** Throws rather than reporting a half-start: a server that is not listening must not read as up. */
    public synchronized void start(File folder, boolean allowUploads) throws IOException {
        stop();
        if (!folder.isDirectory()) throw new IOException("Not a folder: " + folder.getAbsolutePath());
        if (!folder.canRead()) throw new IOException("Cannot read " + folder.getAbsolutePath());

        root = folder.getCanonicalFile();
        uploads = allowUploads;
        socket = new ServerSocket();
        socket.setReuseAddress(true);
        socket.bind(new InetSocketAddress(PORT));
        workers = Executors.newFixedThreadPool(WORKERS);
        running.set(true);

        acceptor = new Thread(this::acceptLoop, "file-server");
        acceptor.setDaemon(true);
        acceptor.start();
    }

    public synchronized void stop() {
        running.set(false);
        if (socket != null) {
            try {
                socket.close();
            } catch (IOException ignored) {
                // Closing a socket that is already gone is not a failure worth reporting.
            }
            socket = null;
        }
        if (workers != null) {
            workers.shutdownNow();
            workers = null;
        }
        acceptor = null;
    }

    private void acceptLoop() {
        while (running.get()) {
            try {
                Socket client = socket.accept();
                workers.execute(() -> serve(client));
            } catch (Exception e) {
                // accept() throwing because stop() closed the socket is the normal way out.
                if (running.get()) Log.w(TAG, "accept failed", e);
                return;
            }
        }
    }

    private void serve(Socket client) {
        try (Socket open = client) {
            open.setSoTimeout(30_000);
            InputStream in = open.getInputStream();
            OutputStream out = new BufferedOutputStream(open.getOutputStream());

            String requestLine = readLine(in);
            if (requestLine == null || requestLine.isEmpty()) return;
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) {
                respond(out, 400, "text/plain", "Bad request".getBytes(StandardCharsets.UTF_8));
                return;
            }
            String method = parts[0];
            String target = parts[1];

            long contentLength = 0;
            String header;
            while ((header = readLine(in)) != null && !header.isEmpty()) {
                String lower = header.toLowerCase();
                if (lower.startsWith("content-length:")) {
                    try {
                        contentLength = Long.parseLong(header.substring(15).trim());
                    } catch (NumberFormatException ignored) {
                        contentLength = 0;
                    }
                }
            }

            if ("GET".equals(method) || "HEAD".equals(method)) {
                handleGet(out, target, "HEAD".equals(method));
            } else if ("PUT".equals(method)) {
                handlePut(in, out, target, contentLength);
            } else {
                respond(out, 405, "text/plain", "Only GET and PUT".getBytes(StandardCharsets.UTF_8));
            }
            out.flush();
        } catch (Exception e) {
            Log.w(TAG, "request failed", e);
        }
    }

    private void handleGet(OutputStream out, String target, boolean headOnly) throws IOException {
        File file = resolve(target);
        if (file == null) {
            respond(out, 403, "text/plain", "Outside the shared folder".getBytes(StandardCharsets.UTF_8));
            return;
        }
        if (!file.exists()) {
            respond(out, 404, "text/plain", "Not found".getBytes(StandardCharsets.UTF_8));
            return;
        }
        if (file.isDirectory()) {
            byte[] page = listing(file).getBytes(StandardCharsets.UTF_8);
            respond(out, 200, "text/html; charset=utf-8", headOnly ? null : page, page.length);
            return;
        }

        writeHeader(out, 200, contentType(file.getName()), file.length(), file.getName());
        if (headOnly) return;
        try (FileInputStream source = new FileInputStream(file)) {
            byte[] buffer = new byte[BUFFER];
            int read;
            while ((read = source.read(buffer)) > 0) out.write(buffer, 0, read);
        }
    }

    private void handlePut(InputStream in, OutputStream out, String target, long length) throws IOException {
        if (!uploads) {
            respond(out, 403, "text/plain", "Uploads are switched off".getBytes(StandardCharsets.UTF_8));
            return;
        }
        File file = resolve(target);
        if (file == null || file.isDirectory()) {
            respond(out, 403, "text/plain", "Outside the shared folder".getBytes(StandardCharsets.UTF_8));
            return;
        }
        File parent = file.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            respond(out, 500, "text/plain", "Could not create the folder".getBytes(StandardCharsets.UTF_8));
            return;
        }

        long written = 0;
        try (FileOutputStream sink = new FileOutputStream(file)) {
            byte[] buffer = new byte[BUFFER];
            while (written < length) {
                int want = (int) Math.min(buffer.length, length - written);
                int read = in.read(buffer, 0, want);
                if (read < 0) break;
                sink.write(buffer, 0, read);
                written += read;
            }
        }
        if (written < length) {
            // A truncated upload that stayed on disk would look like a complete file later.
            if (!file.delete()) Log.w(TAG, "could not remove truncated upload " + file);
            respond(out, 400, "text/plain", "Upload ended early".getBytes(StandardCharsets.UTF_8));
            return;
        }
        respond(out, 201, "text/plain", ("Saved " + file.getName()).getBytes(StandardCharsets.UTF_8));
    }

    /** Null when the request points outside the shared folder. The check itself is SafePath's. */
    private File resolve(String target) throws IOException {
        return SafePath.inside(root, target);
    }

    private String listing(File dir) throws IOException {
        File[] entries = dir.listFiles();
        if (entries == null) entries = new File[0];
        // Folders first, then by name: a listing sorted any other way is unreadable on a headset.
        Arrays.sort(entries, (a, b) -> {
            if (a.isDirectory() != b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.getName().compareToIgnoreCase(b.getName());
        });

        String here = relative(dir);
        StringBuilder html = new StringBuilder();
        html.append("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>")
            .append("<title>").append(escape(dir.getName())).append("</title>")
            .append("<style>body{font:15px system-ui;margin:0;padding:24px;background:#080a10;color:#e7ecf3}")
            .append("a{color:#22d98e;text-decoration:none}li{padding:6px 0;border-bottom:1px solid #1b2130}")
            .append("ul{list-style:none;padding:0;max-width:720px}small{color:#7d8798;float:right}")
            .append("h1{font-size:18px;font-weight:600}form{margin:18px 0}</style>")
            .append("<h1>").append(escape(here.isEmpty() ? "/" : here)).append("</h1>");

        if (uploads) {
            html.append("<form onsubmit='return false'><input type=file id=f multiple>")
                .append("<button onclick='up()'>Upload</button><p id=s></p></form>")
                .append("<script>async function up(){var l=document.getElementById('f').files,s=document.getElementById('s');")
                .append("for(var i=0;i<l.length;i++){s.textContent='Sending '+l[i].name+'…';")
                .append("var r=await fetch(location.pathname.replace(/\\/$/,'')+'/'+encodeURIComponent(l[i].name),{method:'PUT',body:l[i]});")
                .append("if(!r.ok){s.textContent=l[i].name+' failed: '+await r.text();return}}")
                .append("s.textContent='Done';location.reload()}</script>");
        }

        html.append("<ul>");
        if (!here.isEmpty()) html.append("<li><a href='../'>../</a></li>");
        for (File entry : entries) {
            String name = entry.getName();
            String href = URLEncoder.encode(name, "UTF-8").replace("+", "%20");
            html.append("<li><a href='").append(href).append(entry.isDirectory() ? "/'>" : "'>")
                .append(escape(name)).append(entry.isDirectory() ? "/" : "").append("</a>");
            if (entry.isFile()) html.append("<small>").append(size(entry.length())).append("</small>");
            html.append("</li>");
        }
        return html.append("</ul>").toString();
    }

    private String relative(File dir) throws IOException {
        String path = dir.getCanonicalPath();
        String rootPath = root.getCanonicalPath();
        return path.equals(rootPath) ? "" : path.substring(rootPath.length());
    }

    private static String size(long bytes) {
        if (bytes < 1024) return bytes + " B";
        DecimalFormat format = new DecimalFormat("0.#");
        if (bytes < 1024 * 1024) return format.format(bytes / 1024.0) + " KB";
        if (bytes < 1024L * 1024 * 1024) return format.format(bytes / (1024.0 * 1024)) + " MB";
        return format.format(bytes / (1024.0 * 1024 * 1024)) + " GB";
    }

    private static String escape(String raw) {
        return raw.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("'", "&#39;");
    }

    private static String contentType(String name) {
        String lower = name.toLowerCase();
        if (lower.endsWith(".mp4")) return "video/mp4";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".txt") || lower.endsWith(".log")) return "text/plain; charset=utf-8";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".apk")) return "application/vnd.android.package-archive";
        return "application/octet-stream";
    }

    private static void respond(OutputStream out, int status, String type, byte[] body) throws IOException {
        respond(out, status, type, body, body == null ? 0 : body.length);
    }

    private static void respond(OutputStream out, int status, String type, byte[] body, long length)
        throws IOException {
        writeHeader(out, status, type, length, null);
        if (body != null) out.write(body);
    }

    private static void writeHeader(OutputStream out, int status, String type, long length, String filename)
        throws IOException {
        StringBuilder head = new StringBuilder();
        head.append("HTTP/1.1 ").append(status).append(' ').append(reason(status)).append("\r\n")
            .append("Content-Type: ").append(type).append("\r\n")
            .append("Content-Length: ").append(length).append("\r\n")
            .append("Connection: close\r\n");
        if (filename != null) {
            head.append("Content-Disposition: attachment; filename=\"")
                .append(filename.replace("\"", "")).append("\"\r\n");
        }
        head.append("\r\n");
        out.write(head.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static String reason(int status) {
        switch (status) {
            case 200: return "OK";
            case 201: return "Created";
            case 400: return "Bad Request";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            default: return "Error";
        }
    }

    /** Reads one CRLF line without buffering past it, so the body stays where a PUT can stream it. */
    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        int b;
        while ((b = in.read()) >= 0) {
            if (b == '\n') break;
            if (b != '\r') line.write(b);
            if (line.size() > 8192) throw new IOException("Header line too long");
        }
        if (b < 0 && line.size() == 0) return null;
        return line.toString("UTF-8");
    }
}
