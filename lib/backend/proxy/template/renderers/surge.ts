/**
 * Surge / Surfboard 分流模板渲染（Surge 风格 ini）
 *
 * 语法依据：
 * - Surge: https://manual.nssurge.com/ （profile/general、policy-groups、rules/ruleset、rules/ip、rules/final）
 * - Surfboard: https://getsurfboard.com/docs/profile-format/overview/ 及 rule/、proxygroup/ 子页
 *
 * 差异：
 * - url-test 组：Surge 手册说明组行上的 url= 已无效，测速地址取 [General] proxy-test-url；
 *   Surfboard 文档的 url-test 示例带 url= / interval= / tolerance=。
 * - FINAL：Surge 支持 dns-failed；Surfboard 文档未列出该参数，不输出。
 * - no-resolve：Surge RULE-SET 行支持；Surfboard 文档未提及，不输出。
 * - loglevel：Surge 有；Surfboard 文档未列出，不输出。
 */
import { DIRECT, URL_TEST } from '../catalog';
import type { TemplatePlan } from '../plan';
import { bm7RuleUrl, type RuleSourceOptions } from '../sources';
import type { ProxyNode } from '../../types';

export type SurgeFlavor = 'surge' | 'surfboard';

export interface SurgeRenderOptions extends RuleSourceOptions {
    flavor: SurgeFlavor;
    /** [Proxy] 段的节点行（已完成各平台自己的转义） */
    proxyLines: string[];
    /** `[WireGuard X]` 段，放在文件末尾（[Proxy] / [Proxy Group] / [Rule] 之外） */
    wireguardSections?: string[];
}

const SKIP_PROXY =
    '127.0.0.1, 192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12, 100.64.0.0/10, localhost, *.local';

function buildGeneral(flavor: SurgeFlavor): string[] {
    const lines = ['[General]'];
    if (flavor === 'surge') lines.push('loglevel = notify');
    lines.push(
        'dns-server = 223.5.5.5, 119.29.29.29',
        'encrypted-dns-server = https://dns.alidns.com/dns-query, https://doh.pub/dns-query',
        `skip-proxy = ${SKIP_PROXY}`,
        `proxy-test-url = ${URL_TEST.url}`,
        'test-timeout = 5'
    );
    return lines;
}

function buildGroups(plan: TemplatePlan, flavor: SurgeFlavor): string[] {
    const lines = ['[Proxy Group]'];
    for (const group of plan.groups) {
        const parts: string[] = [group.type, ...group.members];
        if (group.type === 'url-test') {
            if (flavor === 'surfboard') parts.push(`url=${URL_TEST.url}`);
            parts.push(`interval=${URL_TEST.interval}`, `tolerance=${URL_TEST.tolerance}`);
        }
        lines.push(`${group.name} = ${parts.join(', ')}`);
    }
    return lines;
}

function buildRules(plan: TemplatePlan, options: SurgeRenderOptions): string[] {
    const surge = options.flavor === 'surge';
    const lines = ['[Rule]'];
    for (const rule of plan.rules) {
        // bm7 为空：iOS 系不生成该分类，交给 FINAL
        for (const name of rule.bm7) {
            const url = bm7RuleUrl('Surge', name, options);
            lines.push(`RULE-SET,${url},${rule.target}${surge ? ',no-resolve' : ''}`);
        }
    }
    lines.push(`GEOIP,CN,${DIRECT}`);
    lines.push(surge ? `FINAL,${plan.final},dns-failed` : `FINAL,${plan.final}`);
    return lines;
}

export function renderSurgeTemplate(plan: TemplatePlan, options: SurgeRenderOptions): string {
    return [
        buildGeneral(options.flavor),
        ['[Proxy]', ...options.proxyLines],
        buildGroups(plan, options.flavor),
        buildRules(plan, options),
        ...(options.wireguardSections ?? []).map((section) => section.split('\n'))
    ]
        .map((section) => section.join('\n'))
        .join('\n\n');
}

/**
 * 模板模式下给重名节点加 `_1`、`_2` 后缀（与 clash.ts 一致：重名的每个都加），
 * 以清洗后的名字（去掉 = 和 ,）判断是否重名。
 */
