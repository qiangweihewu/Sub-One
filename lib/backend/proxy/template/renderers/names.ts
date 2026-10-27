/**
 * 模板模式下 Loon / QX 的节点名处理：清洗语法敏感字符并为重名节点加 _1、_2 后缀
 * 节点行与策略组成员使用同一个处理后的名字
 */
import type { ProxyNode } from '../../types';

const strip = (name: string, chars: RegExp) => name.replace(chars, '').replace(/\s+/g, ' ').trim();

/** Loon：节点行是 `name=type,...`，去掉 `,` `=`；QX：tag 在行尾、成员以逗号分隔，同样去掉 `,` `=` */
export function normalizeNodeNames(nodes: ProxyNode[]): ProxyNode[] {
    const cleaned = nodes.map((n) => ({ ...n, name: strip(n.name, /[,=\r\n]/g) || 'node' }));
    const total = new Map<string, number>();
    cleaned.forEach((n) => total.set(n.name, (total.get(n.name) || 0) + 1));
    const used = new Set(cleaned.map((n) => n.name));
    const index = new Map<string, number>();
    return cleaned.map((n) => {
        if ((total.get(n.name) || 0) <= 1) return n;
        let i = index.get(n.name) || 0;
        let candidate: string;
        do {
            candidate = `${n.name}_${++i}`;
        } while (used.has(candidate));
        index.set(n.name, i);
        used.add(candidate);
        return { ...n, name: candidate };
    });
}
