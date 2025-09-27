import { renameElementSymbol } from 'shared/ReactFeatureFlags';


export const REACT_LEGACY_ELEMENT_TYPE: symbol = Symbol.for('react.element');

// 两种符号类型,新符号（当 renameElementSymbol 为 true）传统符号（当 renameElementSymbol 为 false）
// 使用 Symbol.for() 创建全局符号,名称：'react.transitional.element',这是 React 18 + 中引入的新符号
// 引用传统的元素类型符号,向后兼容旧版本的 React
export const REACT_ELEMENT_TYPE: symbol = renameElementSymbol
    ? Symbol.for('react.transitional.element')
    : REACT_LEGACY_ELEMENT_TYPE;