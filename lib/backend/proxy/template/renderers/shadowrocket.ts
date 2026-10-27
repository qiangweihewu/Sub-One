/**
 * Shadowrocket 分流模板渲染（Clash YAML 形式）
 *
 * 取舍：Shadowrocket 的 conf [Proxy] 可写本地节点，但语法是 Shadowrocket 自己的
 * （method= / obfs=websocket / peer= / auth= 等，与 Surge 写法不同），且被社区手册称为
 * “仅为兼容其他配置文件”。仓库现有的节点输出是 Clash YAML，因此有 preset 时继续输出 YAML，
 * 额外附带 proxy-groups、rule-providers 与 rules。
 *
 * 依据：https://github.com/LOWERTOP/Shadowrocket （社区手册，非官方）：兼容 Clash YAML，
 * RULE-SET / GEOIP / FINAL / no-resolve 语法。
 * 未验证：Shadowrocket 对 YAML 中 rule-providers(classical/text) 的支持。
 */
import { DIRECT, URL_TEST } from '../catalog';
import type { TemplatePlan } from '../plan';
import { bm7RuleUrl, type RuleSourceOptions } from '../sources';

const providerName = (name: string) => `bm7-${name}`;

export function renderShadowrocketTemplate(plan: TemplatePlan, options: RuleSourceOptions = {}) {
    const providers: Record<string, Record<string, unknown>> = {};
    const rules: string[] = [];
    for (const rule of plan.rules) {
        for (const name of rule.bm7) {
            const key = providerName(name);
            if (!providers[key]) {
                providers[key] = {
                    type: 'http',
                    behavior: 'classical',
                    format: 'text',
                    url: bm7RuleUrl('Shadowrocket', name, options),
                    path: `./ruleset/${key}.list`,
                    interval: 86400
                };
            }
            rules.push(`RULE-SET,${key},${rule.target},no-resolve`);
        }
    }
    rules.push(`GEOIP,CN,${DIRECT}`, `MATCH,${plan.final}`);

    const groups = plan.groups.map((group) =>
        group.type === 'url-test'
            ? {
                  name: group.name,
                  type: 'url-test',
                  proxies: group.members,
                  url: URL_TEST.url,
                  interval: URL_TEST.interval,
                  tolerance: URL_TEST.tolerance
              }
            : { name: group.name, type: 'select', proxies: group.members }
    );

    return { 'proxy-groups': groups, 'rule-providers': providers, rules };
}
