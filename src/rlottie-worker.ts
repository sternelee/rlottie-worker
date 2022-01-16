import { Module } from './rlottie-wasm'

import { inflate } from 'pako'

type IReqId = number
type IFrameCount = number
type ReplyType = string
type IClamped = ArrayBuffer

function reply(replyType?: ReplyType, reqId?: IReqId, frameCount?: IFrameCount, fps?: any) {
  if(arguments.length < 1) {
    throw new TypeError('reply - not enough arguments');
  }
  let args = Array.prototype.slice.call(arguments, 1);
  if(isSafari(self)) {
    postMessage({ 'queryMethodListener': arguments[0], 'queryMethodArguments': args });
  } else {
    let transfer = [];
    if (fps && fps instanceof ArrayBuffer) {
      transfer.push(fps)
    }
    if (fps && fps.buffer && fps.buffer instanceof ArrayBuffer) {
      transfer.push(fps.buffer)
    }
    // @ts-ignore
    postMessage({ 'queryMethodListener': arguments[0], 'queryMethodArguments': args }, transfer);
  }
}

interface RLottieWorkerApi {
  init: Function
  destroy: Function
  resize: Function
  buffer: Function
  frameCount: IFrameCount
  render: Function
  loadFromData: Function
}
class _RLottieWorker {
  Api: RLottieWorkerApi = {} as RLottieWorkerApi
  private initApi () {
    this.Api = {
      init: Module.cwrap('lottie_init', '', []),
      destroy: Module.cwrap('lottie_destroy', '', ['number']),
      resize: Module.cwrap('lottie_resize', '', ['number', 'number', 'number']),
      buffer: Module.cwrap('lottie_buffer', 'number', ['number']),
      frameCount: Module.cwrap('lottie_frame_count', 'number', ['number']),
      render: Module.cwrap('lottie_render', '', ['number', 'number']),
      loadFromData: Module.cwrap('lottie_load_from_data', 'number', ['number', 'number']),
    };
  }
  init () {
    this.initApi()
    reply('ready');
  }
}

const RLottieWorker = new _RLottieWorker()

class RLottieItem {
  stringOnWasmHeap: any
  handle: any
  frameCount: IFrameCount
  reqId: IReqId
  width: number
  height: number
  fps: number
  dead: boolean
  constructor (reqId: IReqId, jsString: string, width: number, height: number, fps: number) {
    this.stringOnWasmHeap = null;
    this.handle = null;
    this.frameCount = 0;

    this.reqId = reqId;
    this.width = width;
    this.height = height;
    this.fps = Math.max(1, Math.min(60, fps || 60));

    this.dead = false;

    this.init(jsString);
    reply('loaded', this.reqId, this.frameCount, this.fps);
  }
  init (jsString: string) {
    try {
      this.handle = RLottieWorker.Api.init();

      this.stringOnWasmHeap = Module.allocate(Module.intArrayFromString(jsString), 'i8', 0);

      this.frameCount = RLottieWorker.Api.loadFromData(this.handle, this.stringOnWasmHeap);

      RLottieWorker.Api.resize(this.handle, this.width, this.height);
    } catch(e) {
      console.error('init RLottieItem error:', e);
    }
  }
  render (frameNo: number, clamped?: Uint8ClampedArray) {
    if(this.dead) return;

    if(this.frameCount < frameNo || frameNo < 0) {
      return;
    }

    try {
      RLottieWorker.Api.render(this.handle, frameNo);

      let bufferPointer = RLottieWorker.Api.buffer(this.handle);

      let data = Module.HEAPU8.subarray(bufferPointer, bufferPointer + (this.width * this.height * 4));

      if(!clamped) {
        clamped = new Uint8ClampedArray(data);
      } else {
        clamped.set(data);
      }

      reply('frame', this.reqId, frameNo, clamped);
    } catch(e) {
      console.error('Render error:', e);
      this.dead = true;
    }
  }
  destroy () {
    this.dead = true;
    RLottieWorker.Api.destroy(this.handle);
  }
}

Module.onRuntimeInitialized = function() {
  RLottieWorker.init();
};

let items: { [key: IReqId]: any } = {};
let queryableFunctions = {
  loadFromData: function(reqId: IReqId, url: string, width: number, height: number) {
    getUrlContent(url, function(err: any, data: Uint8Array) {
      if (err) {
        return console.warn('Can\'t fetch file ' + url, err);
      }
      try {
        let json = inflate(data, {to: 'string'});
        let json_parsed = JSON.parse(json);
        items[reqId] = new RLottieItem(reqId, json, width, height, json_parsed.fr);
      } catch (e) {
        return console.warn('Invalid file ' + url);
      }
    });
  },
  destroy: function(reqId: IReqId) {
    items[reqId].destroy();
    delete items[reqId];
  },
  renderFrame: function(reqId: IReqId, frameNo: IFrameCount, clamped: IClamped) {
    items[reqId].render(frameNo, clamped);
  }
};

function defaultReply(message: any) {
  // your default PUBLIC function executed only when main page calls the queryableWorker.postMessage() method directly
  // do something
  console.log('defaultReply', message)
}

/**
 * Returns true when run in WebKit derived browsers.
 * This is used as a workaround for a memory leak in Safari caused by using Transferable objects to
 * transfer data between WebWorkers and the main thread.
 * https://github.com/mapbox/mapbox-gl-js/issues/8771
 *
 * This should be removed once the underlying Safari issue is fixed.
 *
 * @private
 * @param scope {WindowOrWorkerGlobalScope} Since this function is used both on the main thread and WebWorker context,
 *      let the calling scope pass in the global scope object.
 * @returns {boolean}
 */
let _isSafari: any = null;
function isSafari(scope: any) {
  if(_isSafari == null) {
    let userAgent = scope.navigator ? scope.navigator.userAgent : null;
    _isSafari = !!scope.safari ||
    !!(userAgent && (/\b(iPad|iPhone|iPod)\b/.test(userAgent) || (!!userAgent.match('Safari') && !userAgent.match('Chrome'))));
  }
  return _isSafari;
}

function getUrlContent(path: string, callback: Function) {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', path, true);
    if ('responseType' in xhr) {
      xhr.responseType = 'arraybuffer';
    }
    if (xhr.overrideMimeType) {
      xhr.overrideMimeType('text/plain; charset=x-user-defined');
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        if (xhr.status === 200 || xhr.status === 0) {
          callback(null, xhr.response || xhr.responseText);
        } else {
          callback(new Error('Ajax error: ' + this.status + ' ' + this.statusText));
        }
      }
    };
    xhr.send();
  } catch (e: any) {
    callback(new Error(e));
  }
}

// type IQueryMethod = 'loadFromData' | 'destroy' | 'renderFrame'
onmessage = function(oEvent: any) {
  const { data  } = oEvent
  if(data instanceof Object && data.hasOwnProperty('queryMethod') && data.hasOwnProperty('queryMethodArguments')) {
    // @ts-ignore
    queryableFunctions[data.queryMethod].apply(self, data.queryMethodArguments);
  } else {
    defaultReply(data);
  }
};


// Comlink.expose({})
