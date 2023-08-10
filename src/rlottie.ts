import Worker from './rlottie-worker.ts?worker&inline'

interface IOptions {
  maxDeviceRatio?: number; // 比率，可控制大小
  cachingModule?: number;
  playOnce?: boolean;
  forceRender?: boolean;
}

interface IRlPlayer {
  thumb: HTMLImageElement | null;
  isInViewport: boolean;
  reqId: number;
  el: HTMLPictureElement;
  nextFrameNo: number | false;
  frames: {
    [key: number]: Uint8ClampedArray;
  };
  width: number;
  height: number;
  rWorker: QueryableWorker;
  options: IOptions;
  paused: boolean;
  times: number[];
  clamped: Uint8ClampedArray;
  imageData: ImageData;
  frameCount: number;
  frameQueue: FrameQueue;
  frameThen: number;
  frameInterval: number;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  fps: number;
  forceRender: boolean;
}

const userAgent = window.navigator.userAgent;
const isSafari = !!(
    userAgent &&
    (/\b(iPad|iPhone|iPod)\b/.test(userAgent) ||
      (!!userAgent.match("Safari") && !userAgent.match("Chrome"))));


class Rlottie {
  private apiInitStarted = false;
  private apiInited = false;
  private initCallbacks: Function[] = [];
  private deviceRatio = window.devicePixelRatio || 1;
  private rlottieWorkers: QueryableWorker[] = [];
  private curWorkerNum = 0;
  private startTime = +new Date();
  private dT() {
    return "[" + (+new Date() - this.startTime) / 1000.0 + "] ";
  }
  private reqId = 0;
  private mainLoopTO: number = 0;
  private checkViewportDate: number = 0;
  private lastRenderDate: number = 0;
  players: { [key: string]: IRlPlayer } = Object.create(null);
  WORKERS_LIMIT = 1;
  private isRAF = isSafari;
  // private isRAF = true;
  private wasmIsSupported() {
    try {
      if (
        typeof WebAssembly === "object" &&
        typeof WebAssembly.instantiate === "function"
      ) {
        const module = new WebAssembly.Module(
          Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00)
        );
        if (module instanceof WebAssembly.Module) {
          return (
            new WebAssembly.Instance(module) instanceof WebAssembly.Instance
          );
        }
      }
    } catch (e) {}
    return false;
  }
  private _isSupported() {
    return (
      this.wasmIsSupported() &&
      typeof Uint8ClampedArray !== "undefined" &&
      typeof Worker !== "undefined" &&
      typeof ImageData !== "undefined"
    );
  }
  isSupported = this._isSupported();
  private mainLoop = () => {
    let key, rlPlayer, delta, rendered;
    let now = +Date.now();
    let checkViewport = !this.checkViewportDate || (now - this.checkViewportDate) > 1000;
    for (key in this.players) {
      rlPlayer = this.players[key];
      if (rlPlayer &&
          rlPlayer.frameCount) {
        delta = now - rlPlayer.frameThen;
        if (delta > rlPlayer.frameInterval) {
          rendered = this.render(rlPlayer, checkViewport);
          if (rendered) {
            this.lastRenderDate = now;
          }
        }
      }
    }
    let delay = now - this.lastRenderDate < 100 ? 16 : 500;
    if (delay < 20 && this.isRAF) {
      this.mainLoopTO = requestAnimationFrame(this.mainLoop)
    } else {
      this.mainLoopTO = setTimeout(this.mainLoop, delay);
    }
    if (checkViewport) {
      this.checkViewportDate = now;
    }
  }
  private setupMainLoop() {
    let isEmpty = true, key, rlPlayer;
    for (key in this.players) {
      rlPlayer = this.players[key];
      if (rlPlayer &&
          rlPlayer.frameCount) {
        isEmpty = false;
        break;
      }
    }
    if (!!this.mainLoopTO === isEmpty) {
      if (isEmpty) {
        if (this.isRAF) {
          cancelAnimationFrame(this.mainLoopTO);
        }
        try {
          clearTimeout(this.mainLoopTO);
        } catch (e) {};
        this.mainLoopTO = 0;
      } else {
        if (this.isRAF) {
          this.mainLoopTO = requestAnimationFrame(this.mainLoop);
        } else {
          this.mainLoopTO = setTimeout(this.mainLoop, 0);
        }
      }
    }
  }

  private initApi(callback: Function) {
    const that = this
    if (this.apiInited) {
      callback && callback();
    } else {
      callback && this.initCallbacks.push(callback);
      if (!this.apiInitStarted) {
        console.log(this.dT(), 'rlottie init');
        this.apiInitStarted = true;
        let workersRemain = this.WORKERS_LIMIT;
        let firstRlottieWorker = this.rlottieWorkers[0] = new QueryableWorker();
        firstRlottieWorker.addListener('ready', function () {
          console.log(that.dT(), 'worker #0 ready');
          firstRlottieWorker.addListener('frame', that.onFrame);
          firstRlottieWorker.addListener('loaded', that.onLoaded);
          --workersRemain;
          if (!workersRemain) {
            console.log(that.dT(), 'workers ready');
            that.apiInited = true;
            for (let i = 0; i < that.initCallbacks.length; i++) {
              that.initCallbacks[i]();
            }
            that.initCallbacks = [];
          } else {
            for (let workerNum = 1; workerNum < that.WORKERS_LIMIT; workerNum++) {
              (function(workerNum) {
                let rlottieWorker = that.rlottieWorkers[workerNum] = new QueryableWorker();
                rlottieWorker.addListener('ready', function () {
                  console.log(that.dT(), 'worker #' + workerNum + ' ready');
                  rlottieWorker.addListener('frame', that.onFrame);
                  rlottieWorker.addListener('loaded', that.onLoaded);
                  --workersRemain;
                  if (!workersRemain) {
                    console.log(that.dT(), 'workers ready');
                    that.apiInited = true;
                    for (let i = 0; i < that.initCallbacks.length; i++) {
                      that.initCallbacks[i]();
                    }
                    that.initCallbacks = [];
                  }
                });
              })(workerNum);
            }
          }
        });
      }
    }
  }

  destroyWorkers() {
    for (let workerNum = 0; workerNum < this.WORKERS_LIMIT; workerNum++) {
      if (this.rlottieWorkers[workerNum]) {
        this.rlottieWorkers[workerNum].terminate();
        console.log("worker #" + workerNum + " terminated");
      }
    }
    console.log("workers destroyed");
    this.apiInitStarted = this.apiInited = false;
    this.rlottieWorkers = [];
  }

  private initPlayer(
    el: HTMLPictureElement & { rlPlayer: IRlPlayer },
    options: IOptions
  ) {
    if (el.rlPlayer) return;
    if (el.tagName.toLowerCase() != "picture") {
      console.warn("only picture tag allowed");
      return;
    }
    options = options || {};
    let rlPlayer = (el.rlPlayer = {} as IRlPlayer);
    rlPlayer.thumb = el.querySelector("img");
    let tgs_source = el.querySelector('source[type="application/x-rlottie"]');
    let url = (tgs_source && tgs_source.getAttribute("srcset")) || "";
    if (!url) {
      console.warn("picture source application/x-rlottie not found");
      return;
    }
    let pic_width = (el.clientWidth || el.getAttribute("width")) as number;
    let pic_height = (el.clientHeight || el.getAttribute("height")) as number;
    let curDeviceRatio = options.maxDeviceRatio
      ? Math.min(options.maxDeviceRatio, this.deviceRatio)
      : this.deviceRatio;
    if (!pic_width || !pic_height) {
      pic_width = pic_height = 256;
    }
    rlPlayer.reqId = ++this.reqId;
    this.players[this.reqId] = rlPlayer;
    rlPlayer.el = el;
    rlPlayer.nextFrameNo = false;
    rlPlayer.frames = {};
    rlPlayer.width = Math.trunc(pic_width * curDeviceRatio);
    rlPlayer.height = Math.trunc(pic_height * curDeviceRatio);
    rlPlayer.rWorker = this.rlottieWorkers[this.curWorkerNum++];
    if (this.curWorkerNum >= this.rlottieWorkers.length) {
      this.curWorkerNum = 0;
    }
    rlPlayer.options = options;
    rlPlayer.paused = false;
    rlPlayer.times = [];
    rlPlayer.clamped = new Uint8ClampedArray(
      rlPlayer.width * rlPlayer.height * 4
    );
    rlPlayer.imageData = new ImageData(rlPlayer.width, rlPlayer.height);
    rlPlayer.rWorker.sendQuery(
      "loadFromData",
      rlPlayer.reqId,
      url,
      rlPlayer.width,
      rlPlayer.height
    );
  }

  destroyAll () {
    const players = this.players
    for (const key in players) {
      // @ts-ignore
      if (players[key]) this.destroy(players[key].el);
    }
    this.destroyWorkers()
  }

  destroy(el: HTMLPictureElement & { rlPlayer: any }) {
    // console.log("destroy 11: ", el)
    if (!el.rlPlayer) return;
    // console.log("destroy 22: ", el.rlPlayer)
    let rlPlayer = el.rlPlayer;
    delete this.players[rlPlayer.reqId];
    rlPlayer = null;
    this.setupMainLoop();
  }

  private render(rlPlayer: IRlPlayer, checkViewport: boolean) {
    if (!rlPlayer.canvas ||
        rlPlayer.canvas.width == 0 ||
        rlPlayer.canvas.height == 0) {
      return false;
    }
    if (!rlPlayer.forceRender) {
      let focused = window.isFocused ? window.isFocused() : document.hasFocus();
      if (!focused ||
          rlPlayer.paused ||
          !rlPlayer.frameCount) {
        return false;
      }
      let isInViewport = rlPlayer.isInViewport;
      if (isInViewport === undefined || checkViewport) {
        let rect = rlPlayer.el.getBoundingClientRect();
        if (rect.bottom < 0 ||
            rect.right < 0 ||
            rect.top > (window.innerHeight || document.documentElement.clientHeight) ||
            rect.left > (window.innerWidth || document.documentElement.clientWidth)) {
          isInViewport = false;
        } else {
          isInViewport = true;
        }
        rlPlayer.isInViewport = isInViewport;
      }
      if (!isInViewport) {
        return false;
      }
    }
    let frame = rlPlayer.frameQueue.shift();
    if (frame) {
      this.doRender(rlPlayer, frame);
      let nextFrameNo = rlPlayer.nextFrameNo;
      if (nextFrameNo !== false) {
        rlPlayer.nextFrameNo = false;
        this.requestFrame(rlPlayer.reqId, nextFrameNo);
      }
    }

    return true;
  }

  private doRender(rlPlayer: IRlPlayer, frame: Uint8ClampedArray) {
    rlPlayer.forceRender = rlPlayer.options.forceRender || false;
    rlPlayer.imageData.data.set(frame);
    rlPlayer.context.putImageData(rlPlayer.imageData, 0, 0);
    let now = +new Date();
    if (rlPlayer.frameThen) {
      rlPlayer.times.push(now - rlPlayer.frameThen);
    }
    rlPlayer.frameThen = now - (now % rlPlayer.frameInterval);
    if (rlPlayer.thumb) {
      rlPlayer.el.removeChild(rlPlayer.thumb);
      // @ts-ignore
      delete rlPlayer.thumb;
    }
  }

  private requestFrame(reqId: number, frameNo: number) {
    let rlPlayer = this.players[reqId];
    let frame = rlPlayer.frames[frameNo];
    if (frame) {
      this.onFrame(reqId, frameNo, frame);
    } else if (isSafari) {
      rlPlayer.rWorker.sendQuery("renderFrame", reqId, frameNo);
    } else {
      if (!rlPlayer.clamped.length) {
        // fix detached
        rlPlayer.clamped = new Uint8ClampedArray(
          rlPlayer.width * rlPlayer.height * 4
        );
      }
      rlPlayer.rWorker.sendQuery(
        "renderFrame",
        reqId,
        frameNo,
        rlPlayer.clamped
      );
    }
  }

  private onFrame = (reqId: number, frameNo: number, frame: Uint8ClampedArray) => {
    let rlPlayer = this.players[reqId];
    if (
      rlPlayer.options.cachingModule &&
      !rlPlayer.frames[frameNo] &&
      (!frameNo || (reqId + frameNo) % rlPlayer.options.cachingModule)
    ) {
      rlPlayer.frames[frameNo] = new Uint8ClampedArray(frame);
    }
    rlPlayer.frameQueue.push(frame);
    let nextFrameNo = ++frameNo;
    if (nextFrameNo >= rlPlayer.frameCount) {
      if (!rlPlayer.options.playOnce) {
        nextFrameNo = 0;
        if (rlPlayer.times.length) {
          // let avg = 0;
          // for (let i = 0; i < rlPlayer.times.length; i++) {
          //   avg += rlPlayer.times[i] / rlPlayer.times.length;
          // }
          // console.log('avg time: ' +  avg + ', ' + rlPlayer.fps);
          rlPlayer.times = [];
        }
      } else {
        rlPlayer.paused = true;
      }
    }
    if (rlPlayer.frameQueue.needsMore()) {
      this.requestFrame(reqId, nextFrameNo);
    } else {
      rlPlayer.nextFrameNo = nextFrameNo;
    }
  }

  private onLoaded = (reqId: number, frameCount: number, fps: number = 60) => {
    let rlPlayer = this.players[reqId];

    rlPlayer.canvas = document.createElement("canvas");
    rlPlayer.canvas.width = rlPlayer.width;
    rlPlayer.canvas.height = rlPlayer.height;
    rlPlayer.el.appendChild(rlPlayer.canvas);
    rlPlayer.context = rlPlayer.canvas.getContext(
      "2d"
    ) as CanvasRenderingContext2D;

    rlPlayer.fps = fps;
    rlPlayer.frameInterval = 1000 / rlPlayer.fps;
    rlPlayer.frameThen = Date.now();
    rlPlayer.frameCount = frameCount;
    rlPlayer.forceRender = true;
    rlPlayer.frameQueue = new FrameQueue(fps / 4);
    this.setupMainLoop();
    this.requestFrame(reqId, 0);
  }

  init(el: HTMLPictureElement, options: IOptions) {
    if (!this.isSupported) {
      return false;
    }
    // @ts-ignore
    this.initApi(() => this.initPlayer(el, options));
  }
}

