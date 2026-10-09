/* eslint-disable @typescript-eslint/no-require-imports */
const { list } = require('./lib.cjs');
exports.all = async () =>
  list([
    {
      width: 10,
      height: 10,
      decode: async () => {
        throw new Error('HEIF processing error');
      },
    },
  ]);
