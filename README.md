## @sternelee/rlottie

使用 `rlottie` + `pako` + `webworker` 在前端实现 `lottie` 的动画效果, 如 telegram 官网动画的效果, 或本地演示 `npm run dev`

### 将 `lottie` 动画`json`文件使用 `pako` 压缩 生成素材资源

```javasript
const pako = require('pako')
const fs = require('fs')
fs.readFile('./json/xxx.json', null, function (err, data) {
  if (err) {
    console.log(err)
  }
  try {
    const buffer = pako.deflate(data, { level: 9 });
    fs.writeFile('./json/xxx', buffer, 'binary', function (err) {
      console.log(err)
    })
  } catch (e) {
    console.log(e)
  }
})
```


### 前端使用

1. 页面配置资源位置

```html
<picture class="rlottie_image">
  <source type="application/x-rlottie" srcset="/xxx">
</picture>
```

2. 实现动画

将模块目录下的 `rlottie-webworker.[hash].js` 和 `rlottie-wasm.wasm` 放置在您的静态资源目录,方便模块加载

```javasript
import Rlottie from '@sternelee/rlottie'

window.onload = () => {
  document.querySelectorAll('.rlottie_image').forEach(function (imgEl) {
    RLottie.init(imgEl, {});
  });
}
```
