# Canvas Colaborativo P2P

Aplicación web móvil para compartir e interactuar con un **canvas infinito en tiempo real** entre dos dispositivos mediante **WebRTC DataChannel**, sin servidores dedicados de señalización permanente, sin cuentas de usuario y sin almacenamiento remoto de archivos.

---

## 🚀 Características Principales

- **Conexión P2P Directa (Serverless):** Emparejamiento bidireccional mediante códigos QR comprimidos con zlib/Deflate (SDP + candidatos ICE compactados). Opcionalmente permite copiar y pegar códigos para pruebas en un mismo equipo o mensajería.
- **Canvas Infinito Interactivo:** 
  - Desplazamiento horizontal y vertical fluido (*pan*).
  - Zoom multitáctil (*pinch-to-zoom*) en dispositivos móviles y rueda de ratón en escritorio.
  - Cuadrícula infinita con guías de origen (0,0) adaptativas.
- **Manipulación de Imágenes:**
  - Carga directa desde la galería de fotos o cámara fotográfica (`<input type="file" accept="image/*">`).
  - Pegado directo desde el portapapeles (*clipboard* o Ctrl+V).
  - Selección, rotación con sujeción a ángulos clave (0°, 90°, 180°, 270°), escalado manteniendo proporciones, arrastre y duplicación.
  - Reordenamiento de capas (*z-index*: traer adelante / enviar atrás).
  - Eliminación con botón visual o teclado.
- **Cámara Compartida en Tiempo Real:**
  - Sincronización continua de posición (X, Y) y nivel de zoom.
  - **Árbitro temporal:** Se otorga el control de la cámara al usuario que realiza el gesto de navegación más reciente.
  - Prevención activa de bucles de actualización (*echo loops*) y mensajes redundantes mediante filtrado y *throttling* a 33–60 fps.
  - Opción de desacoplar temporalmente la cámara para inspección libre e independiente.
- **Transferencia Binaria por Bloques (*Chunking*):**
  - Las imágenes se optimizan y dividen en bloques SCTP de 16 KB con control de contrapresión (*backpressure*).
  - Barra de progreso interactiva en pantalla de subida y descarga.
- **Recuperación de Estado Completo:**
  - Tras conectarse o reconectarse, el anfitrión transmite el estado actual de todos los objetos y cámara (`STATE_SYNC`).
  - Resolución determinista de conflictos mediante política *Last-Write-Wins* (LWW) con desempate por identificador de par.
- **100% Estático y Desplegable en GitHub Pages:**
  - Sin dependencias de compilación complejas ni backend. Listo para desplegar en GitHub Pages.

---

## 📁 Estructura Modular del Proyecto

```text
├── index.html                   # Shell principal HTML5 responsive y PWA-ready
├── css/
│   └── style.css                # Estilos modernos para móvil (Glassmorphism, Dark UI, Safe Areas)
├── js/
│   ├── main.js                  # Punto de entrada y orquestador del ciclo de vida
│   ├── canvas/
│   │   ├── canvas-manager.js    # Canvas infinito, gestos táctiles (pinch/pan), cuadrícula y cámara
│   │   └── object-manager.js    # Gestión de imágenes Konva, Transformer, LWW y optimización
│   ├── p2p/
│   │   ├── signaling.js         # Compresión Deflate/pako y codificación/decodificación QR
│   │   ├── webrtc.js            # Envoltorio de RTCPeerConnection, DataChannel y recolección ICE
│   │   ├── protocol.js          # Definición de mensajes, validación y chunking binario de imágenes
│   │   └── sync-engine.js       # Árbitro de cámara, recuperación de estado y sincronización
│   └── ui/
│       ├── qr-scanner.js        # Lector de códigos QR con cámara trasera móvil (Html5Qrcode)
│       ├── modal-manager.js     # Modales de emparejamiento, escaneo, entrada manual y ayuda
│       ├── toolbar.js           # Barra inferior táctil (herramientas, capas, zoom y portapapeles)
│       └── status-bar.js        # Notificaciones flotantes (toasts), latencia y estado de conexión
└── vendor/
    ├── konva.min.js             # Motor gráfico 2D para Canvas interactivo
    ├── qrcode.js                # Generador de códigos QR compacto
    ├── html5-qrcode.min.js      # Lector de códigos QR mediante stream de cámara web/móvil
    └── pako.min.js              # Compresión de alta velocidad zlib/deflate para reducir tamaño de SDP
```

---

## 📲 Procedimiento de Conexión entre Dos Celulares

El emparejamiento se realiza directamente entre los dos dispositivos mediante un intercambio de dos pasos:

