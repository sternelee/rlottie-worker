const fs = require('fs')
const buffer = fs.readFileSync('./src/rlottie-wasm.wasm', { encoding: 'base64'})
fs.writeFileSync('./src/rlottie-wasm-base64.ts', `export const wasmContent = 'data:application/octet-stream;base64,${buffer}'`)
