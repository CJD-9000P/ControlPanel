package es.cjd.panel;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class PanelSettings {
    private static final String KEY = "cjd-panel-password";
    static final String DEFAULT_URL = "http://127.0.0.1:8081/";
    enum Alert {
        MODBUS("Modbus desconectado o recuperado"),
        PANEL("Panel inaccesible durante dos minutos de cocción"),
        MQTT("MQTT desconectado o recuperado (si está activo en el panel)"),
        HIGH("Temperatura alta"),
        DEVIATION("Desviación PV/SV en subidas y mesetas"),
        SCHEDULED("Inicio efectivo de una cocción programada"),
        FINISH("Final del último tramo de una cocción");

        final String label;
        Alert(String label) { this.label = label; }
    }

    final SharedPreferences prefs;

    PanelSettings(Context context) {
        prefs = context.getSharedPreferences("panel", Context.MODE_PRIVATE);
    }

    boolean enabled(Alert alert) { return prefs.getBoolean("alert_" + alert.name(), true); }

    boolean configured() { return prefs.contains("url"); }

    String url() { return prefs.getString("url", DEFAULT_URL); }
    String serverUrl() { return serverUrl(url()); }

    static String serverUrl(String address) {
        return URI.create(address).resolve("/").toString();
    }

    double max() { return Double.parseDouble(prefs.getString("max", "1250")); }
    double deviation() { return Double.parseDouble(prefs.getString("deviation", "50")); }

    static String normalize(String raw) throws Exception {
        URI uri = new URI(raw.trim());
        String path = uri.getPath();
        boolean compact = "/movil".equals(path) || "/movil/".equals(path)
                || "/móvil".equals(path) || "/móvil/".equals(path);
        if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                || uri.getHost() == null || uri.getRawUserInfo() != null
                || uri.getRawQuery() != null || uri.getRawFragment() != null
                || !(compact || "".equals(path) || "/".equals(path))
                || uri.getPort() == 0 || uri.getPort() > 65535) {
            throw new IllegalArgumentException("Introduce la dirección del panel, con http:// o https:// y /movil si quieres la vista compacta.");
        }
        return uri.getScheme().toLowerCase(java.util.Locale.ROOT) + "://" + uri.getRawAuthority() + (compact ? "/movil" : "/");
    }

    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        SecretKey existing = (SecretKey) store.getKey(KEY, null);
        if (existing != null) return existing;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }

    String password() throws Exception {
        String encrypted = prefs.getString("password", "");
        if (encrypted.isEmpty()) return "";
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128,
                Base64.decode(prefs.getString("iv", ""), Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }

    void save(String url, String password, double max, double deviation, java.util.Map<Alert, Boolean> alerts) throws Exception {
        SharedPreferences.Editor changes = prefs.edit().putString("url", url)
                .putString("max", Double.toString(max)).putString("deviation", Double.toString(deviation));
        alerts.forEach((alert, enabled) -> changes.putBoolean("alert_" + alert.name(), enabled));
        if (password.isEmpty()) {
            changes.remove("password").remove("iv");
        } else {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            changes.putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP));
            changes.putString("password", Base64.encodeToString(
                    cipher.doFinal(password.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP));
        }
        if (!changes.commit()) throw new IllegalStateException("No se pudieron guardar los ajustes.");
    }
}
