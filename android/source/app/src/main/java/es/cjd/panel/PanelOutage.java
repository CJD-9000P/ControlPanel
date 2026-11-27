package es.cjd.panel;

final class PanelOutage {
    private static final long DELAY_MILLIS = 120_000;
    private long firstFailure = -1;
    private boolean notified;

    boolean failed(boolean eligible, long attemptStarted, long now) {
        if (!eligible) {
            reset();
            return false;
        }
        if (firstFailure < 0) firstFailure = attemptStarted;
        if (notified || now - firstFailure < DELAY_MILLIS) return false;
        notified = true;
        return true;
    }

    boolean reset() {
        boolean hadNotification = notified;
        firstFailure = -1;
        notified = false;
        return hadNotification;
    }
}
