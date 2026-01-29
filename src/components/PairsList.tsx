import React, { useState, useEffect } from 'react';
import { useDex } from '../contexts/DexContext';

export const PairsList: React.FC = () => {
    const { dex, config } = useDex();
    const [pairs, setPairs] = useState<string[]>([]);
    const [pairDetails, setPairDetails] = useState<Record<string, { token0?: string; token1?: string; reserve0?: string; reserve1?: string; token0Addr?: string; token1Addr?: string }>>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchPairs = async () => {
            setLoading(true);
            try {
                const allPairs = await dex.getAllPairs();
                setPairs(allPairs);
            } catch (e) {
                console.error('Error fetching pairs:', e);
            } finally {
                setLoading(false);
            }
        };
        fetchPairs();
    }, [dex]);

    useEffect(() => {
        const normalizeHash = (keyStr: string) => {
            if (!keyStr) return '';
            return keyStr
                .toLowerCase()
                .replace(/^hash-/, '')
                .replace(/^contract-/, '')
                .replace(/^contract-package-/, '');
        };

        const formatAmount = (value: bigint, decimals: number, precision = 4) => {
            const raw = value.toString();
            if (decimals <= 0) return raw;
            const padded = raw.padStart(decimals + 1, '0');
            const whole = padded.slice(0, -decimals);
            let fraction = padded.slice(-decimals).replace(/0+$/, '');
            if (precision >= 0 && fraction.length > precision) fraction = fraction.slice(0, precision);
            return fraction.length ? `${whole}.${fraction}` : whole;
        };

        const resolveSymbol = (addr: string) => {
            const normalized = normalizeHash(addr);
            return Object.entries(config.tokens).find(([, t]) => {
                const pkg = normalizeHash(t.packageHash);
                const ctr = normalizeHash(t.contractHash);
                return normalized === pkg || normalized === ctr;
            })?.[0];
        };

        const loadDetails = async () => {
            if (!pairs.length) {
                setPairDetails({});
                return;
            }
            const entries = await Promise.all(pairs.map(async (pair) => {
                const state = await dex.getPairState(pair);
                if (!state) return [pair, {}] as const;
                const token0Symbol = resolveSymbol(state.token0) || 'UNKNOWN';
                const token1Symbol = resolveSymbol(state.token1) || 'UNKNOWN';
                const dec0 = config.tokens[token0Symbol]?.decimals ?? 18;
                const dec1 = config.tokens[token1Symbol]?.decimals ?? 18;
                return [pair, {
                    token0: token0Symbol,
                    token1: token1Symbol,
                    reserve0: formatAmount(state.reserve0, dec0, 4),
                    reserve1: formatAmount(state.reserve1, dec1, 4),
                    token0Addr: state.token0,
                    token1Addr: state.token1
                }] as const;
            }));
            setPairDetails(Object.fromEntries(entries));
        };
        loadDetails();
    }, [pairs, dex, config]);

    if (loading) {
        return (
            <div className="card">
                <h3>Liquidity Pools</h3>
                <p>Loading...</p>
            </div>
        );
    }

    return (
        <div className="card">
            <h3>Liquidity Pools ({pairs.length})</h3>
            {pairs.length === 0 ? (
                <div style={{ padding: '1rem', color: '#aaa', textAlign: 'center' }}>
                    <p>⚠️ No liquidity pools exist yet</p>
                    <p style={{ fontSize: '0.9rem' }}>
                        Create a pool by adding liquidity for a token pair
                    </p>
                </div>
            ) : (
                <div style={{ marginTop: '1rem' }}>
                    {pairs.map((pair, index) => (
                        <div 
                            key={pair}
                            style={{
                                padding: '0.75rem',
                                marginBottom: '0.5rem',
                                background: 'rgba(255,255,255,0.05)',
                                borderRadius: '4px',
                                fontSize: '0.85rem'
                            }}
                        >
                            <div style={{ fontWeight: 'bold', marginBottom: '0.25rem' }}>
                                Pool #{index + 1}
                            </div>
                            {pairDetails[pair]?.token0 && pairDetails[pair]?.token1 ? (
                                <div style={{ marginBottom: '0.35rem', color: '#ddd' }}>
                                    Pair: {pairDetails[pair].token0} / {pairDetails[pair].token1}
                                    <br />
                                    Reserves: {pairDetails[pair].token0}: {pairDetails[pair].reserve0 ?? '0'} | {pairDetails[pair].token1}: {pairDetails[pair].reserve1 ?? '0'}
                                </div>
                            ) : (
                                <div style={{ marginBottom: '0.35rem', color: '#aaa' }}>
                                    Pool details unavailable
                                </div>
                            )}
                            {pairDetails[pair]?.token0Addr && pairDetails[pair]?.token1Addr && (
                                <div style={{ color: '#888', fontSize: '0.75rem' }}>
                                    token0: {pairDetails[pair].token0Addr} | token1: {pairDetails[pair].token1Addr}
                                </div>
                            )}
                            <div style={{ color: '#aaa', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                                {pair}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
