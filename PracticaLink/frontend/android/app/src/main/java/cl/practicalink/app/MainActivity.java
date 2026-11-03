package cl.practicalink.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(FirebaseStatusPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
