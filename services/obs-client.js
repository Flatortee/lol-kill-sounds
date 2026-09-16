/**
 * obs-client.js
 *
 * Client OBS WebSocket 5.x ecrit "a la main" en JavaScript natif
 * (WebSocket + Web Crypto API), sans dependance npm (obs-websocket-js).
 *
 * Choix d'architecture : une app Overwolf "WebApp" classique n'a pas
 * d'etape de build/bundling par defaut (pas de webpack/parcel requis).
 * Plutot que d'imposer une chaine de build pour importer un module
 * npm, on reimplemente le sous-ensemble du protocole officiel
 * OBS WebSocket 5.x necessaire ici : handshake Hello/Identify,
 * authentification SHA256, et l'envoi de "Request".
 * Reference protocole : https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
 *
 * Declenchement du son : on utilise SetInputSettings (pour pointer la
 * source Media vers le nouveau fichier local) puis
 * TriggerMediaInputAction avec OBS_MEDIA_INPUT_ACTION_RESTART.
 * C'est la methode recommandee pour rejouer dynamiquement un fichier
 * different sur une Media Source existante (plutot que de recreer la
 * source a chaque kill, ce qui serait plus lourd et plus fragile).
 */

const OBS_OPCODE = {
  HELLO: 0,
  IDENTIFY: 1,
  IDENTIFIED: 2,
  REIDENTIFY: 3,
  EVENT: 5,
  REQUEST: 6,
  REQUEST_RESPONSE: 7,
  REQUEST_BATCH: 8,
  REQUEST_BATCH_RESPONSE: 9
};

const RPC_VERSION = 1;

