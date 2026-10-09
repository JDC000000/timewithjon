/* eslint-disable @typescript-eslint/no-require-imports */
const { list, image } = require('./lib.cjs');
exports.all = async () => list([image(40, 30), image(40, 30)]);