```
[ Celular 1: Anfitrión ]                       [ Celular 2: Invitado ]
          │                                              │
          ├─────── 1. Genera Oferta (QR) ───────►        │
          │                                              │
          │       (Celular 2 escanea QR 1)               │
          │                                              │
          │        ◄────── 2. Genera Respuesta (QR) ─────┤
          │                                              │
          │       (Celular 1 escanea QR 2)               │
          ▼                                              ▼
   ══════════════════════════════════════════════════════════════
               CANAL WEBRTC DATACHANNEL CONECTADO
   ══════════════════════════════════════════════════════════════
```

### Paso a Paso:

1. **Abrir la aplicación** en ambos celulares en un navegador moderno (Chrome, Safari, Firefox, Edge, etc.) bajo HTTPS.
2. **En el Celular 1 (Anfitrión):**
   - Pulsa el botón **"Conectar"** en la barra superior.
   - En la pestaña **"1. Anfitrión (Crear)"**, pulsa **"Crear sala (Generar QR)"**.
   - Se creará la oferta WebRTC compactada y se mostrará un código QR en pantalla.
3. **En el Celular 2 (Invitado):**
   - Pulsa el botón **"Conectar"** y selecciona la pestaña **"2. Invitado (Unirse)"**.
   - Pulsa **"Escanear QR del Anfitrión"** (concede permiso de cámara si el navegador lo solicita) y enfoca el código QR de la pantalla del Celular 1.
   - En cuanto detecte el código, el Celular 2 procesará la oferta y generará automáticamente un nuevo código QR con su **Respuesta**.
4. **En el Celular 1 (Anfitrión):**
   - Pulsa el botón **"Escanear Respuesta del Invitado"** y enfoca el código QR de la pantalla del Celular 2.
5. **¡Conexión establecida!**
   - La insignia superior cambiará a verde: **"Conectado P2P"**.
   - El Anfitrión transmitirá de inmediato la instantánea de los objetos existentes y la posición de la cámara.
   - A partir de este momento, cualquier imagen, movimiento, zoom o rotación se sincronizará instantáneamente.

> **💡 Modo Alternativo (Sin Cámara o Pruebas en un mismo PC):**
> Cada código QR cuenta con un botón **"Copiar"** y una opción de **"Pegar código manualmente"**. Permite probar la aplicación en dos pestañas del mismo navegador o compartir el código por cualquier aplicación de mensajería (WhatsApp, Telegram, etc.).

---

## 💻 Instrucciones de Ejecución Local

Dado que la aplicación está construida con módulos estándar de JavaScript (ES Modules), debe servirse a través de un servidor HTTP local (no abrir directamente con doble clic `file://` debido a las políticas de seguridad CORS del navegador para módulos JS).

### Opción 1: Con Python (incluido por defecto en la mayoría de sistemas)
Abre una terminal en la carpeta del proyecto y ejecuta:

```bash
# Python 3
python -m http.server 8080
```

Luego abre en tu navegador:
```text
http://localhost:8080
```

### Opción 2: Con Node.js (npx)
```bash
npx serve .
# o también:
npx http-server -p 8080
```

### Opción 3: Con VS Code Live Server
Si usas Visual Studio Code, instala la extensión **Live Server**, haz clic derecho sobre `index.html` y selecciona **"Open with Live Server"**.

---

## 🌐 Instrucciones de Despliegue en GitHub Pages

La aplicación no requiere ningún paso de compilación (`npm build`), por lo que su despliegue en GitHub Pages es inmediato:

1. **Crear o inicializar el repositorio Git:**
   ```bash
   git init
   git add .
   git commit -m "feat: Canvas colaborativo P2P completo"
   ```
2. **Subir a GitHub:**
   ```bash
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
   git push -u origin main
   ```
3. **Activar GitHub Pages:**
   - Entra en tu repositorio en GitHub y ve a **Settings** &rarr; pestaña **Pages**.
   - En la sección **Build and deployment**:
     - **Source:** *Deploy from a branch*.
     - **Branch:** Selecciona `main` y la carpeta `/ (root)`.
     - Haz clic en **Save**.
4. En 1–2 minutos, GitHub Pages publicará tu aplicación en:
   ```text
   https://TU_USUARIO.github.io/TU_REPOSITORIO/
   ```
   *Nota:* Al estar alojado en GitHub Pages con HTTPS automático, los navegadores móviles (iOS Safari y Android Chrome) permitirán el acceso nativo a la cámara trasera para el escaneo de códigos QR.

---

## ⚙️ Arquitectura Técnica y Decisiones de Diseño

