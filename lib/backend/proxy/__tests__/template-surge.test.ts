import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

import { convert, parse } from '../index';

const SAMPLE = [
    'trojan://p@hk1.example.com:443#香港 01',
    'trojan://p@hk2.example.com:443#HK-02 IPLC',
    'trojan://p@jp.example.com:443#🇯🇵 日本东京',
    'trojan://p@us.example.com:443#US 01',
    'trojan://p@x.example.com:443#未知,节点=1'
].join('\n');

const PRESETS = ['minimal', 'balanced', 'full'] as const;

function sections(text: string): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    let cur = '';
    for (const line of text.split('\n')) {
        const m = line.match(/^\[(.+)\]$/);
        if (m) {
            cur = m[1];
            out[cur] = [];
        } else if (cur && line.trim()) out[cur].push(line);
    }
    return out;
}

describe.each(['surge', 'surfboard'] as const)('template: %s', (target) => {
    it('keeps node-only output without template', async () => {
        const out = await convert(parse(SAMPLE), target);
        expect(out).not.toContain('[General]');
        expect(out.split('\n').every((l) => l.includes('=trojan,'))).toBe(true);
        expect(await convert(parse(SAMPLE), target, { template: 'none' })).toBe(out);
    });

    it.each(PRESETS)('renders a structurally valid profile (%s)', async (preset) => {
        const out = await convert(parse(SAMPLE), target, { template: preset });
        const sec = sections(out);
        expect(Object.keys(sec)).toEqual(['General', 'Proxy', 'Proxy Group', 'Rule']);
        expect(sec.Proxy).toHaveLength(5);

        const nodes = new Set(sec.Proxy.map((l) => l.slice(0, l.indexOf('='))));
        expect(nodes.size).toBe(5);
        const groups = new Map<string, string[]>();
        for (const line of sec['Proxy Group']) {
            const i = line.indexOf(' = ');
            const parts = line.slice(i + 3).split(', ');
            groups.set(
                line.slice(0, i),
                parts.slice(1).filter((p) => !p.includes('='))
            );
        }
        const known = new Set([...nodes, ...groups.keys(), 'DIRECT']);
        for (const members of groups.values()) {
            expect(members.length).toBeGreaterThan(0);
            members.forEach((m) => expect(known.has(m)).toBe(true));
        }
        const rules = sec.Rule;
        for (const r of rules) {
            const parts = r.split(',');
            const target = parts[0] === 'GEOIP' || parts[0] === 'FINAL' ? parts[parts.length === 4 ? 1 : parts[0] === 'GEOIP' ? 2 : 1] : parts[2];
            expect(known.has(target) || target === 'REJECT').toBe(true);
        }
        expect(rules[rules.length - 1]).toMatch(/^FINAL,/);
        expect(rules[rules.length - 2]).toBe('GEOIP,CN,DIRECT');
        expect(rules.some((r) => r.startsWith('RULE-SET,https://') && r.includes('/rule/Surge/'))).toBe(true);
        expect(sec.General.some((l) => l.startsWith('proxy-test-url = '))).toBe(true);
    });

    it('platform specifics', async () => {
        const out = await convert(parse(SAMPLE), target, { template: 'balanced' });
        if (target === 'surge') {
            expect(out).toContain('loglevel = notify');
            expect(out).toContain(',no-resolve');
            expect(out).toMatch(/FINAL,.+,dns-failed/);
            expect(out).not.toMatch(/url=/);
        } else {
            expect(out).not.toContain('no-resolve');
            expect(out).not.toContain('dns-failed');
            expect(out).toContain('url=https://www.gstatic.com/generate_204');
        }
    });

    it('works with zero nodes', async () => {
        const out = await convert([], target, { template: 'full' });
        const sec = sections(out);
        expect(sec['Proxy Group'].some((l) => l.includes('url-test'))).toBe(false);
        expect(sec.Rule[sec.Rule.length - 1]).toMatch(/^FINAL,/);
    });
});