class QueryableWorker {
  defaultListener: Function = () => {};
  onError: Function = (e: AbstractWorker, ev: ErrorEvent) => {};
  worker: Worker | null = null;
  listeners: { [key: string]: Function } = {};
  constructor(defaultListener?: Function, onError?: Function) {
    this.worker = new Worker();
    this.defaultListener = defaultListener || function () {};
    this.onError = onError || function () {};
    if (onError) {
      // @ts-ignore
      this.worker.onerror = onError;
    }
    this.worker.onmessage = (event: MessageEvent<any>) => {
      if (
        event.data instanceof Object &&
        event.data.hasOwnProperty("queryMethodListener") &&
        event.data.hasOwnProperty("queryMethodArguments")
      ) {
        this.listeners[event.data.queryMethodListener].apply(
          this,
          event.data.queryMethodArguments
        );
      } else {
        this.defaultListener.call(this, event.data);
      }
    };
  }
  postMessage(message: any) {
    this.worker?.postMessage(message);
  }
  terminate() {
    this.worker?.terminate();
  }
  addListener(name: string, listener: Function) {
    this.listeners[name] = listener;
  }
  removeListener(name: string) {
    delete this.listeners[name];
  }
  /*
    This functions takes at least one argument, the method name we want to query.
    Then we can pass in the arguments this the method needs.
  */
  sendQuery(name: string, ...args: any[]) {
    if (arguments.length < 1) {
      throw new TypeError(
        "QueryableWorker.sendQuery takes at least one argument"
      );
      return;
    }
    let queryMethod = arguments[0];
    // let args = Array.prototype.slice.call(arguments, 1);
    if (isSafari) {
      this.worker?.postMessage({
        queryMethod: queryMethod,
        queryMethodArguments: args,
      });
    } else {
      let transfer = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] instanceof ArrayBuffer) {
          transfer.push(args[i]);
        }

        if (args[i].buffer && args[i].buffer instanceof ArrayBuffer) {
          transfer.push(args[i].buffer);
        }
      }

      this.worker?.postMessage(
        {
          queryMethod: queryMethod,
          queryMethodArguments: args,
        },
        transfer
      );
    }
  }
}

class FrameQueue {
  queue: Uint8ClampedArray[] = [];
  maxLength: number = 0;
  constructor(maxLength: number) {
    this.maxLength = maxLength;
  }
  needsMore() {
    return this.queue.length < this.maxLength;
  }
  empty() {
    return !this.queue.length;
  }
  notEmpty() {
    return this.queue.length > 0;
  }
  push(element: Uint8ClampedArray) {
    return this.queue.push(element);
  }
  shift() {
    return this.queue.length ? this.queue.shift() : null;
  }
}

export const RLottie = new Rlottie();
