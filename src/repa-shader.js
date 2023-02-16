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
#define o outColor
precision highp float;
uniform vec2 resolution;
uniform vec2 mouse;
uniform float time;
uniform float frame;
out vec4 outColor;
`, // TODO sampler2D, MRT
  geekestStart: `
void main() {
`,
  geekestEnd: `
}
`,
};

const DEMO_FS = `
precision highp float;
uniform vec2 resolution;
uniform vec2 mouse;
uniform float time;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec3 col = .5 + .5 * cos(uv.xyx + time + vec3(0, 2, 4));

  float dist = distance(uv, mouse);
  float circle = smoothstep(.1, .2, dist) * .5 + .5;
  vec4 acolor = vec4(col * circle, circle);
  outColor = vec4(acolor);
}
`;

class RepaShader extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.logger = createLogger(["%c[repa-shader]", "background: #1d2021; color: #bada55"]);
    this._snippets = {};
  }

  connectedCallback() {
    this._createStyle();

    if (!this._target) {
      this._target = this._createTarget();
    }

    if (!this._gl) {
      const glopts = {alpha: this.hasAttribute('alpha'), preserveDrawingBuffer: true};
      this._gl = this._target.getContext('webgl2', glopts);
      if (!this._gl) {
        this.logger.error("WebGL2 not supported");
        return;
      }
    }

    // TODO resize

    this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this._gl.createBuffer());
    this._gl.bufferData(this._gl.ARRAY_BUFFER, new Float32Array([-1,1,0,-1,-1,0,1,1,0,1,-1,0]), this._gl.STATIC_DRAW);
    this._gl.disable(this._gl.DEPTH_TEST);
    this._gl.disable(this._gl.CULL_FACE);
    this._gl.disable(this._gl.BLEND);
    this._gl.clearColor(0,0,0,1);

    this.render(this.getFragmentShaderSource());
  }

  render(source, time) {
    if (!source) {
      return;
    }
    this._fsSource = source;
    this.reset(time);
  }

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

  async getSnippet(name) {
    if (!this._snippets[name]) {
      await this.loadSnippet(name);
    }

    return this._snippets[name];
  }

  async _getSnippets() {
    if (!this.hasAttribute('snippets')) {
      return '';
    }

    const snippetNames = this.getAttribute('snippets').split(',');
    const promises = snippetNames.map(s => this.getSnippet(s));

    return await Promise.all(promises).then(snippets => snippets.join('\n'));
  }

  _resizeTarget() {
    const {width, height} = this._target.getBoundingClientRect();
    this._target.width = width;
    this._target.height = height;
    this._gl.viewport(0, 0, width, height);
  }

  _onMouseMove(e) {
    const x = Math.min(Math.max(e.offsetX, 0), this._target.width);
    const y = Math.min(Math.max(e.offsetY, 0), this._target.height);
    this._mousePosition = [x / this._target.width, 1 - y / this._target.height];
  }

  async reset(time) {
    this._resizeTarget();

    if (this.hasAttribute('mouse')) {
      this._target.addEventListener('pointermove', this._onMouseMove.bind(this));
    }

    this.mode = this.getAttribute('mode') || this.mode;

    const program = this._gl.createProgram();
    const vs = this._createShader(program, this.VS, true);
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

    const resolution = 'resolution';
    const mouse = 'mouse';
    const nowTime = 'time';
    const frame = 'frame';
    // TODO sound? backbuffer? mrt?

    if (this._program) {
      this._gl.deleteProgram(this._program);
    }
    this.program = program;
    this._gl.useProgram(this.program);
    this._uniLocation = {};
    this._uniLocation.resolution = this._gl.getUniformLocation(this.program, resolution);
    this._uniLocation.mouse = this._gl.getUniformLocation(this.program, mouse);
    this._uniLocation.time = this._gl.getUniformLocation(this.program, nowTime);
    this._uniLocation.frame = this._gl.getUniformLocation(this.program, frame);

    this._attLocation = this._gl.getAttribLocation(this.program, 'position');
    this._mousePosition= [0, 0];
    this._startTime = Date.now();
    this._frame = 0;

    this.draw(time);
  }

  draw(time) {
    if (this.running) {
      requestAnimationFrame(this.draw.bind(this));
    }

    if (time) {
      this._nowTime = time;
    } else {
      this._nowTime = (Date.now() - this._startTime) * 0.001;
    }

    ++this._frame;

    this._gl.useProgram(this.program);

    this._gl.enableVertexAttribArray(this._attLocation);
    this._gl.vertexAttribPointer(this._attLocation, 3, this._gl.FLOAT, false, 0, 0);
    this._gl.clear(this._gl.COLOR_BUFFER_BIT);
    this._gl.uniform2fv(this._uniLocation.resolution, [this._target.width, this._target.height]);
    this._gl.uniform2fv(this._uniLocation.mouse, this._mousePosition);
    this._gl.uniform1f(this._uniLocation.time, this._nowTime * .001);
    this._gl.uniform1f(this._uniLocation.frame, this._frame);

    this._gl.drawArrays(this._gl.TRIANGLE_STRIP, 0, 4);

    this._gl.flush();
    // TODO draw callback
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
    return this.getAttribute('width');
  }

  get height() {
    return this.getAttribute('height');
  }

  _createTarget() {
    const target = document.createElement('canvas');
    target.width = this.width || 300; // TODO
    target.height = this.height || 300; // TODO
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

  get VS() {
    return `#version 300 es
in vec3 position;
void main(){
  gl_Position=vec4(position, 1.);
}
`;
  }

  async getFS() {
    // auto guessing mode
    // - contains `precision` -> twigl classic300es
    // - no `precision`, but has `main()` -> twigl geeker300es
    // - no `precision`, no `main()` -> twigl geekest300es
    // TODO: mrt
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
      case 'classic':
        start = CHUNKS.es300;
        break;
      case 'geeker':
        snippets = await this._getSnippets();
        start = CHUNKS.es300 + CHUNKS.geeker + snippets;
        break;
      case 'geekest':
        snippets = await this._getSnippets();
        const noise = await this.getSnippet('noise.glsl');
        start = CHUNKS.es300 + CHUNKS.geeker + noise + snippets + CHUNKS.geekestStart;
        end = CHUNKS.geekestEnd;
        break;
    }

    return `${start}\n${this._fsSource}\n${end}`;
  }

  getFragmentShaderSource() {
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
        source = fsEl.textContent;
      }
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

}

customElements.define("repa-shader", RepaShader);

export default RepaShader;
