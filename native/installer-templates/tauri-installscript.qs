function Component() {
    component.loaded.connect(this, Component.prototype.loaded);
    installer.installationFinished.connect(this, Component.prototype.installationFinished);
}

Component.prototype.loaded = function() {};

Component.prototype.createOperations = function() {
    component.createOperations();
};

Component.prototype.installationFinished = function() {
    try {
        var targetDir = installer.value("TargetDir");
        var platform = systemInfo.productType;
        var isWindows = (platform === "windows");
        var exePath = isWindows
            ? targetDir + "/SSE ExEd Studio Control Native/sse-exed-tauri-shell.exe"
            : targetDir + "/SSE ExEd Studio Control Native.app/Contents/MacOS/sse-exed-tauri-shell";
        var statusPath = targetDir + "/install-tauri-smoke.json";

        var args = [
            exePath,
            "--smoke-test",
            "--smoke-status-path=" + statusPath
        ];

        var result = installer.execute(args[0], args.slice(1), "");

        if (result && result[1] !== 0) {
            var summary =
                "The newly installed Tauri candidate did not pass the first-launch smoke test. " +
                "Review the diagnostic status at:\n\n" + statusPath + "\n\n" +
                "Do not promote this candidate until the packaged smoke passes.";
            QMessageBox.warning("smoke.warning", "First-launch check", summary, QMessageBox.Ok);
        }
    } catch (e) {
    }
};
