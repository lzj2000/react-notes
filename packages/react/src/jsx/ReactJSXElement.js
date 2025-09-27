import {
    REACT_ELEMENT_TYPE,
} from 'shared/ReactSymbols';

function ReactElement(
    type,        // 元素类型（如 'div', 'span', 或组件函数）
    key,         // 用于列表渲染的唯一标识符
    self,        // 保留参数（当前未使用）
    source,      // 开发环境下的源码信息
    owner,       // 拥有此元素的组件
    props,       // 元素的属性对象
    debugStack,  // 开发环境下的调试堆栈
    debugTask,   // 开发环境下的调试任务信息
) {
    /** React 中 ref 机制的核心实现 */
    // 从 props 中提取 ref 属性
    const refProp = props.ref;
    // 如果 ref 存在则使用它，否则设为 null
    const ref = refProp !== undefined ? refProp : null;

    // 创建 React 元素对象
    let element;
    element = {
        // 这个标签允许我们唯一标识这是一个 React 元素
        // 这是 React 的安全机制，用于防止 XSS 攻击，确保只有真正的 React 元素才能被渲染
        $$typeof: REACT_ELEMENT_TYPE,

        // 元素的内置属性
        type,    // 元素类型，决定渲染什么（HTML 标签或组件）
        key,     // 唯一键，用于 React 的 diff 算法优化
        ref,     // 引用，用于直接访问 DOM 节点或组件实例
        props,   // 属性对象，包含所有传递给元素的属性
    };

    return element;
}

// React DevTools 使用所有者信息来显示组件树， 生产环境直接返回 null
function getOwner() {
    if (__DEV__) {
        const dispatcher = ReactSharedInternals.A;
        if (dispatcher === null) {
            return null;
        }
        return dispatcher.getOwner();
    }
    return null;
}

/** 这是 React 中用于处理生产环境 JSX 转换的核心函数，负责将 JSX 语法转换为 React 元素对象。 */
export function jsxProd(
    type,// 元素类型（HTML 标签名或组件函数）
    config, // 属性配置对象
    maybeKey // 可选的 key 值
) {
    let key = null;

    // 处理 maybeKey 参数
    if (maybeKey !== undefined) {
        key = '' + maybeKey;  // 强制转换为字符串
    }

    // 处理 config 中的 key
    if (hasValidKey(config)) {
        key = '' + config.key;
    }

    let props;
    if (!('key' in config)) {
        // 如果 config 中没有 key，直接使用 config 作为 props
        props = config;
    } else {
        // 如果 config 中有 key，需要从 config 中排除 key
        props = {};
        for (const propName in config) {
            if (propName !== 'key') {
                props[propName] = config[propName];
            }
        }
    }

    //  默认属性处理
    if (!disableDefaultPropsExceptForClasses) {
        // 检查组件是否有 defaultProps
        if (type && type.defaultProps) {
            const defaultProps = type.defaultProps;
            for (const propName in defaultProps) {
                // 将未定义的属性用默认值填充
                if (props[propName] === undefined) {
                    props[propName] = defaultProps[propName];
                }
            }
        }
    }

    return ReactElement(
        type,
        key,
        undefined,
        undefined,
        getOwner(),
        props,
        undefined,
        undefined,
    );
}