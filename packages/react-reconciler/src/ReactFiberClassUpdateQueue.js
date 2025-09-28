import { enqueueConcurrentClassUpdate } from "./ReactFiberConcurrentUpdates";

export type Update<State> = {
  lane: Lane,

  tag: 0 | 1 | 2 | 3,
  payload: any,
  callback: (() => mixed) | null,

  next: Update<State> | null,
};

export type UpdateQueue<State> = {
  baseState: State,
  firstBaseUpdate: Update<State> | null,
  lastBaseUpdate: Update<State> | null,
  shared: SharedQueue<State>,
  callbacks: Array<() => mixed> | null,
};

export const UpdateState = 0;
export const ReplaceState = 1;
export const ForceUpdate = 2;
export const CaptureUpdate = 3;

export function initializeUpdateQueue<State>(fiber: Fiber): void {
  const queue: UpdateQueue<State> = {
    baseState: fiber.memoizedState,
    firstBaseUpdate: null,
    lastBaseUpdate: null,
    shared: {
      pending: null,
      lanes: NoLanes,
      hiddenCallbacks: null,
    },
    callbacks: null,
  };
  fiber.updateQueue = queue;
}

/**
 * 创建一个新的更新对象（Update），用于 React 类组件的状态更新
 * @param {Lane} lane - 更新优先级车道，用于确定更新的优先级和执行时机，高优先级车道会优先执行，低优先级车道可能会被延迟或中断
 * @returns {Update<mixed>} 新创建的更新对象
 *
 */
export function createUpdate(lane: Lane): Update<mixed> {
  // 创建更新对象，使用传入的车道作为优先级
  const update: Update<mixed> = {
    // 更新优先级车道，用于调度器确定更新执行顺序
    lane,

    // 更新类型标记，UpdateState 表示这是一个状态更新
    // 其他可能的值包括：ReplaceState、ForceUpdate、CaptureUpdate
    tag: UpdateState,

    // 更新数据载荷，存储具体的状态更新值
    // 初始为 null，后续会被设置为实际的状态值或更新函数
    payload: null,

    // 更新完成后的回调函数，用于执行副作用
    // 初始为 null，后续可能会被设置为具体的回调函数
    callback: null,

    // 链表指针，指向下一个更新对象
    // 初始为 null，后续会被设置为链表中的下一个更新
    next: null,
  };

  // 返回新创建的更新对象
  return update;
}

/**
 * 判断当前是否处于不安全的类组件渲染阶段更新
 * 用于识别在组件渲染阶段（render 方法执行期间）触发的类组件更新，这类更新通常被视为不安全操作
 *
 * @param {Fiber} fiber - 要检查的 Fiber 节点（通常是触发更新的类组件对应的 Fiber）
 * @returns {boolean} 若处于不安全的类组件渲染阶段更新则返回 true，否则返回 false
 *
 * 什么情况返回 true：
 * - 当当前执行上下文（executionContext）包含渲染阶段标记（RenderContext）时，即 React 正在执行组件的 render 方法
 * - 此时若类组件在自身 render 过程中触发了状态更新（如调用 this.setState），会被判定为不安全的渲染阶段更新
 *
 * 什么情况返回 false：
 * - 当当前执行上下文不包含 RenderContext 时，即不在组件渲染阶段（如在事件处理函数、副作用钩子、并发更新阶段等）
 * - 非类组件的更新（如函数组件通过 useState 触发的更新）不会进入此判断逻辑
 */
export function isUnsafeClassRenderPhaseUpdate(fiber: Fiber): boolean {
  // 检查当前执行上下文是否包含渲染阶段标记
  // executionContext 是 React 内部跟踪当前执行阶段的全局变量
  // RenderContext 是渲染阶段的标记位，NoContext 表示无任何阶段标记
  return (executionContext & RenderContext) !== NoContext;
}

/**
 * 将更新操作加入队列，并返回对应的 FiberRoot（如果存在）
 * 该函数负责将状态更新添加到指定 Fiber 节点的更新队列中，
 * 并根据更新发生的阶段（渲染阶段/并发阶段）采取不同的处理策略
 *
 * @template State - 更新状态的类型
 * @param {Fiber} fiber - 要接收更新的 Fiber 节点
 * @param {Update<State>} update - 要加入队列的更新对象
 * @param {Lane} lane - 该更新对应的优先级通道（ lanes 机制用于优先级调度）
 * @returns {FiberRoot | null} - 对应的 FiberRoot 根节点，若 Fiber 已卸载则返回 null
 */