function base64FromBytes(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function sha256Base64(str) {
  const enc = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", enc);
  return base64FromBytes(new Uint8Array(hashBuffer));
}

class ObsClient {
  /**
   * @param {object} opts
   * @param {(msg:string)=>void} opts.onLog
   * @param {(connected:boolean)=>void} opts.onStatusChange
   */
  constructor(opts = {}) {
    this.onLog = opts.onLog || (() => {});
    this.onStatusChange = opts.onStatusChange || (() => {});
    this.ws = null;
    this.identified = false;
    this.connecting = false;
    this.host = "127.0.0.1";
    this.port = 4455;
    this.password = "";
    this._reconnectTimer = null;
    this._reconnectDelayMs = 3000;
    this._manualClose = false;
    this._pendingRequests = new Map(); // requestId -> {resolve, reject}
    this._requestCounter = 0;
  }

  configure({ host, port, password }) {
    this.host = host || "127.0.0.1";
    this.port = port || 4455;
    this.password = password || "";
  }

  isConnected() {
    return this.identified;
  }

  connect() {
    if (this.connecting || this.identified) return;
    this._manualClose = false;
    this.connecting = true;

    const url = `ws://${this.host}:${this.port}`;
    this.onLog(`Connexion a OBS WebSocket (${url})...`);

    let socket;
    try {
      socket = new WebSocket(url);
    } catch (err) {
      this.connecting = false;
      this.onLog(`Erreur creation WebSocket: ${err.message}`);
      this._scheduleReconnect();
      return;
    }

    this.ws = socket;

    socket.onopen = () => {
      this.onLog("Connexion TCP etablie, attente du message Hello...");
    };

    socket.onmessage = (evt) => this._handleMessage(evt);

    socket.onerror = (evt) => {
      this.onLog("Erreur WebSocket (OBS est-il lance avec le serveur WebSocket active ?).");
    };

    socket.onclose = (evt) => {
      const wasIdentified = this.identified;
      this.connecting = false;
      this.identified = false;
      this.ws = null;
      this._rejectAllPending("Connexion OBS fermee.");
      this.onStatusChange(false);
      if (wasIdentified) {
        this.onLog(`Connexion a OBS perdue (code ${evt.code}). Nouvelle tentative dans ${this._reconnectDelayMs / 1000}s...`);
      }
      if (!this._manualClose) {
        this._scheduleReconnect();
      }
    };
  }

  disconnect() {
    this._manualClose = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch (e) { /* noop */ }
    }
    this.identified = false;
    this.connecting = false;
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, this._reconnectDelayMs);
  }

  async _handleMessage(evt) {
    let msg;
    try {
      msg = JSON.parse(evt.data);
    } catch (err) {
      this.onLog("Message OBS illisible (JSON invalide).");
      return;
    }

    switch (msg.op) {
      case OBS_OPCODE.HELLO:
        await this._handleHello(msg.d);
        break;
      case OBS_OPCODE.IDENTIFIED:
        this.connecting = false;
        this.identified = true;
        this.onLog(`Identifie aupres d'OBS WebSocket (rpcVersion=${msg.d.negotiatedRpcVersion}).`);
        this.onStatusChange(true);
        break;
      case OBS_OPCODE.REQUEST_RESPONSE:
        this._handleRequestResponse(msg.d);
        break;
      case OBS_OPCODE.EVENT:
        // Non utilise actuellement (on n'a pas besoin des evenements OBS),
        // mais on ne fait rien planter si un event arrive.
        break;
      default:
        break;
    }
  }

  async _handleHello(data) {
    const identify = {
      op: OBS_OPCODE.IDENTIFY,
      d: {
        rpcVersion: RPC_VERSION
      }
    };

    if (data.authentication) {
      if (!this.password) {
        this.onLog("OBS WebSocket exige un mot de passe, mais aucun n'est configure dans les Settings.");
      }
      const { challenge, salt } = data.authentication;
      const secret = await sha256Base64(this.password + salt);
      const authResponse = await sha256Base64(secret + challenge);
      identify.d.authentication = authResponse;
    }

    this._send(identify);
  }

  _handleRequestResponse(d) {
    const pending = this._pendingRequests.get(d.requestId);
    if (!pending) return;
    this._pendingRequests.delete(d.requestId);

    if (d.requestStatus && d.requestStatus.result) {
      pending.resolve(d.responseData || {});
    } else {
      const code = d.requestStatus ? d.requestStatus.code : "unknown";
      const comment = d.requestStatus ? d.requestStatus.comment : "Erreur inconnue";
      pending.reject(new Error(`OBS a refuse la requete "${d.requestType}" (code ${code}): ${comment}`));
    }
  }

  _rejectAllPending(reason) {
    for (const [, pending] of this._pendingRequests) {
      pending.reject(new Error(reason));
    }
    this._pendingRequests.clear();
  }

  _send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(obj));
  }

  /**
   * Envoie une requete OBS WebSocket et attend la reponse.
   * @param {string} requestType ex: "SetInputSettings"
   * @param {object} requestData
   */
  call(requestType, requestData = {}) {
    return new Promise((resolve, reject) => {
      if (!this.identified) {
        reject(new Error("Non connecte a OBS."));
        return;
      }
      const requestId = `req_${++this._requestCounter}_${Date.now()}`;
      this._pendingRequests.set(requestId, { resolve, reject });

      this._send({
        op: OBS_OPCODE.REQUEST,
        d: { requestType, requestId, requestData }
      });

      // Timeout de securite : evite une requete bloquee indefiniment.
      setTimeout(() => {
        if (this._pendingRequests.has(requestId)) {
          this._pendingRequests.delete(requestId);
          reject(new Error(`Timeout en attente de la reponse OBS pour ${requestType}.`));
        }
      }, 8000);
    });
  }

  /**
   * Joue un fichier audio via une source "Media Source" existante dans OBS.
   * @param {string} sourceName nom de la source OBS (ex: "LoL Kill Sound")
   * @param {string} filePath chemin absolu local du fichier a jouer
   */
  async playSoundFile(sourceName, filePath) {
    await this.call("SetInputSettings", {
      inputName: sourceName,
      inputSettings: { local_file: filePath },
      overlay: true
    });
    await this.call("TriggerMediaInputAction", {
      inputName: sourceName,
      mediaAction: "OBS_MEDIA_INPUT_ACTION_RESTART"
    });
  }

  /** Verifie simplement que la source existe (utile pour "TEST OBS"). */
  async checkSourceExists(sourceName) {
    const result = await this.call("GetInputList", {});
    const inputs = (result && result.inputs) || [];
    return inputs.some(i => i.inputName === sourceName);
  }
}

window.ObsClient = ObsClient;
