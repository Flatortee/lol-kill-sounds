/**
 * config-store.js
 *
 * Persistance locale des reglages de l'application.
 *
 * On utilise localStorage : dans une app Overwolf packagee, toutes les
 * fenetres de la meme app tournent sur la meme origine
 * (overwolf-extension://<id>), donc localStorage est partage entre
 * background / main / settings. C'est suffisant ici (pas de FileSystem
 * necessaire pour de simples reglages cle/valeur) et ca evite toute
 * ecriture disque manuelle.
 */

const CONFIG_STORAGE_KEY = "lol-kill-sounds:config:v1";

const DEFAULT_CONFIG = {
  soundsFolder: "",          // Chemin absolu vers le dossier "sounds" contenant 1kill..5kill
  obsHost: "127.0.0.1",
  obsPort: 4455,
  obsPassword: "",
  obsSource: "LoL Kill Sound",
  historySize: 5,
  killSoundsEnabled: true,
  supportedExtensions: ["mp3", "wav", "ogg"]
};

function loadConfig() {
  try {
    const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_CONFIG };
    }
    const parsed = JSON.parse(raw);
    // fusion avec les valeurs par defaut : si un champ manque
    // (ancienne version des settings), on ne casse rien.
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (err) {
    console.error("[config-store] Impossible de lire la config, retour aux valeurs par defaut.", err);
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(config) {
  try {
    const merged = { ...DEFAULT_CONFIG, ...config };
    window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(merged));
    return merged;
  } catch (err) {
    console.error("[config-store] Impossible de sauvegarder la config.", err);
    return config;
  }
}

// Expose globalement (les fenetres Overwolf chargent ce script via <script src="">,
// pas de bundler / modules ES ici pour rester simple et sans etape de build).
window.ConfigStore = {
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig
};
