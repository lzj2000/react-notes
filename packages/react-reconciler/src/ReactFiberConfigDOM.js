/**
 * 跨环境兼容的 setTimeout 调度函数
 * 优先使用全局的 setTimeout 函数，若环境中不存在（如某些特殊 JS 运行时），则 fallback 为 undefined
 * 用于需要延迟执行的任务调度（宏任务）
 */
export const scheduleTimeout: any =
  // 检查全局环境中是否存在 setTimeout 函数
  typeof setTimeout === "function"
    ? setTimeout // 存在则直接使用原生 setTimeout
    : (undefined: any); // 不存在则赋值为 undefined

/** 标记当前环境是否支持微任务（Microtask）调度 */
export const supportsMicrotasks = true;
/**
 * 跨环境兼容的微任务调度函数
 * 微任务具有比宏任务更高的执行优先级（在当前事件循环的同步代码执行完毕后立即执行）
 * 优先使用标准的 queueMicrotask，其次降级为 Promise.then，最后 fallback 到 setTimeout（宏任务，最低优先级）
 */
export const scheduleMicrotask: any =
  // 优先检查是否支持标准的 queueMicrotask（现代浏览器和 Node.js 环境支持）
  typeof queueMicrotask === "function"
    ? queueMicrotask // 使用原生 queueMicrotask 调度微任务
    : // 若不支持 queueMicrotask，检查是否存在 Promise（通过 localPromise 引用全局 Promise）
    typeof localPromise !== "undefined"
    ? (callback: Function) =>
        // 使用 Promise.resolve 创建微任务，执行完成后调用回调
        // catch 用于捕获回调执行中的错误，避免未处理的 Promise 拒绝
        localPromise.resolve(null).then(callback).catch(handleErrorInNextTick)
    : // 若既不支持 queueMicrotask 也不支持 Promise，则 fallback 到 setTimeout（降级为宏任务）
      scheduleTimeout;
