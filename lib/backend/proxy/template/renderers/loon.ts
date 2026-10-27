/**
 * Loon 分流模板渲染
 * 文档：https://nsloon.app/LoonManual/cn/policygroup.md、sub_rule.md、general.md、dns.md
 * 示例配置：https://github.com/Loon0x00/LoonExampleConfig/blob/master/example.conf
 */
import { DIRECT, URL_TEST } from '../catalog';
import type { TemplatePlan } from '../plan';
import { bm7RuleUrl, type RuleSourceOptions } from '../sources';

const section = (name: string, lines: string[]) => `[${name}]\n${lines.join('\n')}`;

function renderGeneral(): string[] {
    return [
        'ipv6 = false',
        'dns-server = 223.5.5.5,119.29.29.29',
        'doh-server = https://223.5.5.5/dns-query,https://doh.pub/dns-query',
        'skip-proxy = 192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,localhost,*.local',
        'bypass-tun = 10.0.0.0/8,100.64.0.0/10,127.0.0.0/8,169.254.0.0/16,172.16.0.0/12,192.168.0.0/16,224.0.0.0/4',
        `proxy-test-url = ${URL_TEST.url}`,
        'test-timeout = 5'
    ];
}

function renderGroups(plan: TemplatePlan): string[] {
    return plan.groups.map((group) => {
        const members = group.members.join(',');
        return group.type === 'url-test'
            ? `${group.name} = url-test,${members},url = ${URL_TEST.url},interval = ${URL_TEST.interval},tolerance = ${URL_TEST.tolerance}`
            : `${group.name} = select,${members}`;
    });
}

function renderRemoteRules(plan: TemplatePlan, options: RuleSourceOptions): string[] {
    const lines: string[] = [];
    const seen = new Set<string>();
    for (const rule of plan.rules) {
        for (const name of rule.bm7) {
            const key = `${name}|${rule.target}`;
            if (seen.has(key)) continue;
            seen.add(key);
            // DIRECT / REJECT 为 Loon 内置策略，原样写入
            lines.push(
                `${bm7RuleUrl('Loon', name, options)}, policy=${rule.target}, tag=${name}, enabled=true`
            );
        }
    }
    return lines;
}

/** nodeLines：converter 已生成的节点行（原样放入 [Proxy]） */
export function renderLoonTemplate(
    plan: TemplatePlan,
    nodeLines: string[],
    options: RuleSourceOptions
): string {
    return [
        section('General', renderGeneral()),
        section('Proxy', nodeLines),
        section('Proxy Group', renderGroups(plan)),
        section('Remote Rule', renderRemoteRules(plan, options)),
        section('Rule', [`GEOIP,CN,${DIRECT}`, `FINAL,${plan.final}`])
    ].join('\n\n');
}

