/**
 * sing-box 分流模板渲染
 *
 * 依据：https://sing-box.sagernet.org/configuration/ 与 /migration/
 * - 新格式（>= 1.12 / 未知）：type 式 DNS server、route.default_domain_resolver、rule action
 * - 1.11 兼容格式：旧式 address DNS server + dns outbound rule（1.14 起才移除，仅用于旧客户端）
 * 1.11 起已移除 block / dns outbound，拦截用 route rule 的 action: reject。
 */
import { DIRECT, REJECT, URL_TEST } from '../catalog';
import type { PlanRule, TemplatePlan } from '../plan';
import { type GeoKind, type RuleSourceOptions, singRuleUrl } from '../sources';

export interface SingboxRenderOptions extends RuleSourceOptions {
    /** sing-box < 1.12：使用旧 DNS server 写法 */
    legacy: boolean;
}

export const SINGBOX_DIRECT_TAG = 'direct';

/**
 * 从 User-Agent 解析 sing-box 版本。
 * 常见形式：`SFA/1.11.4 (build 123; sing-box 1.11.4; language zh_CN)`、`SFI/1.12.0 (...)`、
 * `SFM/...`、`sing-box 1.11.0`、`sing-box/1.12.1`。解析不到返回 undefined。
 */
export function parseSingboxVersion(userAgent = ''): { major: number; minor: number } | undefined {
    const m =
        /sing-box[\s/]+v?(\d+)\.(\d+)/i.exec(userAgent) || /\bSF[AIMT]\/v?(\d+)\.(\d+)/.exec(userAgent);
    if (!m) return undefined;
    return { major: Number(m[1]), minor: Number(m[2]) };
}

/** 明确识别出 < 1.12 才走旧格式 */
export function isLegacySingbox(userAgent = ''): boolean {
    const v = parseSingboxVersion(userAgent);
    return !!v && (v.major < 1 || (v.major === 1 && v.minor < 12));
}

const tagOf = (kind: GeoKind, id: string) => `${kind}-${id}`;
const target = (t: string) => (t === DIRECT ? SINGBOX_DIRECT_TAG : t);

function collectRuleSets(plan: TemplatePlan, options: SingboxRenderOptions) {
    const sets = new Map<string, Record<string, unknown>>();
    const add = (kind: GeoKind, id: string) => {
        const tag = tagOf(kind, id);
        if (sets.has(tag)) return;
        sets.set(tag, {
            type: 'remote',
            tag,
            format: 'binary',
            url: singRuleUrl(kind, id, options),
            update_interval: '1d'
        });
    };
    for (const rule of plan.rules) {
        rule.geosite.forEach((id) => add('geosite', id));
        rule.geoip.forEach((id) => add('geoip', id));
    }
    add('geosite', 'cn'); // DNS 分流需要
    return [...sets.values()];
}

function routeRule(tags: string[], rule: PlanRule) {
    const base = { rule_set: tags };
    return rule.target === REJECT
        ? { ...base, action: 'reject' }
        : { ...base, action: 'route', outbound: target(rule.target) };
}

function buildRouteRules(plan: TemplatePlan) {
    const rules: Record<string, unknown>[] = [
        { action: 'sniff' },
        { protocol: 'dns', action: 'hijack-dns' }
    ];
    const ipRules: Record<string, unknown>[] = [];
    for (const rule of plan.rules) {
        const site = rule.geosite.map((id) => tagOf('geosite', id));
        const ip = rule.geoip.map((id) => tagOf('geoip', id));
        if (site.length) rules.push(routeRule(site, rule));
        if (ip.length) ipRules.push(routeRule(ip, rule));
    }
    // IP 类规则只匹配 IP；先 resolve（走 DNS 规则：国内域名 dns-cn，其余 dns-remote），
    // 让 mixed 入站的域名请求也能命中 geoip-cn 等规则。域名类规则已在前面匹配完。
    return ipRules.length ? [...rules, { action: 'resolve' }, ...ipRules] : rules;
}

function buildGroups(plan: TemplatePlan) {
    return plan.groups.map((g) => {
        const outbounds = g.members.map(target);
        if (g.type === 'url-test') {
            return {
                type: 'urltest',
                tag: g.name,
                outbounds,
                url: URL_TEST.url,
                interval: `${URL_TEST.interval}s`,
                tolerance: URL_TEST.tolerance
            };
        }
        return { type: 'selector', tag: g.name, outbounds, default: outbounds[0] };
    });
}

