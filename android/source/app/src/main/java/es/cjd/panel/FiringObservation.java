package es.cjd.panel;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.OffsetDateTime;
import java.time.Instant;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class FiringObservation {
    private static final Pattern SCHEDULE = Pattern.compile("Inicio programado para memoria ([1-4]) \\(([^)]+)\\)\\.");

    static JSONArray curve(JSONObject state) {
        JSONObject memories = state.optJSONObject("memories");
        return memories == null ? null : memories.optJSONArray(state.optString("memory"));
    }

    static boolean checksDeviation(JSONObject state) {
        if (state.optInt("state") != 1) return false;
        JSONArray curve = curve(state);
        int step = state.optInt("step");
        if (curve == null || step < 1 || step >= curve.length()) return false;
        JSONObject from = curve.optJSONObject(step - 1);
        JSONObject to = curve.optJSONObject(step);
        if (from == null || to == null || from.optInt("minutes") <= 0) return false;
        double start = from.optDouble("temperature");
        double end = to.optDouble("temperature");
        return Double.isFinite(start) && Double.isFinite(end) && end >= start;
    }

    static String active(JSONObject state) {
        return state.isNull("active_firing") ? "" : state.optString("active_firing");
    }

    static boolean finished(JSONObject previous, JSONObject current) {
        if (previous == null || previous.optInt("state", -1) != 1 || active(previous).isEmpty()
                || current.optInt("state", -1) != 0 || !active(current).isEmpty()) return false;
        int memory = previous.optInt("memory", -1);
        return memory > 0 && current.optInt("completed_memory", -1) == memory
                && current.optInt("memory", -1) == memory
                && previous.optInt("mode_generation") == current.optInt("mode_generation");
    }

    static boolean scheduledRun(JSONArray events, String firing, int memory) {
        boolean runConfirmed = false;
        Instant startedAt = null;
        for (int i = 0; i < events.length(); i++) {
            JSONObject event = events.optJSONObject(i);
            if (event == null) continue;
            String kind = event.optString("kind");
            String eventFiring = event.optString("firing_id");
            String message = event.optString("message");
            if (startedAt == null) {
                if (firing.equals(eventFiring) && "command".equals(kind) && message.startsWith("RUN ")) {
                    runConfirmed = true;
                }
                if (firing.equals(eventFiring) && "started".equals(kind)) {
                    if (!runConfirmed) return false;
                    startedAt = instant(event.optString("timestamp"));
                    if (startedAt == null) return false;
                }
                continue;
            }
            if ("schedule_cancelled".equals(kind) || "schedule_error".equals(kind) || "started".equals(kind)) return false;
            if ("scheduled_start".equals(kind)) {
                Matcher match = SCHEDULE.matcher(message);
                if (!match.matches() || Integer.parseInt(match.group(1)) != memory) return false;
                Instant due = instant(match.group(2));
                return due != null && !startedAt.isBefore(due) && !startedAt.isAfter(due.plusSeconds(30));
            }
        }
        return false;
    }

    private static Instant instant(String value) {
        try {
            return OffsetDateTime.parse(value).toInstant();
        } catch (java.time.format.DateTimeParseException error) {
            return null;
        }
    }
}
