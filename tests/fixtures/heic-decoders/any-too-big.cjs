/* eslint-disable @typescript-eslint/no-require-imports */
// any image over 50 MP (here the second): refused from the container, nothing decoded
const { list, untouched } = require('./lib.cjs');
exports.all = async () => list([untouched(1000, 800), untouched(10000, 6000)]);
