import { describe, expect, it } from 'vitest';

import { convert, parse } from '../index';
import { isLegacySingbox, parseSingboxVersion } from '../template/renderers/singbox';

const SS = 'ss://' + Buffer.from('aes-256-gcm:pass').toString('base64') + '@us.example.com:8388#US 01';
const SAMPLE = [
    'trojan://p@hk1.example.com:443?sni=a.com#香港 01',
    'trojan://p@hk2.example.com:443?sni=a.com#HK-02 IPLC',
    'hysteria2://pass@jp.example.com:443?sni=jp.example.com#🇯🇵 日本东京',
    SS,
    'trojan://p@x.example.com:443#未知节点',
    'trojan://p@x.example.com:443#未知节点'
].join('\n');

const gen = async (template?: string, userAgent?: string) =>
    JSON.parse(await convert(parse(SAMPLE), 'singbox', { template: template as any, userAgent }));

describe('template: sing-box', () => {
    it('keeps node-only output when template is not set', async () => {
        const out = await gen();
        expect(Object.keys(out)).toEqual(['outbounds']);
    });

    for (const preset of ['minimal', 'balanced', 'full']) {
        it(`renders a complete config for ${preset}`, async () => {
            const out = await gen(preset);
            expect(Object.keys(out)).toEqual(
                expect.arrayContaining(['log', 'dns', 'inbounds', 'outbounds', 'route', 'experimental'])
            );
            const tags = out.outbounds.map((o: any) => o.tag);
            expect(new Set(tags).size).toBe(tags.length);
            expect(tags).toContain('direct');
            expect(out.outbounds.some((o: any) => o.type === 'block')).toBe(false);
            for (const o of out.outbounds.filter((o: any) => ['selector', 'urltest'].includes(o.type))) {
                o.outbounds.forEach((m: string) => expect(tags).toContain(m));
            }
            const sets = out.route.rule_set.map((r: any) => r.tag);
            expect(tags).toContain(out.route.final);
            for (const r of out.route.rules) {
                if (r.outbound) expect(tags).toContain(r.outbound);
                (r.rule_set || []).forEach((s: string) => expect(sets).toContain(s));
            }
            expect(out.route.rule_set[0].format).toBe('binary');
            expect(out.route.default_domain_resolver).toBeDefined();
            expect(out.dns.servers[0].type).toBe('https');
            expect(sets).toContain('geosite-cn');
        });
    }

    it('uses reject action for ads and parses client versions', async () => {
        const out = await gen('full');
        expect(out.route.rules.some((r: any) => r.action === 'reject')).toBe(true);
        expect(parseSingboxVersion('SFA/1.11.4 (build 1; sing-box 1.11.4; language zh_CN)')).toEqual({
            major: 1,
            minor: 11
        });
        expect(isLegacySingbox('sing-box 1.12.0')).toBe(false);
        expect(isLegacySingbox('curl/8')).toBe(false);
    });

    it('emits legacy dns format for sing-box < 1.12', async () => {
        const out = await gen('balanced', 'SFI/1.11.0 (build 1; sing-box 1.11.0)');
        expect(out.dns.servers[0].address).toBeDefined();
        expect(out.route.default_domain_resolver).toBeUndefined();
    });
});

describe('template: sing-box edge cases', () => {
    const st = Buffer.from(JSON.stringify({ version: 3, password: 'pw', host: 'www.apple.com' })).toString('base64');
    const EDGE = [
        'trojan://p@hk1.example.com:443?sni=a.com#香港 01',
        'trojan://p@hk1.example.com:443?sni=a.com#香港 01',
        'ss://' + Buffer.from('aes-256-gcm:pass').toString('base64') + '@us.example.com:8388?shadow-tls=' + st + '#US STLS',
        'anytls://pw@any.example.com:443?sni=any.example.com#日本 AnyTLS',
        'wireguard://' +
            encodeURIComponent('cHJpdmF0ZWtleXByaXZhdGVrZXlwcml2YXRla2V5MTI=') +
            '@wg.example.com:51820?address=10.0.0.2/32&publickey=' +
            encodeURIComponent('cHVibGlja2V5cHVibGlja2V5cHVibGlja2V5cHViMTI=') +
            '&reserved=1,2,3#WG 法国'
    ].join('\n');
    const run = async (userAgent = '') =>
        JSON.parse(await convert(parse(EDGE), 'singbox', { template: 'balanced', userAgent }));

    it('renders WireGuard as endpoint (new) and keeps outbound (legacy)', async () => {
        const out = await run();
        expect(out.endpoints).toHaveLength(1);
        expect(out.endpoints[0].peers[0]).toMatchObject({
            address: 'wg.example.com',
            port: 51820,
            allowed_ips: ['0.0.0.0/0', '::/0'],
            reserved: [1, 2, 3]
        });
        expect(out.outbounds.some((o: any) => o.type === 'wireguard')).toBe(false);
        const auto = out.outbounds.find((o: any) => o.tag === '♻️ 自动选择');
        expect(auto.outbounds).toContain('WG 法国');
        const old = await run('sing-box 1.11.0');
        expect(old.endpoints).toBeUndefined();
        expect(old.outbounds.some((o: any) => o.type === 'wireguard')).toBe(true);
    });

    it('keeps shadowtls helper out of groups and drops anytls for legacy', async () => {
        const out = await run();
        const auto = out.outbounds.find((o: any) => o.tag === '♻️ 自动选择');
        expect(auto.outbounds).not.toContain('US STLS_shadowtls');
        expect(auto.outbounds).toContain('US STLS');
        expect(out.outbounds.some((o: any) => o.tag === 'US STLS_shadowtls')).toBe(true);
        expect(auto.outbounds).toContain('香港 01 2');
        const old = await run('SFA/1.11.4 (build 1; sing-box 1.11.4)');
        expect(old.outbounds.some((o: any) => o.type === 'anytls')).toBe(false);
    });

    it('updates detour when a referenced tag is renamed', async () => {
        const dup = [
            'trojan://p@a.example.com:443#US STLS_shadowtls',
            'ss://' + Buffer.from('aes-256-gcm:pass').toString('base64') + '@us.example.com:8388?shadow-tls=' + st + '#US STLS'
        ].join('\n');
        const out = JSON.parse(await convert(parse(dup), 'singbox', { template: 'balanced' }));
        const ss = out.outbounds.find((o: any) => o.tag === 'US STLS');
        expect(out.outbounds.some((o: any) => o.tag === ss.detour)).toBe(true);
        expect(ss.detour).toBe('US STLS_shadowtls 2');
    });

    it('resolves before IP rules', async () => {
        const out = await run();
        const rules = out.route.rules;
        const i = rules.findIndex((r: any) => r.action === 'resolve');
        expect(i).toBeGreaterThan(0);
        expect(rules[i + 1].rule_set.some((s: string) => s.startsWith('geoip-'))).toBe(true);
    });

    it('wireguard URI defaults allowed-ips', () => {
        const node: any = parse(EDGE).find((n: any) => n.type === 'wireguard');
        expect(node.peers[0]['allowed-ips']).toEqual(['0.0.0.0/0', '::/0']);
    });
});
