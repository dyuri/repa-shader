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

const DEMO = `
precision highp float;
uniform vec2 resolution;
uniform vec2 mouse;
uniform float time;
out vec4 outColor;
void main(){
  vec2 r=resolution, p=(gl_FragCoord.xy*2.-r)/min(r.x,r.y)-mouse;
  for (int i=0;i<8;++i) {
    p.xy=abs(p)/abs(dot(p,p))-vec2(.9+cos(time*.2)*.4);
  }
  outColor=vec4(p.xxy,1);
}
`;

class RepaShader extends HTMLElement {
  constructor(cfg = {}) {
    super();
    this._cfg = cfg;
    this.attachShadow({ mode: 'open' });
    this.logger = createLogger(["%c[repa-shader]", "background: #1d2021; color: #bada55"]);
  }

  connectedCallback() {
    this._createStyle();

    if (!this._target) {
      this._target = this._createTarget();
    }

    if (!this._gl) {
      const glopts = this._cfg.glopts || {alpha: true, preserveDrawingBuffer: true};
      this._gl = this._target.getContext('webgl2', glopts);
      if (!this._gl) {
        this.logger.error("WebGL2 not supported");
        return;
      }
    }

    // TODO resize
    // TODO postprogram
    // TODO source + reset

    this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this._gl.createBuffer());
    this._gl.bufferData(this._gl.ARRAY_BUFFER, new Float32Array([-1,1,0,-1,-1,0,1,1,0,1,-1,0]), this._gl.STATIC_DRAW);
    this._gl.disable(this._gl.DEPTH_TEST);
    this._gl.disable(this._gl.CULL_FACE);
    this._gl.disable(this._gl.BLEND);
    this._gl.clearColor(0,0,0,1);

    // TODO remove
    this.demo();
  }

  render(source, time) {
    if (!source) {
      return;
    }
    this._fsSource = source;
    this.reset(time);
  }

  _resizeTarget() {
    const {width, height} = this._target.getBoundingClientRect();
    this._target.width = width;
    this._target.height = height;
    // TODO buffers
    this._gl.viewport(0, 0, width, height);
  }

  _onMouseMove(e) {
    const x = Math.min(Math.max(e.offsetX, 0), this._target.width);
    const y = Math.min(Math.max(e.offsetY, 0), this._target.height);
    this._mousePosition = [x / this._target.width, 1 - y / this._target.height];
  }

  reset(time) {
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
    const fs = this._createShader(program, this.FS, false);
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

    // TODO geek mode
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
    // TODO buffers

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

  _createTarget() {
    const target = document.createElement('canvas');
    target.width = this._cfg.width || 300; // TODO
    target.height = this._cfg.height || 300; // TODO
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

  // TODO
  get VS() {
    return `#version 300 es
in vec3 position;
void main(){
  gl_Position=vec4(position, 1.);
}
`;
  }

  get FS() {
    // auto guessing mode
    // - contains `precision` -> twigl classic300es
    // - no `precision`, but has `main()` -> twigl geeker300es
    // - no `precision`, no `main()` -> twigl geekest300es
    // TODO: mrt
    if (!this.mode) {
      const hasPrecision = this._fsSource.includes('precision');
      const hasMain = this._fsSource.includes('main()');
      if (hasPrecision) {
        this.mode = 'classic';
      } else if (hasMain) {
        this.mode = 'geeker';
      } else {
        this.mode = 'geekest';
      }
    }

    let start = '';
    let end = '';
    switch (this.mode) {
      case 'classic':
        start = CHUNKS.es300;
        break;
      case 'geeker':
        start = CHUNKS.es300 + CHUNKS.geeker;
        break;
      case 'geekest':
        start = CHUNKS.es300 + CHUNKS.geeker + CHUNKS.geekestStart;
        end = CHUNKS.geekestEnd;
        break;
    }

    return `${start}\n${this._fsSource}\n${end}`;
  }

  demo() {
    this.render(DEMO);
  }

}

customElements.define("repa-shader", RepaShader);

export default RepaShader;
