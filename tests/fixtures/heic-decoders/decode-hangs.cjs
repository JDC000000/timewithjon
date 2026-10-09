/* eslint-disable @typescript-eslint/no-require-imports */
// the container reads fine, then the pixel decode never finishes (and keeps its thread alive meanwhile)
const { list } = require('./lib.cjs');
exports.all = async () =>
  list([{ width: 40, height: 30, decode: () => new Promise(() => setInterval(() => {}, 1000)) }]);
