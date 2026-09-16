/**
 * background.js
 *
 * Orchestrateur principal de l'app, execute en permanence dans la
 * fenetre cachee "background" (is_background_page: true dans le
 * manifest -> reste active meme si aucune fenetre visible n'est ouverte).
 *
 * La fenetre "main" (UI) lit et pilote cet objet via
 * overwolf.windows.getMainWindow().App, puisque toutes les fenetres
 * d'une app Overwolf packagee partagent la meme origine.
 */

const logger = window.Logger;

const App = {
  state: {
    enabled: true,
    lolRunning: false,
    obsConnected: false,
    currentStreak: 0,
    lastSound: null, // { folder, file, fullPath, at }
    soundStats: {},
    logs: []
  },

  listeners: [],

  config: null,
  soundManager: null,
  obsClient: null,
  lolEvents: null,

  init() {
    this.config = window.ConfigStore.loadConfig();
    this.soundManager = new window.SoundManager(logger);
    this.soundManager.setHistorySize(this.config.historySize);
    this.soundManager.setSupportedExtensions(this.config.supportedExtensions);

    this.obsClient = new window.ObsClient({
      onLog: (msg) => logger.info(`[OBS] ${msg}`),
      onStatusChange: (connected) => {
        this.state.obsConnected = connected;
        this._notify();
      }
    });
    this.obsClient.configure({
      host: this.config.obsHost,
      port: this.config.obsPort,
      password: this.config.obsPassword
    });

    this.lolEvents = new window.LolEvents({
      logger,
      onGameStateChange: (running) => {
        this.state.lolRunning = running;
        this._notify();
      },
      onDeathOrReset: () => {
        this.state.currentStreak = 0;
        this._notify();
      },
      onKill: (streak, label) => {
        this.state.currentStreak = streak;
        this._notify();
        this.playForStreak(streak);
      }
    });

    logger.onLine((line) => {
      this.state.logs = logger.getAll();
      this._notify();
    });

    logger.info("Application demarree.");

    if (this.config.soundsFolder) {
      this.rescanSounds();
    } else {
      logger.warn("Aucun dossier de sons configure. Ouvrez les Settings pour le definir.");
    }

    this.lolEvents.init();
    this.obsClient.connect();

    this.state.logs = logger.getAll();
  },

  // ---- Abonnement de la fenetre "main" aux changements d'etat ----
  subscribe(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  },

  _notify() {
    for (const cb of this.listeners) {
      try { cb(this.state); } catch (e) { /* noop */ }
    }
  },

  getState() {
    return this.state;
  },

  getConfig() {
    return this.config;
  },

  // ---- Actions exposees a l'UI ----

  setEnabled(enabled) {
    this.state.enabled = enabled;
    logger.info(`Sons de kill ${enabled ? "actives" : "desactives"}.`);
    this._notify();
  },

  rescanSounds() {
    if (!this.config.soundsFolder) {
      logger.error("Impossible de scanner : aucun dossier de sons configure.");
      return;
    }
    logger.info(`Scan du dossier de sons: ${this.config.soundsFolder}`);
    this.soundManager.scan(this.config.soundsFolder, (ok, folders) => {
      this.state.soundStats = this.soundManager.getStats();
      this._notify();
    });
  },

  updateConfig(partialConfig) {
    this.config = window.ConfigStore.saveConfig({ ...this.config, ...partialConfig });
    this.soundManager.setHistorySize(this.config.historySize);
    this.soundManager.setSupportedExtensions(this.config.supportedExtensions);
    this.obsClient.disconnect();
    this.obsClient.configure({
      host: this.config.obsHost,
      port: this.config.obsPort,
      password: this.config.obsPassword
    });
    this.obsClient.connect();
    this.rescanSounds();
    logger.info("Configuration mise a jour.");
    this._notify();
  },

  /** Selectionne un son pour le streak donne et l'envoie a OBS (utilise par le GEP et par les boutons TEST). */
  async playForStreak(streak) {
    if (!this.state.enabled) {
      logger.info(`Kill ignore (application desactivee). Streak=${streak}`);
      return;
    }

    const picked = this.soundManager.pick(streak);
    if (!picked) {
      logger.error(`Aucun son disponible pour la categorie correspondant a ${streak} kill(s).`);
      return;
    }

    this.state.lastSound = { ...picked, at: Date.now() };
    this._notify();
    logger.info(`Son selectionne: ${picked.folder}/${picked.file}`);

    if (!this.obsClient.isConnected()) {
      logger.error("OBS n'est pas connecte : le son ne peut pas etre diffuse.");
      return;
    }

    try {
      await this.obsClient.playSoundFile(this.config.obsSource, picked.fullPath);
      logger.info(`Son envoye a OBS (source "${this.config.obsSource}").`);
    } catch (err) {
      logger.error(`Echec de l'envoi du son a OBS: ${err.message}`);
    }
  },

  async testObsConnection() {
    logger.info("Test de connexion OBS demande...");
    if (!this.obsClient.isConnected()) {
      logger.error("OBS n'est pas connecte. Verifiez que le serveur WebSocket est active dans OBS (Outils > WebSocket Server Settings).");
      return { success: false, message: "OBS non connecte." };
    }
    try {
      const exists = await this.obsClient.checkSourceExists(this.config.obsSource);
      if (!exists) {
        const msg = `La source OBS "${this.config.obsSource}" est introuvable. Creez une Media Source portant exactement ce nom.`;
        logger.error(msg);
        return { success: false, message: msg };
      }
      logger.info(`Source OBS "${this.config.obsSource}" trouvee. Lecture d'un son de test...`);
      await this.playForStreak(1);
      return { success: true, message: "OBS connecte et source valide." };
    } catch (err) {
      logger.error(`Test OBS echoue: ${err.message}`);
      return { success: false, message: err.message };
    }
  }
};

window.App = App;
App.init();
