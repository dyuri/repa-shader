const createLogger = pfx => {
  return {
    info: (...args) => console.info(...pfx, ...args),
    log: (...args) => console.log(...pfx, ...args),
    warn: (...args) => console.warn(...pfx, ...args),
    error: (...args) => console.error(...pfx, ...args),
  };
};

const isImage = (src) => {
  return /\w+\.(jpg|png|jpeg|svg|webp)(?=\?|$)/i.test(src);
};

const isVideo = (src) => {
  return /\w+\.(mp4|3gp|webm|ogv|avif)(?=\?|$)/i.test(src);
};

/* TODO
 * - display content on canvas
 * - ready promise
 **
 * types: image, [video, webcam], [canvas, shader]
 */
class RepaTexture extends HTMLElement {
  constructor() {
    super();
    this.logger = createLogger(["%c[repa-texture]", "background: #282828; color: #fabd2f"]);
    this.ready = false;
    this._forceUpdate = false;
  }

  connectedCallback() {
    this._load();
  }

  static get observedAttributes() {
    return ['src', 'type', 'mag-filter', 'min-filter', 'filter', 'wrap-s', 'wrap-t', 'wrap'];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    this.logger.info(`Attribute changed: ${name} ${oldValue} -> ${newValue}`);
    if (this.ready) {
      if (name === 'src') {
        this._load(true);
      } else {
        this._forceUpdate = true;
      }
    }
  }

  async _load(reload = false) {
    if (this.ready && !reload) {
      return;
    }

    this.ready = false;

    // drop old content if we created it
    if (this._hiddenEl) {
      this._hiddenEl.remove();
      this.ref = null;
    }

    // load new ref
    const ref = this.getAttribute('ref');
    if (ref) {
      const refEl = document.getElementById(ref);
      if (refEl) {
        this.ref = refEl;
      }
    }

    if (!this.ref) {
      const src = this.getAttribute('src');
      if (src) {
        try {
          this.ref = await this._loadSource(src);
        } catch (e) {
          this.logger.error(`Source ${src} cannot be loaded:`, e);
          this.ready = true;
        }
      }
    }

    if (this.ref) {
      this.ready = true;
      this._forceUpdate = true;
    } else {
      this.logger.error('Source cannot be loaded');
    }
  }

  async _loadSource(src) {
    const type = this.getAttribute('type') || this._guessType(this.src);
    this._type = type;

    if (!type) {
      this.logger.error(`Unknown type: ${src}`);
    } else {
      this.logger.log(`Loading ${src} as ${type}`);
    }

    let ref = null;

    switch (type) {
      case 'image':
        ref = await this._loadImage(src);
      break;
      case 'video':
        ref = await this._loadVideo(src);
      break;
      case 'webcam':
        ref = await this._createWebcam();
      break;
    }

    return ref;
  }

  _hideInDOM(el) {
    const hiddenEl = document.createElement('div');
    hiddenEl.style.width = hiddenEl.style.height = '1px';
    hiddenEl.style.top = hiddenEl.style.left = '1px';
    hiddenEl.style.overflow = 'hidden';
    hiddenEl.style.position = 'fixed';
    hiddenEl.style.zIndex = '-100';
    hiddenEl.style.opacity = '0';
    hiddenEl.style.pointerEvents = 'none';
    hiddenEl.appendChild(el);

    this._hiddenEl = hiddenEl;
    document.body.appendChild(this._hiddenEl);
  }

  async _loadImage(src) {
    const imgEl = document.createElement('img');
    imgEl.crossOrigin = 'anonymous';
    const loader = new Promise((resolve, reject) => {
      imgEl.onload = () => resolve(imgEl);
      imgEl.onerror = reject;
      imgEl.src = src;
    });

    this._hideInDOM(imgEl);

    return await loader;
  }

  async _loadVideo(src) {
    const videoEl = document.createElement('video');
    videoEl.crossOrigin = 'anonymous';
    videoEl.autoplay = true;
    videoEl.loop = true;
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.src = src;

    this._hideInDOM(videoEl);

    return videoEl;
  }

  async _createWebcam() {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      const videoEl = document.createElement('video');
      videoEl.autoplay = true;
      videoEl.width = 640;
      videoEl.height = 480;

      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      videoEl.srcObject = stream;

      this._hideInDOM(videoEl);

      return videoEl;
    }

    this.logger.error('Webcam is not supported');

    return null;
  }

  get src() {
    return this.getAttribute('src');
  }

  get type() {
    if (this._type) {
      return this._type;
    }

    if (this.ref) {
      if (this.ref instanceof HTMLImageElement) {
        return 'image';
      } else if (this.ref instanceof HTMLVideoElement) {
        return 'video';
      } else if (this.ref instanceof HTMLCanvasElement) {
        return 'canvas';
      } else if (this.ref.nodeName === 'REPA-SHADER') {
        return 'shader';
      }
    }

    return null;
  }

  get content() {
    if (this.ref) {
      if (this.type === 'shader') {
        return this.ref.target;
      } else {
        return this.ref;
      }
    }

    return null;
  }

  _guessType(src) {
    if (src.toLowerCase() === 'webcam') {
      return 'webcam';
    }

    if (isImage(src)) {
      return 'image';
    }

    if (isVideo(src)) {
      return 'video';
    }

    return null;
  }

  update() {
    this._forceUpdate = false;
    return this.content;
  }

  forceUpdate() {
    this._forceUpdate = true;
  }

  get shouldUpdate() {
    return this.ready &&
      (this._forceUpdate || (
        this.ref && (
          (this.ref instanceof HTMLVideoElement && this.ref.readyState === this.ref.HAVE_ENOUGH_DATA) ||
          (this.ref instanceof HTMLCanvasElement)
        )
      )
    );
  }

  get width() {
    return this.ref?.videoWidth || this.ref?.width || 0;
  }

  get height() {
    return this.ref?.videoHeight || this.ref?.height || 0;
  }

  get magFilter() {
    return this.getAttribute('mag-filter') || this.getAttribute('filter') || 'linear';
  }

  get minFilter() {
    return this.getAttribute('min-filter') || this.getAttribute('filter') || 'linear';
  }

  get wrapS() {
    return this.getAttribute('wrap-s') || this.getAttribute('wrap') || 'clamp-to-edge';
  }

  get wrapT() {
    return this.getAttribute('wrap-t') || this.getAttribute('wrap') || 'clamp-to-edge';
  }

  get name() {
    if (!this._name) {
      let name = this.getAttribute('name');
      if (!name) {
        const textures = this.parentNode.querySelectorAll('repa-texture');
        textures.forEach((texture, i) => {
          if (texture === this) {
            name = `texture${i}`;
          }
        });
      }

      this._name = name;
    }

    return this._name;
  }
}

customElements.define("repa-texture", RepaTexture);

export default RepaTexture;
