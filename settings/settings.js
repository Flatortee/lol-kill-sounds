/**
 * settings.js
 *
 * Lit/ecrit la configuration via l'objet "App" heberge par la fenetre
 * background (voir main.js pour l'explication du pattern
 * getMainWindow()).
 */

function getApp() {
  const bg = overwolf.windows.getMainWindow();
  return bg && bg.App;
}

function fillForm(config) {
  document.getElementById("input-sounds-folder").value = config.soundsFolder || "";
  document.getElementById("input-obs-host").value = config.obsHost || "127.0.0.1";
  document.getElementById("input-obs-port").value = config.obsPort || 4455;
  document.getElementById("input-obs-password").value = config.obsPassword || "";
  document.getElementById("input-obs-source").value = config.obsSource || "LoL Kill Sound";
  document.getElementById("input-history-size").value = config.historySize != null ? config.historySize : 5;
  document.getElementById("input-enabled").checked = !!config.killSoundsEnabled;
}

function readForm() {
  return {
    soundsFolder: document.getElementById("input-sounds-folder").value.trim(),
    obsHost: document.getElementById("input-obs-host").value.trim() || "127.0.0.1",
    obsPort: parseInt(document.getElementById("input-obs-port").value, 10) || 4455,
    obsPassword: document.getElementById("input-obs-password").value,
    obsSource: document.getElementById("input-obs-source").value.trim() || "LoL Kill Sound",
    historySize: Math.max(0, parseInt(document.getElementById("input-history-size").value, 10) || 0),
    killSoundsEnabled: document.getElementById("input-enabled").checked
  };
}

function initWindowControls() {
  overwolf.windows.getCurrentWindow((result) => {
    const windowName = result && result.window && result.window.name;
    document.getElementById("btn-close").addEventListener("click", () => {
      overwolf.windows.close(windowName, () => {});
    });
  });
}

function main() {
  initWindowControls();
  const app = getApp();
  if (!app) {
    document.body.innerHTML = "<p style='padding:20px;color:#fff'>Impossible de contacter le processus background.</p>";
    return;
  }

  fillForm(app.getConfig());

  document.getElementById("btn-browse-folder").addEventListener("click", () => {
    const current = document.getElementById("input-sounds-folder").value || "";
    overwolf.utils.openFolderPicker(current, (result) => {
      if (result && result.status === "success" && result.path) {
        document.getElementById("input-sounds-folder").value = result.path;
      }
    });
  });

  document.getElementById("btn-save").addEventListener("click", () => {
    const newConfig = readForm();
    app.updateConfig(newConfig);
    app.setEnabled(newConfig.killSoundsEnabled);

    const status = document.getElementById("save-status");
    status.textContent = "Parametres enregistres.";
    setTimeout(() => { status.textContent = ""; }, 2500);
  });
}

if (typeof overwolf === "undefined") {
  document.body.innerHTML = "<p style='padding:20px;color:#fff'>Cette page doit etre executee dans le client Overwolf.</p>";
} else {
  document.addEventListener("DOMContentLoaded", main);
}
