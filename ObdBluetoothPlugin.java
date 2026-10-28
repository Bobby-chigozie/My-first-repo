package com.aicardoctor.app;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Minimal Bluetooth Classic (SPP/RFCOMM) bridge for ELM327-style OBD-II adapters.
 * Only already-paired devices are used. It sends text commands and returns the reply text.
 * It never clears codes by itself; the JavaScript decides which commands to send.
 */
@CapacitorPlugin(
    name = "ObdBluetooth",
    permissions = {
        @Permission(alias = "bluetooth", strings = { "android.permission.BLUETOOTH_CONNECT" })
    }
)
public class ObdBluetoothPlugin extends Plugin {

    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private BluetoothSocket socket;
    private InputStream in;
    private OutputStream out;

    private boolean needsPermission() {
        return Build.VERSION.SDK_INT >= 31 && getPermissionState("bluetooth") != PermissionState.GRANTED;
    }

    private static final String DENIED =
        "Bluetooth permission was denied. In Android settings, allow 'Nearby devices' for AI Car Doctor.";

    // ---------- list paired devices ----------
    @PluginMethod
    public void listPaired(PluginCall call) {
        if (needsPermission()) {
            requestPermissionForAlias("bluetooth", call, "listPermCallback");
            return;
        }
        doList(call);
    }

    @PermissionCallback
    private void listPermCallback(PluginCall call) {
        if (needsPermission()) { call.reject(DENIED); return; }
        doList(call);
    }

    @SuppressLint("MissingPermission")
    private void doList(PluginCall call) {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) { call.reject("This device has no Bluetooth."); return; }
        if (!adapter.isEnabled()) { call.reject("Bluetooth is turned off. Turn it on and tap Refresh list."); return; }
        JSArray devices = new JSArray();
        Set<BluetoothDevice> bonded = adapter.getBondedDevices();
        if (bonded != null) {
            for (BluetoothDevice d : bonded) {
                JSObject o = new JSObject();
                o.put("name", d.getName() == null ? "" : d.getName());
                o.put("address", d.getAddress());
                devices.put(o);
            }
        }
        JSObject ret = new JSObject();
        ret.put("devices", devices);
        call.resolve(ret);
    }

    // ---------- connect ----------
    @PluginMethod
    public void connect(PluginCall call) {
        if (needsPermission()) {
            requestPermissionForAlias("bluetooth", call, "connectPermCallback");
            return;
        }
        doConnect(call);
    }

    @PermissionCallback
    private void connectPermCallback(PluginCall call) {
        if (needsPermission()) { call.reject(DENIED); return; }
        doConnect(call);
    }

    @SuppressLint("MissingPermission")
    private void doConnect(final PluginCall call) {
        final String address = call.getString("address");
        if (address == null || address.isEmpty()) { call.reject("No adapter address given."); return; }
        io.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    closeQuietly();
                    BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
                    if (adapter == null || !adapter.isEnabled()) { call.reject("Bluetooth is turned off."); return; }
                    adapter.cancelDiscovery();
                    BluetoothDevice device = adapter.getRemoteDevice(address);
                    BluetoothSocket s;
                    try {
                        s = device.createRfcommSocketToServiceRecord(SPP_UUID);
                        s.connect();
                    } catch (Exception first) {
                        // Common fallback for adapters that do not advertise the standard service record
                        s = (BluetoothSocket) device.getClass()
                            .getMethod("createRfcommSocket", new Class[] { int.class })
                            .invoke(device, Integer.valueOf(1));
                        s.connect();
                    }
                    socket = s;
                    in = s.getInputStream();
                    out = s.getOutputStream();
                    JSObject ret = new JSObject();
                    ret.put("connected", true);
                    call.resolve(ret);
                } catch (Exception e) {
                    closeQuietly();
                    call.reject("Bluetooth connection failed: " + e.getMessage());
                }
            }
        });
    }

    // ---------- send a command and read the reply (until the ELM '>' prompt or timeout) ----------
    @PluginMethod
    public void send(final PluginCall call) {
        final String command = call.getString("command");
        final int timeout = call.getInt("timeoutMs", 5000);
        if (command == null) { call.reject("No command given."); return; }
        io.execute(new Runnable() {
            @Override
            public void run() {
                if (socket == null || in == null || out == null) { call.reject("Not connected to an adapter."); return; }
                try {
                    // throw away anything left over from earlier
                    while (in.available() > 0) { in.read(); }
                    out.write((command + "\r").getBytes(StandardCharsets.US_ASCII));
                    out.flush();
                    StringBuilder sb = new StringBuilder();
                    long end = System.currentTimeMillis() + timeout;
                    byte[] buf = new byte[256];
                    while (System.currentTimeMillis() < end) {
                        int avail = in.available();
                        if (avail > 0) {
                            int n = in.read(buf, 0, Math.min(avail, buf.length));
                            if (n > 0) sb.append(new String(buf, 0, n, StandardCharsets.US_ASCII));
                            if (sb.toString().trim().endsWith(">")) break;
                        } else {
                            Thread.sleep(20);
                        }
                    }
                    JSObject ret = new JSObject();
                    ret.put("response", sb.toString());
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject("Lost connection to the adapter: " + e.getMessage());
                }
            }
        });
    }

    // ---------- disconnect ----------
    @PluginMethod
    public void disconnect(PluginCall call) {
        closeQuietly();
        call.resolve();
    }

    private void closeQuietly() {
        try { if (socket != null) socket.close(); } catch (Exception ignored) { }
        socket = null; in = null; out = null;
    }

    @Override
    protected void handleOnDestroy() {
        closeQuietly();
        io.shutdown();
    }
}
