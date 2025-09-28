import { mergeLanes } from "./ReactFiberLane";

/**
 * 并发更新队列数组，用于临时存储待处理的并发更新信息
 * 数组采用扁平化存储，每4个元素表示一个更新的完整信息：
 * [fiber, queue, update, lane, fiber2, queue2, update2, lane2, ...]
 * 这种结构可以高效批量处理多个并发更新
 */
const concurrentQueues: Array<any> = [];

/**
 * 并发队列当前的索引指针，用于追踪下一个待插入元素的位置
 * 每次插入一个更新会使索引增加4（因为每个更新占4个位置）
 */
let concurrentQueuesIndex = 0;

/**
 * 将并发更新信息加入到并发队列中，并更新相关优先级车道
 * 该函数是处理并发更新的基础，负责暂存更新并标记优先级
 *
 * @param {Fiber} fiber - 接收更新的 Fiber 节点
 * @param {ConcurrentQueue | null} queue - 该 Fiber 节点的并发更新队列
 * @param {ConcurrentUpdate | null} update - 待入队的并发更新对象
 * @param {Lane} lane - 该更新的优先级车道
 */

/**
 * 全局变量：存储当前所有并发更新的优先级车道集合
 *
 * 作用：
 * 1. 汇聚所有通过并发路径（如 `useTransition`、异步事件）触发的更新的车道
 * 2. 供 React 调度系统快速判断是否存在待处理的并发更新，以及这些更新的优先级范围
 * 3. 避免频繁遍历所有 Fiber 节点查询更新状态，提升调度效率
 *
 * 操作逻辑：
 * - 当新的并发更新入队时（如 `enqueueConcurrentClassUpdate` 调用），通过 `mergeLanes` 函数
 *   将更新的车道合并到该变量中（按位或操作，保留所有更新的优先级比特位）
 * - 当并发更新被处理或过期时，会从该变量中移除对应的车道（通过按位与非操作）
 * - 初始值为 `NoLanes`（所有比特位为 0），表示无任何并发更新待处理
 */
let concurrentlyUpdatedLanes: Lanes = NoLanes;

function enqueueUpdate(
  fiber: Fiber,
  queue: ConcurrentQueue | null,
  update: ConcurrentUpdate | null,
  lane: Lane
) {
  // 将更新的四要素按顺序存入并发队列（扁平化存储）
  concurrentQueues[concurrentQueuesIndex++] = fiber;
  concurrentQueues[concurrentQueuesIndex++] = queue;
  concurrentQueues[concurrentQueuesIndex++] = update;
  concurrentQueues[concurrentQueuesIndex++] = lane;

  // 将当前更新的车道合并到全局并发更新车道集合中
  // 用于后续判断是否有高优先级更新需要处理
  concurrentlyUpdatedLanes = mergeLanes(concurrentlyUpdatedLanes, lane);

  // 更新 Fiber 节点自身的车道集合，标记该节点有此优先级的更新
  fiber.lanes = mergeLanes(fiber.lanes, lane);
  // 如果存在备用 Fiber 节点（current 树中的对应节点），也同步更新其车道
  // 确保 current 树和 workInProgress 树的车道信息一致
  const alternate = fiber.alternate;
  if (alternate !== null) {
    alternate.lanes = mergeLanes(alternate.lanes, lane);
  }
}

/**
 * 为类组件入队一个并发更新，并返回该更新所属的根节点
 * 是类组件并发更新的入口函数，负责类型转换和触发入队
 *
 * @template State - 更新关联的状态类型
 * @param {Fiber} fiber - 类组件对应的 Fiber 节点
 * @param {ClassQueue<State>} queue - 类组件的更新队列
 * @param {ClassUpdate<State>} update - 类组件的更新对象
 * @param {Lane} lane - 该更新的优先级车道
 * @returns {FiberRoot | null} - 更新所属的根节点（用于后续调度），若无法找到则返回 null
 */
export function enqueueConcurrentClassUpdate<State>(
  fiber: Fiber,
  queue: ClassQueue<State>,
  update: ClassUpdate<State>,
  lane: Lane
): FiberRoot | null {
  // 将类组件的队列和更新转换为通用的并发队列和更新类型
  const concurrentQueue: ConcurrentQueue = (queue: any);
  const concurrentUpdate: ConcurrentUpdate = (update: any);

  // 调用通用的入队函数，将更新加入并发队列
  enqueueUpdate(fiber, concurrentQueue, concurrentUpdate, lane);

  // 查找并返回该 Fiber 节点所属的根节点（FiberRoot）
  return getRootForUpdatedFiber(fiber);
}

/**
 * 从触发更新的 Fiber 节点向上遍历，找到其所属的根节点（HostRoot）
 * 同时进行一些安全检查（如检测无限更新循环、已卸载 Fiber 的更新）
 *
 * @param {Fiber} sourceFiber - 触发更新的源 Fiber 节点
 * @returns {FiberRoot | null} - 找到的根节点，若不是有效的 HostRoot 则返回 null
 */
function getRootForUpdatedFiber(sourceFiber: Fiber): FiberRoot | null {
  // 检查是否存在无限更新循环（如在 render 中无限调用 setState）
  throwIfInfiniteUpdateLoopDetected();

  // 从源 Fiber 开始向上遍历，检查是否有已卸载的 Fiber 节点
  // 若更新已卸载的节点，会发出警告
  detectUpdateOnUnmountedFiber(sourceFiber, sourceFiber);

  // 向上遍历 Fiber 树，直到找到根节点（parent 为 null 的节点）
  let node = sourceFiber;
  let parent = node.return;
  while (parent !== null) {
    // 检查当前节点是否已卸载
    detectUpdateOnUnmountedFiber(sourceFiber, node);
    // 继续向上移动
    node = parent;
    parent = node.return;
  }

  // 最终的 node 应该是根节点，若其类型为 HostRoot，则返回其状态节点（FiberRoot）
  // 否则返回 null（非有效的根节点）
  return node.tag === HostRoot ? (node.stateNode: FiberRoot) : null;
}
