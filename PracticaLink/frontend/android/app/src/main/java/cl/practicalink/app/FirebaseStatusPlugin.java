package cl.practicalink.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FirebaseStatus")
public class FirebaseStatusPlugin extends Plugin {

    @PluginMethod
    public void checkConfigured(PluginCall call) {
        int appIdResource = getContext().getResources().getIdentifier(
            "google_app_id",
            "string",
            getContext().getPackageName()
        );
        boolean configured = appIdResource != 0
            && !getContext().getString(appIdResource).isEmpty();
        JSObject result = new JSObject();
        result.put("configured", configured);
        call.resolve(result);
    }
}
