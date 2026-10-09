/* eslint-disable @typescript-eslint/no-require-imports */
const { list, untouched } = require('./lib.cjs');
exports.all = async () => list([untouched(8000, 7000), untouched(100, 100)]);
