package com.ocularmigraine.mcp;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.util.ArrayList;
import java.util.List;

/**
 * Marks a side-by-side capture as 3D, so YouTube plays it as stereo instead of two squashed halves.
 *
 * Recording both eyes gives one frame with the left eye beside the right, and nothing in the file
 * says so. The `st3d` box from Google's spatial-media spec is what says it: one byte inside the
 * video sample entry, holding stereo_mode = 2 (left-right).
 *
 * Nothing is re-encoded and the original is never touched — a copy is written with the box added,
 * so a bug here costs a copy rather than the recording. Growing the moov moves everything after it,
 * so every chunk offset in a file whose moov sits before its mdat is corrected by the same delta.
 *
 * No Android imports, on purpose: main() runs this against a real file on a desktop JVM.
 */
public final class Mp4Stereo {

    /** From the spatial-media spec: 0 mono, 1 top-bottom, 2 left-right. */
    public static final int STEREO_LEFT_RIGHT = 2;
    public static final int STEREO_TOP_BOTTOM = 1;

    private static final int HEADER = 8;
    /** size + 'st3d' + version/flags + one byte of stereo_mode. */
    private static final int ST3D_SIZE = 13;

    private Mp4Stereo() {
    }

    /** A box as it sits in the file: where it starts, how long it is, and what it is. */
    private static final class Box {
        final long offset;
        final long size;
        final String type;
        final long contentOffset;

        Box(long offset, long size, String type, long contentOffset) {
            this.offset = offset;
            this.size = size;
            this.type = type;
            this.contentOffset = contentOffset;
        }

        long end() {
            return offset + size;
        }
    }

    /**
     * Writes `target` as `source` plus the stereo marker. Throws when the file is not something
     * this understands, rather than writing a copy that only looks converted.
     */
    public static void inject(File source, File target, int stereoMode) throws IOException {
        byte[] file = readAll(source);

        List<Box> top = boxesIn(file, 0, file.length);
        Box moov = find(top, "moov");
        Box mdat = find(top, "mdat");
        if (moov == null) throw new IOException("No moov box: not an MP4 this can mark");
        if (mdat == null) throw new IOException("No mdat box: nothing to play");

        // The visual sample entry is the one box the marker belongs inside.
        List<Box> path = pathToVisualSampleEntry(file, moov);
        if (path == null) throw new IOException("No video track found in this file");
        Box sampleEntry = path.get(path.size() - 1);

        byte[] out = new byte[file.length + ST3D_SIZE];
        int at = (int) sampleEntry.end();
        System.arraycopy(file, 0, out, 0, at);
        writeSt3d(out, at, stereoMode);
        System.arraycopy(file, at, out, at + ST3D_SIZE, file.length - at);

        // Every box that contains the new one is now that much longer.
        for (Box ancestor : path) growBox(out, ancestor, ST3D_SIZE);
        growBox(out, moov, ST3D_SIZE);

        // Only a moov ahead of the media moves it; a moov written after mdat leaves it where it is.
        if (moov.offset < mdat.offset) shiftChunkOffsets(out, moov, ST3D_SIZE);

        writeAll(target, out);
    }

    private static void writeSt3d(byte[] out, int at, int stereoMode) {
        writeInt(out, at, ST3D_SIZE);
        out[at + 4] = 's';
        out[at + 5] = 't';
        out[at + 6] = '3';
        out[at + 7] = 'd';
        // version 0, flags 0
        out[at + 8] = 0;
        out[at + 9] = 0;
        out[at + 10] = 0;
        out[at + 11] = 0;
        out[at + 12] = (byte) stereoMode;
    }

    /**
     * moov -> trak -> mdia -> minf -> stbl -> stsd -> the first sample entry, for the trak whose
     * handler is 'vide'. Returned outermost-first, because every one of them has to grow.
     */
    private static List<Box> pathToVisualSampleEntry(byte[] file, Box moov) {
        for (Box trak : childrenOf(file, moov, "trak")) {
            for (Box mdia : childrenOf(file, trak, "mdia")) {
                if (!"vide".equals(handlerOf(file, mdia))) continue;
                for (Box minf : childrenOf(file, mdia, "minf")) {
                    for (Box stbl : childrenOf(file, minf, "stbl")) {
                        for (Box stsd : childrenOf(file, stbl, "stsd")) {
                            // stsd is a FullBox with an entry count before its children.
                            List<Box> entries = boxesIn(file, (int) stsd.contentOffset + 8, (int) stsd.end());
                            if (entries.isEmpty()) continue;
                            List<Box> path = new ArrayList<>();
                            path.add(trak);
                            path.add(mdia);
                            path.add(minf);
                            path.add(stbl);
                            path.add(stsd);
                            path.add(entries.get(0));
                            return path;
                        }
                    }
                }
            }
        }
        return null;
    }

    /** The four-character handler type of an mdia, or null when it has no hdlr. */
    private static String handlerOf(byte[] file, Box mdia) {
        for (Box hdlr : childrenOf(file, mdia, "hdlr")) {
            // FullBox(4) + pre_defined(4), then the handler type.
            int at = (int) hdlr.contentOffset + 8;
            if (at + 4 > file.length) return null;
            return new String(file, at, 4, java.nio.charset.StandardCharsets.ISO_8859_1);
        }
        return null;
    }