export function enqueueUpdate<State>(
  fiber: Fiber,
  update: Update<State>,
  lane: Lane
): FiberRoot | null {
  // 获取当前 Fiber 节点的更新队列
  const updateQueue = fiber.updateQueue;
  if (updateQueue === null) {
    // 如果更新队列为 null，说明当前 Fiber 已经被卸载，无法处理更新
    return null;
  }

  // 从更新队列中获取共享队列（SharedQueue 用于存储待处理的更新）
  const sharedQueue: SharedQueue<State> = (updateQueue: any).shared;

  // 判断是否为不安全的类组件渲染阶段更新
  // （渲染阶段更新指在组件 render 方法执行过程中触发的更新，通常不推荐这种做法）
  if (isUnsafeClassRenderPhaseUpdate(fiber)) {
    // 处理不安全的渲染阶段更新：直接添加到更新队列，以便在当前渲染过程中立即处理
    const pending = sharedQueue.pending;
    if (pending === null) {
      // 如果共享队列中没有待处理更新，这是第一个更新，创建循环链表
      update.next = update;
    } else {
      // 如果已有待处理更新，将新更新插入循环链表的末尾
      // （当前 pending 指向最后一个更新，新更新的 next 指向第一个更新，最后一个更新的 next 指向新更新）
      update.next = pending.next;
      pending.next = update;
    }
    // 更新共享队列的 pending 指针，使其指向最新添加的更新（即当前更新）
    sharedQueue.pending = update;

    // 即使当前可能正在渲染该 Fiber，仍需更新 childLanes 以保持兼容性
    // （针对在渲染阶段更新非当前渲染组件的场景，这种模式通常会伴随警告）
    return unsafe_markUpdateLaneFromFiberToRoot(fiber, lane);
  } else {
    // 处理并发模式下的类组件更新，使用专门的并发更新队列处理函数
    return enqueueConcurrentClassUpdate(fiber, sharedQueue, update, lane);
  }
}

/**
 * 处理 Fiber 节点的更新队列，计算新的状态并更新相关属性
 * 该函数负责处理待执行的更新队列，根据当前渲染优先级（renderLanes）筛选有效更新，
 * 计算最终状态，并维护更新队列的状态（如基础状态、剩余未处理更新等）
 * 
 * @template State - 更新状态的类型
 * @param {Fiber} workInProgress - 当前正在处理的 Fiber 节点（工作单元）
 * @param {any} props - 当前 Fiber 节点对应的组件 props
 * @param {any} instance - 组件实例（类组件实例或根节点实例）
 * @param {Lanes} renderLanes - 当前渲染阶段的优先级通道集合，用于筛选符合优先级的更新
 */
