// @ts-check

/**
 * createLogger - creates a logger function
 *
 * @param {string[]} pfx - logger prefix
 */
const createLogger = pfx => {
  return {
    info: (...args) => console.info(...pfx, ...args),
    log: (...args) => console.log(...pfx, ...args),
    warn: (...args) => console.warn(...pfx, ...args),
    error: (...args) => console.error(...pfx, ...args),
  };
};

const CHUNKS = {
  es300: '#version 300 es\n',
  geeker: `
#define FC gl_FragCoord
#define r resolution
#define m mouse
#define t time
#define f frame
precision highp float;
precision highp sampler3D;
uniform vec2 resolution;
uniform vec3 mouse;
uniform vec3 orientation;
uniform float time;
uniform float frame;
`,
  geekestStart: `
void main() {
`,
  geekestEnd: `
}
`,
};

const DEMO_FS = `
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec3 col = .5 + .5 * cos(uv.xyx + time + vec3(0, 2, 4));

  float dist = distance(uv, mouse.xy);
  float circle = smoothstep(.1, .2, dist) * .5 + .5;
  vec4 acolor = vec4(col * circle, circle);
  outColor = vec4(acolor);
}
`;

const DEFAULT_VS = `#version 300 es
in vec3 position;
void main(){
  gl_Position=vec4(position, 1.);
}
`;