    private static void shiftChunkOffsets(byte[] out, Box moov, int delta) {
        for (Box trak : childrenOf(out, moov, "trak")) {
            for (Box mdia : childrenOf(out, trak, "mdia")) {
                for (Box minf : childrenOf(out, mdia, "minf")) {
                    for (Box stbl : childrenOf(out, minf, "stbl")) {
                        for (Box stco : childrenOf(out, stbl, "stco")) shift32(out, stco, delta);
                        for (Box co64 : childrenOf(out, stbl, "co64")) shift64(out, co64, delta);
                    }
                }
            }
        }
    }

    private static void shift32(byte[] out, Box stco, int delta) {
        int at = (int) stco.contentOffset + 4;
        int count = readInt(out, at);
        at += 4;
        for (int i = 0; i < count; i++, at += 4) writeInt(out, at, readInt(out, at) + delta);
    }

    private static void shift64(byte[] out, Box co64, int delta) {
        int at = (int) co64.contentOffset + 4;
        int count = readInt(out, at);
        at += 4;
        for (int i = 0; i < count; i++, at += 8) writeLong(out, at, readLong(out, at) + delta);
    }

    /**
     * Boxes are found again in the grown buffer rather than patched from the old offsets: every
     * box after the insertion point has moved, and only the ones before it are still where they were.
     */
    private static void growBox(byte[] out, Box box, int delta) {
        writeInt(out, (int) box.offset, (int) (box.size + delta));
    }

    private static List<Box> childrenOf(byte[] file, Box parent, String type) {
        List<Box> found = new ArrayList<>();
        for (Box child : boxesIn(file, (int) parent.contentOffset, (int) parent.end())) {
            if (child.type.equals(type)) found.add(child);
        }
        return found;
    }

    private static Box find(List<Box> boxes, String type) {
        for (Box box : boxes) {
            if (box.type.equals(type)) return box;
        }
        return null;
    }

    /**
     * The boxes laid out between two offsets. A box claiming a size that runs past the end, or a
     * size of zero, stops the walk — a truncated file must not be read as if it had more in it.
     */
    private static List<Box> boxesIn(byte[] file, int from, int to) {
        List<Box> boxes = new ArrayList<>();
        int at = from;
        while (at + HEADER <= to) {
            long size = readInt(file, at) & 0xFFFFFFFFL;
            String type = new String(file, at + 4, 4, java.nio.charset.StandardCharsets.ISO_8859_1);
            int contentOffset = at + HEADER;
            if (size == 1) {
                // 64-bit size, in the eight bytes after the type.
                if (at + 16 > to) break;
                size = readLong(file, at + 8);
                contentOffset = at + 16;
            } else if (size == 0) {
                // "to the end of the file", which only the last box may claim.
                size = to - at;
            }
            if (size < HEADER || at + size > to) break;
            boxes.add(new Box(at, size, type, contentOffset));
            at += size;
        }
        return boxes;
    }

    private static int readInt(byte[] b, int at) {
        return ((b[at] & 0xFF) << 24) | ((b[at + 1] & 0xFF) << 16) | ((b[at + 2] & 0xFF) << 8) | (b[at + 3] & 0xFF);
    }

    private static long readLong(byte[] b, int at) {
        return ((long) readInt(b, at) << 32) | (readInt(b, at + 4) & 0xFFFFFFFFL);
    }

    private static void writeInt(byte[] b, int at, int value) {
        b[at] = (byte) (value >>> 24);
        b[at + 1] = (byte) (value >>> 16);
        b[at + 2] = (byte) (value >>> 8);
        b[at + 3] = (byte) value;
    }

    private static void writeLong(byte[] b, int at, long value) {
        writeInt(b, at, (int) (value >>> 32));
        writeInt(b, at + 4, (int) value);
    }

    /**
     * Whole-file, because the moov has to be rewritten in place and a Quest capture is opened once
     * on a device with gigabytes of RAM. A file too large to hold is refused rather than streamed
     * badly: the limit is stated, not discovered halfway through.
     */
    private static byte[] readAll(File source) throws IOException {
        long length = source.length();
        if (length <= 0) throw new IOException("Empty file: " + source.getName());
        if (length > Integer.MAX_VALUE - ST3D_SIZE) throw new IOException("File is too large to mark in one pass");
        byte[] data = new byte[(int) length];
        try (RandomAccessFile in = new RandomAccessFile(source, "r")) {
            in.readFully(data);
        }
        return data;
    }

    private static void writeAll(File target, byte[] data) throws IOException {
        File parent = target.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IOException("Could not create " + parent.getAbsolutePath());
        }
        try (RandomAccessFile out = new RandomAccessFile(target, "rw")) {
            out.setLength(0);
            out.write(data);
        }
    }

    /** Marks the file named on the command line, so the box can be checked with a real player. */
    public static void main(String[] args) throws IOException {
        if (args.length < 2) {
            System.out.println("usage: Mp4Stereo <in.mp4> <out.mp4>");
            return;
        }
        inject(new File(args[0]), new File(args[1]), STEREO_LEFT_RIGHT);
        System.out.println("marked " + args[1] + " as side-by-side 3D");
    }
}
