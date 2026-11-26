package com.geogis6.mobile;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.GnssStatus;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.location.OnNmeaMessageListener;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Locale;

@CapacitorPlugin(name = "GeoGisGnss")
public class GeoGisGnssPlugin extends Plugin {
    private static final long MIN_EMIT_INTERVAL_MS = 800L;

    private LocationManager locationManager;
    private Object gnssCallbackObj;
    private Object nmeaListenerObj;
    private LocationListener gpsKeepAliveListener;
    private boolean isListening = false;
    private long lastEmitMs = 0L;

    private Double lastPdop = null;
    private Double lastHdop = null;
    private Double lastVdop = null;
    private JSObject lastSnapshot = null;

    @PluginMethod
    public void start(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) {
            call.reject("Contexto Android no disponible");
            return;
        }

        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            JSObject denied = new JSObject();
            denied.put("started", false);
            denied.put("permissionDenied", true);
            call.resolve(denied);
            return;
        }

        startInternal(ctx);

        JSObject res = new JSObject();
        res.put("started", isListening);
        res.put("permissionDenied", false);
        call.resolve(res);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopInternal();
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        if (lastSnapshot != null) {
            call.resolve(lastSnapshot);
            return;
        }
        JSObject empty = new JSObject();
        empty.put("satellites", new JSArray());
        empty.put("usedCount", 0);
        empty.put("visibleCount", 0);
        empty.put("timestamp", System.currentTimeMillis());
        call.resolve(empty);
    }

    @Override
    protected void handleOnDestroy() {
        stopInternal();
        super.handleOnDestroy();
    }

    private synchronized void startInternal(Context ctx) {
        if (isListening) return;

        Object service = ctx.getSystemService(Context.LOCATION_SERVICE);
        if (!(service instanceof LocationManager)) return;
        locationManager = (LocationManager) service;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            GnssStatus.Callback cb = new GnssStatus.Callback() {
                @Override
                public void onSatelliteStatusChanged(GnssStatus status) {
                    long now = System.currentTimeMillis();
                    if (now - lastEmitMs < MIN_EMIT_INTERVAL_MS && lastSnapshot != null) {
                        return;
                    }
                    lastEmitMs = now;
                    JSObject payload = buildPayloadFromStatus(status, now);
                    lastSnapshot = payload;
                    notifyListeners("gnssStatus", payload);
                }
            };
            gnssCallbackObj = cb;

            OnNmeaMessageListener nmeaListener = (message, timestamp) -> parseNmeaSentence(message);
            nmeaListenerObj = nmeaListener;

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    locationManager.registerGnssStatusCallback(
                        ContextCompat.getMainExecutor(ctx),
                        cb
                    );
                    locationManager.addNmeaListener(
                        ContextCompat.getMainExecutor(ctx),
                        nmeaListener
                    );
                } else {
                    Handler mainHandler = new Handler(Looper.getMainLooper());
                    locationManager.registerGnssStatusCallback(cb, mainHandler);
                    locationManager.addNmeaListener(nmeaListener, mainHandler);
                }
            } catch (SecurityException | IllegalArgumentException ignored) {
            }
        }

        gpsKeepAliveListener = new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {}

            @Override
            public void onStatusChanged(String provider, int status, Bundle extras) {}

            @Override
            public void onProviderEnabled(String provider) {}

            @Override
            public void onProviderDisabled(String provider) {}
        };

        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    1000L,
                    0f,
                    gpsKeepAliveListener,
                    Looper.getMainLooper()
                );
            }
        } catch (SecurityException | IllegalArgumentException ignored) {
        }

        isListening = true;
    }

    private synchronized void stopInternal() {
        if (!isListening || locationManager == null) {
            isListening = false;
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            if (gnssCallbackObj instanceof GnssStatus.Callback) {
                try {
                    locationManager.unregisterGnssStatusCallback((GnssStatus.Callback) gnssCallbackObj);
                } catch (Exception ignored) {
                }
            }
            if (nmeaListenerObj instanceof OnNmeaMessageListener) {
                try {
                    locationManager.removeNmeaListener((OnNmeaMessageListener) nmeaListenerObj);
                } catch (Exception ignored) {
                }
            }
        }

        if (gpsKeepAliveListener != null) {
            try {
                locationManager.removeUpdates(gpsKeepAliveListener);
            } catch (Exception ignored) {
            }
        }

        gnssCallbackObj = null;
        nmeaListenerObj = null;
        gpsKeepAliveListener = null;
        isListening = false;
    }

    private void parseNmeaSentence(String raw) {
        if (raw == null || raw.isEmpty()) return;
        String sentence = raw.trim();
        if (!sentence.startsWith("$")) return;

        int starIdx = sentence.indexOf('*');
        if (starIdx > 0) {
            sentence = sentence.substring(0, starIdx);
        }

        String[] parts = sentence.split(",", -1);
        if (parts.length < 18) return;

        String header = parts[0].toUpperCase(Locale.US);
        if (header.endsWith("GSA")) {
            Double pd = tryParsePositiveDouble(parts[15]);
            Double hd = tryParsePositiveDouble(parts[16]);
            Double vd = tryParsePositiveDouble(parts[17]);
            if (pd != null) lastPdop = pd;
            if (hd != null) lastHdop = hd;
            if (vd != null) lastVdop = vd;
        }
    }

    private static Double tryParsePositiveDouble(String raw) {
        if (raw == null) return null;
        String s = raw.trim();
        if (s.isEmpty()) return null;
        try {
            double val = Double.parseDouble(s);
            return Double.isFinite(val) && val > 0 ? val : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private JSObject buildPayloadFromStatus(GnssStatus status, long nowMs) {
        JSArray satArray = new JSArray();
        int total = 0;
        int used = 0;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && status != null) {
            total = status.getSatelliteCount();
            for (int i = 0; i < total; i++) {
                int cType = status.getConstellationType(i);
                int svid = status.getSvid(i);
                boolean inFix = status.usedInFix(i);
                if (inFix) used++;

                String prefix;
                String constellation;
                switch (cType) {
                    case GnssStatus.CONSTELLATION_GPS:
                        prefix = "G";
                        constellation = "GPS";
                        break;
                    case GnssStatus.CONSTELLATION_GLONASS:
                        prefix = "R";
                        constellation = "GLONASS";
                        break;
                    case GnssStatus.CONSTELLATION_GALILEO:
                        prefix = "E";
                        constellation = "GALILEO";
                        break;
                    case GnssStatus.CONSTELLATION_BEIDOU:
                        prefix = "C";
                        constellation = "BEIDOU";
                        break;
                    case GnssStatus.CONSTELLATION_QZSS:
                        prefix = "J";
                        constellation = "QZSS";
                        break;
                    case GnssStatus.CONSTELLATION_SBAS:
                        prefix = "S";
                        constellation = "SBAS";
                        break;
                    case 7:
                        prefix = "I";
                        constellation = "NAVIC";
                        break;
                    default:
                        prefix = "U";
                        constellation = "OTHER";
                        break;
                }

                JSObject item = new JSObject();
                item.put("prn", String.format(Locale.US, "%s%02d", prefix, svid));
                item.put("svid", svid);
                item.put("constellation", constellation);
                item.put("elevationDeg", Math.round(status.getElevationDegrees(i) * 10.0) / 10.0);
                item.put("azimuthDeg", Math.round(status.getAzimuthDegrees(i) * 10.0) / 10.0);
                item.put("cn0DbHz", Math.round(status.getCn0DbHz(i) * 10.0) / 10.0);
                item.put("usedInFix", inFix);
                item.put("hasEphemeris", status.hasEphemerisData(i));
                item.put("hasAlmanac", status.hasAlmanacData(i));
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && status.hasCarrierFrequencyHz(i)) {
                    double mhz = status.getCarrierFrequencyHz(i) / 1_000_000.0;
                    item.put("carrierFrequencyMhz", Math.round(mhz * 100.0) / 100.0);
                } else {
                    item.put("carrierFrequencyMhz", JSONObjectNull());
                }
                satArray.put(item);
            }
        }

        JSObject payload = new JSObject();
        payload.put("satellites", satArray);
        payload.put("usedCount", used);
        payload.put("visibleCount", total);
        payload.put("pdop", lastPdop);
        payload.put("hdop", lastHdop);
        payload.put("vdop", lastVdop);
        payload.put("timestamp", nowMs);
        return payload;
    }

    private static Object JSONObjectNull() {
        return org.json.JSONObject.NULL;
    }
}