class RepaShader extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.logger = createLogger(["%c[repa-shader]", "background: #282828; color: #b8bb26"]);
    this._snippets = {};
    this._postProgram = null;
    /** @type {WebGL2RenderingContext} */
    this._gl = null;
  }

  connectedCallback() {
    this._createStyle();

    if (!this._target) {
      this._target = this._createTarget();
    }

    if (!this._gl) {
      const glopts = {alpha: this.hasAttribute('alpha'), preserveDrawingBuffer: true};
      this._gl = this._target.getContext('webgl2', glopts); // @ts-ignore
      if (!this._gl) {
        this.logger.error("WebGL2 not supported");
        return;
      }
    }

    // TODO resize

    // postprocessing
    this._postProgram = this._gl.createProgram();
    const pvs = this._createShader(this._postProgram, this.postVS, true);
    const pfs = this._createShader(this._postProgram, this.postFS);
    this._gl.linkProgram(this._postProgram);
    this._gl.deleteShader(pvs);
    this._gl.deleteShader(pfs);
    this._postUniLocation = {};
    this._postUniLocation.texture = this._gl.getUniformLocation(this._postProgram, 'drawTexture');
    this._postAttLocation = this._gl.getAttribLocation(this._postProgram, 'position');

    this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this._gl.createBuffer());
    this._gl.bufferData(this._gl.ARRAY_BUFFER, new Float32Array([-1,1,0,-1,-1,0,1,1,0,1,-1,0]), this._gl.STATIC_DRAW);
    this._gl.disable(this._gl.DEPTH_TEST);
    this._gl.disable(this._gl.CULL_FACE);
    this._gl.disable(this._gl.BLEND);
    this._gl.clearColor(0,0,0,1);

    this.render();
  }

  disconnectedCallback() {
    // TODO stop animation
  }

  /**
   * render - loads the source if not provided and renders the shader
   *
   * @param {string} [source] - fragment shader source
   * @param {Number} [time] - timestamp to render for
   */
  async render(source, time) {
    if (!source) {
      source = await this.getFragmentShaderSource();
    }
    this._fsSource = source;
    this.reset(time);
  }

  /**
   * @return {string}
   */
  get snippetPrefix() {
    if (this.hasAttribute('snippet-prefix')) {
      return this.getAttribute('snippet-prefix');
    }

    let path = '';
    if (import.meta?.url) {
      const pathparts = new URL(import.meta.url).pathname.split('/');
      pathparts.pop();
      path = pathparts.join('/');
    }

    return path + '/snippets';
  }

  /**
   * loadSnippet - loads a snippet (prepending `snippetPrefix`)
   *
   * @param {string} name - snippet script name
   */
  async loadSnippet(name) {
    let url = name;
    if (!url.startsWith('http')) {
      url = `${this.snippetPrefix}/${name}`;
    }
    const res = await fetch(url);
    if (!res.ok) {
      this.logger.error(`Failed to load snippet ${name}`);
      this._snippets[name] = `// error loading snippet ${name}`;
      return;
    }
    const text = await res.text();
    this._snippets[name] = text;
  }

  /**
   * getSnippet - returns a snippet (loading it if necessary)
   *
   * @param {string} name
   * @return {string} - snippet source
   */
  async getSnippet(name) {
    if (!this._snippets[name]) {
      await this.loadSnippet(name);
    }

    return this._snippets[name];
  }

  /**
   * _getSnippets - load all the snippets from the `snippets` attribute
   *
   * @return {<Promise>} - resolves when all snippets are loaded
   */
  async _getSnippets() {
    if (!this.hasAttribute('snippets')) {
      return '';
    }

    const snippetNames = this.getAttribute('snippets').split(',');
    const promises = snippetNames.map(s => this.getSnippet(s));

    return await Promise.all(promises).then(snippets => snippets.join('\n'));
  }

  /**
   * _resizeTarget - resizes the current target (and the GL viewport) canvas based on its current size
   */
  _resizeTarget() {
    const {width, height} = this._target.getBoundingClientRect();
    this._target.width = width;
    this._target.height = height;
    this._gl.viewport(0, 0, width, height);
  }

  /**
   * _onOrientationEvent - handles orientation events
   *
   * @param {Event} e
   */
  _onOrientationEvent(e) {
    this._orientation = [e.alpha, e.beta, e.gamma];
  }

  _onMouseEvent(e) {
    const x = Math.min(Math.max(e.offsetX, 0), this._target.width);
    const y = Math.min(Math.max(e.offsetY, 0), this._target.height);
    const btn = e.buttons;
    this._mousePosition = [x / this._target.width, 1 - y / this._target.height, btn];
  }

  _resetBuffer(buff) {
    if (!this._gl || !buff) {
      return;
    }

    // framebuffer
    if (buff.framebuffer && this._gl.isFramebuffer(buff.framebuffer)) {
      this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, null);
      this._gl.deleteFramebuffer(buff.framebuffer);
      buff.framebuffer = null;
    }

    // renderbuffer
    if (buff.renderbuffer && this._gl.isRenderbuffer(buff.renderbuffer)) {
      this._gl.bindRenderbuffer(this._gl.RENDERBUFFER, null);
      this._gl.deleteRenderbuffer(buff.renderbuffer);
      buff.renderbuffer = null;
    }

    // textures
    if (buff.textures?.length) {
      buff.textures.forEach(t => {
        if (this._gl.isTexture(t)) {
          this._gl.bindTexture(this._gl.TEXTURE_2D, null);
          this._gl.deleteTexture(t);
        }
      });
      buff.textures = null;
    }
  }

  _createBuffer(w, h) {
    const buff = {};

    // framebuffer
    buff.framebuffer = this._gl.createFramebuffer();
    this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, buff.framebuffer);

    // renderbuffer
    buff.renderbuffer = this._gl.createRenderbuffer();
    this._gl.bindRenderbuffer(this._gl.RENDERBUFFER, buff.renderbuffer);
    this._gl.renderbufferStorage(this._gl.RENDERBUFFER, this._gl.DEPTH_COMPONENT16, w, h);
    this._gl.framebufferRenderbuffer(this._gl.FRAMEBUFFER, this._gl.DEPTH_ATTACHMENT, this._gl.RENDERBUFFER, buff.renderbuffer);

    // textures
    buff.textures = [];
    buff.buffers = [];
    for (let i = 0; i < this.mrt; i++) {
      let texture = this._gl.createTexture();
      this._gl.bindTexture(this._gl.TEXTURE_2D, texture);
      this._gl.texImage2D(this._gl.TEXTURE_2D, 0, this._gl.RGBA, w, h, 0, this._gl.RGBA, this._gl.UNSIGNED_BYTE, null);
      this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_MIN_FILTER, this._gl.LINEAR);
      this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_MAG_FILTER, this._gl.LINEAR);
      this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_WRAP_S, this._gl.CLAMP_TO_EDGE);
      this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_WRAP_T, this._gl.CLAMP_TO_EDGE);
      this._gl.framebufferTexture2D(this._gl.FRAMEBUFFER, this._gl.COLOR_ATTACHMENT0 + i, this._gl.TEXTURE_2D, texture, 0);
      buff.textures.push(texture);
      buff.buffers.push(this._gl.COLOR_ATTACHMENT0 + i);
    }

    // unbind
    this._gl.bindTexture(this._gl.TEXTURE_2D, null);
    this._gl.bindRenderbuffer(this._gl.RENDERBUFFER, null);
    this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, null);

    return buff;
  }

  _resetBuffers() {
    this._resetBuffer(this.backbuffer);
    this._resetBuffer(this.frontbuffer);
  }

  _getWrap(wrap) {
    return (wrap && this._gl[wrap.toUpperCase().replaceAll('-', '_')]) || this._gl.CLAMP_TO_EDGE;
  }

  _getFilter(filter) {
    return (filter && this._gl[filter.toUpperCase().replaceAll('-', '_')]) || this._gl.LINEAR;
  }

  _getFormat(format) {
    return (format && this._gl[format.toUpperCase().replaceAll('-', '_')]) || this._gl.RGBA;
  }

  _collectTextures() {
    this._textures = [];
    this._textures3d = [];

    this.querySelectorAll('repa-texture:not([t3d])').forEach(t => {
      const texture = this._gl.createTexture();
      this._gl.bindTexture(this._gl.TEXTURE_2D, texture);

      this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_WRAP_S, this._getWrap(t.wrapS));
      this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_WRAP_T, this._getWrap(t.wrapT));
      this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_MIN_FILTER, this._getFilter(t.minFilter));
      this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_MAG_FILTER, this._getFilter(t.magFilter));

      // fill texture with default black
      this._gl.texImage2D(this._gl.TEXTURE_2D, 0, this._gl.RGBA, 1, 1, 0, this._gl.RGBA, this._gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

      this._textures.push({
        texture,
        texElement: t,
      });
    });

    this.querySelectorAll('repa-texture[t3d]').forEach(t => {
      let texture = this._gl.createTexture();
      this._gl.bindTexture(this._gl.TEXTURE_3D, texture);
      this._gl.texParameteri(this._gl.TEXTURE_3D, this._gl.TEXTURE_MIN_FILTER, this._getFilter(t.minFilter));
      this._gl.texParameteri(this._gl.TEXTURE_3D, this._gl.TEXTURE_MAG_FILTER, this._getFilter(t.magFilter));
      this._gl.texParameteri(this._gl.TEXTURE_3D, this._gl.TEXTURE_WRAP_S, this._getWrap(t.wrapS));
      this._gl.texParameteri(this._gl.TEXTURE_3D, this._gl.TEXTURE_WRAP_T, this._getWrap(t.wrapT));
      this._gl.texParameteri(this._gl.TEXTURE_3D, this._gl.TEXTURE_WRAP_R, this._getWrap(t.wrapR));

      this._gl.texImage3D(this._gl.TEXTURE_3D, 0, this._gl.RGBA, 1, 1, 1, 0, this._gl.RGBA, this._gl.UNSIGNED_BYTE, new Uint8Array([64, 255, 128, 255]));

      this._textures3d.push({
        texture,
        texElement: t
      });
    });
  }

  async reset(time) {
    this._resizeTarget();
    this._resetBuffers();
    this._collectTextures();
    this.frontbuffer = this._createBuffer(this._target.width, this._target.height);
    this.backbuffer = this._createBuffer(this._target.width, this._target.height);

    if (this.hasAttribute('mouse')) {
      this._target.addEventListener('pointermove', this._onMouseEvent.bind(this));
      this._target.addEventListener('mousedown', this._onMouseEvent.bind(this));
      this._target.addEventListener('mouseup', this._onMouseEvent.bind(this));
      // TODO touch ?
    }

    if (this.hasAttribute('orientation')) {
      window.addEventListener('deviceorientation', this._onOrientationEvent.bind(this));
    }

    this.mode = this.getAttribute('mode') || this.mode;

    const program = this._gl.createProgram();
    const vs = this._createShader(program, await this.getVS(), true);
    if (!vs) {
      return;
    }
    const fs = this._createShader(program, await this.getFS(), false);
    if (!fs) {
      this._gl.deleteShader(vs);
      return;
    }

    this._gl.linkProgram(program);
    this._gl.deleteShader(vs);
    this._gl.deleteShader(fs);

    if (!this._gl.getProgramParameter(program, this._gl.LINK_STATUS)) {
      const msg = this._gl.getProgramInfoLog(program);
      this.logger.error("Program link error: ", msg);
      // TODO error callback
      program = null;
      return;
    }

    if (this._program) {
      this._gl.deleteProgram(this._program);
    }
    this.program = program;
    this._gl.useProgram(this.program);
    this._uniLocation = {};
    this._uniLocation.resolution = this._gl.getUniformLocation(this.program, 'resolution');
    this._uniLocation.mouse = this._gl.getUniformLocation(this.program, 'mouse');
    this._uniLocation.orientation = this._gl.getUniformLocation(this.program, 'orientation');
    this._uniLocation.time = this._gl.getUniformLocation(this.program, 'time');
    this._uniLocation.frame = this._gl.getUniformLocation(this.program, 'frame');

    // backbuffers
    for (let i = 0; i < this.mrt; i++) {
      this._uniLocation[`backbuffer${i}`] = this._gl.getUniformLocation(this.program, `backbuffer${i}`);
    }

    // textures
    this._textures.forEach((t) => {
      this._uniLocation[t.texElement.name] = this._gl.getUniformLocation(this.program, t.texElement.name); // texture
      this._uniLocation[t.texElement.name+'_d'] = this._gl.getUniformLocation(this.program, t.texElement.name+'_d'); // dimensions
      t.texElement.forceUpdate();
    });

    this._textures3d.forEach((t) => {
      this._uniLocation[t.texElement.name] = this._gl.getUniformLocation(this.program, t.texElement.name); // texture
      this._uniLocation[t.texElement.name+'_d'] = this._gl.getUniformLocation(this.program, t.texElement.name+'_d'); // dimensions
      t.texElement.forceUpdate();
    });

    this._attLocation = this._gl.getAttribLocation(this.program, 'position');
    this._mousePosition= [0, 0, 0];
    this._orientation = [0, 0, 0];
    this._startTime = Date.now();
    this._frame = 0;

    this.draw(time);
  }

  draw(time) {
    if (time) {
      this._nowTime = time;
    } else {
      this._nowTime = (Date.now() - this._startTime) * 0.001;
    }

    ++this._frame;

    this._gl.useProgram(this.program);

    this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, this.frontbuffer.framebuffer);

    // backbuffer
    this._gl.drawBuffers(this.frontbuffer.buffers);

    for (let i = 0; i < this.mrt; i++) {
      this._gl.activeTexture(this._gl.TEXTURE0 + i);
      this._gl.bindTexture(this._gl.TEXTURE_2D, this.backbuffer.textures[i]);
      this._gl.uniform1i(this._uniLocation[`backbuffer${i}`], i);
    }

    this._gl.enableVertexAttribArray(this._attLocation);
    this._gl.vertexAttribPointer(this._attLocation, 3, this._gl.FLOAT, false, 0, 0);
    this._gl.clear(this._gl.COLOR_BUFFER_BIT);
    this._gl.uniform2fv(this._uniLocation.resolution, [this._target.width, this._target.height]);
    this._gl.uniform3fv(this._uniLocation.mouse, this._mousePosition);
    this._gl.uniform3fv(this._uniLocation.orientation, this._orientation);
    this._gl.uniform1f(this._uniLocation.time, this._nowTime * .001);
    this._gl.uniform1f(this._uniLocation.frame, this._frame);

    // textures
    this._textures.forEach((t, i) => {
      this._gl.activeTexture(this._gl.TEXTURE0 + i + this.mrt);
      this._gl.bindTexture(this._gl.TEXTURE_2D, t.texture);

      // update if needed
      if (t.texElement.shouldUpdate) {
        const format = this._getFormat(t.texElement.format);
        this._gl.pixelStorei(this._gl.UNPACK_FLIP_Y_WEBGL, t.texElement.flipY);

        this._gl.texImage2D(this._gl.TEXTURE_2D, 0, format, t.texElement.width, t.texElement.height, 0, format, this._gl.UNSIGNED_BYTE, t.texElement.update());
      }

      this._gl.uniform1i(this._uniLocation[t.texElement.name], i + this.mrt);
      this._gl.uniform2fv(this._uniLocation[t.texElement.name+'_d'], [t.texElement.width || 1, t.texElement.height || 1]);
    });

    this._textures3d.forEach((t, i) => {
      this._gl.activeTexture(this._gl.TEXTURE0 + i + this.mrt + this._textures.length);
      this._gl.bindTexture(this._gl.TEXTURE_3D, t.texture);

      // update if needed
      if (t.texElement.shouldUpdate) {
        const format = this._getFormat(t.texElement.format);
        this._gl.pixelStorei(this._gl.UNPACK_FLIP_Y_WEBGL, 0);

        this._gl.texImage3D(this._gl.TEXTURE_3D, 0, format, t.texElement.width, t.texElement.height, t.texElement.depth, 0, format, this._gl.UNSIGNED_BYTE, t.texElement.update());
      }

      this._gl.uniform1i(this._uniLocation[t.texElement.name], i + this.mrt + this._textures.length);
      this._gl.uniform3fv(this._uniLocation[t.texElement.name+'_d'], [t.texElement.width || 1, t.texElement.height || 1, t.texElement.depth || 1]);
    });

    this._gl.drawArrays(this._gl.TRIANGLE_STRIP, 0, 4);

    // fill buffer
    this._gl.useProgram(this._postProgram);
    this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, null);
    this._gl.activeTexture(this._gl.TEXTURE0);
    this._gl.bindTexture(this._gl.TEXTURE_2D, this.frontbuffer.textures[0]);
    this._gl.enableVertexAttribArray(this._postAttLocation);
    this._gl.vertexAttribPointer(this._postAttLocation, 3, this._gl.FLOAT, false, 0, 0);
    this._gl.clear(this._gl.COLOR_BUFFER_BIT);
    this._gl.uniform1i(this._postUniLocation.texture, 0);
    this._gl.drawArrays(this._gl.TRIANGLE_STRIP, 0, 4);

    this._gl.flush();

    // swap buffers
    [this.frontbuffer, this.backbuffer] = [this.backbuffer, this.frontbuffer];

    // TODO draw callback

    if (this.running) {
      requestAnimationFrame(this.draw.bind(this));
    }
  }

  run() {
    this.removeAttribute('paused');
    this.draw();
  }

  pause() {
    this.setAttribute('paused', '');
  }

  get running() {
    return !this.hasAttribute('paused');
  }

  _createShader(program, source, isVertex) {
    if (!this._gl) {
      return null;
    }
    const type = isVertex ? this._gl.VERTEX_SHADER : this._gl.FRAGMENT_SHADER;
    const shader = this._gl.createShader(type);
    this._gl.shaderSource(shader, source);
    this._gl.compileShader(shader);

    if (!this._gl.getShaderParameter(shader, this._gl.COMPILE_STATUS)) {
      const msg = this._gl.getShaderInfoLog(shader);
      this.logger.error("Shader compile error:", msg); // TODO format + error callback
      return null;
    }
    // TODO success callback
    this.logger.info(`Shader successfully compiled [${isVertex ? 'vertex' : 'fragment'}]`);

    this._gl.attachShader(program, shader);
    const log = this._gl.getShaderInfoLog(shader);
    if (log) {
      this.logger.log(log);
    }
    return shader;
  }

  get width() {
    return parseInt(this.getAttribute('width'), 10);
  }

  get height() {
    return parseInt(this.getAttribute('height'), 10);
  }

  _createTarget() {
    const target = document.createElement('canvas');
    target.width = this.width || 300;
    target.height = this.height || 300;
    this.shadowRoot.appendChild(target);

    return target;
  }

  _createStyle() {
    let style = this.shadowRoot.querySelector('style') || document.createElement('style');
    style.textContent = `
      :host {
        display: block;
      }
    `;
    this.shadowRoot.appendChild(style);
  }

  _appendStyle(content) {
    const style = this.shadowRoot.querySelector('style');
    style.textContent += content;
  }

  get target() {
    return this._target;
  }

  get mrt() {
    return +this.getAttribute('render-target-count') || 1;
  }

  get postVS() {
    return `#version 300 es
in vec3 position;
out vec2 vTexCoord;
void main() {
  vTexCoord = (position.xy + 1.0) * 0.5;
  gl_Position = vec4(position, 1.);
}`;
  }

  get postFS() {
    return `#version 300 es
precision mediump float;
uniform sampler2D drawTexture;
in vec2 vTexCoord;
layout (location = 0) out vec4 outColor;
void main() {
  outColor = texture(drawTexture, vTexCoord);
}`;
  }

  _getRenderTargets() {
    const targets = [];

    if (this.mrt > 1) {
      for (let i = 0; i < this.mrt; i++) {
        const target = `
  #define b${i} backbuffer${i}
  #define o${i} outColor${i}
  uniform sampler2D backbuffer${i};
  layout (location = ${i}) out vec4 outColor${i};
  `;
        targets.push(target);
      }
    } else {
      targets.push(`
  #define b backbuffer0
  #define o outColor0
  #define backbuffer backbuffer0
  #define outColor outColor0
  uniform sampler2D backbuffer0;
  layout (location = 0) out vec4 outColor0;
  `);
    }

    return targets.join('');
  }

  _getTextures() {
    return this._textures.map(t => {
      return `
  uniform sampler2D ${t.texElement.name};
  uniform vec2 ${t.texElement.name}_d;
  `;
    }).join('') +
    this._textures3d.map(t => {
      return `
  uniform sampler3D ${t.texElement.name};
  uniform vec3 ${t.texElement.name}_d;
  `;
    }).join('');
  }

  async getVS() {
    let source = '';

    const vsEl = this.querySelector('script[type="x-shader/x-vertex"]');
    if (vsEl) {
      const vsSrc = vsEl.getAttribute('src');
      if (vsSrc) {
        source = await fetch(vsSrc).then(res => res.text());
      } else {
        source = vsEl.textContent.trim();
      }
    }

    if (!source) {
      source = DEFAULT_VS;
    }

    return source;
  }

  async getFS() {
    // auto guessing mode
    // - starts with #version -> raw
    // - contains `precision` -> twigl classic300es
    // - no `precision`, but has `main()` -> twigl geeker300es
    // - no `precision`, no `main()` -> twigl geekest300es
    let mode = this.mode;
    if (!mode) {
      const hasVersion = this._fsSource.startsWith('#version');
      const hasPrecision = this._fsSource.includes('precision');
      const hasMain = this._fsSource.includes('main()');
      if (hasVersion) {
        mode = 'raw';
      } else if (hasPrecision) {
        mode = 'classic';
      } else if (hasMain) {
        mode = 'geeker';
      } else {
        mode = 'geekest';
      }
      this.logger.info(`Auto guessing mode: ${mode}`);
    }

    let start = '';
    let end = '';
    let snippets = '';
    switch (mode) {
      case 'raw':
        return this._fsSource;
      case 'classic':
        start = CHUNKS.es300;
        break;
      case 'geeker':
        snippets = await this._getSnippets();
        start = CHUNKS.es300 + CHUNKS.geeker + this._getRenderTargets() + this._getTextures() + snippets;
        break;
      case 'geekest':
        snippets = await this._getSnippets();
        if (!snippets) {
          snippets = await this.getSnippet('noise.glsl');
        }
        start = CHUNKS.es300 + CHUNKS.geeker + this._getRenderTargets() + this._getTextures() + snippets + CHUNKS.geekestStart;
        end = CHUNKS.geekestEnd;
        break;
    }

    return `${start}\n${this._fsSource}\n${end}`;
  }

  async getFragmentShaderSource() {
    let source = '';

    // text area editor
    let fsInput = this.shadowRoot.querySelector('textarea[name="fragment-shader"]') || this.querySelector('textarea[name="fragment-shader"]');
    if (!fsInput) {
      const fsInputId = this.getAttribute('fs-input');
      fsInput = document.getElementById(fsInputId);
    }
    if (fsInput) {
      source = fsInput.value;
    }

    // script tag
    if (!source) {
      const fsEl = this.querySelector('script[type="x-shader/x-fragment"]');
      if (fsEl) {
        const fsSrc = fsEl.getAttribute('src');
        if (fsSrc) {
          source = await fetch(fsSrc).then(res => res.text());
        } else {
          source = fsEl.textContent.trim();
        }
      }
    }

    // text content
    if (!source) {
      source = Array.from(this.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim();
    }

    // fallback demo
    if (!source) {
      source = DEMO_FS;
    }

    // fill back to textarea
    if (fsInput) {
      fsInput.value = source;
    }

    return source;
  }

  get canvas() {
    return this._target;
  }
}

customElements.define("repa-shader", RepaShader);

export default RepaShader;
