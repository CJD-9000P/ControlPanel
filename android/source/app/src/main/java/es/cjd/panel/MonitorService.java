package es.cjd.panel;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;

import org.json.JSONArray;
import org.json.JSONObject;

import static es.cjd.panel.PanelSettings.Alert.*;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public final class MonitorService extends Service {
    static final String STOP = "es.cjd.panel.STOP";
    private static final String MONITOR = "monitor";
    private static final String CONNECTION = "connection";
    private static final String TEMPERATURE = "temperature";
    private static final int ONGOING_ID = 10;
    private static final int OUTAGE_ID = 20;
    private static final String WATCHING = "Vigilancia de avisos en segundo plano";
    enum Link { CONFIRMED, LOST, UNKNOWN }
    static final class Connections {
        final Link panel, modbus;
        final String detail;

        Connections(Link panel, Link modbus, String detail) {
            this.panel = panel;
            this.modbus = modbus;
            this.detail = detail;
        }
    }

    static final Connections UNCONFIRMED = new Connections(Link.UNKNOWN, Link.UNKNOWN, "Conexión sin confirmar");
    static volatile Connections connections = UNCONFIRMED;
    static volatile boolean running;
    private String lastUrl, lastPassword;

    private final PanelOutage outage = new PanelOutage();
    private final Alarm modbus = new Alarm(21, CONNECTION, "Comunicación Modbus perdida", "Comunicación Modbus recuperada", 1);
    private final Alarm mqtt = new Alarm(22, CONNECTION, "Comunicación MQTT perdida", "Comunicación MQTT recuperada", 2);
    private final Alarm high = new Alarm(23, TEMPERATURE, "Temperatura alta", null, 1);
    private final Alarm difference = new Alarm(24, TEMPERATURE, "Desviación entre PV y SV", null, 3);
    private ScheduledExecutorService executor;
    private PowerManager.WakeLock wakeLock;
    private String lastStatus;
    private JSONObject previousReading;
    private String pendingStart = "";
    private int startChecks;
    private boolean hasReference;
    private volatile boolean monitoring;

    static void channels(NotificationManager manager) {
        manager.createNotificationChannel(new NotificationChannel(MONITOR, "Vigilancia del panel",
                NotificationManager.IMPORTANCE_LOW));
        NotificationChannel connection = new NotificationChannel(CONNECTION, "Alertas de comunicación",
                NotificationManager.IMPORTANCE_HIGH);
        connection.enableVibration(true);
        manager.createNotificationChannel(connection);
        NotificationChannel temperature = new NotificationChannel(TEMPERATURE, "Alertas de temperatura",
                NotificationManager.IMPORTANCE_HIGH);
        temperature.enableVibration(true);
        manager.createNotificationChannel(temperature);
    }

    private PendingIntent openApp() {
        return PendingIntent.getActivity(this, 0, new Intent(this, PanelActivity.class),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification ongoing(String message) {
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, MonitorService.class).setAction(STOP),
                PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, MONITOR).setSmallIcon(R.drawable.ic_cjd_notification)
                .setContentTitle("Vigilancia CJD activa").setContentText(message).setOngoing(true)
                .setContentIntent(openApp()).addAction(new Notification.Action.Builder(null, "Detener", stop).build())
                .build();
    }

    private void status(String message) {
        if (monitoring && !message.equals(lastStatus)) {
            lastStatus = message;
            manager().notify(ONGOING_ID, ongoing(message));
        }
    }

    private NotificationManager manager() { return getSystemService(NotificationManager.class); }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (executor != null) return START_NOT_STICKY;
        channels(manager());
        lastStatus = WATCHING;
        startForeground(ONGOING_ID, ongoing(lastStatus));
        monitoring = true;
        running = true;
        wakeLock = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "CJD:Monitor");
        wakeLock.acquire();
        PanelSettings settings = new PanelSettings(this);
        executor = Executors.newSingleThreadScheduledExecutor();
        executor.scheduleWithFixedDelay(() -> poll(settings), 0, 3, TimeUnit.SECONDS);
        return START_NOT_STICKY;
    }

    private void poll(PanelSettings settings) {
        if (!monitoring) return;
        HttpURLConnection connection = null;
        boolean reached = false;
        long attemptStarted = SystemClock.elapsedRealtime();
        try {
            String password = settings.password();
            String url = settings.serverUrl();
            if (!url.equals(lastUrl) || !password.equals(lastPassword)) {
                lastUrl = url;
                lastPassword = password;
                clearOutage();
                modbus.forget(); mqtt.forget(); high.forget(); difference.forget();
                hasReference = false;
                previousReading = null;
                pendingStart = "";
                connections = UNCONFIRMED;
            }
            connection = PanelHttp.open(url + "api/state?view=monitor");
            PanelHttp.authenticate(connection, password);
            int code = connection.getResponseCode();
            reached = code > 0;
            if (reached) clearOutage();
            if (code == 401 || code == 403) {
                connections = new Connections(Link.CONFIRMED, Link.UNKNOWN, "El PC responde. Revisa la contraseña.");
                status(WATCHING);
                modbus.pause(); mqtt.pause(); high.pause(); difference.pause();
                return;
            }
            if (code != 200) throw new IOException("HTTP " + code);
            JSONObject state = new JSONObject(new String(PanelHttp.read(connection, 2_000_000), StandardCharsets.UTF_8));
            apply(state, settings);
        } catch (Exception error) {
            if (!monitoring) return;
            connections = reached
                    ? new Connections(Link.CONFIRMED, Link.UNKNOWN, "El PC responde, pero el panel no devuelve un estado válido")
                    : new Connections(Link.LOST, Link.UNKNOWN, "Panel inaccesible");
            boolean eligible = settings.enabled(PANEL) && previousReading != null && previousReading.optInt("state") == 1
                    && !FiringObservation.active(previousReading).isEmpty();
            status(eligible ? "Comprobando la conexión con el panel…" : WATCHING);
            if (!eligible) clearOutage();
            if (!reached && outage.failed(eligible, attemptStarted, SystemClock.elapsedRealtime())) {
                post(OUTAGE_ID, CONNECTION, "El móvil no puede conectar con el panel",
                        "La última lectura confirmada indicaba que la cocción estaba en marcha.");
            }
            modbus.pause(); mqtt.pause(); high.pause(); difference.pause();
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void clearOutage() {
        if (outage.reset()) manager().cancel(OUTAGE_ID);
    }

    private JSONArray events(PanelSettings settings) throws Exception {
        HttpURLConnection connection = PanelHttp.open(settings.serverUrl() + "api/events");
        try {
            PanelHttp.authenticate(connection, settings.password());
            if (connection.getResponseCode() != 200) throw new IOException("No se pudo leer el registro de eventos");
            return new JSONArray(new String(PanelHttp.read(connection, 200_000), StandardCharsets.UTF_8));
        } finally {
            connection.disconnect();
        }
    }

    private void firingAlerts(JSONObject state, PanelSettings settings, String device) {
        String firing = FiringObservation.active(state);
        if (!firing.equals(pendingStart) || !settings.enabled(SCHEDULED)) pendingStart = "";
        if (previousReading != null) {
            if (settings.enabled(SCHEDULED) && state.optInt("state") == 1 && !firing.isEmpty()
                    && !firing.equals(FiringObservation.active(previousReading))) {
                pendingStart = firing;
                startChecks = 0;
            }
            if (settings.enabled(FINISH) && FiringObservation.finished(previousReading, state)) {
                post(26, CONNECTION, "Cocción finalizada", device + " · Último tramo completado");
            }
        }
        previousReading = state;
        if (pendingStart.isEmpty() || state.optInt("state") != 1) return;
        try {
            if (FiringObservation.scheduledRun(events(settings), pendingStart, state.optInt("memory"))) {
                post(25, CONNECTION, "Cocción programada iniciada", device + " · Memoria " + state.optInt("memory"));
                pendingStart = "";
            } else if (++startChecks >= 3) {
                pendingStart = "";
            }
        } catch (Exception error) {
            if (++startChecks >= 3) pendingStart = "";
        }
    }

    private void apply(JSONObject state, PanelSettings settings) throws Exception {
        String link = state.getString("communication_status");
        boolean online = state.getBoolean("online");
        connections = new Connections(Link.CONFIRMED,
                online ? Link.CONFIRMED : "connecting".equals(link) ? Link.UNKNOWN : Link.LOST,
                "Panel accesible");
        boolean active = !FiringObservation.active(state).isEmpty() && (state.optInt("state") == 1 || state.optInt("state") == 2);
        boolean notify = hasReference && active;
        hasReference = true;
        boolean physical = "physical".equals(state.optString("mode"));
        String device = physical ? "Programador físico" : "Simulador";
        if ("connecting".equals(link)) modbus.pause();
        else modbus.update(settings.enabled(MODBUS), notify, !online, device + " · " + link);
        JSONObject broker = state.optJSONObject("mqtt");
        if (broker != null && broker.optBoolean("enabled")) {
            mqtt.update(settings.enabled(MQTT), notify, !(broker.optBoolean("connected") && broker.optBoolean("subscribed")),
                    "Estado de la integración MQTT del servidor.");
        } else {
            mqtt.forget();
        }

        if (online) firingAlerts(state, settings, device);
        else pendingStart = "";
        double pv = state.optDouble("pv");
        double sv = state.optDouble("sv");
        if (!online || !Double.isFinite(pv) || !Double.isFinite(sv)) {
            status(active ? device + " · Sin lectura confirmada durante la cocción" : WATCHING);
            high.pause(); difference.pause();
            return;
        }
        String values = device + " · PV " + number(pv) + " °C · SV " + number(sv) + " °C";
        status(active ? values : WATCHING);
        double max = settings.max();
        double deviation = settings.deviation();
        high.update(settings.enabled(HIGH) && max > 0, notify, active && pv > max, values + " · Límite " + number(max) + " °C");
        difference.update(settings.enabled(DEVIATION) && deviation > 0, notify,
                active && FiringObservation.checksDeviation(state) && Math.abs(pv - sv) > deviation, values + " · Límite de diferencia " + number(deviation) + " °C");
    }

    private String number(double value) {
        return new java.text.DecimalFormat("0.##").format(value);
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onDestroy() {
        monitoring = false;
        connections = UNCONFIRMED;
        running = false;
        if (executor != null) executor.shutdownNow();
        manager().cancel(OUTAGE_ID);
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    private void post(int id, String channel, String title, String detail) {
        if (!monitoring) return;
        manager().notify(id, new Notification.Builder(this, channel)
                .setSmallIcon(R.drawable.ic_cjd_notification).setContentTitle(title)
                .setContentText(detail).setStyle(new Notification.BigTextStyle().bigText(detail))
                .setContentIntent(openApp()).setAutoCancel(true).build());
    }

    private final class Alarm {
        private final int id;
        private final String channel, failure, recovery;
        private final int required;
        private int failures;
        private boolean active;

        Alarm(int id, String channel, String failure, String recovery, int required) {
            this.id = id;
            this.channel = channel;
            this.failure = failure;
            this.recovery = recovery;
            this.required = required;
        }

        void pause() { failures = 0; }

        void forget() {
            pause();
            active = false;
        }

        void update(boolean enabled, boolean notify, boolean failed, String detail) {
            if (!monitoring) return;
            if (!enabled) {
                forget();
                return;
            }
            if (!notify) {
                pause();
                active = failed;
                return;
            }
            if (!failed) {
                pause();
                if (active && recovery != null) post(id, channel, recovery, detail);
                active = false;
            } else if (!active && ++failures >= required) {
                active = true;
                post(id, channel, failure, detail);
            }
        }

    }
}
