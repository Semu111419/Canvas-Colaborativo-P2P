/**
 * signaling.js
 * Codificación, compresión y generación/lectura de datos de señalización WebRTC (SDP + ICE)
 * para emparejamiento manual mediante códigos QR o texto copiado sin servidor permanente.
 */

/* global pako, qrcode */

export class SignalingHelper {
  /**
   * Comprime un texto usando pako (Deflate) y lo codifica en Base64 URL-safe.
   * @param {string} str 
   * @returns {string}
   */
  static compressString(str) {
    try {
      const uint8 = new TextEncoder().encode(str);
      const compressed = pako.deflate(uint8, { level: 9 });
      let binary = '';
      const len = compressed.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(compressed[i]);
      }
      return btoa(binary);
    } catch (err) {
      console.warn('Fallback compresión:', err);
      return btoa(encodeURIComponent(str));
    }
  }

  /**
   * Descomprime una cadena Base64 generada por compressString.
   * @param {string} base64Str 
   * @returns {string}
   */
  static decompressString(base64Str) {
    try {
      const binary = atob(base64Str.trim());
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const decompressed = pako.inflate(bytes);
      return new TextDecoder().decode(decompressed);
    } catch (err) {
      try {
        return decodeURIComponent(atob(base64Str.trim()));
      } catch (err2) {
        throw new Error('No se pudo descomprimir el contenido de señalización: ' + err.message);
      }
    }
  }

  /**
   * Empaqueta una descripción de sesión SDP (oferta o respuesta) en un formato compacto.
   * @param {RTCSessionDescriptionInit} sessionDesc 
   * @returns {string} Cadena lista para el QR o para copiar.
   */
  static encodeSessionDescription(sessionDesc) {
    if (!sessionDesc || !sessionDesc.type || !sessionDesc.sdp) {
      throw new Error('Descripción de sesión inválida');
    }

    const payload = {
      t: sessionDesc.type === 'offer' ? 'o' : 'a',
      s: this.compressString(sessionDesc.sdp),
      v: 1
    };

    return JSON.stringify(payload);
  }

  /**
   * Decodifica una cadena proveniente de un QR o texto copiado a RTCSessionDescriptionInit.
   * @param {string} rawString 
   * @returns {RTCSessionDescriptionInit}
   */
  static decodeSessionDescription(rawString) {
    if (!rawString || typeof rawString !== 'string') {
      throw new Error('Los datos proporcionados están vacíos o no son válidos');
    }

    const clean = rawString.trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      throw new Error('El código no tiene formato JSON válido');
    }

    if (!parsed || !parsed.t || !parsed.s) {
      throw new Error('Formato de datos de conexión desconocido');
    }

    const type = parsed.t === 'o' ? 'offer' : (parsed.t === 'a' ? 'answer' : null);
    if (!type) {
      throw new Error('Tipo de señalización no reconocido (se esperaba oferta o respuesta)');
    }

    const sdp = this.decompressString(parsed.s);
    return {
      type,
      sdp
    };
  }

  /**
   * Renderiza un código QR en un elemento contenedor (HTML o Canvas).
   * @param {string} text Contenido a codificar
   * @param {HTMLElement} containerElement Contenedor donde insertar el QR
   * @param {number} [cellSize=4] Tamaño de cada celda en píxeles
   */
  static renderQRCode(text, containerElement, cellSize = 4) {
    containerElement.innerHTML = '';

    try {
      // 0 = autodeterminar versión, 'M' = corrección de errores media (15%)
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();

      // Creamos una imagen SVG o Tag
      const imgTag = qr.createSvgTag(cellSize, 8);
      containerElement.innerHTML = imgTag;

      const svg = containerElement.querySelector('svg');
      if (svg) {
        svg.style.maxWidth = '100%';
        svg.style.height = 'auto';
        svg.style.borderRadius = '8px';
        svg.style.boxShadow = '0 4px 14px rgba(0,0,0,0.2)';
      }
    } catch (err) {
      console.error('Error generando QR:', err);
      containerElement.innerHTML = `<div class="error-box">No se pudo generar el código QR: ${err.message}. Por favor use la opción de copiar texto.</div>`;
    }
  }
}
