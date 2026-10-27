/**
 * Clash / Mihomo / Stash 分流模板渲染
 */
import { URL_TEST } from '../catalog';
import type { PlanRule, TemplatePlan } from '../plan';
import { type GeoKind, metaRuleUrl, type RuleSourceOptions } from '../sources';

export interface ClashRenderOptions extends RuleSourceOptions {
    /** mrs 仅 Meta 内核支持；Stash / 旧版 Clash 用 yaml */
    providerFormat: 'mrs' | 'yaml';
    /** 是否输出 Meta 专有段（sniffer、geox 等） */
    meta: boolean;
}

/** 旧版 Clash 内核与 Stash 不认 mrs */
export function clashProviderFormat(userAgent = '', isStash = false): 'mrs' | 'yaml' {
    if (isStash) return 'yaml';
    const ua = userAgent.toLowerCase();
    if (/mihomo|meta|verge|flclash|clash party|clashmi|nyanpasu/.test(ua)) return 'mrs';
    if (/clashforwindows|clashforandroid|clashx\/|clash\/|clash-premium|merlin/.test(ua)) return 'yaml';
    return 'mrs';
}

const providerName = (kind: GeoKind, id: string) => `${kind}-${id}`;

function buildProviders(plan: TemplatePlan, options: ClashRenderOptions) {
    const providers: Record<string, Record<string, unknown>> = {};
    const add = (kind: GeoKind, id: string) => {
        const name = providerName(kind, id);
        if (providers[name]) return;
        providers[name] = {
            type: 'http',
            behavior: kind === 'geosite' ? 'domain' : 'ipcidr',
            format: options.providerFormat,
            url: metaRuleUrl(kind, id, options.providerFormat, options),
            path: `./ruleset/${name}.${options.providerFormat}`,
            interval: 86400
        };
    };
    for (const rule of plan.rules) {
        rule.geosite.forEach((id) => add('geosite', id));
        rule.geoip.forEach((id) => add('geoip', id));
    }
    return providers;
}

/** 域名类规则在前；IP 类后置并加 no-resolve，最后用 cn IP 兜底（需要解析） */
function buildRules(plan: TemplatePlan): string[] {
    const domainRules: string[] = [];
    const ipRules: string[] = [];
    const lateIpRules: string[] = [];
    const pushIp = (rule: PlanRule) => {
        for (const id of rule.geoip) {
            const name = providerName('geoip', id);
            if (rule.id === 'cn') {
                lateIpRules.push(`RULE-SET,${name},${rule.target}`);
            } else {
                ipRules.push(`RULE-SET,${name},${rule.target},no-resolve`);
            }
        }
    };
    for (const rule of plan.rules) {
        rule.geosite.forEach((id) => domainRules.push(`RULE-SET,${providerName('geosite', id)},${rule.target}`));
        pushIp(rule);
    }
    return [...domainRules, ...ipRules, ...lateIpRules, `MATCH,${plan.final}`];
}

function buildGroups(plan: TemplatePlan) {
    return plan.groups.map((group) =>
        group.type === 'url-test'
            ? {
                  name: group.name,
                  type: 'url-test',
                  proxies: group.members,
                  url: URL_TEST.url,
                  interval: URL_TEST.interval,
                  tolerance: URL_TEST.tolerance,
                  lazy: true
              }
            : { name: group.name, type: 'select', proxies: group.members }
    );
}

const FAKE_IP_FILTER = [
    '+.lan',
    '+.local',
    '+.localdomain',
    '+.home.arpa',
    'localhost.ptlogin2.qq.com',
    '+.msftconnecttest.com',
    '+.msftncsi.com',
    'time.*.com',
    'ntp.*.com',
    '+.pool.ntp.org',
    '+.stun.*.*',
    '+.stun.*.*.*',
    '+.srv.nintendo.net',
    '+.stun.playstation.net',
    'xbox.*.microsoft.com',
    '+.xboxlive.com'
];

function buildDns(plan: TemplatePlan, meta: boolean) {
    const domestic = ['https://223.5.5.5/dns-query', 'https://doh.pub/dns-query'];
    const foreign = ['https://1.1.1.1/dns-query', 'https://8.8.8.8/dns-query'];
    const dns: Record<string, unknown> = {
        enable: true,
        ipv6: false,
        'enhanced-mode': 'fake-ip',
        'fake-ip-range': '198.18.0.1/16',
        'fake-ip-filter': FAKE_IP_FILTER,
        'default-nameserver': ['223.5.5.5', '119.29.29.29'],
        nameserver: domestic
    };
    if (meta) {
        dns['proxy-server-nameserver'] = domestic;
        const hasCn = plan.rules.some((r) => r.id === 'cn');
        const hasNonCn = plan.rules.some((r) => r.id === 'non-cn');
        const policy: Record<string, string[]> = {};
        if (hasCn) policy[`rule-set:${providerName('geosite', 'cn')}`] = domestic;
        if (hasNonCn) policy[`rule-set:${providerName('geosite', 'geolocation-!cn')}`] = foreign;
        if (Object.keys(policy).length > 0) dns['nameserver-policy'] = policy;
    } else {
        dns.fallback = foreign;
    }
    return dns;
}

/**
 * 生成完整配置（不含 proxies，由调用方按原有逻辑放在 proxies 之后合并）
 * 返回的对象按 Clash 习惯的字段顺序组织
 */
export function renderClashTemplate(plan: TemplatePlan, options: ClashRenderOptions) {
    const head: Record<string, unknown> = {
        'mixed-port': 7890,
        'allow-lan': false,
        mode: 'rule',
        'log-level': 'info',
        ipv6: false
    };
    if (options.meta) {
        head['unified-delay'] = true;
        head['tcp-concurrent'] = true;
        head.profile = { 'store-selected': true, 'store-fake-ip': true };
        head.sniffer = {
            enable: true,
            'force-dns-mapping': true,
            'parse-pure-ip': true,
            'override-destination': false,
            sniff: {
                HTTP: { ports: [80, '8080-8880'] },
                TLS: { ports: [443, 8443] },
                QUIC: { ports: [443, 8443] }
            },
            'skip-domain': ['Mijia Cloud', '+.push.apple.com']
        };
    }
    head.dns = buildDns(plan, options.meta);

    return {
        head,
        'proxy-groups': buildGroups(plan),
        'rule-providers': buildProviders(plan, options),
        rules: buildRules(plan)
    };
}

