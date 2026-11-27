package es.cjd.panel;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.FileNotFoundException;

public final class UpdateFileProvider extends ContentProvider {
    static final String MIME = "application/vnd.android.package-archive";
    static final String PATH = "/cjd-update.apk";

    @Override public boolean onCreate() { return true; }

    @Override public String getType(Uri uri) { return MIME; }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!PATH.equals(uri.getPath()) || !"r".equals(mode)) throw new FileNotFoundException();
        return ParcelFileDescriptor.open(AppUpdates.apk(getContext()), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) {
        if (!PATH.equals(uri.getPath())) throw new IllegalArgumentException("Archivo desconocido");
        String[] keys = projection == null ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
        MatrixCursor cursor = new MatrixCursor(keys);
        Object[] row = new Object[keys.length];
        for (int i = 0; i < keys.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(keys[i])) row[i] = "CJD-Control-Panel.apk";
            if (OpenableColumns.SIZE.equals(keys[i])) row[i] = AppUpdates.apk(getContext()).length();
        }
        cursor.addRow(row);
        return cursor;
    }

    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
}
