package es.cjd.panel;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;

final class AppUpdates {
    private static final String REPOSITORY = "CJD-9000P/ControlPanel";
    private static final String UPDATE_REF = "https://api.github.com/repos/" + REPOSITORY
            + "/git/ref/heads/codex/android-updates";
    private static final String RAW = "https://raw.githubusercontent.com/" + REPOSITORY + "/";
    private static final int MAX_APK_BYTES = 20 * 1024 * 1024;
    private static final int SIGNATURES = PackageManager.GET_SIGNATURES;

    static PackageInfo installed(Context context) {
        try {
            return context.getPackageManager().getPackageInfo(context.getPackageName(), SIGNATURES);
        } catch (PackageManager.NameNotFoundException error) {
            throw new IllegalStateException(error);
        }
    }

    static final class Release {
        final String version, digest, source;
        final int code;
        Release(String version, int code, String digest, String source) {
            this.version = version;
            this.code = code;
            this.digest = digest;
            this.source = source;
        }
    }

    static Release check() throws Exception {
        HttpURLConnection ref = PanelHttp.open(UPDATE_REF + "?check=" + System.currentTimeMillis());
        String commit;
        try {
            ref.setRequestProperty("Accept", "application/vnd.github+json");
            JSONObject data = new JSONObject(new String(PanelHttp.read(ref, 8192), StandardCharsets.UTF_8));
            commit = data.getJSONObject("object").getString("sha");
        } finally {
            ref.disconnect();
        }
        if (!commit.matches("[0-9a-f]{40}")) throw new IOException("Referencia de versión inválida");
        String source = RAW + commit + "/android/";
        HttpURLConnection connection = PanelHttp.open(source + "latest.json");
        try {
            JSONObject data = new JSONObject(new String(PanelHttp.read(connection, 8192), StandardCharsets.UTF_8));
            String version = data.getString("version");
            String digest = data.getString("sha256");
            int code = data.getInt("versionCode");
            if (!version.matches("[0-9]{1,5}\\.[0-9]{1,5}\\.[0-9]{1,5}") || !digest.matches("[0-9a-f]{64}") || code < 1) {
                throw new IOException("Ficha de versión inválida");
            }
            return new Release(version, code, digest, source);
        } finally {
            connection.disconnect();
        }
    }

    static File apk(Context context) { return new File(context.getCacheDir(), "cjd-update.apk"); }

    static synchronized void download(Context context, Release release) throws Exception {
        File temporary = File.createTempFile("cjd-download-", ".apk", context.getCacheDir());
        HttpURLConnection connection = null;
        try {
            connection = PanelHttp.open(release.source + "CJD-Control-Panel-" + release.version + ".apk");
            connection.setReadTimeout(20_000);
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temporary)) {
                byte[] buffer = new byte[8192];
                int total = 0;
                int length;
                while ((length = input.read(buffer)) != -1) {
                    total += length;
                    if (total > MAX_APK_BYTES) throw new IOException("El APK excede el tamaño permitido");
                    digest.update(buffer, 0, length);
                    output.write(buffer, 0, length);
                }
            }
            StringBuilder checksum = new StringBuilder();
            for (byte value : digest.digest()) checksum.append(String.format(Locale.ROOT, "%02x", value & 255));
            PackageInfo current = installed(context);
            PackageInfo incoming = context.getPackageManager().getPackageArchiveInfo(temporary.getPath(), SIGNATURES);
            if (!checksum.toString().equals(release.digest) || incoming == null
                    || !current.packageName.equals(incoming.packageName) || incoming.versionCode != release.code
                    || !release.version.equals(incoming.versionName) || incoming.versionCode <= current.versionCode
                    || incoming.signatures == null || !Arrays.equals(current.signatures, incoming.signatures)) {
                throw new IOException("No se pudo verificar la actualización");
            }
            if (!temporary.renameTo(apk(context))) throw new IOException("No se pudo preparar el APK");
        } finally {
            if (connection != null) connection.disconnect();
            temporary.delete();
        }
    }
}
