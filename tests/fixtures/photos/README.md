`iphone-like.heic`: a real HEVC-coded HEIC (brands `mif1 heic hevc`, 1280×854), the `examples/example.heic`
file from the libheif project (github.com/strukturag/libheif). sharp's bundled libheif can't decode HEVC, so it
exercises the heic-decode path (T3.6.08). Every other test image is generated at runtime by
`tests/fixtures/images.ts`.
