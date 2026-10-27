import { describe, expect, it } from 'vitest';

import { convert, parse } from '../index';

const SAMPLE = [
    'trojan://p@hk1.example.com:443#香港 01',
    'trojan://p@hk2.example.com:443#HK-02 IPLC',
    'trojan://p@jp.example.com:443#🇯🇵 日本东京',
    'trojan://p@us.example.com:443#US 01'
].join('\n');

function sections(text: string) {
    const out: Record<string, string[]> = {};
    let cur = '';
    for (const line of text.split('\n')) {
        const m = line.match(/^\[(.+)\]$/);
        if (m) out[(cur = m[1])] = [];
        else if (cur && line.trim()) out[cur].push(line);
    }
    return out;
}

describe('template: quantumult x', () => {
    it('keeps node-only output without template', async () => {
        const plain = await convert(parse(SAMPLE), 'quanx');
        expect(plain).not.toContain('[policy]');
        expect(await convert(parse(SAMPLE), 'quanx', { template: 'none' })).toBe(plain);
    });

    for (const preset of ['minimal', 'balanced', 'full'] as const) {
        it(`renders a consistent ${preset} config`, async () => {
            const plain = await convert(parse(SAMPLE), 'quanx');
            const s = sections(await convert(parse(SAMPLE), 'quanx', { template: preset }));
            for (const name of ['general', 'dns', 'policy', 'server_local', 'filter_remote', 'filter_local']) {
                expect(s[name]).toBeDefined();
            }
            expect(s.server_local.join('\n')).toBe(plain);

            const nodes = s.server_local.map((l) => l.match(/,tag=(.+)$/)![1]);
            const groups = s.policy.map((l) => l.slice(l.indexOf('=') + 1).split(',')[0].trim());
            const known = new Set([...nodes, ...groups, 'direct']);
            for (const line of s.policy) {
                const kind = line.slice(0, line.indexOf('='));
                expect(['static', 'url-latency-benchmark']).toContain(kind);
                const parts = line.slice(line.indexOf('=') + 1).split(',').map((x) => x.trim());
                for (const m of parts.slice(1).filter((x) => !x.includes('='))) {
                    expect(known.has(m)).toBe(true);
                }
            }
            for (const line of s.filter_remote) {
                const policy = line.match(/force-policy=([^,]+)/)![1];
                expect(known.has(policy) || policy === 'reject').toBe(true);
            }
            expect(s.filter_local).toContain('geoip, cn, direct');
            const final = s.filter_local.find((l) => l.startsWith('final, '))!;
            expect(known.has(final.slice(7))).toBe(true);
            expect(text(s)).not.toMatch(/force-policy=(DIRECT|REJECT)/);
        });
    }
});

function text(s: Record<string, string[]>) {
    return Object.values(s).flat().join('\n');
}

describe('template: quantumult x node names', () => {
    it('sanitizes , and = and de-duplicates names so every member resolves', async () => {
        const raw = [
            'trojan://p@a.example.com:443#' + encodeURIComponent('SG-01, 新加坡=IPLC'),
            'trojan://p@b.example.com:443#' + encodeURIComponent('香港 01'),
            'trojan://p@c.example.com:443#' + encodeURIComponent('香港 01'),
            'trojan://p@d.example.com:443#' + encodeURIComponent('日本 01')
        ].join('\n');
        const s = sections(await convert(parse(raw), 'quanx', { template: 'balanced' }));
        const nodes = s.server_local.map((l) => l.match(/,tag=(.+)$/)![1]);
        const groups = s.policy.map((l) => l.slice(l.indexOf('=') + 1).split(',')[0].trim());
        expect(new Set(nodes).size).toBe(nodes.length);
        expect(nodes.length).toBe(4);
        expect(nodes.some((n) => /[,=]/.test(n))).toBe(false);
        expect(nodes).toContain('香港 01_1');
        const known = new Set([...nodes, ...groups, 'direct']);
        for (const line of s.policy) {
            const body = line.slice(line.indexOf('=') + 1).split(',').slice(1).map((x) => x.trim()).filter((x) => !x.includes('='));
            for (const m of body) expect(known.has(m)).toBe(true);
        }
    });
});
