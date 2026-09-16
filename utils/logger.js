/**
 * logger.js
 *
 * Petit systeme de logs en memoire (ring buffer), consultable depuis
 * la fenetre principale, avec miroir dans la console (F12 / DevTools
 * Overwolf) et enregistrement sur disque via overwolf.io si la
 * permission FileSystem est disponible.
 */

const MAX_LOG_LINES = 500;

function pad2(n) {
  return n < 10 ? "0" + n : "" + n;
}

function timestamp() {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

class Logger {
  constructor() {
    this.lines = [];
    this.listeners = [];
    this._logFilePath = null;
  }

  /** Permet a la fenetre principale de recevoir chaque nouvelle ligne en direct. */
  onLine(callback) {
    this.listeners.push(callback);
  }

  _push(level, message) {
    const line = { level, message, time: timestamp() };
    this.lines.push(line);
    if (this.lines.length > MAX_LOG_LINES) {
      this.lines.shift();
    }
    for (const cb of this.listeners) {
      try { cb(line); } catch (e) { /* noop */ }
    }
    const text = `[${line.time}] ${message}`;
    if (level === "error") console.error(text);
    else if (level === "warn") console.warn(text);
    else console.log(text);

    this._scheduleFileWrite();
  }

  info(message) { this._push("info", message); }
  warn(message) { this._push("warn", message); }
  error(message) { this._push("error", message); }

  getAll() {
    return this.lines.slice();
  }

  /**
   * Ecrit les logs dans un fichier texte local (best-effort).
   * Necessite la permission "FileSystem" (deja declaree dans le manifest).
   *
   * Important : overwolf.io.writeFileContents() ECRASE le fichier a
   * chaque appel (il n'existe pas d'API "append" documentee cote
   * Overwolf). On reecrit donc l'integralite du buffer de logs a
   * chaque fois, ce qui reste tres leger (max 500 lignes) et est
   * debounce pour eviter d'ecrire sur disque a chaque ligne.
   */
  _scheduleFileWrite() {
    if (this._writeTimer) return;
    this._writeTimer = setTimeout(() => {
      this._writeTimer = null;
      this._flushToFile();
    }, 1000);
  }

  _flushToFile() {
    try {
      if (typeof overwolf === "undefined" || !overwolf.io || !overwolf.io.paths) return;
      if (!this._logFilePath) {
        this._logFilePath = overwolf.io.paths.localAppData + "\\LoL-Kill-Sounds\\app.log";
      }
      const content = this.lines.map(l => `[${l.time}] [${l.level.toUpperCase()}] ${l.message}`).join("\r\n");
      overwolf.io.writeFileContents(this._logFilePath, content, "UTF8", false, () => {});
    } catch (err) {
      // Ne jamais faire planter l'app pour un probleme d'ecriture de log.
    }
  }

  getLogFilePath() {
    return this._logFilePath;
  }
}

window.Logger = new Logger();
