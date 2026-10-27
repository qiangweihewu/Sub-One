/**
 * Sub-One 规则集 URL 构造
 *
 * 只拼 URL，不在 Worker 里下载规则。CDN 可配置：
 * - testingcf / jsdelivr：https://<host>/gh/{owner}/{repo}@{branch}/{path}
 * - raw：https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}
 * - custom：用户提供的模板，支持 {owner} {repo} {branch} {path} 占位符
 */

export type RuleCdn = 'testingcf' | 'jsdelivr' | 'raw' | 'custom';

export const RULE_CDNS: RuleCdn[] = ['testingcf', 'jsdelivr', 'raw', 'custom'];
export const DEFAULT_RULE_CDN: RuleCdn = 'testingcf';

export interface RuleSourceOptions {
    cdn?: RuleCdn;
    /** cdn = custom 时使用，如 https://gh-proxy.com/https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path} */
    customTemplate?: string;
}

export function isRuleCdn(value: unknown): value is RuleCdn {
    return typeof value === 'string' && (RULE_CDNS as string[]).includes(value);
}

export function githubFileUrl(
    owner: string,
    repo: string,
    branch: string,
    path: string,
    options: RuleSourceOptions = {}
): string {
    const cdn = options.cdn || DEFAULT_RULE_CDN;
    switch (cdn) {
        case 'jsdelivr':
            return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${path}`;
        case 'raw':
            return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
        case 'custom': {
            // 拼进 ini / YAML 配置，拒绝含空白（换行注入）或非 https 的模板
            const tpl = options.customTemplate?.trim();
            if (tpl && /^https:\/\/\S+$/.test(tpl) && tpl.includes('{path}')) {
                return tpl
                    .replace(/\{owner\}/g, owner)
                    .replace(/\{repo\}/g, repo)
                    .replace(/\{branch\}/g, branch)
                    .replace(/\{path\}/g, path);
            }
            return `https://testingcf.jsdelivr.net/gh/${owner}/${repo}@${branch}/${path}`;
        }
        case 'testingcf':
        default:
            return `https://testingcf.jsdelivr.net/gh/${owner}/${repo}@${branch}/${path}`;
    }
}

export type GeoKind = 'geosite' | 'geoip';

/** mihomo 规则集：mrs（Meta 内核）或 yaml（Stash / 旧版 Clash） */
export function metaRuleUrl(
    kind: GeoKind,
    id: string,
    format: 'mrs' | 'yaml',
    options?: RuleSourceOptions
): string {
    return githubFileUrl('MetaCubeX', 'meta-rules-dat', 'meta', `geo/${kind}/${id}.${format}`, options);
}

/** sing-box 二进制规则集 (srs) */
export function singRuleUrl(kind: GeoKind, id: string, options?: RuleSourceOptions): string {
    return githubFileUrl('MetaCubeX', 'meta-rules-dat', 'sing', `geo/${kind}/${id}.srs`, options);
}

export type Bm7Client = 'Surge' | 'Loon' | 'QuantumultX' | 'Shadowrocket' | 'Clash';

/** blackmatrix7/ios_rule_script 规则列表 */
export function bm7RuleUrl(client: Bm7Client, name: string, options?: RuleSourceOptions): string {
    return githubFileUrl('blackmatrix7', 'ios_rule_script', 'master', `rule/${client}/${name}/${name}.list`, options);
}
