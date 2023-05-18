# repa-shader
Web component to render webgl shaders

I'm planning to create a custom web component to easily embed fragment shaders to any website for a long time. Here it is finally - now that `webgpu` appeared, so I can move on to create something similar with that ;)

I've tried to create `<repa-component>` to be [TWIGL](https://twigl.app/) compatible, supporting (and more-or-less autodetecting) _geekest_ mode and MRT as well. (But it supports only 300 es mode.)

## Basic usage

Include the `repa-shader.js` module in your HTML, then add your fragment shader code into a `<repa-shader>` element. That's it. Here's a simple red background:

```html
<script type="module" src="repa-shader.js"></script>
<repa-shader width=400 height=400>
void main() {
  outColor = vec4(1.0, 0.0, 0.0, 1.0);
}
</repa-shader>
```

You can include your shader code in `<script type="x-shader/x-fragment">[your code here]</script>` tags as well, in this way you can override the default vertex shader too (using `x-shader/x-fragment` type).

## &lt;repa-shader&gt;

### Supported attributes

- `width`, `height`: embedded canvas size
- `alpha`: trasparent background
- `snippets`: list of snippets to load
- `snippet-prefix`: URL prefix of the snippets (`/snippets` by default)
- `mouse`: mouse support
- `orientation`: device orientation support
- `mode`: shader mode
  - `raw`: nothing is added, in this way you can embed version 200 shaders too
  - `classic`: ~ twigl classic 300 es mode
  - `geeker`: ~ twigl geeker 300 es mode
  - `geekest`: ~ twigl geekest 300 es mode (`noise.glsl` snippet automatically included)
- `render-target-count`: MRT target count
- `src`: external fragment shader source
- `fs-input`: id of the input/textarea element containing the shader source

### Uniforms

- `time` _float_, seconds from start (also available as `t`)
- `frame` _float_, frame number from start (`f`)
- `resolution` _vec2_, shader resolution (`r`)
- `mouse` _vec3_, mouse position + button state (`m`)
- `orientation` _vec3_, device orientation

## &lt;repa-texture&gt;

You can add textures using the `<repa-texture>` component included inside your `<repa-shader>`.

### Attributes

- `src`: texture source
- `ref`: `id` of the referred texture element (like an existing image or video in the page)
- `type`: texture type - sane autodetection available
  - `image`
  - `video`
  - `webcam`
  - `canvas`
  - `audio`
  - `shader` - other instance of `<repa-shader>`
  - `raw` - content provided via JS or as JSON
- `min-filter`, `mag-filter` (both set by `filter`): WebGL filtering
- `wrap-s`, `wrap-t`, `wrap-r` (all set by `wrap`): WebGL wrapping
- `format`: WebGL format
- `internal-format`: WebGL internal format
- `t3d`: 3d texture

More about filtering/wrapping/formats at [MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/texImage2D)

## Examples

Check the [demo](demo) folder for more detailed examples.
