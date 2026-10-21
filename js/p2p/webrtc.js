/**
 * webrtc.js
 * Envoltorio para RTCPeerConnection y RTCDataChannel.
 * Gestiona el ciclo de vida de la conexión P2P, la recolección completa de candidatos ICE
 * y la detección de estados y desconexiones sin servidor permanente.
 */

import { SignalingHelper } from './signaling.js';

export const ConnectionState = {
  DISCONNECTED: 'DISCONNECTED',
  GATHERING_OFFER: 'GATHERING_OFFER',
  WAITING_FOR_ANSWER: 'WAITING_FOR_ANSWER',
  GATHERING_ANSWER: 'GATHERING_ANSWER',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  FAILED: 'FAILED',
  CLOSED: 'CLOSED'
};

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ],
  iceCandidatePoolSize: 2
};

export class P2PConnection {
  constructor() {
    this.peerId = 'peer_' + Math.random().toString(36).substring(2, 9);
    this.isHost = false;
    this.pc = null;
    this.dataChannel = null;
    this.state = ConnectionState.DISCONNECTED;

    // Callbacks
    this.onStateChange = null;
    this.onMessage = null;
    this.onError = null;
    this.onChannelOpen = null;
    this.onChannelClose = null;

    this.pingInterval = null;
    this.lastPingTime = 0;
    this.latency = 0;
  }

  setState(newState, details = null) {
    this.state = newState;
    if (this.onStateChange) {
      this.onStateChange(newState, details);
    }
  }

  /**
   * Crea una nueva instancia de RTCPeerConnection y configura los listeners.
   */
  createPeerConnection() {
    this.cleanup();

    try {
      this.pc = new RTCPeerConnection(RTC_CONFIG);
    } catch (err) {
      const errorMsg = 'Este navegador no soporta WebRTC o la configuración falló: ' + err.message;
      if (this.onError) this.onError(errorMsg);
      throw new Error(errorMsg);
    }

    this.pc.onconnectionstatechange = () => {
      console.log('RTCPeerConnection state:', this.pc.connectionState);
      if (this.pc.connectionState === 'connected') {
        this.setState(ConnectionState.CONNECTED);
      } else if (this.pc.connectionState === 'disconnected') {
        this.setState(ConnectionState.DISCONNECTED, 'El par se ha desconectado temporalmente.');
      } else if (this.pc.connectionState === 'failed') {
        this.setState(ConnectionState.FAILED, 'La conexión directa P2P falló (posible restricción NAT/cortafuegos).');
      } else if (this.pc.connectionState === 'closed') {
        this.setState(ConnectionState.CLOSED);
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      console.log('ICE state:', this.pc.iceConnectionState);
      if (this.pc.iceConnectionState === 'failed') {
        this.setState(ConnectionState.FAILED, 'Error al negociar candidatos ICE en la red actual.');
      }
    };

    return this.pc;
  }

  /**
   * Espera a que la recolección de candidatos ICE termine o expire el timeout.
   */
  waitForIceGathering(timeoutMs = 3000) {
    return new Promise((resolve) => {
      if (!this.pc) return resolve();
      if (this.pc.iceGatheringState === 'complete') {
        return resolve();
      }

      let timeoutHandle = null;

      const checkState = () => {
        if (this.pc && (this.pc.iceGatheringState === 'complete' || !this.pc)) {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          this.pc?.removeEventListener('icegatheringstatechange', checkState);
          this.pc?.removeEventListener('icecandidate', onCandidate);
          resolve();
        }
      };

      const onCandidate = (event) => {
        if (!event.candidate) {
          // Candidato nulo indica fin de candidatos
          if (timeoutHandle) clearTimeout(timeoutHandle);
          this.pc?.removeEventListener('icegatheringstatechange', checkState);
          this.pc?.removeEventListener('icecandidate', onCandidate);
          resolve();
        }
      };

      this.pc.addEventListener('icegatheringstatechange', checkState);
      this.pc.addEventListener('icecandidate', onCandidate);

      // Tiempo límite de seguridad para generar el QR sin demoras
      timeoutHandle = setTimeout(() => {
        this.pc?.removeEventListener('icegatheringstatechange', checkState);
        this.pc?.removeEventListener('icecandidate', onCandidate);
        resolve();
      }, timeoutMs);
    });
  }

  /**
   * Inicializa la conexión como Anfitrión (Host):
   * Crea el canal de datos, genera la Oferta SDP, espera ICE y devuelve el payload para el QR.
   * @returns {Promise<string>} Payload comprimido para el código QR
   */
  async initAsHost() {
    this.isHost = true;
    this.createPeerConnection();
    this.setState(ConnectionState.GATHERING_OFFER);

    // El host crea el canal de datos
    this.dataChannel = this.pc.createDataChannel('canvas-p2p-channel', {
      ordered: true
    });
    this.setupDataChannel(this.dataChannel);

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    // Esperar candidatos ICE para incluirlos en el QR
    await this.waitForIceGathering();

    this.setState(ConnectionState.WAITING_FOR_ANSWER);
    return SignalingHelper.encodeSessionDescription(this.pc.localDescription);
  }

  /**
   * El Anfitrión recibe y aplica la respuesta (Answer) generada por el Invitado.
   * @param {string} answerPayload Cadena comprimida del QR/texto de respuesta
   */
  async acceptAnswer(answerPayload) {
    if (!this.pc) {
      throw new Error('No hay una sesión de Anfitrión activa');
    }

    const sessionDesc = SignalingHelper.decodeSessionDescription(answerPayload);
    if (sessionDesc.type !== 'answer') {
      throw new Error(`Se esperaba una Respuesta (answer), pero se recibió: ${sessionDesc.type}`);
    }

    this.setState(ConnectionState.CONNECTING);
    await this.pc.setRemoteDescription(new RTCSessionDescription(sessionDesc));
  }

  /**
   * Inicializa la conexión como Invitado (Guest):
   * Recibe la oferta del Host, genera la Respuesta SDP, espera ICE y devuelve el payload para el QR.
   * @param {string} offerPayload Cadena comprimida del QR/texto de oferta
   * @returns {Promise<string>} Payload de respuesta para el código QR
   */
  async initAsGuest(offerPayload) {
    this.isHost = false;
    this.createPeerConnection();
    this.setState(ConnectionState.GATHERING_ANSWER);

    // El invitado escucha el canal de datos creado por el anfitrión
    this.pc.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.setupDataChannel(this.dataChannel);
    };

    const sessionDesc = SignalingHelper.decodeSessionDescription(offerPayload);
    if (sessionDesc.type !== 'offer') {
      throw new Error(`Se esperaba una Oferta (offer), pero se recibió: ${sessionDesc.type}`);
    }

    await this.pc.setRemoteDescription(new RTCSessionDescription(sessionDesc));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    // Esperar candidatos ICE para incluirlos en la respuesta
    await this.waitForIceGathering();

    this.setState(ConnectionState.CONNECTING);
    return SignalingHelper.encodeSessionDescription(this.pc.localDescription);
  }