function buildDns(proxyTag: string, legacy: boolean) {
    if (legacy) {
        return {
            servers: [
                { tag: 'dns-remote', address: 'https://1.1.1.1/dns-query', detour: proxyTag },
                { tag: 'dns-cn', address: 'https://223.5.5.5/dns-query' },
                { tag: 'dns-local', address: 'local' }
            ],
            rules: [
                // 解析节点域名自身：必须走国内直连 DNS，避免绕回代理
                { outbound: 'any', server: 'dns-cn' },
                { rule_set: ['geosite-cn'], server: 'dns-cn' }
            ],
            final: 'dns-remote'
        };
    }
    return {
        servers: [
            { type: 'https', tag: 'dns-remote', server: '1.1.1.1', detour: proxyTag },
            { type: 'https', tag: 'dns-cn', server: '223.5.5.5' },
            { type: 'local', tag: 'dns-local' }
        ],
        rules: [{ rule_set: ['geosite-cn'], action: 'route', server: 'dns-cn' }],
        final: 'dns-remote'
    };
}

export function renderSingboxTemplate(
    plan: TemplatePlan,
    nodeOutbounds: Record<string, unknown>[],
    options: SingboxRenderOptions,
    endpoints: Record<string, unknown>[] = []
) {
    const proxyTag = plan.groups[0].name; // 🚀 节点选择
    const tun: Record<string, unknown> = {
        type: 'tun',
        tag: 'tun-in',
        address: ['172.19.0.1/30', 'fdfe:dcba:9876::1/126'],
        auto_route: true,
        strict_route: true
    };
    if (options.legacy) tun.stack = 'mixed'; // stack 在 1.15 起弃用

    const route: Record<string, unknown> = {
        rule_set: collectRuleSets(plan, options),
        rules: buildRouteRules(plan),
        final: plan.final,
        auto_detect_interface: true
    };
    if (!options.legacy) route.default_domain_resolver = { server: 'dns-cn' };

    return {
        log: { level: 'info', timestamp: true },
        dns: buildDns(proxyTag, options.legacy),
        inbounds: [
            { type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: 7890 },
            tun
        ],
        ...(endpoints.length ? { endpoints } : {}),
        outbounds: [...nodeOutbounds, ...buildGroups(plan), { type: 'direct', tag: SINGBOX_DIRECT_TAG }],
        route,
        experimental: { cache_file: { enabled: true } }
    };
}

/**
 * WireGuard outbound -> endpoint（sing-box 1.11 起迁移，1.13 起移除旧 outbound 写法）
 * 字段依据 https://sing-box.sagernet.org/configuration/endpoint/wireguard/
 */
export function wireguardOutboundToEndpoint(ob: Record<string, any>): Record<string, unknown> {
    const toReserved = (r: unknown): number[] | undefined => {
        const list = Array.isArray(r) ? r : typeof r === 'string' ? r.split(',') : [];
        const nums = list.map((i: unknown) => parseInt(String(i).trim(), 10));
        return nums.length === 3 && nums.every(Number.isInteger) ? nums : undefined;
    };
    const peers: Record<string, unknown>[] = Array.isArray(ob.peers)
        ? ob.peers.map((p: any) => ({
              address: p.server,
              port: p.server_port,
              public_key: p.public_key,
              ...(p.pre_shared_key ? { pre_shared_key: p.pre_shared_key } : {}),
              allowed_ips: p.allowed_ips,
              ...(toReserved(p.reserved ?? ob.reserved) ? { reserved: toReserved(p.reserved ?? ob.reserved) } : {})
          }))
        : [
              {
                  address: ob.server,
                  port: ob.server_port,
                  public_key: ob.peer_public_key,
                  ...(ob.pre_shared_key ? { pre_shared_key: ob.pre_shared_key } : {}),
                  allowed_ips: ['0.0.0.0/0', '::/0'],
                  ...(toReserved(ob.reserved) ? { reserved: toReserved(ob.reserved) } : {})
              }
          ];
    return {
        type: 'wireguard',
        tag: ob.tag,
        address: ob.local_address,
        private_key: ob.private_key,
        ...(ob.mtu ? { mtu: ob.mtu } : {}),
        peers,
        ...(ob.detour ? { detour: ob.detour } : {})
    };
}
