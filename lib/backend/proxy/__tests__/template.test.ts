import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

import { convert, parse } from '../index';
import { buildPlan, githubFileUrl, GROUP_NAMES, matchRegion } from '../template';

const SAMPLE = [
    'trojan://p@hk1.example.com:443#香港 01',
    'trojan://p@hk2.example.com:443#HK-02 IPLC',
    'trojan://p@jp.example.com:443#🇯🇵 日本东京',
    'trojan://p@us.example.com:443#US 01',
    'trojan://p@x.example.com:443#未知节点'
].join('\n');

describe('template: regions', () => {
    it('matches common node names', () => {
        expect(matchRegion('香港 01')).toBe('🇭🇰 香港节点');
        expect(matchRegion('HK-02 IPLC')).toBe('🇭🇰 香港节点');
        expect(matchRegion('US 01')).toBe('🇺🇸 美国节点');
        expect(matchRegion('法兰克福 01')).toBe('🇩🇪 德国节点');
        expect(matchRegion('Plus 01')).toBeUndefined();
        expect(matchRegion('亚美尼亚')).toBeUndefined();
        expect(matchRegion('JP-NRT 01')).toBe('🇯🇵 日本节点');
        expect(matchRegion('德克萨斯 01')).toBe('🇺🇸 美国节点');
    });

    it('avoids common false positives', () => {
        expect(matchRegion('ROCKET 01')).toBeUndefined();
        expect(matchRegion('Premium SCAN')).toBeUndefined();
        expect(matchRegion('官网后台')).toBeUndefined();
        expect(matchRegion('平台专线')).toBeUndefined();
    });
});

describe('template: sources', () => {
    it('falls back to testingcf for unsafe custom templates', () => {
        const ok = githubFileUrl('o', 'r', 'b', 'p.list', {
            cdn: 'custom',
            customTemplate: 'https://gh-proxy.com/https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}'
        });
        expect(ok).toBe('https://gh-proxy.com/https://raw.githubusercontent.com/o/r/b/p.list');
        for (const bad of ['http://x/{path}', 'https://x/{path}\n[Rule]', 'https://x/no-placeholder']) {
            expect(githubFileUrl('o', 'r', 'b', 'p.list', { cdn: 'custom', customTemplate: bad })).toBe(
                'https://testingcf.jsdelivr.net/gh/o/r@b/p.list'
            );
        }
    });
});

describe('template: plan', () => {
    it('builds region groups only when at least two regions exist', () => {
        const plan = buildPlan(['香港 01', 'HK 02', '日本 01', '未知'], 'balanced');
        expect(plan.groups.map((g) => g.name)).toContain('🇭🇰 香港节点');
        const flat = buildPlan(['香港 01', '未知'], 'balanced');
        expect(flat.groups.some((g) => g.name.includes('香港'))).toBe(false);
    });

    it('never puts REJECT into group members and never emits empty url-test groups', () => {
        for (const names of [[], ['a'], ['香港 01', '日本 01']]) {
            const plan = buildPlan(names, 'full');
            for (const g of plan.groups) {
                expect(g.members).not.toContain('REJECT');
                expect(g.members.length).toBeGreaterThan(0);
            }
        }
    });

    it('every member references a node, a group or DIRECT', () => {
        const plan = buildPlan(['香港 01', '日本 01', 'x'], 'full');
        const known = new Set([...plan.nodeNames, ...plan.groups.map((g) => g.name), 'DIRECT']);
        for (const g of plan.groups) g.members.forEach((m) => expect(known.has(m)).toBe(true));
        for (const r of plan.rules) expect(known.has(r.target) || r.target === 'REJECT').toBe(true);
    });
});

describe('template: clash', () => {
    it('keeps node-only output when template is not set', async () => {
        const out = yaml.load(await convert(parse(SAMPLE), 'mihomo')) as any;
        expect(Object.keys(out)).toEqual(['proxies']);
    });

    it('renders groups, providers and rules for mihomo', async () => {
        const out = yaml.load(await convert(parse(SAMPLE), 'mihomo', { template: 'balanced' })) as any;
        expect(out.mode).toBe('rule');
        expect(out.proxies).toHaveLength(5);
        const groupNames = out['proxy-groups'].map((g: any) => g.name);
        expect(groupNames[0]).toBe(GROUP_NAMES.select);
        expect(groupNames).toContain('🤖 AI 服务');
        expect(out.rules.at(-1)).toBe(`MATCH,${GROUP_NAMES.final}`);
        expect(out['rule-providers']['geosite-cn'].format).toBe('mrs');
        expect(out['rule-providers']['geosite-cn'].url).toContain('testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta');
        // 每条 RULE-SET 都有对应的 provider，每个目标都是已定义的组或内置策略
        const groups = new Set(groupNames);
        for (const rule of out.rules as string[]) {
            const [type, a, b] = rule.split(',');
            if (type === 'RULE-SET') {
                expect(out['rule-providers'][a]).toBeDefined();
                expect(groups.has(b) || b === 'DIRECT' || b === 'REJECT').toBe(true);
            }
        }
    });

    it('uses yaml providers for Stash and legacy Clash', async () => {
        const stash = yaml.load(await convert(parse(SAMPLE), 'stash', { template: 'minimal' })) as any;
        expect(stash['rule-providers']['geosite-cn'].format).toBe('yaml');
        expect(stash.sniffer).toBeUndefined();
        const legacy = yaml.load(
            await convert(parse(SAMPLE), 'clash', { template: 'minimal', userAgent: 'ClashforWindows/0.20' })
        ) as any;
        expect(legacy['rule-providers']['geosite-cn'].format).toBe('yaml');
    });

    it('honours the CDN option', async () => {
        const raw = yaml.load(
            await convert(parse(SAMPLE), 'mihomo', { template: 'minimal', ruleCdn: 'raw' })
        ) as any;
        expect(raw['rule-providers']['geosite-cn'].url).toBe(
            'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/cn.mrs'
        );
    });
});
