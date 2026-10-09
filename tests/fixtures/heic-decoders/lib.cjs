// Helpers for the stand-in decoders: an image of a size whose decode() returns grey RGBA, or must not be called.
const rgba = (width, height) => ({
  width,
  height,
  data: new Uint8ClampedArray(width * height * 4).fill(200),
});
exports.image = (width, height) => ({ width, height, decode: async () => rgba(width, height) });
exports.untouched = (width, height) => ({
  width,
  height,
  decode: async () => {
    throw new Error('DECODED');
  },
});
exports.list = (images) => Object.assign(images, { dispose() {} });
