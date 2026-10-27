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

describe('template: loon', () => {
    it('keeps node-only output without template', async () => {
        const plain = await convert(parse(SAMPLE), 'loon');
        expect(plain).not.toContain('[Proxy Group]');
        expect(await convert(parse(SAMPLE), 'loon', { template: 'none' })).toBe(plain);
    });

    for (const preset of ['minimal', 'balanced', 'full'] as const) {
        it(`renders a consistent ${preset} config`, async () => {
            const plain = await convert(parse(SAMPLE), 'loon');
            const text = await convert(parse(SAMPLE), 'loon', { template: preset });
            const s = sections(text);
            for (const name of ['General', 'Proxy', 'Proxy Group', 'Remote Rule', 'Rule']) {
                expect(s[name]).toBeDefined();
            }
            expect(s.Proxy.join('\n')).toBe(plain);

            const nodes = s.Proxy.map((l) => l.split('=')[0]);
            const groups = s['Proxy Group'].map((l) => l.split(' = ')[0]);
            const known = new Set([...nodes, ...groups, 'DIRECT']);
            for (const line of s['Proxy Group']) {
                const body = line.slice(line.indexOf(' = ') + 3).split(',');
                expect(['select', 'url-test']).toContain(body[0]);
                for (const m of body.slice(1).filter((x) => !x.includes('='))) {
                    expect(known.has(m.trim())).toBe(true);
                }
            }
            for (const line of s['Remote Rule']) {
                const policy = line.match(/policy=([^,]+)/)![1];
                expect(known.has(policy) || policy === 'REJECT').toBe(true);
                expect(line).toContain('enabled=true');
            }
            const final = s.Rule.find((l) => l.startsWith('FINAL,'))!;
            expect(known.has(final.split(',')[1])).toBe(true);
            expect(s.Rule).toContain('GEOIP,CN,DIRECT');
        });
    }
});

describe('template: loon node names', () => {
    it('sanitizes , and = and de-duplicates names so every member resolves', async () => {
        const raw = [
            'trojan://p@a.example.com:443#' + encodeURIComponent('SG-01, 新加坡=IPLC'),
            'trojan://p@b.example.com:443#' + encodeURIComponent('香港 01'),
            'trojan://p@c.example.com:443#' + encodeURIComponent('香港 01'),
            'trojan://p@d.example.com:443#' + encodeURIComponent('日本 01')
        ].join('\n');
        const s = sections(await convert(parse(raw), 'loon', { template: 'balanced' }));
        const nodes = s.Proxy.map((l) => l.split('=')[0]);
        const groups = s['Proxy Group'].map((l) => l.split(' = ')[0]);
        expect(new Set(nodes).size).toBe(nodes.length);
        expect(nodes.length).toBe(4);
        expect(nodes.some((n) => /[,=]/.test(n))).toBe(false);
        expect(nodes).toContain('香港 01_1');
        const known = new Set([...nodes, ...groups, 'DIRECT']);
        for (const line of s['Proxy Group']) {
            const body = line.slice(line.indexOf(' = ') + 3).split(',').slice(1).filter((x) => !x.includes('='));
            for (const m of body) expect(known.has(m)).toBe(true);
        }
    });
});