describe('template: shadowrocket', () => {
    it('keeps node-only YAML without template', async () => {
        const out = yaml.load(await convert(parse(SAMPLE), 'shadowrocket')) as any;
        expect(Object.keys(out)).toEqual(['proxies']);
    });

    it.each(PRESETS)('adds groups, providers and rules (%s)', async (preset) => {
        const out = yaml.load(await convert(parse(SAMPLE), 'shadowrocket', { template: preset })) as any;
        expect(Object.keys(out)).toEqual(['proxies', 'proxy-groups', 'rule-providers', 'rules']);
        const known = new Set<string>([
            ...out.proxies.map((p: any) => p.name),
            ...out['proxy-groups'].map((g: any) => g.name),
            'DIRECT'
        ]);
        for (const g of out['proxy-groups']) {
            expect(g.proxies.length).toBeGreaterThan(0);
            g.proxies.forEach((m: string) => expect(known.has(m)).toBe(true));
        }
        for (const r of out.rules as string[]) {
            const p = r.split(',');
            const tgt = p[0] === 'MATCH' ? p[1] : p[2];
            expect(known.has(tgt) || tgt === 'REJECT').toBe(true);
            if (p[0] === 'RULE-SET') expect(out['rule-providers'][p[1]]).toBeDefined();
        }
        expect(out.rules[out.rules.length - 1]).toMatch(/^MATCH,/);
        expect(out.rules[out.rules.length - 2]).toBe('GEOIP,CN,DIRECT');
        for (const p of Object.values<any>(out['rule-providers'])) {
            expect(p.url).toContain('/rule/Shadowrocket/');
        }
    });
});

describe.each(['surge', 'surfboard'] as const)('template: %s with WireGuard and duplicate names', (target) => {
    const WG = 'wireguard://testkey@26.27.28.29:51820?publickey=pubkey123&ip=10.0.0.2&dns=1.1.1.1&mtu=1280&keepalive=25#WG 法国';
    const INPUT = [SAMPLE, WG, 'trojan://p@d1.example.com:443#dup', 'trojan://p@d2.example.com:443#dup'].join('\n');

    it('keeps sections well-formed and members resolvable', async () => {
        const out = await convert(parse(INPUT), target, { template: 'balanced' });
        const lines = out.split('\n');
        const heads = lines.filter((l) => /^\[.+\]$/.test(l));
        expect(heads).toEqual(['[General]', '[Proxy]', '[Proxy Group]', '[Rule]', '[WireGuard WG 法国]']);
        expect(out).not.toMatch(/^#/m);
        const sec = sections(out);
        expect(sec['WireGuard WG 法国'].some((l) => l.startsWith('private-key = '))).toBe(true);
        expect(sec['WireGuard WG 法国'].some((l) => l.startsWith('peer = ('))).toBe(true);
        const wgLine = sec.Proxy.find((l) => l.startsWith('WG 法国='))!;
        expect(wgLine).toMatch(/^WG 法国=wireguard,section-name=WG 法国/);

        const nodes = sec.Proxy.map((l) => l.slice(0, l.indexOf('=')));
        expect(new Set(nodes).size).toBe(nodes.length);
        expect(nodes).toContain('dup_1');
        expect(nodes).toContain('dup_2');
        const known = new Set([...nodes, 'DIRECT']);
        for (const l of sec['Proxy Group']) known.add(l.slice(0, l.indexOf(' = ')));
        for (const l of sec['Proxy Group']) {
            l.slice(l.indexOf(' = ') + 3)
                .split(', ')
                .slice(1)
                .filter((p) => !p.includes('='))
                .forEach((m) => expect(known.has(m)).toBe(true));
        }
        expect(sec['Proxy Group'].some((l) => l.includes('WG 法国'))).toBe(true);
        expect(sec.Rule[sec.Rule.length - 1]).toMatch(/^FINAL,/);
    });

    it('does not change output without template', async () => {
        const out = await convert(parse(INPUT), target);
        expect(out).not.toContain('dup_1');
    });

    it('restores WireGuard proxy lines whose name contains #', async () => {
        const wgHash = WG.replace('#WG 法国', `#${encodeURIComponent('WG#1 美国')}`);
        const out = await convert(parse([SAMPLE, wgHash].join('\n')), target, { template: 'balanced' });
        expect(out).not.toMatch(/^#/m);
        const proxies = sections(out).Proxy.map((l) => l.slice(0, l.indexOf('=')));
        expect(proxies).toContain('WG#1 美国');
    });
});
