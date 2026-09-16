/**
 * sound-manager.js
 *
 * Scanne les dossiers de sons (1kill..5kill) via overwolf.io.dir()
 * (permission "FileSystem"), et choisit un fichier aleatoire par
 * categorie en respectant un historique anti-repetition.
 *
 * API Overwolf utilisee (documentee) :
 *   overwolf.io.dir(path, callback) -> { success, path, data: [{name, type}] }
 *   Reference: https://dev.overwolf.com/ow-native/reference/io/ow-io/
 */

const KILL_FOLDERS = ["1kill", "2kill", "3kill", "4kill", "5kill"];

function joinPath(base, ...segments) {
  let p = base.replace(/[\\/]+$/, "");
  for (const s of segments) {
    p += "\\" + String(s).replace(/^[\\/]+/, "");
  }
  return p;
}

class SoundManager {
  constructor(logger) {
    this.logger = logger || console;
    this.folders = {}; // { "1kill": ["son01.mp3", ...], ... }
    this.history = {}; // { "1kill": ["son01.mp3", ...] } ordre = plus recent en fin
    this.historySize = 5;
    this.rootPath = "";
    this.supportedExtensions = ["mp3", "wav", "ogg"];
    this.lastError = null;
  }

  setHistorySize(size) {
    this.historySize = Math.max(0, parseInt(size, 10) || 0);
  }

  setSupportedExtensions(list) {
    if (Array.isArray(list) && list.length > 0) {
      this.supportedExtensions = list.map(e => String(e).toLowerCase().replace(/^\./, ""));
    }
  }

  /**
   * Scanne le dossier racine "sounds" (et ses 5 sous-dossiers).
   * Ne plante jamais : si un dossier est manquant/vide, il est
   * simplement considere comme "0 son disponible" pour cette categorie.
   */
  scan(rootPath, callback) {
    this.rootPath = rootPath;
    this.folders = {};
    this.lastError = null;

    if (!rootPath || typeof overwolf === "undefined" || !overwolf.io) {
      this.lastError = "Chemin du dossier de sons non configure, ou API overwolf.io indisponible.";
      this.logger.error("[SoundManager] " + this.lastError);
      if (callback) callback(false, this.folders);
      return;
    }

    let remaining = KILL_FOLDERS.length;
    const done = () => {
      remaining--;
      if (remaining <= 0 && callback) callback(true, this.folders);
    };

    for (const folder of KILL_FOLDERS) {
      const fullPath = joinPath(rootPath, folder);
      overwolf.io.dir(fullPath, (result) => {
        if (!result || !result.success) {
          this.logger.warn(`[SoundManager] Dossier introuvable ou vide: ${fullPath} (${result && result.error})`);
          this.folders[folder] = [];
          done();
          return;
        }
        const files = (result.data || [])
          .filter(entry => entry.type === "file")
          .map(entry => entry.name)
          .filter(name => this._hasSupportedExtension(name));
        this.folders[folder] = files;
        if (!this.history[folder]) this.history[folder] = [];
        this.logger.info(`[SoundManager] ${folder}: ${files.length} son(s) detecte(s).`);
        done();
      });
    }
  }

  _hasSupportedExtension(filename) {
    const idx = filename.lastIndexOf(".");
    if (idx === -1) return false;
    const ext = filename.slice(idx + 1).toLowerCase();
    return this.supportedExtensions.includes(ext);
  }

  /** Convertit un compteur de kills consecutifs (1,2,3,4,5,6,7...) vers le nom de dossier. */
  static folderForStreak(streak) {
    const n = Math.max(1, Math.min(5, streak));
    return KILL_FOLDERS[n - 1];
  }

  /**
   * Choisit un fichier aleatoire dans la categorie donnee, en excluant
   * (autant que possible) les derniers fichiers joues (anti-repetition).
   * Retourne { folder, file, fullPath } ou null si aucun son disponible.
   */
  pick(streakOrFolderName) {
    const folder = KILL_FOLDERS.includes(streakOrFolderName)
      ? streakOrFolderName
      : SoundManager.folderForStreak(streakOrFolderName);

    const files = this.folders[folder] || [];
    if (files.length === 0) {
      this.logger.warn(`[SoundManager] Aucun fichier audio disponible dans sounds/${folder}.`);
      return null;
    }

    const recent = this.history[folder] || [];
    // Reduit automatiquement la contrainte si le dossier a moins de
    // fichiers que la taille de l'historique (ne doit jamais bloquer).
    const maxExcluded = Math.min(this.historySize, Math.max(0, files.length - 1));
    const excluded = new Set(recent.slice(-maxExcluded));

    let candidates = files.filter(f => !excluded.has(f));
    if (candidates.length === 0) {
      // Securite supplementaire (ne devrait pas arriver grace a maxExcluded).
      candidates = files;
    }

    const chosen = candidates[Math.floor(Math.random() * candidates.length)];

    if (!this.history[folder]) this.history[folder] = [];
    this.history[folder].push(chosen);
    if (this.history[folder].length > this.historySize) {
      this.history[folder] = this.history[folder].slice(-this.historySize);
    }

    return {
      folder,
      file: chosen,
      fullPath: joinPath(this.rootPath, folder, chosen)
    };
  }

  getStats() {
    const stats = {};
    for (const folder of KILL_FOLDERS) {
      stats[folder] = (this.folders[folder] || []).length;
    }
    return stats;
  }
}

window.SoundManager = SoundManager;
window.KILL_FOLDERS = KILL_FOLDERS;