export function processUpdateQueue<State>(
  workInProgress: Fiber,
  props: any,
  instance: any,
  renderLanes: Lanes
): void {
  // 重置异步操作纠缠状态标记（用于跟踪是否读取了纠缠的异步操作）
  didReadFromEntangledAsyncAction = false;

  // 获取当前 Fiber 节点的更新队列（类组件或根节点的更新队列必然非空）
  const queue: UpdateQueue<State> = (workInProgress.updateQueue: any);

  // 重置强制更新标记（用于跟踪是否有强制更新操作）
  hasForceUpdate = false;

  // 获取基础更新队列的首尾指针（基础队列存储未被处理的历史更新）
  let firstBaseUpdate = queue.firstBaseUpdate;
  let lastBaseUpdate = queue.lastBaseUpdate;

  // 检查是否有 pending 状态的更新队列，若有则转移到基础队列
  let pendingQueue = queue.shared.pending;
  if (pendingQueue !== null) {
    // 清空 pending 队列标记（避免重复处理）
    queue.shared.pending = null;

    // pending 队列是循环链表，需要断开首尾连接使其成为非循环链表
    const lastPendingUpdate = pendingQueue;
    const firstPendingUpdate = lastPendingUpdate.next;
    lastPendingUpdate.next = null;

    // 将 pending 队列中的更新追加到基础队列
    if (lastBaseUpdate === null) {
      // 基础队列为空时，直接将 pending 队列作为基础队列起点
      firstBaseUpdate = firstPendingUpdate;
    } else {
      // 基础队列非空时，将 pending 队列连接到基础队列末尾
      lastBaseUpdate.next = firstPendingUpdate;
    }
    // 更新基础队列的尾指针
    lastBaseUpdate = lastPendingUpdate;

    // 如果存在当前 Fiber（alternate），且其更新队列与工作队列不同，
    // 需要同步更新当前队列，利用结构共享减少冗余
    const current = workInProgress.alternate;
    if (current !== null) {
      // 获取当前 Fiber 的更新队列（类组件或根节点的更新队列必然非空）
      const currentQueue: UpdateQueue<State> = (current.updateQueue: any);
      const currentLastBaseUpdate = currentQueue.lastBaseUpdate;
      // 仅当当前队列的尾指针与工作队列不同步时才更新
      if (currentLastBaseUpdate !== lastBaseUpdate) {
        if (currentLastBaseUpdate === null) {
          currentQueue.firstBaseUpdate = firstPendingUpdate;
        } else {
          currentLastBaseUpdate.next = firstPendingUpdate;
        }
        currentQueue.lastBaseUpdate = lastPendingUpdate;
      }
    }
  }

  // 若存在基础更新需要处理
  if (firstBaseUpdate !== null) {
    // 从基础状态开始计算新状态
    let newState = queue.baseState;
    // 记录未处理更新的优先级通道（用于后续标记未处理的 lanes）
    let newLanes: Lanes = NoLanes;

    // 新的基础状态和基础更新队列指针（处理后剩余的未处理更新）
    let newBaseState = null;
    let newFirstBaseUpdate = null;
    let newLastBaseUpdate: null | Update<State> = null;

    // 遍历所有基础更新
    let update: Update<State> = firstBaseUpdate;
    do {
      // 移除更新通道中的 OffscreenLane 标记（用于区分隐藏树中的更新）
      const updateLane = removeLanes(update.lane, OffscreenLane);
      // 判断该更新是否是在树隐藏时产生的
      const isHiddenUpdate = updateLane !== update.lane;

      // 根据更新是否在隐藏时产生，判断是否跳过该更新：
      // - 隐藏时的更新：检查是否在当前根节点的渲染通道中
      // - 非隐藏时的更新：检查是否在当前渲染通道中
      const shouldSkipUpdate = isHiddenUpdate
        ? !isSubsetOfLanes(getWorkInProgressRootRenderLanes(), updateLane)
        : !isSubsetOfLanes(renderLanes, updateLane);

      if (shouldSkipUpdate) {
        // 优先级不足，跳过该更新
        // 克隆更新对象（保留必要信息），加入新的基础更新队列
        const clone: Update<State> = {
          lane: updateLane,
          tag: update.tag,
          payload: update.payload,
          callback: update.callback,
          next: null,
        };
        if (newLastBaseUpdate === null) {
          // 新基础队列为空时，初始化首尾指针
          newFirstBaseUpdate = newLastBaseUpdate = clone;
          newBaseState = newState; // 以当前状态作为新的基础状态
        } else {
          // 追加到新基础队列末尾
          newLastBaseUpdate = newLastBaseUpdate.next = clone;
        }
        // 合并未处理更新的优先级通道
        newLanes = mergeLanes(newLanes, updateLane);
      } else {
        // 优先级足够，处理该更新

        // 检查该更新是否属于待处理的异步操作，若是则标记已读取纠缠的异步操作
        if (updateLane !== NoLane && updateLane === peekEntangledActionLane()) {
          didReadFromEntangledAsyncAction = true;
        }

        // 若存在未处理的基础更新，克隆当前更新并清除通道和回调（已处理的更新不再参与后续流程）
        if (newLastBaseUpdate !== null) {
          const clone: Update<State> = {
            lane: NoLane, // 用 NoLane 标记已处理，确保不会被再次跳过
            tag: update.tag,
            payload: update.payload,
            callback: null, // 已处理的更新不再触发回调
            next: null,
          };
          newLastBaseUpdate = newLastBaseUpdate.next = clone;
        }

        // 应用更新计算新状态
        newState = getStateFromUpdate(
          workInProgress,
          queue,
          update,
          newState,
          props,
          instance
        );
        // 处理更新回调
        const callback = update.callback;
        if (callback !== null) {
          // 标记 Fiber 有回调需要执行
          workInProgress.flags |= Callback;
          // 若为隐藏时的更新，标记可见性相关 flag
          if (isHiddenUpdate) {
            workInProgress.flags |= Visibility;
          }
          // 将回调加入队列（后续会在 commit 阶段执行）
          const callbacks = queue.callbacks;
          if (callbacks === null) {
            queue.callbacks = [callback];
          } else {
            callbacks.push(callback);
          }
        }
      }

      // 处理下一个更新
      update = update.next!; // 类型断言：循环结束前 update 不会为 null
      if (update === null) {
        // 检查是否有新的 pending 更新（可能在处理过程中被新增）
        pendingQueue = queue.shared.pending;
        if (pendingQueue === null) {
          // 无新 pending 更新，退出循环
          break;
        } else {
          // 有新的 pending 更新，将其追加到当前处理队列并继续处理
          const lastPendingUpdate = pendingQueue;
          const firstPendingUpdate = (lastPendingUpdate.next as Update<State>);
          lastPendingUpdate.next = null; // 断开循环
          update = firstPendingUpdate;
          // 更新基础队列尾指针和 pending 标记
          queue.lastBaseUpdate = lastPendingUpdate;
          queue.shared.pending = null;
        }
      }
    } while (true);

    // 若没有剩余未处理的基础更新，新状态即为新的基础状态
    if (newLastBaseUpdate === null) {
      newBaseState = newState;
    }

    // 更新队列的基础状态和基础更新指针
    queue.baseState = (newBaseState as State);
    queue.firstBaseUpdate = newFirstBaseUpdate;
    queue.lastBaseUpdate = newLastBaseUpdate;

    // 若基础更新队列为空，重置共享队列的 lanes（用于纠缠过渡）
    if (firstBaseUpdate === null) {
      queue.shared.lanes = NoLanes;
    }

    // 标记跳过的更新通道，并更新当前 Fiber 的 lanes 和记忆化状态
    markSkippedUpdateLanes(newLanes);
    workInProgress.lanes = newLanes;
    workInProgress.memoizedState = newState;
  }

}

