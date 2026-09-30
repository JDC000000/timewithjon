// heic-decode ships no types. Only `.all()` is used (src/features/photos/reencode.ts): it reads every top-level
// image's size from the container WITHOUT decoding pixels, so the pixel cap runs before any big allocation.
declare module 'heic-decode' {
  interface Input {
    buffer: Buffer | Uint8Array | ArrayBuffer;
  }
  interface Decoded {
    width: number;
    height: number;
    data: Uint8ClampedArray; // RGBA, width * height * 4
  }
  interface HeifImage {
    width: number;
    height: number;
    decode(): Promise<Decoded>;
  }
  type HeifImages = HeifImage[] & { dispose(): void };
  function one(input: Input): Promise<Decoded>;
  namespace one {
    function all(input: Input): Promise<HeifImages>;
  }
  export default one;
}
