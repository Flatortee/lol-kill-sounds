/**
 * lol-events.js
 *
 * Integration avec l'API officielle Overwolf Game Events Provider (GEP)
 * pour League of Legends (Game ID 5426).
 *
 * Documentation verifiee (Overwolf Developers, ow-native) :
 *   - overwolf.games.events.setRequiredFeatures(features, callback)
 *   - overwolf.games.events.onNewEvents.addListener(callback)
 *   - overwolf.games.events.onInfoUpdates2.addListener(callback)
 *   - overwolf.games.events.onError.addListener(callback)
 *   - overwolf.games.events.getInfo(callback)
 *   - overwolf.games.onGameInfoUpdated.addListener(callback)
 *   - overwolf.games.getRunningGameInfo(callback)
 *
 * Features LoL utilisees (confirmees dans la doc "League of Legends
 * Game events", dev.overwolf.com/ow-native) :
 *   - "kill"       -> Event "kill", data JSON: { label, count, totalKills }
 *                     label ∈ kill / double_kill / triple_kill / quadra_kill / penta_kill
 *   - "death"      -> Event "death" (le champion du joueur est mort)
 *   - "matchState" -> Event "matchStart" (debut de partie), info "matchStarted"
 *   - "summoner_info" -> juste pour afficher le champion joue (confort, optionnel)
 *
 * Logique anti double-comptage :
 * Chaque elimination reelle ne declenche qu'UN SEUL evenement "kill".
 * Son champ "totalKills" est un compteur CUMULE et fiable pour tout le
 * match (fourni par Overwolf, pas recalculee par nous). On ne se base
 * donc jamais sur un "+1" manuel a chaque event recu (ce qui *aurait*
 * pu compter un meme kill plusieurs fois si Overwolf renvoyait aussi
 * un evenement "double_kill" separe) : on calcule le nombre de kills
 * de la serie en cours comme :
 *
 *     streak = totalKills (fourni par l'event) - killsBaseline
 *
 * ou killsBaseline est remis a jour uniquement :
 *   - a la mort du joueur (event "death") -> killsBaseline = totalKills courant
 *   - au debut d'une nouvelle partie (event "matchStart") -> killsBaseline = 0
 *   - au demarrage de l'app en cours de partie -> killsBaseline = valeur
 *     actuelle de game_info.kills (recuperee via getInfo()), pour ne pas
 *     fausser le tout premier kill detecte apres coup.
 */

const LOL_GAME_ID = 5426;
const REQUIRED_FEATURES = ["matchState", "kill", "death", "summoner_info"];
const SET_FEATURES_MAX_RETRIES = 5;
const SET_FEATURES_RETRY_DELAY_MS = 3000;

class LolEvents {
  /**
   * @param {object} opts
   * @param {object} opts.logger
   * @param {(streak:number, label:string)=>void} opts.onKill
   * @param {()=>void} opts.onDeathOrReset
   * @param {(running:boolean)=>void} opts.onGameStateChange
   */
  constructor(opts = {}) {
    this.logger = opts.logger || console;
    this.onKill = opts.onKill || (() => {});
    this.onDeathOrReset = opts.onDeathOrReset || (() => {});
    this.onGameStateChange = opts.onGameStateChange || (() => {});

    this.killsBaseline = 0;
    this.lastKnownTotalKills = 0;
    this.isGameRunning = false;
    this._featuresRegistered = false;
  }

  /** A appeler une seule fois au demarrage de l'app (depuis le background). */
  init() {
    if (typeof overwolf === "undefined" || !overwolf.games) {
      this.logger.error("[LolEvents] API overwolf.games indisponible. L'app doit tourner dans le client Overwolf.");
      return;
    }

    overwolf.games.onGameInfoUpdated.addListener((info) => this._handleGameInfoUpdated(info));
    overwolf.games.events.onError.addListener((info) => {
      this.logger.error(`[LolEvents] Erreur GEP: ${JSON.stringify(info)}`);
    });
    overwolf.games.events.onNewEvents.addListener((info) => this._handleNewEvents(info));
    overwolf.games.events.onInfoUpdates2.addListener((info) => this._handleInfoUpdates(info));

    // Etat initial (l'app peut demarrer alors que LoL tourne deja).
    overwolf.games.getRunningGameInfo((gameInfo) => {
      this._applyGameInfo(gameInfo);
    });
  }

