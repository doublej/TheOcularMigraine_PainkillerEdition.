package com.ocularmigraine.mcp;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.ocularmigraine.mcp.plugins.AppsPlugin;
import com.ocularmigraine.mcp.plugins.DeviceInfoPlugin;
import com.ocularmigraine.mcp.plugins.ShellExecPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered before super.onCreate(), which is where Capacitor builds the bridge.
        registerPlugin(ShellExecPlugin.class);
        registerPlugin(DeviceInfoPlugin.class);
        registerPlugin(AppsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
