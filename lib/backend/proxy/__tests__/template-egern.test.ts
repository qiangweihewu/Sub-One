import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

import { convert, parse } from '../index';

const SAMPLE = [
    'trojan://p@hk1.example.com:443#香港 01',
    'trojan://p@hk2.example.com:443#HK-02 IPLC',
    'trojan://p@jp.example.com:443#🇯🇵 日本东京',
    'trojan://p@us.example.com:443#US 01'
].join('\n');

const kindOf = (item: Record<string, any>) => Object.keys(item)[0];

describe('template: egern', () => {
    it('keeps node-only output without template', async () => {
        const plain = await convert(parse(SAMPLE), 'egern');
        expect(plain.startsWith('proxies:\n')).toBe(true);
        expect(await convert(parse(SAMPLE), 'egern', { template: 'none' })).toBe(plain);
    });

    for (const preset of ['minimal', 'balanced', 'full'] as const) {
        it(`renders a consistent ${preset} config`, async () => {
            const plain = await convert(parse(SAMPLE), 'egern');
            const text = await convert(parse(SAMPLE), 'egern', { template: preset });
            expect(text).toContain(plain.trimEnd());
            const out = yaml.load(text) as any;
            expect(out.proxies.length).toBe(4);
            expect(out.policy_groups.length).toBeGreaterThan(0);

            const groups = out.policy_groups.map((g: any) => g[kindOf(g)]);
            const known = new Set<string>([
                ...out.proxies.map((p: any) => p.name),
                ...groups.map((g: any) => g.name),
                'DIRECT'
            ]);
            for (const g of out.policy_groups) {
                expect(['select', 'auto_test']).toContain(kindOf(g));
                for (const m of g[kindOf(g)].policies) expect(known.has(m)).toBe(true);
            }
            for (const r of out.rules) {
                const body = r[kindOf(r)];
                expect(known.has(body.policy) || body.policy === 'REJECT').toBe(true);
            }
            const last = out.rules[out.rules.length - 1];
            expect(kindOf(last)).toBe('default');
            expect(known.has(last.default.policy)).toBe(true);
            expect(out.rules.some((r: any) => kindOf(r) === 'geoip' && r.geoip.match === 'CN')).toBe(true);
        });
    }
});