export function dedupeNodeNames(nodes: ProxyNode[]): ProxyNode[] {
    const safe = (name: string) => name.replace(/=|,/g, '');
    const count = new Map<string, number>();
    for (const node of nodes) count.set(safe(node.name), (count.get(safe(node.name)) || 0) + 1);
    const index = new Map<string, number>();
    return nodes.map((node) => {
        const name = safe(node.name);
        if ((count.get(name) || 0) <= 1) return node;
        const i = (index.get(name) || 0) + 1;
        index.set(name, i);
        return { ...node, name: `${name}_${i}` };
    });
}

/**
 * 拆开 SurgeConverter 的输出：WireGuard 节点会产生“注释掉的节点行 + [WireGuard X] 段”的多行块。
 * 节点行恢复成有效行放进 [Proxy]，[WireGuard X] 段单独收集。
 */
export function splitSurgeOutputs(outputs: string[]): { proxyLines: string[]; sections: string[] } {
    const proxyLines: string[] = [];
    const sections: string[] = [];
    for (const output of outputs) {
        let section: string[] | null = null;
        for (const line of output.split('\n')) {
            if (/^\[WireGuard /.test(line)) {
                section = [line];
                sections.push('');
                continue;
            }
            if (section) {
                section.push(line);
                continue;
            }
            if (!line.trim() || line.startsWith('# > ')) continue;
            proxyLines.push(/^# .+=wireguard,section-name=/.test(line) ? line.slice(2) : line);
        }
        if (section) sections[sections.length - 1] = section.join('\n').trimEnd();
    }
    return { proxyLines, sections };
}

/** Surfboard 的 [WireGuard X] 段，字段依据 getsurfboard.com/docs/profile-format/proxy/external-proxy/wireguard */
export function surfboardWireguardSection(proxy: ProxyNode): string {
    const p: any = { ...proxy, name: proxy.name.replace(/=|,/g, '') };
    const peer = Array.isArray(p.peers) && p.peers.length > 0 ? p.peers[0] : {};
    const join = (v: unknown, sep: string) => (Array.isArray(v) ? v.join(sep) : v);
    let server = p.server;
    let port = p.port;
    if (peer.endpoint) {
        const idx = String(peer.endpoint).lastIndexOf(':');
        server = String(peer.endpoint).slice(0, idx);
        port = parseInt(String(peer.endpoint).slice(idx + 1) || '51820', 10);
    }
    const publicKey = peer['public-key'] || p['public-key'] || p.publicKey;
    const preshared = peer['pre-shared-key'] || p['preshared-key'] || p['pre-shared-key'];
    const allowed = join(peer['allowed-ips'] ?? p['allowed-ips'], ', ') || '0.0.0.0/0, ::/0';
    const keepalive = p['persistent-keepalive'] || p.keepalive;
    const host = String(server).includes(':') && !String(server).startsWith('[') ? `[${server}]` : server;

    const lines = [`[WireGuard ${p.name}]`, `private-key = ${p['private-key'] || p.privateKey}`];
    const ip = peer.ip || p.ip;
    const ipv6 = peer.ipv6 || p.ipv6;
    if (ip) lines.push(`self-ip = ${ip}`);
    if (ipv6) lines.push(`self-ip-v6 = ${ipv6}`);
    // 文档标 dns-server 为必填
    lines.push(`dns-server = ${join(p.dns, ', ') || '1.1.1.1'}`);
    lines.push(`mtu = ${p.mtu || 1280}`);
    const peerParts = [
        `public-key = ${publicKey}`,
        preshared ? `preshared-key = ${preshared}` : '',
        `allowed-ips = "${allowed}"`,
        `endpoint = ${host}:${port}`,
        keepalive ? `keepalive = ${keepalive}` : ''
    ].filter(Boolean);
    lines.push(`peer = (${peerParts.join(', ')})`);
    return lines.join('\n');
}

/** 从节点行（`名称=类型,...`）取节点名；converter 已去掉名称中的 = 和 , */
export function proxyLineName(line: string): string {
    return line.slice(0, line.indexOf('='));
}