  /**
   * Configura los eventos del RTCDataChannel.
   * @param {RTCDataChannel} channel 
   */
  setupDataChannel(channel) {
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      console.log('WebRTC DataChannel abierto exitosamente');
      this.setState(ConnectionState.CONNECTED);
      this.startHeartbeat();
      if (this.onChannelOpen) this.onChannelOpen();
    };

    channel.onclose = () => {
      console.log('WebRTC DataChannel cerrado');
      this.stopHeartbeat();
      this.setState(ConnectionState.DISCONNECTED, 'El canal de datos se ha cerrado.');
      if (this.onChannelClose) this.onChannelClose();
    };

    channel.onerror = (err) => {
      console.error('Error en RTCDataChannel:', err);
      if (this.onError) this.onError('Error en el canal de datos: ' + err.message);
    };

    channel.onmessage = (event) => {
      try {
        if (typeof event.data === 'string') {
          const parsed = JSON.parse(event.data);
          
          // Responder a PING
          if (parsed.type === 'PING') {
            this.send({ type: 'PONG', timestamp: parsed.timestamp });
            return;
          }
          if (parsed.type === 'PONG') {
            this.latency = Math.max(0, Date.now() - parsed.timestamp);
            return;
          }

          if (this.onMessage) {
            this.onMessage(parsed);
          }
        }
      } catch (err) {
        console.error('Error procesando mensaje entrante:', err);
      }
    };
  }

  /**
   * Envía un mensaje estructurado por el DataChannel.
   * @param {object} messageObject 
   */
  send(messageObject) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      return false;
    }

    try {
      const json = JSON.stringify(messageObject);
      this.dataChannel.send(json);
      return true;
    } catch (err) {
      console.error('Error enviando datos por DataChannel:', err);
      return false;
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.isConnected()) {
        this.send({ type: 'PING', timestamp: Date.now() });
      }
    }, 4000);
  }

  stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  isConnected() {
    return this.dataChannel && this.dataChannel.readyState === 'open';
  }

  cleanup() {
    this.stopHeartbeat();
    if (this.dataChannel) {
      try { this.dataChannel.close(); } catch {}
      this.dataChannel = null;
    }
    if (this.pc) {
      try { this.pc.close(); } catch {}
      this.pc = null;
    }
    this.setState(ConnectionState.DISCONNECTED);
  }
}
