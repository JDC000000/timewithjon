Stand-in HEIC decoders (CommonJS, the shape of heic-decode's `all()`), loaded by the HEIC worker in tests
(src/features/photos/**tests**/reencode-heic.test.ts). A `decode()` that must not run throws `DECODED`, so a test can
tell "refused before decoding" from "failed while decoding".
