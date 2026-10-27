/**
 * Quantumult X 分流模板渲染
 * 文档：https://github.com/crossutility/Quantumult-X/blob/master/sample.conf
 */
import { DIRECT, REJECT, URL_TEST } from '../catalog';
import type { TemplatePlan } from '../plan';
import { bm7RuleUrl, type RuleSourceOptions } from '../sources';

const section = (name: string, lines: string[]) => `[${name}]\n${lines.join('\n')}`;

/** QX 内置策略名小写；其余（节点 tag / 策略组名）原样 */
export function qxPolicy(name: string): string {
    if (name === DIRECT) return 'direct';
    if (name === REJECT) return 'reject';
    return name;
}

function renderPolicies(plan: TemplatePlan): string[] {
    return plan.groups.map((group) => {
        const members = group.members.map(qxPolicy).join(', ');
        return group.type === 'url-test'
            ? `url-latency-benchmark=${group.name}, ${members}, check-interval=${URL_TEST.interval}, tolerance=${URL_TEST.tolerance}`
            : `static=${group.name}, ${members}`;
    });
}

function renderFilterRemote(plan: TemplatePlan, options: RuleSourceOptions): string[] {
    const lines: string[] = [];
    const seen = new Set<string>();
    for (const rule of plan.rules) {
        for (const name of rule.bm7) {
            const key = `${name}|${rule.target}`;
            if (seen.has(key)) continue;
            seen.add(key);
            lines.push(
                `${bm7RuleUrl('QuantumultX', name, options)}, tag=${name}, force-policy=${qxPolicy(rule.target)}, update-interval=86400, opt-parser=false, enabled=true`
            );
        }
    }
    return lines;
}

export function renderQuantumultXTemplate(
    plan: TemplatePlan,
    nodeLines: string[],
    options: RuleSourceOptions
): string {
    return [
        section('general', [`server_check_url=${URL_TEST.url}`, 'server_check_timeout=5000']),
        section('dns', [
            'no-ipv6',
            'doh-server=https://223.5.5.5/dns-query, https://doh.pub/dns-query'
        ]),
        section('policy', renderPolicies(plan)),
        section('server_local', nodeLines),
        section('filter_remote', renderFilterRemote(plan, options)),
        section('filter_local', ['geoip, cn, direct', `final, ${qxPolicy(plan.final)}`])
    ].join('\n\n');
}
