/**
 * main.js
 *
 * Fenetre principale (UI). Toute la logique metier vit dans la
 * fenetre "background" ; cette fenetre se contente de lire son etat
 * (overwolf.windows.getMainWindow() renvoie l'objet window de la
 * fenetre declaree comme "start_window" dans le manifest, ici la
 * fenetre background) et de relayer les actions de l'utilisateur.
 */

let App = null;

function getApp() {
  if (App) return App;
  const bg = overwolf.windows.getMainWindow();
  App = bg && bg.App;
  return App;
}

function fmtTime(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  const p = n => (n < 10 ? "0" + n : "" + n);
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function render(state) {
  const dotLol = document.getElementById("dot-lol");
  const textLol = document.getElementById("text-lol");
  dotLol.className = "dot " + (state.lolRunning ? "on" : "off");
  textLol.textContent = state.lolRunning ? "League of Legends detecte" : "League of Legends non detecte";

  const dotObs = document.getElementById("dot-obs");
  const textObs = document.getElementById("text-obs");
  dotObs.className = "dot " + (state.obsConnected ? "on" : "off");
  textObs.textContent = state.obsConnected ? "OBS connecte" : "OBS deconnecte";

  document.getElementById("streak-value").textContent = state.currentStreak;

  const lastSoundEl = document.getElementById("last-sound-value");
  if (state.lastSound) {
    lastSoundEl.textContent = `sounds/${state.lastSound.folder}/${state.lastSound.file} (${fmtTime(state.lastSound.at)})`;
  } else {
    lastSoundEl.textContent = "-";
  }

  const toggleBtn = document.getElementById("btn-toggle");
  toggleBtn.textContent = state.enabled ? "ON" : "OFF";
  toggleBtn.className = "toggle-btn " + (state.enabled ? "enabled" : "disabled");

  const statsEl = document.getElementById("sound-stats");
  statsEl.innerHTML = "";
  const folders = window.KILL_FOLDERS || ["1kill", "2kill", "3kill", "4kill", "5kill"];
  for (const f of folders) {
    const span = document.createElement("span");
    const count = (state.soundStats && state.soundStats[f]) || 0;
    span.textContent = `${f}: ${count}`;
    if (count === 0) span.style.color = "#d03535";
    statsEl.appendChild(span);
  }

  const logsEl = document.getElementById("logs-content");
  logsEl.innerHTML = "";
  for (const line of state.logs.slice(-100)) {
    const div = document.createElement("div");
    div.textContent = `[${line.time}] ${line.message}`;
    if (line.level === "error") div.className = "log-error";
    else if (line.level === "warn") div.className = "log-warn";
    logsEl.appendChild(div);
  }
  logsEl.scrollTop = logsEl.scrollHeight;
}

function initWindowControls() {
  overwolf.windows.getCurrentWindow((result) => {
    const windowName = result && result.window && result.window.name;
    document.getElementById("btn-minimize").addEventListener("click", () => {
      overwolf.windows.minimize(windowName, () => {});
    });
    document.getElementById("btn-close").addEventListener("click", () => {
      overwolf.windows.close(windowName, () => {});
    });
  });
}

function initActions() {
  const app = getApp();
  if (!app) return;

  document.getElementById("btn-toggle").addEventListener("click", () => {
    app.setEnabled(!app.getState().enabled);
  });

  document.querySelectorAll(".test-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const streak = parseInt(btn.getAttribute("data-streak"), 10);
      app.playForStreak(streak);
    });
  });

  document.getElementById("btn-test-obs").addEventListener("click", async () => {
    const result = await app.testObsConnection();
    if (!result.success) {
      // Le detail est deja dans les logs ; pas besoin d'alert bloquante.
      console.warn(result.message);
    }
  });

  document.getElementById("btn-settings").addEventListener("click", () => {
    overwolf.windows.obtainDeclaredWindow("settings", (result) => {
      if (result && result.window) {
        overwolf.windows.restore(result.window.id, () => {});
      }
    });
  });
}

function main() {
  initWindowControls();
  const app = getApp();
  if (!app) {
    document.getElementById("logs-content").textContent =
      "Erreur: impossible de se connecter au processus background de l'app.";
    return;
  }

  initActions();
  render(app.getState());
  app.subscribe(render);
}

if (typeof overwolf === "undefined") {
  document.body.innerHTML = "<p style='padding:20px;color:#fff'>Cette page doit etre executee dans le client Overwolf.</p>";
} else {
  document.addEventListener("DOMContentLoaded", main);
}