  _isLol(gameInfo) {
    if (!gameInfo || !gameInfo.isRunning || !gameInfo.id) return false;
    // Les IDs Overwolf ont un suffixe de sequence: on isole le classId.
    return Math.floor(gameInfo.id / 10) === LOL_GAME_ID;
  }

  _handleGameInfoUpdated(info) {
    if (!info || !info.gameInfo) return;
    if (!info.gameChanged && !info.runningChanged) return;
    this._applyGameInfo(info.gameInfo);
  }

  _applyGameInfo(gameInfo) {
    const running = this._isLol(gameInfo);
    if (running === this.isGameRunning) return;

    this.isGameRunning = running;
    this.onGameStateChange(running);

    if (running) {
      this.logger.info("[LolEvents] League of Legends detecte.");
      this._registerFeatures();
    } else {
      this.logger.info("[LolEvents] League of Legends ferme ou changement de jeu.");
      this._featuresRegistered = false;
    }
  }

  _registerFeatures(attempt = 1) {
    overwolf.games.events.setRequiredFeatures(REQUIRED_FEATURES, (info) => {
      if (!info || info.success === false) {
        const err = info && info.error;
        this.logger.warn(`[LolEvents] setRequiredFeatures a echoue (tentative ${attempt}/${SET_FEATURES_MAX_RETRIES}): ${err}`);
        if (attempt < SET_FEATURES_MAX_RETRIES) {
          setTimeout(() => this._registerFeatures(attempt + 1), SET_FEATURES_RETRY_DELAY_MS);
        } else {
          this.logger.error("[LolEvents] Abandon de l'enregistrement des features GEP apres plusieurs tentatives.");
        }
        return;
      }

      this._featuresRegistered = true;
      this.logger.info(`[LolEvents] Features GEP actives: ${(info.supportedFeatures || []).join(", ")}`);

      // Recupere l'etat courant (utile si l'app est lancee en cours de partie).
      overwolf.games.events.getInfo((result) => {
        try {
          const killsStr = result && result.res && result.res.game_info && result.res.game_info.kills;
          const currentKills = parseInt(killsStr, 10);
          if (!isNaN(currentKills)) {
            this.killsBaseline = currentKills;
            this.lastKnownTotalKills = currentKills;
            this.logger.info(`[LolEvents] Kills deja realises ce match (baseline initiale): ${currentKills}`);
          }
        } catch (err) {
          // Pas grave : on repartira simplement de 0.
        }
      });
    });
  }

  _handleInfoUpdates(info) {
    // Pas indispensable a la logique (le champ totalKills de l'evenement
    // "kill" suffit), mais permet de garder une trace utile dans les logs.
  }

  _handleNewEvents(info) {
    if (!info || !Array.isArray(info.events)) return;

    for (const evt of info.events) {
      switch (evt.name) {
        case "matchStart":
          this.logger.info("[LolEvents] Nouvelle partie detectee (matchStart) -> reset du compteur de kills.");
          this.killsBaseline = 0;
          this.lastKnownTotalKills = 0;
          this.onDeathOrReset();
          break;

        case "death":
          this.logger.info(`[LolEvents] Mort du champion detectee -> fin de la serie (${this.lastKnownTotalKills - this.killsBaseline} kill(s)).`);
          this.killsBaseline = this.lastKnownTotalKills;
          this.onDeathOrReset();
          break;

        case "kill":
          this._handleKillEvent(evt.data);
          break;

        default:
          break;
      }
    }
  }

  _handleKillEvent(rawData) {
    let data;
    try {
      data = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
    } catch (err) {
      this.logger.warn(`[LolEvents] Event "kill" recu avec des donnees illisibles: ${rawData}`);
      return;
    }

    const totalKills = parseInt(data && data.totalKills, 10);
    const label = (data && data.label) || "kill";

    if (isNaN(totalKills)) {
      this.logger.warn(`[LolEvents] Event "kill" sans totalKills exploitable: ${JSON.stringify(data)}`);
      return;
    }

    this.lastKnownTotalKills = totalKills;
    const streak = Math.max(1, totalKills - this.killsBaseline);

    this.logger.info(`[LolEvents] Kill detecte (label=${label}, totalKills=${totalKills}) -> streak actuelle: ${streak}`);
    this.onKill(streak, label);
  }
}

window.LolEvents = LolEvents;
window.LOL_GAME_ID = LOL_GAME_ID;