/**
 * 根据更新对象（Update）计算组件的新状态
 * 该函数是 React 状态更新的核心逻辑实现，根据更新的类型（如替换、合并、强制更新等），
 * 结合当前状态、新 props 和组件实例，计算出组件的下一个状态
 * 
 * @template State - 组件状态的类型
 * @param {Fiber} workInProgress - 当前正在处理的 Fiber 节点
 * @param {UpdateQueue<State>} queue - 组件的更新队列
 * @param {Update<State>} update - 当前要处理的更新对象
 * @param {State} prevState - 组件的当前状态（上一次计算后的状态）
 * @param {any} nextProps - 组件即将使用的新 props
 * @param {any} instance - 组件实例（类组件的 this 指向，函数组件为 null）
 * @returns {any} 计算后的新状态
 */
function getStateFromUpdate<State>(
  workInProgress: Fiber,
  queue: UpdateQueue<State>,
  update: Update<State>,
  prevState: State,
  nextProps: any,
  instance: any,
): any {
  // 根据更新的类型（tag）执行不同的状态计算逻辑
  switch (update.tag) {
    // 处理 "替换状态" 类型的更新（对应 ReplaceState 标记）
    case ReplaceState: {
      const payload = update.payload;
      if (typeof payload === 'function') {
        // 若 payload 是函数，执行函数并传入当前状态和新 props，返回值为新状态
        // 函数形式：(prevState, nextProps) => newState
        const nextState = payload.call(instance, prevState, nextProps);
        return nextState;
      }
      // 若 payload 是对象，直接作为新状态（完全替换旧状态）
      return payload;
    }

    // 处理 "捕获更新" 类型的更新（对应 CaptureUpdate 标记，用于错误边界）
    case CaptureUpdate: {
      // 更新 Fiber 节点的 flags：清除 ShouldCapture 标记，添加 DidCapture 标记
      // 表示该节点已完成错误捕获，需要进入提交阶段处理
      workInProgress.flags =
        (workInProgress.flags & ~ShouldCapture) | DidCapture;
      // 继续执行下面的 UpdateState 逻辑（故意穿透 case）
    }

    // 处理 "合并状态" 类型的更新（对应 UpdateState 标记，最常见的更新类型）
    case UpdateState: {
      const payload = update.payload;
      let partialState; // 部分状态（要更新的字段）
      if (typeof payload === 'function') {
        // 若 payload 是函数，执行函数并传入当前状态和新 props，返回部分状态
        // 函数形式：(prevState, nextProps) => partialState
        partialState = payload.call(instance, prevState, nextProps);
      } else {
        // 若 payload 是对象，直接作为部分状态
        partialState = payload;
      }

      // 若部分状态为 null 或 undefined，视为“无操作”，返回原状态
      if (partialState === null || partialState === undefined) {
        return prevState;
      }

      // 合并部分状态和之前的状态（浅合并），生成新状态
      // 注：React 类组件的 setState 浅合并逻辑在此处实现
      return assign({}, prevState, partialState);
    }

    // 处理 "强制更新" 类型的更新（对应 ForceUpdate 标记）
    case ForceUpdate: {
      // 标记存在强制更新操作（后续会跳过 shouldComponentUpdate 判断）
      hasForceUpdate = true;
      // 强制更新不改变状态值，仅触发重新渲染，因此返回原状态
      return prevState;
    }
  }

  // 若更新类型不匹配任何 case（理论上不会发生），返回原状态
  return prevState;
}