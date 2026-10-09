// libheif decodes synchronously: a slow file blocks its thread. This never returns.
exports.all = () => {
  for (;;) {}
};