### 1. WebRTC Serverless con SDP Compactado
El intercambio de SDP estándar en navegadores suele superar los 2–3 KB de texto plano debido a descriptores multimedia y candidatos ICE. 
En este proyecto:
- Configuramos el `RTCPeerConnection` únicamente para canal de datos (sin pistas de audio ni video), lo que reduce sustancialmente el tamaño base.
- Utilizamos **pako** (Deflate a nivel 9) para comprimir los datos SDP antes de codificarlos en Base64.
- Esto reduce el tamaño total del payload a solo ~350–500 caracteres, permitiendo generar un código QR de densidad media muy legible para cámaras de teléfonos móviles a distancia cómoda y en diversas condiciones de iluminación.

### 2. Árbitro de Cámara y Prevención de Bucles (*Echo Loops*)
La cámara infinita sincroniza `x`, `y` y `scale` (zoom). Para asegurar una experiencia fluida sin saltos ni bucles infinitos de rebote:
- Cada mensaje de cámara lleva un `timestamp` UTC de alta precisión y el `peerId` de origen.
- Cuando un usuario inicia un toque o arrastre local, se activa una bandera de prioridad local y se envía el estado de la cámara con *throttling* a 33 ms (~30 fps).
- Al recibir una actualización remota, la función `applyRemoteCamera()` actualiza la posición y escala de Konva desactivando temporalmente los escuchadores de emisión local (`isApplyingRemoteCamera = true`), garantizando que la cámara remota no genere un eco de vuelta.
- Si ambos usuarios mueven la pantalla casi a la vez, el árbitro otorga la prioridad temporal al gesto con la marca de tiempo más reciente.

### 3. Transferencia Binaria por Bloques y Manejo de Imágenes
- Cuando un usuario añade una foto de alta resolución desde su teléfono (por ejemplo, 12 a 48 megapíxeles), la imagen se procesa en memoria mediante un canvas auxiliar antes de ser enviada: se escala proporcionalmente a un máximo de 1600 px y se optimiza a JPEG/WebP de calidad 85%.
- La imagen resultante se fragmenta en bloques de 16 KB (`IMAGE_CHUNK`) que se envían secuencialmente verificando el umbral de contrapresión (`bufferedAmount <= 256 KB`), impidiendo bloqueos del búfer SCTP de WebRTC.
- Mientras los bloques se transmiten, el receptor visualiza inmediatamente un contenedor provisional (*placeholder*) en la posición exacta del canvas con un indicador animado de carga. Al completarse la recepción de todos los bloques, la imagen real se ensambla a partir del Blob binario y se actualiza instantáneamente en el canvas.

### 4. Resolución Determinista de Conflictos (LWW)
- Todos los objetos cuentan con un identificador único global (`obj_<timestamp>_<random>`), coordenadas `x`, `y`, dimensiones `width`, `height`, factores de escala `scaleX`, `scaleY`, rotación `rotation`, índice de capa `zIndex` y marca de última modificación `lastModified`.
- Cuando dos usuarios manipulan el mismo objeto al mismo tiempo, el conflicto se resuelve de forma determinista mediante **Last-Write-Wins (LWW)**: prevalece la modificación con mayor marca de tiempo UTC; en caso de empate exacto de milisegundo, se utiliza el identificador alfanumérico del par como desempate.
- La manipulación simultánea de objetos distintos ocurre sin interferencias mutuas, ya que los mensajes de actualización van direccionados por el ID específico de cada objeto.

---

## 📋 Resumen de Cumplimiento de Criterios

| Criterio de Aceptación | Estado | Implementación |
| :--- | :---: | :--- |
| **1. Dos celulares se conectan y comparten sesión** | ✅ | Emparejamiento QR bidireccional Oferta/Respuesta vía WebRTC DataChannel sin backend permanente. |
| **2. Imágenes y modificaciones sincronizadas bidireccionalmente** | ✅ | Eventos `OBJECT_ADD`, `OBJECT_UPDATE`, `OBJECT_DELETE` e `IMAGE_CHUNK` en tiempo real. |
| **3. Desplazamiento y zoom reflejados en tiempo real** | ✅ | Cámara compartida continua (`CAMERA_SYNC`), soporte multitáctil *pinch-to-zoom* y pan. |
| **4. Manipulación simultánea de objetos diferentes** | ✅ | Objetos desacoplados por ID y resolución de conflictos determinista LWW en objetos compartidos. |
| **5. Recuperación de estado tras reconexión** | ✅ | Handshake `STATE_SYNC_REQUEST` y `STATE_SYNC` completo con retransmisión de imágenes faltantes. |
| **6. Funciona en navegadores móviles modernos** | ✅ | Probado con WebRTC estándar, soporte táctil adaptativo y *viewport-fit=cover* para iOS y Android. |
| **7. Comunicación directa sin servidores externos** | ✅ | Las imágenes y coordenadas viajan cifradas punto a punto mediante RTCDataChannel; el servidor solo aloja archivos estáticos. |
