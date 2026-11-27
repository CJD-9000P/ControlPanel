package es.cjd.panel;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.util.Base64;
import android.view.ViewGroup;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.EnumMap;

public final class PanelActivity extends Activity {
    private static final int NOTIFICATIONS_REQUEST = 11;
    private static final int EXPORT_REQUEST = 12;
    private static final int UPDATE_PERMISSION_REQUEST = 13;
    private static final int CSV_PICK_REQUEST = 14;
    private ValueCallback<Uri[]> pendingCsv;
    private boolean updateBusy;
    private static final java.util.regex.Pattern CSV_EXPORT =
            java.util.regex.Pattern.compile("/api/(firings|profiles)/([A-Za-z0-9_-]+)/csv");
    private String pendingExport;
    private static final String NOTICE_SEEN = "remote_use_notice_seen";
    private static final String USE_NOTICE = "CJD Control Panel es una aplicación que permite consultar "
            + "el estado del horno remotamente. Las notificaciones pueden retrasarse o perderse. "
            + "Comprueba siempre el estado del horno directamente en su programador."
            + "\n\nLa aplicación Android y el servidor Python se proporcionan tal cual y su instalación "
            + "y uso son responsabilidad de quien los utilice. El autor no asume responsabilidad por daños "
            + "derivados de su instalación o uso.";
    private PanelSettings settings;
    private LinearLayout layout;
    private WebView page;
    private ImageButton modbusIndicator, panelIndicator;
    private MonitorService.Connections lastConnections;
    private final Runnable indicators = new Runnable() {
        @Override public void run() {
            refreshIndicators();
            layout.postDelayed(this, 650);
        }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        settings = new PanelSettings(this);
        if (state != null) pendingExport = state.getString("pendingExport");
        MonitorService.channels(getSystemService(NotificationManager.class));

        layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        getWindow().setStatusBarColor(0xff101213);
        getWindow().setNavigationBarColor(0xff101213);
        LinearLayout bar = new LinearLayout(this);
        bar.setBackgroundColor(0xff151718);
        bar.setGravity(android.view.Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(4), 0, dp(4), 0);
        ImageView brand = new ImageView(this);
        brand.setImageResource(R.drawable.cjd_wordmark);
        brand.setContentDescription("CJD Control Panel");
        brand.setScaleType(ImageView.ScaleType.FIT_START);
        LinearLayout.LayoutParams brandSize = new LinearLayout.LayoutParams(0, dp(28), 1);
        brandSize.setMargins(dp(6), 0, dp(4), 0);
        bar.addView(brand, brandSize);
        modbusIndicator = icon(R.drawable.ic_modbus_on, "Modbus sin confirmar",
                () -> showStatus(modbusIndicator.getContentDescription()));
        panelIndicator = icon(R.drawable.ic_wifi_on, "Conexión con el PC sin confirmar",
                () -> showStatus(panelIndicator.getContentDescription()));
        bar.addView(modbusIndicator, new LinearLayout.LayoutParams(dp(42), dp(48)));
        bar.addView(panelIndicator, new LinearLayout.LayoutParams(dp(42), dp(48)));
        bar.addView(icon(R.drawable.ic_refresh, "Recargar panel", this::loadPanel),
                new LinearLayout.LayoutParams(dp(48), dp(48)));
        bar.addView(icon(R.drawable.ic_more, "Menú del panel", this::showMenu),
                new LinearLayout.LayoutParams(dp(48), dp(48)));
        layout.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));
        setContentView(layout);
        refreshIndicators();
        if (!settings.prefs.getBoolean(NOTICE_SEEN, false)) {
            layout.post(() -> showUseNotice(true));
        } else {
            openConfiguredPanel(state == null);
        }
    }

    private void openConfiguredPanel(boolean openSettingsIfNeeded) {
        if (settings.configured()) {
            loadPanel();
            layout.post(this::enableMonitoring);
        } else if (openSettingsIfNeeded) {
            layout.post(this::editSettings);
        }
    }

    private void showMenu() {
        String[] items = {"Ajustes de notificaciones", "Ayuda", "Acerca de"};
        new AlertDialog.Builder(this).setItems(items, (dialog, selected) -> {
            if (selected == 0) editSettings();
            else if (selected == 1) showHelp();
            else showUseNotice(false);
        }).show();
    }

    private void showHelp() {
        new AlertDialog.Builder(this).setTitle("Ayuda")
                .setMessage("Requisitos\nCJD-9000P, convertidor RS485–USB y un equipo Linux junto al programador con CJD Control Panel.\n\n"
                        + "Conexión\nUsa la misma Wi‑Fi o una conexión privada al equipo Linux. En Ajustes de notificaciones, "
                        + "escribe la dirección del panel y su contraseña. La ruta /movil deja solo las tres pestañas en la cabecera.\n\n"
                        + "Avisos y archivos\nElige los avisos que quieras recibir y concede el permiso de notificaciones. "
                        + "La app necesita llegar al panel. Puedes importar y exportar CSV con el selector de archivos de Android.\n\n"
                        + "Actualización\nAbre Acerca de y pulsa Buscar actualización.")
                .setPositiveButton("Cerrar", null).show();
    }

    private void showUseNotice(boolean firstOpen) {
        AlertDialog.Builder dialog = new AlertDialog.Builder(this)
                .setTitle(firstOpen ? "Uso y limitaciones" : "Acerca de CJD Control Panel")
                .setMessage(firstOpen ? USE_NOTICE : "Versión " + AppUpdates.installed(this).versionName + "\n\n" + USE_NOTICE)
                .setCancelable(!firstOpen)
                .setPositiveButton(firstOpen ? "Continuar" : "Cerrar", (window, which) -> {
                    if (firstOpen) {
                        settings.prefs.edit().putBoolean(NOTICE_SEEN, true).apply();
                        openConfiguredPanel(true);
                    }
                });
        if (!firstOpen) dialog.setNeutralButton("Buscar actualización", (window, button) -> checkForUpdate());
        dialog.show();
    }

    private void checkForUpdate() {
        if (updateBusy) return;
        updateBusy = true;
        showStatus("Buscando actualizaciones en GitHub…");
        new Thread(() -> {
            try {
                AppUpdates.Release release = AppUpdates.check();
                runOnUiThread(() -> {
                    updateBusy = false;
                    if (isFinishing() || isDestroyed()) return;
                    if (release.code <= AppUpdates.installed(this).versionCode) {
                        showStatus("Tienes la última versión publicada.");
                    } else {
                        new AlertDialog.Builder(this).setTitle("Versión " + release.version + " disponible")
                                .setMessage("Descarga la actualización desde GitHub y confirma la instalación en Android.")
                                .setNegativeButton("Cancelar", null)
                                .setPositiveButton("Descargar", (dialog, button) -> downloadUpdate(release)).show();
                    }
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    updateBusy = false;
                    if (!isDestroyed()) showStatus("No se pudo consultar GitHub.");
                });
            }
        }, "cjd-update-check").start();
    }

    private void downloadUpdate(AppUpdates.Release release) {
        if (updateBusy) return;
        updateBusy = true;
        showStatus("Descargando actualización…");
        new Thread(() -> {
            try {
                AppUpdates.download(this, release);
                runOnUiThread(() -> {
                    updateBusy = false;
                    if (!isFinishing() && !isDestroyed()) installUpdate();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    updateBusy = false;
                    if (!isDestroyed()) showStatus("No se pudo descargar o verificar la actualización.");
                });
            }
        }, "cjd-update-download").start();
    }

    private void installUpdate() {
        if (!getPackageManager().canRequestPackageInstalls()) {
            new AlertDialog.Builder(this).setTitle("Permiso de instalación")
                    .setMessage("Para continuar, permite que CJD Control Panel solicite la instalación de la actualización.")
                    .setNegativeButton("Cancelar", null)
                    .setPositiveButton("Abrir ajustes", (dialog, button) -> {
                        Intent settings = new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:" + getPackageName()));
                        try {
                            startActivityForResult(settings, UPDATE_PERMISSION_REQUEST);
                        } catch (android.content.ActivityNotFoundException error) {
                            showStatus("Android no permite cambiar este permiso desde la app.");
                        }
                    }).show();
            return;
        }
        Uri content = Uri.parse("content://" + getPackageName() + ".updates" + UpdateFileProvider.PATH);
        Intent install = new Intent(Intent.ACTION_VIEW).setDataAndType(content, UpdateFileProvider.MIME)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivity(install);
        } catch (android.content.ActivityNotFoundException error) {
            showStatus("Android no tiene disponible el instalador de aplicaciones.");
        }
    }

    @Override public void onResume() {
        super.onResume();
        layout.post(indicators);
    }

    @Override public void onPause() {
        layout.removeCallbacks(indicators);
        super.onPause();
    }

    private void showStatus(CharSequence message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    private void refreshIndicators() {
        MonitorService.Connections current = MonitorService.connections;
        if (current == lastConnections) return;
        lastConnections = current;
        drawLink(panelIndicator, current.panel, R.drawable.ic_wifi_on, R.drawable.ic_wifi_off, current.detail);
        String modbus = "Modbus " + (current.modbus == MonitorService.Link.CONFIRMED ? "conectado"
                : current.modbus == MonitorService.Link.LOST ? "desconectado" : "sin confirmar");
        drawLink(modbusIndicator, current.modbus, R.drawable.ic_modbus_on, R.drawable.ic_modbus_off, modbus);
    }

    private void drawLink(ImageButton view, MonitorService.Link state, int on, int off, String description) {
        view.setImageResource(state == MonitorService.Link.LOST ? off : on);
        view.setColorFilter(state == MonitorService.Link.CONFIRMED ? 0xff29bc6c
                : state == MonitorService.Link.LOST ? 0xfff17470 : 0xffa0aaa5);
        view.setContentDescription(description);
        view.setTooltipText(description);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private RippleDrawable ripple(int background) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(background);
        shape.setCornerRadius(dp(9));
        return new RippleDrawable(ColorStateList.valueOf(0x4029bc6c), shape, null);
    }

    private ImageButton icon(int drawable, String label, Runnable action) {
        ImageButton button = new ImageButton(this);
        button.setImageResource(drawable);
        button.setContentDescription(label);
        button.setTooltipText(label);
        button.setBackground(ripple(Color.TRANSPARENT));
        button.setOnClickListener(view -> action.run());
        return button;
    }

    private void enableMonitoring() {
        if (MonitorService.running) return;
        if (Build.VERSION.SDK_INT >= 33 && !settings.prefs.getBoolean("notifications_requested", false) &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            settings.prefs.edit().putBoolean("notifications_requested", true).apply();
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATIONS_REQUEST);
            return;
        }
        startMonitoring();
    }

    private void startMonitoring() {
        startForegroundService(new Intent(this, MonitorService.class));
    }

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == NOTIFICATIONS_REQUEST && settings.configured() && !MonitorService.running) {
            startMonitoring();
        }
    }

    private void loadPanel() {
        if (!settings.configured()) {
            editSettings();
            return;
        }
        if (pendingCsv != null) {
            pendingCsv.onReceiveValue(null);
            pendingCsv = null;
        }
        if (page != null) {
            layout.removeView(page);
            page.destroy();
        }
        final String address = settings.url();
        final String root = PanelSettings.serverUrl(address);
        String savedPassword;
        try {
            savedPassword = settings.password();
        } catch (Exception error) {
            savedPassword = "";
            Toast.makeText(this, "Vuelve a guardar la contraseña en Ajustes de notificaciones.", Toast.LENGTH_LONG).show();
        }
        final String password = savedPassword;
        page = new WebView(this);
        page.getSettings().setJavaScriptEnabled(true);
        page.getSettings().setDomStorageEnabled(true);
        page.getSettings().setAllowFileAccess(false);
        page.getSettings().setAllowContentAccess(false);
        page.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                                        FileChooserParams params) {
                if (pendingCsv != null) {
                    callback.onReceiveValue(null);
                    return true;
                }
                pendingCsv = callback;
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                        .addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                try {
                    startActivityForResult(picker, CSV_PICK_REQUEST);
                } catch (android.content.ActivityNotFoundException error) {
                    pendingCsv = null;
                    callback.onReceiveValue(null);
                    showStatus("Android no tiene disponible el selector de archivos.");
                }
                return true;
            }
        });
        page.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!sameOrigin(Uri.parse(root), url)) return true;
                if (request.isForMainFrame() && "GET".equals(request.getMethod())) {
                    String filename = exportFilename(url.getPath());
                    if (filename != null) {
                        chooseExportDestination(url, filename);
                        return true;
                    }
                }
                return false;
            }

            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (sameOrigin(Uri.parse(root), url) && "/app.js".equals(url.getPath())
                        && "GET".equals(request.getMethod())) {
                    return loadPanelScript(root, password);
                }
                return null;
            }

            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    Toast.makeText(PanelActivity.this, "Panel inaccesible. Revisa la URL y la conexión.", Toast.LENGTH_LONG).show();
                }
            }
        });
        layout.addView(page, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        page.loadUrl(address);
    }

    private static boolean sameOrigin(Uri first, Uri second) {
        return first.getScheme() != null && first.getScheme().equalsIgnoreCase(second.getScheme())
                && first.getHost() != null && first.getHost().equalsIgnoreCase(second.getHost())
                && port(first) == port(second);
    }

    private static int port(Uri uri) {
        if (uri.getPort() != -1) return uri.getPort();
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }

    private static WebResourceResponse loadPanelScript(String root, String password) {
        HttpURLConnection connection = null;
        try {
            connection = PanelHttp.open(root + "app.js");
            if (connection.getResponseCode() != 200) throw new IllegalStateException("No se pudo cargar app.js");
            String encoded = Base64.encodeToString(password.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
            // Seed the same session entry that the panel's login form uses, before app.js reads it.
            String script = "'use strict';\nsessionStorage.setItem('cjd-token',new TextDecoder().decode(Uint8Array.from(atob('"
                    + encoded + "'),c=>c.charCodeAt(0))));\n"
                    + new String(PanelHttp.read(connection, 2_000_000), StandardCharsets.UTF_8)
                    + "\nif (typeof download === 'function') download = path => { location.assign('/api/' + path); };\n";
            return new WebResourceResponse("application/javascript", "UTF-8", 200, "OK",
                    Collections.singletonMap("Cache-Control", "no-store"),
                    new ByteArrayInputStream(script.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception error) {
            return new WebResourceResponse("text/plain", "UTF-8", 503, "Unavailable", Collections.emptyMap(),
                    new ByteArrayInputStream(new byte[0]));
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    static String exportFilename(String path) {
        if ("/api/backup".equals(path)) return "cjd-backup.sqlite3";
        if (path == null) return null;
        java.util.regex.Matcher csv = CSV_EXPORT.matcher(path);
        if (!csv.matches()) return null;
        return "firings".equals(csv.group(1)) ? "coccion-" + csv.group(2) + ".csv" : "curva.csv";
    }

    private void chooseExportDestination(Uri url, String filename) {
        if (pendingExport != null) return;
        pendingExport = url.toString();
        Intent picker = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(filename.endsWith(".csv") ? "text/csv" : "application/octet-stream")
                .putExtra(Intent.EXTRA_TITLE, filename);
        try {
            startActivityForResult(picker, EXPORT_REQUEST);
        } catch (android.content.ActivityNotFoundException error) {
            pendingExport = null;
            showStatus("Android no tiene disponible el selector de archivos.");
        }
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        state.putString("pendingExport", pendingExport);
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == UPDATE_PERMISSION_REQUEST) {
            if (getPackageManager().canRequestPackageInstalls() && AppUpdates.apk(this).isFile()) installUpdate();
            return;
        }
        if (request == CSV_PICK_REQUEST) {
            ValueCallback<Uri[]> callback = pendingCsv;
            pendingCsv = null;
            if (callback != null) callback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            return;
        }
        if (request != EXPORT_REQUEST) return;
        String address = pendingExport;
        pendingExport = null;
        if (result != RESULT_OK || data == null || data.getData() == null || address == null) return;
        Uri origin = Uri.parse(address);
        if (!sameOrigin(Uri.parse(settings.serverUrl()), origin) || exportFilename(origin.getPath()) == null) {
            showStatus("La dirección del panel ha cambiado. Vuelve a iniciar la exportación.");
            return;
        }
        Uri destination = data.getData();
        new Thread(() -> saveExport(address, destination), "cjd-export").start();
    }

    private void saveExport(String address, Uri destination) {
        HttpURLConnection connection = null;
        try {
            connection = PanelHttp.open(address);
            PanelHttp.authenticate(connection, settings.password());
            connection.setReadTimeout(20_000);
            int code = connection.getResponseCode();
            if (code != 200) throw new IOException(code == 401 ? "Revisa la contraseña del panel." : "Error HTTP " + code);
            try (InputStream source = connection.getInputStream();
                 OutputStream file = getContentResolver().openOutputStream(destination, "wt")) {
                if (file == null) throw new IOException("Android no pudo abrir el archivo.");
                byte[] buffer = new byte[8192];
                int bytes;
                while ((bytes = source.read(buffer)) != -1) file.write(buffer, 0, bytes);
            }
            runOnUiThread(() -> showStatus("Archivo guardado."));
        } catch (Exception error) {
            String detail = error.getMessage();
            runOnUiThread(() -> showStatus("No se pudo guardar la exportación."
                    + (detail == null ? "" : " " + detail)));
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void editSettings() {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        int padding = Math.round(20 * getResources().getDisplayMetrics().density);
        form.setPadding(padding, 0, padding, padding);
        EditText url = field(form, "Dirección del panel", settings.url(), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        EditText password = field(form, "Contraseña del panel", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        try {
            password.setText(settings.password());
        } catch (Exception ignored) {
            password.setHint("Introduce la contraseña de nuevo");
        }
        int signed = InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL
                | InputType.TYPE_NUMBER_FLAG_SIGNED;
        EditText max = field(form, "Temperatura máxima (°C)", formatTemperature(settings.max()), signed);
        EditText deviation = field(form, "Diferencia máxima PV/SV (°C)", formatTemperature(settings.deviation()), signed);
        TextView note = new TextView(this);
        note.setText("La desviación se comprueba durante tres lecturas en subidas o mesetas.");
        form.addView(note);
        TextView alertTitle = new TextView(this);
        alertTitle.setText("Avisos con sonido y vibración");
        alertTitle.setPadding(0, dp(16), 0, 0);
        form.addView(alertTitle);
        EnumMap<PanelSettings.Alert, CheckBox> checkboxes = new EnumMap<>(PanelSettings.Alert.class);
        for (PanelSettings.Alert alert : PanelSettings.Alert.values()) {
            CheckBox checkbox = new CheckBox(this);
            checkbox.setText(alert.label);
            checkbox.setChecked(settings.enabled(alert));
            checkbox.setButtonTintList(ColorStateList.valueOf(0xff29bc6c));
            form.addView(checkbox);
            checkboxes.put(alert, checkbox);
        }
        TextView validation = new TextView(this);
        validation.setTextColor(0xffe6a23c);
        form.addView(validation);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(form);

        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Ajustes de notificaciones").setView(scroll)
                .setNegativeButton("Cancelar", null).setPositiveButton("Guardar", null).create();
        dialog.show();
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            try {
                String address = PanelSettings.normalize(url.getText().toString());
                double maximum = value(max);
                double difference = value(deviation);
                String previousPassword;
                try {
                    previousPassword = settings.password();
                } catch (Exception ignored) {
                    previousPassword = null;
                }
                boolean reconnect = !address.equals(settings.url()) || !password.getText().toString().equals(previousPassword);
                EnumMap<PanelSettings.Alert, Boolean> alerts = new EnumMap<>(PanelSettings.Alert.class);
                checkboxes.forEach((alert, checkbox) -> alerts.put(alert, checkbox.isChecked()));
                settings.save(address, password.getText().toString(), maximum, difference, alerts);
                if (reconnect || page == null) loadPanel();
                if (!MonitorService.running) enableMonitoring();
                dialog.dismiss();
            } catch (Exception error) {
                validation.setText(error instanceof IllegalArgumentException && !(error instanceof NumberFormatException)
                        ? error.getMessage() : "Revisa la dirección y los dos umbrales de temperatura.");
            }
        });
    }

    private static String formatTemperature(double value) {
        return java.math.BigDecimal.valueOf(value).stripTrailingZeros().toPlainString().replace('.', ',');
    }

    private static double value(EditText input) {
        double number = Double.parseDouble(input.getText().toString().trim().replace(',', '.'));
        if (!Double.isFinite(number)) throw new NumberFormatException();
        return number;
    }

    private EditText field(LinearLayout layout, String label, String value, int inputType) {
        TextView title = new TextView(this);
        title.setText(label);
        EditText input = new EditText(this);
        input.setId(android.view.View.generateViewId());
        title.setLabelFor(input.getId());
        input.setInputType(inputType);
        input.setSingleLine(true);
        if ((inputType & InputType.TYPE_MASK_CLASS) == InputType.TYPE_CLASS_NUMBER) {
            input.setKeyListener(android.text.method.DigitsKeyListener.getInstance("0123456789.,-"));
            input.setRawInputType(inputType);
        }
        input.setText(value);
        title.setIncludeFontPadding(false);
        LinearLayout.LayoutParams labelParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        labelParams.topMargin = dp(16);
        layout.addView(title, labelParams);
        input.setPadding(input.getPaddingLeft(), dp(2), input.getPaddingRight(), input.getPaddingBottom());
        layout.addView(input);
        return input;
    }

    @Override public void onDestroy() {
        if (pendingCsv != null) {
            pendingCsv.onReceiveValue(null);
            pendingCsv = null;
        }
        if (page != null) {
            layout.removeView(page);
            page.destroy();
        }
        super.onDestroy();
    }
}
