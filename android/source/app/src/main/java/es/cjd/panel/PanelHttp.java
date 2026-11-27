package es.cjd.panel;

import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class PanelHttp {
    private PanelHttp() {}

    static HttpURLConnection open(String address) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(3000);
        connection.setReadTimeout(3000);
        connection.setInstanceFollowRedirects(false);
        connection.setUseCaches(false);
        return connection;
    }

    static void authenticate(HttpURLConnection connection, String password) {
        if (!password.isEmpty()) {
            String credentials = Base64.encodeToString((":" + password).getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
            connection.setRequestProperty("Authorization", "Basic " + credentials);
        }
    }

    static byte[] read(HttpURLConnection connection, int limit) throws IOException {
        try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[8192];
            int length;
            while ((length = input.read(chunk)) != -1) {
                if (output.size() + length > limit) throw new IOException("Respuesta demasiado grande");
                output.write(chunk, 0, length);
            }
            return output.toByteArray();
        }
    }
}
