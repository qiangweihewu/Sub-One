/**
 * Egern 分流模板渲染
 * 文档：https://egernapp.com/docs/configuration/example 、 /docs/configuration/rules 、 /docs/configuration/dns
 */
import { URL_TEST } from '../catalog';
import type { TemplatePlan } from '../plan';
import { bm7RuleUrl, type RuleSourceOptions } from '../sources';

/** 返回 proxies 之后的顶层段（policy_groups / rules）与前置的通用段 */
export function renderEgernTemplate(plan: TemplatePlan, options: RuleSourceOptions) {
    const head = {
        ipv6: false,
        proxy_latency_test_url: URL_TEST.url,
        dns: {
            bootstrap: ['223.5.5.5', '119.29.29.29'],
            upstreams: {
                domestic: ['https://223.5.5.5/dns-query', 'https://doh.pub/dns-query']
            },
            forward: [{ domain_wildcard: { match: '*', value: 'domestic' } }]
        }
    };

    const policy_groups = plan.groups.map((group) =>
        group.type === 'url-test'
            ? {
                  auto_test: {
                      name: group.name,
                      policies: group.members,
                      interval: URL_TEST.interval,
                      tolerance: URL_TEST.tolerance,
                      timeout: 5
                  }
              }
            : { select: { name: group.name, policies: group.members } }
    );

    const rules: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    for (const rule of plan.rules) {
        for (const name of rule.bm7) {
            const key = `${name}|${rule.target}`;
            if (seen.has(key)) continue;
            seen.add(key);
            rules.push({
                rule_set: {
                    match: bm7RuleUrl('Surge', name, options),
                    policy: rule.target,
                    update_interval: 86400
                }
            });
        }
    }
    rules.push({ geoip: { match: 'CN', policy: 'DIRECT' } });
    rules.push({ default: { policy: plan.final } });

    return { head, policy_groups, rules };
}
