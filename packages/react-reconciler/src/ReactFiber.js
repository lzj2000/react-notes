import { NoFlags } from './ReactFiberFlags';

/** Fiber 节点类，用于构建 Fiber 树 */
function FiberNode(
    this: $FlowFixMe,        // Flow 类型检查忽略
    tag: WorkTag,            // 工作标签，标识节点类型
    pendingProps: mixed,     // 待处理的属性
    key: null | string,      // 唯一标识符
    mode: TypeOfMode,        // 渲染模式
) {
    // 实例属性
    this.tag = tag;              // 节点类型标签（如 FunctionComponent, ClassComponent, HostComponent）
    this.key = key;              // 用于 diff 算法的唯一键
    this.elementType = null;     // 元素的类型（原始类型）
    this.type = null;            // 元素的类型（可能是包装后的类型）
    this.stateNode = null;       // 对应的真实 DOM 节点或组件实例

    // Fiber 树结构属性
    this.return = null;          // 父节点
    this.child = null;           // 第一个子节点
    this.sibling = null;         // 下一个兄弟节点
    this.index = 0;              // 在父节点中的索引

    // 引用属性
    this.ref = null;             // React ref
    this.refCleanup = null;      // ref 清理函数

    // 属性和状态管理
    this.pendingProps = pendingProps;    // 待处理的属性
    this.memoizedProps = null;           // 已处理的属性
    this.updateQueue = null;             // 更新队列
    this.memoizedState = null;           // 已处理的状态
    this.dependencies = null;            // 依赖项

    // 渲染模式
    this.mode = mode;            // 渲染模式（并发模式、 严格模式、 阻塞模式）

    // 副作用标记
    this.flags = NoFlags;        // 当前节点的副作用标记
    this.subtreeFlags = NoFlags; // 子树的副作用标记
    this.deletions = null;       // 待删除的子节点列表

    // 优先级和调度
    this.lanes = NoLanes;        // 当前节点的优先级车道
    this.childLanes = NoLanes;   // 子节点的优先级车道

    // 双缓存机制
    this.alternate = null;       // 对应的 alternate fiber

    // 性能分析（可选）
    if (enableProfilerTimer) {
        this.actualDuration = -0;        // 实际渲染时间
        this.actualStartTime = -1.1;     // 实际开始时间
        this.selfBaseDuration = -0;      // 自身基础渲染时间
        this.treeBaseDuration = -0;      // 子树基础渲染时间
    }
}