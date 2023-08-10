import './style.css'
import { RLottie } from './rlottie'

// pnpm add ./
// import RLottie from '@sternelee/rlottie' // 使用当前打包的模块

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <h1>Hello Vite!</h1>
  <a href="https://vitejs.dev/guide/features.html" target="_blank">Documentation</a>
`

function mainInitTgStickers(options: any) {
  options = options || {};
  document.querySelectorAll('.rlottie_image').forEach(function (imgEl) {
    // @ts-ignore
    RLottie.init(imgEl, options);
  });
}

window.onload = () => {
  mainInitTgStickers({"maxDeviceRatio":2, "cachingModule":3, forceRender: true});
  setTimeout(() => {
    RLottie.destroyAll()
  }, 4000)
}
